import { NextRequest, NextResponse } from "next/server";
import { assertSafeId, deleteSession } from "../_files";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { sessionId?: string };
    const sessionId = assertSafeId(body.sessionId, "session id");

    await deleteSession(sessionId);

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Cleanup failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
