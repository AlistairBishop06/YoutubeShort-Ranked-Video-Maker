import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export const runtime = "nodejs";

export async function GET() {
  const filePath = resolve(process.cwd(), "app", "assets", "sounds", "boom.mp3");
  const file = await readFile(filePath);

  return new Response(file, {
    headers: {
      "Content-Type": "audio/mpeg",
      "Cache-Control": "public, max-age=31536000, immutable"
    }
  });
}
