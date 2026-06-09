import { NextRequest, NextResponse } from "next/server";
import { join } from "node:path";
import { writeFile } from "node:fs/promises";
import {
  assertSafeId,
  createSafeId,
  deleteSession,
  ensureSessionDir,
  findClipPath
} from "../_files";

export const runtime = "nodejs";
export const maxDuration = 120;

type TikWMDownloadResponse = {
  code?: number;
  msg?: string;
  data?: {
    play?: string;
    hdplay?: string;
    wmplay?: string;
    title?: string;
  };
};

function isValidTikTokUrl(value: string) {
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^www\./, "");
    return (
      url.protocol === "https:" &&
      (host === "tiktok.com" ||
        host === "m.tiktok.com" ||
        host === "vm.tiktok.com" ||
        host === "vt.tiktok.com")
    );
  } catch {
    return false;
  }
}

function isCloudflareChallenge(value: string) {
  const lower = value.toLowerCase();
  return (
    lower.includes("just a moment") ||
    lower.includes("challenges.cloudflare.com") ||
    lower.includes("cf-chl") ||
    lower.includes("cloudflare")
  );
}

function normalizeMediaUrl(value: string) {
  if (value.startsWith("//")) {
    return `https:${value}`;
  }

  return value;
}

async function resolveTikWMDownloadUrl(tiktokUrl: string) {
  const apiUrl = new URL("https://www.tikwm.com/api/");
  apiUrl.searchParams.set("url", tiktokUrl);
  apiUrl.searchParams.set("hd", "1");

  const response = await fetch(apiUrl, {
    headers: {
      Accept: "application/json",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36"
    }
  });
  const text = await response.text();

  if (!response.ok || isCloudflareChallenge(text)) {
    throw new Error(
      `TikWM direct download is currently unavailable${response.status ? ` (HTTP ${response.status})` : ""}.`
    );
  }

  let payload: TikWMDownloadResponse;

  try {
    payload = JSON.parse(text) as TikWMDownloadResponse;
  } catch {
    throw new Error("TikWM returned a non-JSON download response.");
  }

  const mediaUrl = payload.data?.hdplay || payload.data?.play || payload.data?.wmplay;

  if (payload.code !== 0 || !mediaUrl) {
    throw new Error(payload.msg || "TikWM could not resolve this TikTok link.");
  }

  return normalizeMediaUrl(mediaUrl);
}

async function downloadMediaToFile(mediaUrl: string, outputPath: string) {
  const response = await fetch(mediaUrl, {
    headers: {
      Referer: "https://www.tikwm.com/",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36"
    }
  });

  if (!response.ok) {
    throw new Error(`Resolved TikTok media could not be downloaded (HTTP ${response.status}).`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());

  if (!bytes.length) {
    throw new Error("Resolved TikTok media was empty.");
  }

  await writeFile(outputPath, bytes);
}

function downloaderErrorMessage(error: unknown) {
  if (!(error instanceof Error)) {
    return "TikTok download failed.";
  }

  const message = error.message.trim();

  if (!message) {
    return "TikTok download failed before the server returned details.";
  }

  if (
    message.includes("Unsupported URL") ||
    message.includes("Unable to") ||
    message.includes("This video is unavailable") ||
    message.includes("Private video") ||
    message.includes("Sign in")
  ) {
    return "TikTok download failed. The link may be private, region-blocked, age-gated, or protected by TikTok.";
  }

  if (message.includes("TikWM direct download is currently unavailable")) {
    return "TikTok download is temporarily unavailable because TikWM is blocked or rate-limited. Try again later or upload the clip manually.";
  }

  return message;
}

export async function POST(request: NextRequest) {
  let newSessionIdForFailureCleanup: string | null = null;

  try {
    const body = (await request.json()) as { url?: string; sessionId?: string };
    const url = body.url?.trim() ?? "";

    if (!isValidTikTokUrl(url)) {
      return NextResponse.json({ error: "Enter a valid TikTok URL." }, { status: 400 });
    }

    const sessionId = body.sessionId ? assertSafeId(body.sessionId, "session id") : createSafeId();
    newSessionIdForFailureCleanup = body.sessionId ? null : sessionId;
    const clipId = createSafeId();
    const sessionDir = await ensureSessionDir(sessionId);
    const outputPath = join(sessionDir, `${clipId}.mp4`);

    // Server-side TikTok pulling is intentionally isolated from browser FFmpeg:
    // TikWM resolves a known TikTok link to a media URL, then the server writes
    // the short-lived MP4 into the OS temp directory for the browser to fetch.
    const mediaUrl = await resolveTikWMDownloadUrl(url);
    await downloadMediaToFile(mediaUrl, outputPath);

    const clip = await findClipPath(sessionId, clipId);

    return NextResponse.json({
      sessionId,
      clipId,
      fileName: clip.fileName,
      size: clip.size,
      downloadUrl: `/api/tiktok/file?sessionId=${sessionId}&clipId=${clipId}`
    });
  } catch (error) {
    if (newSessionIdForFailureCleanup) {
      await deleteSession(newSessionIdForFailureCleanup);
    }

    const message = downloaderErrorMessage(error);
    console.error("TikTok download failed:", error);

    return NextResponse.json(
      {
        error: message
      },
      { status: 500 }
    );
  }
}
