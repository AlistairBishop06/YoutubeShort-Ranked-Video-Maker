import { NextRequest, NextResponse } from "next/server";

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

function uniqueMediaUrls(values: Array<string | undefined>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)).map(normalizeMediaUrl))];
}

function hasMp4AudioTrack(bytes: Buffer) {
  const containers = new Set(["moov", "trak", "mdia", "minf", "stbl", "edts", "moof", "traf"]);

  function scan(start: number, end: number, depth: number): boolean {
    let offset = start;

    while (offset + 8 <= end && depth < 12) {
      const size32 = bytes.readUInt32BE(offset);
      const type = bytes.toString("ascii", offset + 4, offset + 8);
      let headerSize = 8;
      let boxSize = size32;

      if (size32 === 1 && offset + 16 <= end) {
        const largeSize = bytes.readBigUInt64BE(offset + 8);
        boxSize = Number(largeSize);
        headerSize = 16;
      } else if (size32 === 0) {
        boxSize = end - offset;
      }

      if (!Number.isFinite(boxSize) || boxSize < headerSize || offset + boxSize > end) {
        break;
      }

      if (type === "hdlr" && offset + 20 <= end) {
        const handlerType = bytes.toString("ascii", offset + 16, offset + 20);

        if (handlerType === "soun") {
          return true;
        }
      }

      if (containers.has(type) && scan(offset + headerSize, offset + boxSize, depth + 1)) {
        return true;
      }

      offset += boxSize;
    }

    return false;
  }

  return scan(0, bytes.length, 0);
}

async function resolveTikWMMediaUrls(tiktokUrl: string) {
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

  const mediaUrls = uniqueMediaUrls([
    payload.data?.play,
    payload.data?.wmplay,
    payload.data?.hdplay
  ]);

  if (payload.code !== 0 || !mediaUrls.length) {
    throw new Error(payload.msg || "TikWM could not resolve this TikTok link.");
  }

  return mediaUrls;
}

async function downloadMedia(mediaUrl: string) {
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

  return bytes;
}

async function downloadBestAudioMedia(mediaUrls: string[]) {
  let firstDownloadedBytes: Buffer | null = null;
  let lastError: Error | null = null;

  for (const mediaUrl of mediaUrls) {
    try {
      const bytes = await downloadMedia(mediaUrl);
      firstDownloadedBytes ??= bytes;

      if (hasMp4AudioTrack(bytes)) {
        return bytes;
      }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("Resolved TikTok media could not be downloaded.");
    }
  }

  if (firstDownloadedBytes) {
    return firstDownloadedBytes;
  }

  throw lastError ?? new Error("Resolved TikTok media could not be downloaded.");
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
  try {
    const body = (await request.json()) as { url?: string };
    const url = body.url?.trim() ?? "";

    if (!isValidTikTokUrl(url)) {
      return NextResponse.json({ error: "Enter a valid TikTok URL." }, { status: 400 });
    }

    // Server-side TikTok pulling is intentionally isolated from browser FFmpeg:
    // TikWM resolves a known TikTok link to a media URL, then this route returns
    // the MP4 bytes directly so Vercel never has to share temp files between
    // separate serverless function invocations.
    const mediaUrls = await resolveTikWMMediaUrls(url);
    const bytes = await downloadBestAudioMedia(mediaUrls);

    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "video/mp4",
        "Content-Length": String(bytes.length),
        "Content-Disposition": 'attachment; filename="tiktok-clip.mp4"',
        "X-Has-Audio": hasMp4AudioTrack(bytes) ? "true" : "false"
      }
    });
  } catch (error) {
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
