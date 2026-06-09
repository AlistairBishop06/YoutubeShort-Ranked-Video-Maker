import { NextRequest, NextResponse } from "next/server";
import { join, resolve } from "node:path";
import { create as createYoutubeDl } from "youtube-dl-exec";
import {
  assertSafeId,
  createSafeId,
  deleteSession,
  ensureSessionDir,
  findClipPath
} from "../_files";

export const runtime = "nodejs";
export const maxDuration = 120;

const youtubeDl = createYoutubeDl(
  resolve(
    process.cwd(),
    "node_modules",
    "youtube-dl-exec",
    "bin",
    process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp"
  )
);

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

function downloaderErrorMessage(error: unknown) {
  if (!(error instanceof Error)) {
    return "TikTok download failed.";
  }

  const details = error as Error & { stderr?: string; stdout?: string; code?: string };
  const message = [error.message, details.stderr, details.stdout, details.code]
    .filter(Boolean)
    .join("\n")
    .trim();

  if (!message) {
    return "TikTok download failed before yt-dlp returned details.";
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

  if (message.includes("ENOENT")) {
    return "Could not find the bundled yt-dlp downloader binary.";
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
    const outputTemplate = join(sessionDir, `${clipId}.%(ext)s`);

    // Server-side TikTok pulling is intentionally isolated from browser FFmpeg:
    // yt-dlp writes a short-lived source clip into the OS temp directory, then
    // the client fetches it as a blob and asks cleanup to delete it after export.
    await youtubeDl(url, {
      output: outputTemplate,
      format: "best[ext=mp4]/best",
      noPlaylist: true,
      noWarnings: true,
      noCheckCertificates: true,
      forceOverwrites: true,
      windowsFilenames: true,
      socketTimeout: 30,
      retries: 2,
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36"
    });

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
