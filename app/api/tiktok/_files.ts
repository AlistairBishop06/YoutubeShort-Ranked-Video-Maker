import { mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

export const TEMP_ROOT = resolve(process.cwd(), ".tmp", "tiktok-clips");

export function createSafeId() {
  return randomUUID().replace(/-/g, "");
}

export function assertSafeId(value: unknown, label: string) {
  if (typeof value !== "string" || !/^[a-f0-9]{32}$/i.test(value)) {
    throw new Error(`Invalid ${label}.`);
  }

  return value.toLowerCase();
}

export function getSessionDir(sessionId: string) {
  const dir = resolve(TEMP_ROOT, sessionId);

  if (!dir.startsWith(`${TEMP_ROOT}\\`) && dir !== TEMP_ROOT) {
    throw new Error("Invalid temp directory.");
  }

  return dir;
}

export async function ensureSessionDir(sessionId: string) {
  const sessionDir = getSessionDir(sessionId);
  await mkdir(sessionDir, { recursive: true });
  return sessionDir;
}

export async function findClipPath(sessionId: string, clipId: string) {
  const sessionDir = getSessionDir(sessionId);
  const files = await readdir(sessionDir);
  const match = files.find(
    (file) => file.startsWith(`${clipId}.`) && !file.endsWith(".part") && !file.endsWith(".ytdl")
  );

  if (!match) {
    throw new Error("Downloaded clip was not found.");
  }

  const clipPath = resolve(join(sessionDir, match));

  if (!clipPath.startsWith(`${sessionDir}\\`)) {
    throw new Error("Invalid clip path.");
  }

  const info = await stat(clipPath);

  if (!info.isFile() || info.size === 0) {
    throw new Error("Downloaded clip is empty.");
  }

  return { clipPath, fileName: match, size: info.size };
}

export async function readClip(sessionId: string, clipId: string) {
  const clip = await findClipPath(sessionId, clipId);
  const bytes = await readFile(clip.clipPath);
  return { ...clip, bytes };
}

export async function deleteSession(sessionId: string) {
  await rm(getSessionDir(sessionId), { recursive: true, force: true });
}

export function contentTypeFor(fileName: string) {
  const lower = fileName.toLowerCase();

  if (lower.endsWith(".webm")) {
    return "video/webm";
  }

  if (lower.endsWith(".mov")) {
    return "video/quicktime";
  }

  return "video/mp4";
}
