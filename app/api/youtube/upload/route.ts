import { google } from "googleapis";
import { NextRequest, NextResponse } from "next/server";
import { Readable } from "node:stream";

export const runtime = "nodejs";
export const maxDuration = 300;

const REQUIRED_ENV = ["YOUTUBE_CLIENT_ID", "YOUTUBE_CLIENT_SECRET", "YOUTUBE_REFRESH_TOKEN"];

function missingConfig() {
  return REQUIRED_ENV.filter((key) => !process.env[key]);
}

function youtubeAuth() {
  const oauth2Client = new google.auth.OAuth2(
    process.env.YOUTUBE_CLIENT_ID,
    process.env.YOUTUBE_CLIENT_SECRET
  );

  oauth2Client.setCredentials({
    refresh_token: process.env.YOUTUBE_REFRESH_TOKEN
  });

  return oauth2Client;
}

function cleanTags(value: FormDataEntryValue | null) {
  if (typeof value !== "string") {
    return ["shorts", "viral", "top 5"];
  }

  const tags = value
    .split(",")
    .map((tag) => tag.replace(/^#/, "").trim())
    .filter(Boolean)
    .slice(0, 20);

  return tags.length ? tags : ["shorts", "viral", "top 5"];
}

function isCompleteMp4(bytes: Buffer) {
  return (
    bytes.length >= 100_000 &&
    bytes.indexOf(Buffer.from("ftyp"), 0) >= 0 &&
    bytes.indexOf(Buffer.from("moov"), 0) >= 0 &&
    bytes.indexOf(Buffer.from("mdat"), 0) >= 0 &&
    bytes.indexOf(Buffer.from("vide"), 0) >= 0
  );
}

function isCompleteWebm(bytes: Buffer) {
  return (
    bytes.length >= 100_000 &&
    bytes[0] === 0x1a &&
    bytes[1] === 0x45 &&
    bytes[2] === 0xdf &&
    bytes[3] === 0xa3
  );
}

export async function GET() {
  const missing = missingConfig();

  return NextResponse.json({
    configured: missing.length === 0,
    missing,
    privacyStatus: process.env.YOUTUBE_PRIVACY_STATUS ?? "private"
  });
}

export async function POST(request: NextRequest) {
  const missing = missingConfig();

  if (missing.length) {
    return NextResponse.json(
      {
        error: `YouTube upload is not configured. Missing: ${missing.join(", ")}.`
      },
      { status: 400 }
    );
  }

  const formData = await request.formData();
  const file = formData.get("video");
  const title = String(formData.get("title") || "Ranking Short").slice(0, 100);
  const description = String(formData.get("description") || "").slice(0, 5000);
  const tags = cleanTags(formData.get("tags"));

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing generated video file." }, { status: 400 });
  }

  const bytes = Buffer.from(await file.arrayBuffer());

  const isMp4 = file.type.startsWith("video/mp4") && isCompleteMp4(bytes);
  const isWebm = file.type.startsWith("video/webm") && isCompleteWebm(bytes);

  if (!isMp4 && !isWebm) {
    return NextResponse.json(
      { error: "The generated video is incomplete or has no playable track. Generate it again." },
      { status: 400 }
    );
  }

  const youtube = google.youtube({ version: "v3", auth: youtubeAuth() });

  // YouTube uploads require OAuth access to the user's channel. The refresh
  // token lets this local server obtain short-lived access tokens without
  // putting OAuth secrets in the browser.
  const response = await youtube.videos.insert({
    part: ["snippet", "status"],
    requestBody: {
      snippet: {
        title,
        description,
        tags,
        categoryId: process.env.YOUTUBE_CATEGORY_ID ?? "24"
      },
      status: {
        privacyStatus: process.env.YOUTUBE_PRIVACY_STATUS ?? "private",
        selfDeclaredMadeForKids: false
      }
    },
    media: {
      mimeType: file.type || "video/mp4",
      body: Readable.from(bytes)
    }
  });

  const videoId = response.data.id;

  if (!videoId) {
    return NextResponse.json({ error: "YouTube upload did not return a video id." }, { status: 502 });
  }

  return NextResponse.json({
    videoId,
    url: `https://www.youtube.com/watch?v=${videoId}`,
    privacyStatus: process.env.YOUTUBE_PRIVACY_STATUS ?? "private"
  });
}
