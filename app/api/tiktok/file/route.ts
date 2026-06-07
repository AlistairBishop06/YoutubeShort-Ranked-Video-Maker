import { NextRequest, NextResponse } from "next/server";
import { assertSafeId, contentTypeFor, readClip } from "../_files";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const sessionId = assertSafeId(request.nextUrl.searchParams.get("sessionId"), "session id");
    const clipId = assertSafeId(request.nextUrl.searchParams.get("clipId"), "clip id");
    const clip = await readClip(sessionId, clipId);

    return new NextResponse(clip.bytes, {
      headers: {
        "Content-Type": contentTypeFor(clip.fileName),
        "Content-Length": String(clip.size),
        "Content-Disposition": `inline; filename="${clip.fileName}"`
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Clip not found.";
    return NextResponse.json({ error: message }, { status: 404 });
  }
}
