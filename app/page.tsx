"use client";

import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile } from "@ffmpeg/util";
import {
  AlertCircle,
  Check,
  Clock,
  Copy,
  Download,
  ExternalLink,
  Github,
  Lightbulb,
  Loader2,
  Play,
  Search,
  Upload,
  Wand2,
  Youtube
} from "lucide-react";
import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";

type RankingEntry = {
  rank: number;
  name: string;
  url: string;
  file: File | null;
  duration?: number;
};

type FieldErrors = Record<string, string>;

type DownloadedClipResponse = {
  sessionId: string;
  clipId: string;
  fileName: string;
  size: number;
  downloadUrl: string;
};

type ViralCandidate = {
  id: string;
  url: string;
  name: string;
  sourceTitle: string;
  creator: string;
  thumbnail: string;
  duration: number;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  score: number;
};

type ViralIdea = {
  topic: string;
  title: string;
  source: string;
  description: string;
  hashtags: string[];
  candidates: ViralCandidate[];
  generatedAt: string;
};

type YouTubeStatus = {
  configured: boolean;
  missing: string[];
  privacyStatus: string;
};

type GitHubScheduleStatus = {
  configured: boolean;
  missing: string[];
  schedule?: {
    enabled: boolean;
    times: string[];
    timezone: string;
    lastSlot?: string;
  };
};

type GenerateVideoOptions = {
  formTitle?: string;
  formEntries?: RankingEntry[];
  forceUpload?: boolean;
  description?: string;
  tags?: string[];
};

type ClipPlan = {
  duration: number;
  start: number;
};

type HookTeaserLines = {
  primary: string;
};

const RANK_COUNT = 5;
const OUTPUT_WIDTH = 1080;
const OUTPUT_HEIGHT = 1920;
const DEFAULT_DURATION_SECONDS = 15;
const HOOK_DURATION_SECONDS = 5;
const SFX_SAMPLE_RATE = 44100;
const AUTO_RUN_INTERVAL_MS = 15 * 60 * 1000;
const DEFAULT_DAILY_UPLOAD_TIMES = "5am, 7am, 9am, 11am";

const initialEntries = Array.from({ length: RANK_COUNT }, (_, index) => ({
  rank: index + 1,
  name: "",
  url: "",
  file: null
}));

function entriesFromCandidates(candidates: ViralCandidate[]) {
  return candidates.slice(0, RANK_COUNT).map((candidate, index) => ({
    rank: index + 1,
    name: candidate.name || `@${candidate.creator}`,
    url: candidate.url,
    file: null,
    duration: candidate.duration
  }));
}

function candidateIdsFromCandidates(candidates: ViralCandidate[]) {
  return candidates.slice(0, RANK_COUNT).map((candidate) => candidate.id);
}

function formatCountdown(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes.toString().padStart(2, "0")}m`;
  }

  return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
}

function normalizeDailyTimeToken(token: string) {
  const compact = token.trim().toLowerCase().replace(/\s+/g, "");

  if (!compact) {
    return null;
  }

  const meridiemMatch = compact.match(/^(\d{1,2})(?::(\d{2}))?(am|pm)$/);

  if (meridiemMatch) {
    let hour = Number(meridiemMatch[1]);
    const minute = Number(meridiemMatch[2] ?? "0");
    const meridiem = meridiemMatch[3];

    if (hour < 1 || hour > 12 || minute < 0 || minute > 59) {
      return null;
    }

    if (meridiem === "am") {
      hour = hour === 12 ? 0 : hour;
    } else {
      hour = hour === 12 ? 12 : hour + 12;
    }

    return `${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`;
  }

  const clockMatch = compact.match(/^(\d{1,2})(?::(\d{2}))?$/);

  if (!clockMatch) {
    return null;
  }

  const hour = Number(clockMatch[1]);
  const minute = Number(clockMatch[2] ?? "0");

  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }

  return `${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`;
}

function parseDailyScheduleInput(value: string) {
  const tokens = value.split(/[\s,;]+/).filter(Boolean);
  const invalidTokens: string[] = [];
  const times = tokens
    .map((token) => {
      const normalized = normalizeDailyTimeToken(token);

      if (!normalized) {
        invalidTokens.push(token);
      }

      return normalized;
    })
    .filter((time): time is string => Boolean(time));

  const uniqueTimes = [...new Set(times)].sort();

  if (!tokens.length) {
    return { times: uniqueTimes, error: "Add at least one upload time." };
  }

  if (invalidTokens.length) {
    return { times: uniqueTimes, error: `Invalid upload time: ${invalidTokens[0]}.` };
  }

  return { times: uniqueTimes, error: "" };
}

function timeToMinutes(time: string) {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
}

function nextDailyRunTimestamp(times: string[], now = new Date()) {
  const sortedTimes = [...times].sort((a, b) => timeToMinutes(a) - timeToMinutes(b));
  const nowTimestamp = now.getTime();

  for (const time of sortedTimes) {
    const [hour, minute] = time.split(":").map(Number);
    const candidate = new Date(now);
    candidate.setHours(hour, minute, 0, 0);

    if (candidate.getTime() > nowTimestamp + 1000) {
      return candidate.getTime();
    }
  }

  const [hour, minute] = sortedTimes[0].split(":").map(Number);
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(hour, minute, 0, 0);
  return tomorrow.getTime();
}

function formatLocalTime(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(timestamp));
}

function isValidTikTokUrl(value: string) {
  if (!value.trim()) {
    return true;
  }

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

function fileExtension(file: File) {
  const fromName = file.name.split(".").pop();

  if (fromName && fromName.length <= 5) {
    return fromName.toLowerCase();
  }

  if (file.type.includes("quicktime")) {
    return "mov";
  }

  if (file.type.includes("webm")) {
    return "webm";
  }

  return "mp4";
}

function extensionFromName(fileName: string) {
  return fileName.split(".").pop()?.toLowerCase() || "mp4";
}

function formatMetric(value: number) {
  return Intl.NumberFormat("en", {
    notation: "compact",
    maximumFractionDigits: 1
  }).format(value);
}

function emojiPackForTitle(value: string) {
  const lower = value.toLowerCase();

  if (lower.includes("fail") || lower.includes("crashout")) {
    return ["💀", "😂", "🔥"];
  }

  if (lower.includes("stream") || lower.includes("twitch") || lower.includes("youtube")) {
    return ["🎮", "😂", "🔥"];
  }

  return ["😂", "🔥", "😱"];
}

function viralVideoTitle(value: string) {
  const [firstEmoji, secondEmoji] = emojiPackForTitle(value);
  const cleanTitle = value.trim() || "Top 5 Viral Moments";

  return `${firstEmoji} ${cleanTitle} ${secondEmoji}`;
}

function downloadFileName(value: string) {
  const slug = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `🔥-${slug || "ranking-short"}-😂.mp4`;
}

function buildCopyDescription(idea: ViralIdea, selectedCandidates: ViralCandidate[]) {
  const candidates =
    selectedCandidates.length === RANK_COUNT
      ? selectedCandidates
      : idea.candidates.slice(0, RANK_COUNT);
  const [laughEmoji, fireEmoji, shockEmoji] = emojiPackForTitle(idea.title);
  const featureWords = candidates
    .map((candidate) => candidate.name)
    .filter(Boolean)
    .slice(0, 4)
    .join(", ");
  const hashtags = idea.hashtags?.length
    ? idea.hashtags
    : ["#TikTokRankings", "#Top5", "#ViralTikTok", "#Shorts", "#YouTubeShorts", "#FYP"];

  return [
    `${laughEmoji} ${idea.title} ranked from #5 to #1 ${fireEmoji}`,
    `${shockEmoji} Wait for #1... it gets WILD.`,
    featureWords
      ? `Best moments: ${featureWords} ${laughEmoji}`
      : `Which clip deserves the top spot? ${laughEmoji}`,
    "Who got cooked the hardest? Comment your winner 👇",
    "Subscribe for more funny moments 🏆",
    "",
    hashtags.join(" ")
  ].join("\n");
}

function fallbackUploadDescription(title: string, entries: RankingEntry[]) {
  const [laughEmoji, fireEmoji, shockEmoji] = emojiPackForTitle(title);
  const names = entries
    .map((entry) => entry.name.trim())
    .filter(Boolean)
    .slice(0, 5);

  return [
    `${laughEmoji} ${title} ranked from #5 to #1 ${fireEmoji}`,
    `${shockEmoji} Wait for #1... it gets WILD.`,
    names.length
      ? `Best moments: ${names.join(", ")} ${laughEmoji}`
      : `Which clip deserves the top spot? ${laughEmoji}`,
    "Who got cooked the hardest? Comment your winner 👇",
    "Subscribe for more funny moments 🏆",
    "",
    "#Top5 #ViralTikTok #FunnyMoments #MustWatch #Shorts #YouTubeShorts #FYP #Trending"
  ].join("\n");
}

function uploadTagsFromDescription(description: string) {
  const tags = [...description.matchAll(/#([a-zA-Z0-9_]+)/g)]
    .map((match) => match[1])
    .filter(Boolean);

  return [...new Set(tags.length ? tags : ["Top5", "ViralTikTok", "Shorts", "YouTubeShorts"])];
}

function escapeConcatPath(path: string) {
  return path.replace(/'/g, "'\\''");
}

function assertUint8Array(data: Awaited<ReturnType<FFmpeg["readFile"]>>) {
  if (typeof data === "string") {
    return new TextEncoder().encode(data);
  }

  return data;
}

function toArrayBuffer(bytes: Uint8Array) {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number
) {
  const words = text.trim().split(/\s+/);
  const lines: string[] = [];
  let currentLine = "";

  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;

    if (ctx.measureText(testLine).width <= maxWidth) {
      currentLine = testLine;
      continue;
    }

    if (currentLine) {
      lines.push(currentLine);
    }

    currentLine = word;

    if (lines.length === maxLines - 1) {
      break;
    }
  }

  if (currentLine && lines.length < maxLines) {
    lines.push(currentLine);
  }

  const hiddenWords = words.slice(lines.join(" ").split(/\s+/).length);

  if (hiddenWords.length && lines.length) {
    let lastLine = lines[lines.length - 1];

    while (ctx.measureText(`${lastLine}...`).width > maxWidth && lastLine.length > 0) {
      lastLine = lastLine.slice(0, -1);
    }

    lines[lines.length - 1] = `${lastLine.trim()}...`;
  }

  return lines;
}

function wrapTextFully(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let currentLine = "";

  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;

    if (ctx.measureText(testLine).width <= maxWidth) {
      currentLine = testLine;
      continue;
    }

    if (currentLine) {
      lines.push(currentLine);
      currentLine = "";
    }

    if (ctx.measureText(word).width <= maxWidth) {
      currentLine = word;
      continue;
    }

    let wordChunk = "";

    for (const char of word) {
      const testChunk = `${wordChunk}${char}`;

      if (ctx.measureText(testChunk).width <= maxWidth) {
        wordChunk = testChunk;
        continue;
      }

      if (wordChunk) {
        lines.push(wordChunk);
      }

      wordChunk = char;
    }

    currentLine = wordChunk;
  }

  if (currentLine) {
    lines.push(currentLine);
  }

  return lines.length ? lines : [text];
}

function titleFontForLineCount(lineCount: number) {
  if (lineCount <= 2) {
    return { size: 68, lineHeight: 78 };
  }

  if (lineCount === 3) {
    return { size: 58, lineHeight: 68 };
  }

  return { size: 48, lineHeight: 58 };
}

function bestHookEntry(entries: RankingEntry[]) {
  // The hook should tease the strongest moment before the countdown starts.
  // In a ranked video, #1 is the safest default source when no separate hook
  // candidate exists in the browser editor.
  return [...entries].sort((a, b) => a.rank - b.rank)[0] ?? entries[0];
}

function randomItem<T>(items: T[]) {
  return items[Math.floor(Math.random() * items.length)];
}

function hookTeaserLines(value: string): HookTeaserLines {
  const lower = value.toLowerCase();
  const primary = [
    "WAIT FOR #1",
    "#1 IS UNREAL",
    "THIS GETS WORSE",
    "THE LAST ONE WINS",
    "DO NOT MISS #1"
  ];

  if (lower.includes("stream") || lower.includes("twitch") || lower.includes("speed")) {
    primary.push("CHAT WAS NOT READY", "THE STREAM WENT WILD");
  }

  if (lower.includes("fail") || lower.includes("crashout")) {
    primary.push("INSTANT REGRET", "THIS WAS A VIOLATION");
  }

  return {
    primary: randomItem(primary)
  };
}

function createImpactSfxWavBytes() {
  const durationSeconds = 0.48;
  const channels = 2;
  const bitsPerSample = 16;
  const sampleCount = Math.floor(SFX_SAMPLE_RATE * durationSeconds);
  const dataBytes = sampleCount * channels * (bitsPerSample / 8);
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  let offset = 0;

  const writeString = (value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset, value.charCodeAt(index));
      offset += 1;
    }
  };
  const writeUint32 = (value: number) => {
    view.setUint32(offset, value, true);
    offset += 4;
  };
  const writeUint16 = (value: number) => {
    view.setUint16(offset, value, true);
    offset += 2;
  };

  writeString("RIFF");
  writeUint32(36 + dataBytes);
  writeString("WAVE");
  writeString("fmt ");
  writeUint32(16);
  writeUint16(1);
  writeUint16(channels);
  writeUint32(SFX_SAMPLE_RATE);
  writeUint32(SFX_SAMPLE_RATE * channels * (bitsPerSample / 8));
  writeUint16(channels * (bitsPerSample / 8));
  writeUint16(bitsPerSample);
  writeString("data");
  writeUint32(dataBytes);

  for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
    const t = sampleIndex / SFX_SAMPLE_RATE;
    const envelope = Math.exp(-t * 8.5);
    const kick = Math.sin(2 * Math.PI * (132 * t - 56 * t * t)) * envelope;
    const click = Math.sin(2 * Math.PI * 760 * t) * Math.exp(-t * 22);
    const noise = (Math.random() * 2 - 1) * Math.exp(-t * 32);
    const mixed = Math.max(-1, Math.min(1, (kick * 0.72 + click * 0.22 + noise * 0.12) * 0.58));
    const pcm = Math.round(mixed * 32767);

    for (let channel = 0; channel < channels; channel += 1) {
      view.setInt16(offset, pcm, true);
      offset += 2;
    }
  }

  return new Uint8Array(buffer);
}

async function canvasToPngBytes(canvas: HTMLCanvasElement) {
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((result) => {
      if (result) {
        resolve(result);
      } else {
        reject(new Error("Could not render overlay canvas."));
      }
    }, "image/png");
  });

  return new Uint8Array(await blob.arrayBuffer());
}

async function videoDurationFromFile(file: File) {
  const url = URL.createObjectURL(file);

  try {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.src = url;

    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error("Could not read video metadata."));
    });

    return Number.isFinite(video.duration) ? video.duration : 0;
  } catch {
    return 0;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function audioHighlightStartFromFile(file: File, sourceDuration: number, windowSeconds: number) {
  const AudioContextConstructor =
    window.AudioContext ||
    (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

  if (!AudioContextConstructor) {
    return Math.max(0, (sourceDuration - windowSeconds) / 2);
  }

  const audioContext = new AudioContextConstructor();

  try {
    const decoded = await audioContext.decodeAudioData(await file.arrayBuffer());
    const sampleRate = decoded.sampleRate;
    const windowSamples = Math.max(1, Math.floor(windowSeconds * sampleRate));
    const stepSamples = Math.max(1, Math.floor(0.5 * sampleRate));
    const sampleStride = Math.max(1, Math.floor(sampleRate / 200));
    const maxStartSample = Math.max(0, decoded.length - windowSamples);
    let bestStartSample = 0;
    let bestScore = -Infinity;

    for (let startSample = 0; startSample <= maxStartSample; startSample += stepSamples) {
      const endSample = Math.min(decoded.length, startSample + windowSamples);
      let total = 0;
      let samples = 0;

      for (let channel = 0; channel < decoded.numberOfChannels; channel += 1) {
        const data = decoded.getChannelData(channel);

        for (let index = startSample; index < endSample; index += sampleStride) {
          total += data[index] * data[index];
          samples += 1;
        }
      }

      const rms = samples ? Math.sqrt(total / samples) : 0;
      const centerBias = 1 - Math.abs(startSample / Math.max(1, maxStartSample) - 0.5) * 0.08;
      const score = rms * centerBias;

      if (score > bestScore) {
        bestScore = score;
        bestStartSample = startSample;
      }
    }

    return Math.max(0, Math.min(bestStartSample / sampleRate, sourceDuration - windowSeconds));
  } catch {
    return Math.max(0, (sourceDuration - windowSeconds) / 2);
  } finally {
    await audioContext.close();
  }
}

async function browserClipPlan(entry: RankingEntry, maxDuration: number, smartHighlights: boolean) {
  if (!smartHighlights || !entry.file) {
    return { start: 0, duration: maxDuration };
  }

  const measuredDuration = await videoDurationFromFile(entry.file);
  const sourceDuration = measuredDuration || entry.duration || maxDuration;
  const safeSourceDuration = Math.max(0.5, sourceDuration);
  const clipDuration = Math.min(maxDuration, safeSourceDuration);

  if (safeSourceDuration <= maxDuration + 0.25) {
    return { start: 0, duration: clipDuration };
  }

  const start = await audioHighlightStartFromFile(entry.file, safeSourceDuration, clipDuration);

  return { start, duration: clipDuration };
}

async function createOverlayPng(
  title: string,
  activeEntry: RankingEntry,
  orderedEntries: RankingEntry[]
) {
  const canvas = document.createElement("canvas");
  canvas.width = OUTPUT_WIDTH;
  canvas.height = OUTPUT_HEIGHT;

  const ctx = canvas.getContext("2d");

  if (!ctx) {
    throw new Error("Canvas rendering is unavailable in this browser.");
  }

  ctx.clearRect(0, 0, OUTPUT_WIDTH, OUTPUT_HEIGHT);

  // Text overlays are rendered to a transparent PNG first, then FFmpeg places
  // that PNG on top of each clip. This avoids browser FFmpeg font issues.
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillStyle = "#ffffff";
  ctx.shadowColor = "rgba(0, 0, 0, 0.72)";
  ctx.shadowBlur = 22;
  ctx.font = '800 68px "Arial", sans-serif';

  const titleSafeY = 140;
  const titleLines = wrapTextFully(ctx, title, 910);
  const titleFont = titleFontForLineCount(titleLines.length);
  ctx.font = `800 ${titleFont.size}px "Arial", sans-serif`;
  titleLines.forEach((line, index) => {
    ctx.fillText(line, OUTPUT_WIDTH / 2, titleSafeY + index * titleFont.lineHeight);
  });

  ctx.textAlign = "left";
  ctx.shadowBlur = 30;
  ctx.font = '900 178px "Arial Black", Impact, sans-serif';
  ctx.fillStyle = "#39ff88";
  ctx.fillText(`#${activeEntry.rank}`, 70, 1215);

  ctx.font = '900 64px "Arial", sans-serif';
  ctx.fillStyle = "#ffffff";
  const nameLines = wrapText(ctx, activeEntry.name, 900, 2);
  nameLines.forEach((line, index) => {
    ctx.fillText(line, 72, 1400 + index * 74);
  });

  const listX = 70;
  const listY = 1570;
  const itemHeight = 58;

  ctx.shadowBlur = 0;
  ctx.font = '800 33px "Arial", sans-serif';
  ctx.textBaseline = "middle";

  orderedEntries.forEach((entry, index) => {
    const y = listY + index * itemHeight;
    const isActive = entry.rank === activeEntry.rank;
    const isComplete =
      orderedEntries.findIndex((ordered) => ordered.rank === activeEntry.rank) > index;

    ctx.fillStyle = isActive
      ? "rgba(57, 255, 136, 0.24)"
      : isComplete
        ? "rgba(255, 255, 255, 0.16)"
        : "rgba(255, 255, 255, 0.08)";
    ctx.beginPath();
    ctx.roundRect(listX, y, 940, 44, 18);
    ctx.fill();

    ctx.fillStyle = isActive ? "#39ff88" : isComplete ? "#ffffff" : "rgba(255, 255, 255, 0.68)";
    ctx.fillText(`#${entry.rank}`, listX + 22, y + 22);

    ctx.fillStyle = isActive ? "#ffffff" : "rgba(255, 255, 255, 0.78)";
    const trimmedName =
      entry.name.length > 30 ? `${entry.name.slice(0, 29).trim()}...` : entry.name;
    ctx.fillText(trimmedName, listX + 118, y + 22);
  });

  return canvasToPngBytes(canvas);
}

async function createTransparentOverlayPng() {
  const canvas = document.createElement("canvas");
  canvas.width = OUTPUT_WIDTH;
  canvas.height = OUTPUT_HEIGHT;

  return canvasToPngBytes(canvas);
}

async function createRankRevealPng(rank: number) {
  const canvas = document.createElement("canvas");
  canvas.width = OUTPUT_WIDTH;
  canvas.height = OUTPUT_HEIGHT;

  const ctx = canvas.getContext("2d");

  if (!ctx) {
    throw new Error("Canvas rendering is unavailable in this browser.");
  }

  ctx.clearRect(0, 0, OUTPUT_WIDTH, OUTPUT_HEIGHT);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.shadowColor = "rgba(0, 0, 0, 0.85)";
  ctx.shadowBlur = 42;

  // This transparent PNG is overlaid only for the first split second of each
  // ranked clip, giving the rank a big pop-in reveal without hiding the video.
  ctx.font = '900 330px "Arial Black", Impact, sans-serif';
  ctx.lineWidth = 22;
  ctx.strokeStyle = "rgba(0, 0, 0, 0.88)";
  ctx.fillStyle = "#39ff88";
  ctx.strokeText(`#${rank}`, OUTPUT_WIDTH / 2, 820);
  ctx.fillText(`#${rank}`, OUTPUT_WIDTH / 2, 820);

  return canvasToPngBytes(canvas);
}

async function createHookOverlayPng(title: string, teaser: HookTeaserLines) {
  const canvas = document.createElement("canvas");
  canvas.width = OUTPUT_WIDTH;
  canvas.height = OUTPUT_HEIGHT;

  const ctx = canvas.getContext("2d");

  if (!ctx) {
    throw new Error("Canvas rendering is unavailable in this browser.");
  }

  ctx.clearRect(0, 0, OUTPUT_WIDTH, OUTPUT_HEIGHT);

  // The hook overlay avoids full-screen tinting, but uses heavy shadows and
  // strokes so the opening text stays readable over fast TikTok footage.
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "rgba(0, 0, 0, 0.82)";
  ctx.lineJoin = "round";
  ctx.shadowColor = "rgba(0, 0, 0, 0.78)";
  ctx.shadowBlur = 24;
  ctx.font = '800 68px "Arial", sans-serif';

  const titleSafeY = 140;
  const titleLines = wrapTextFully(ctx, title, 910);
  const titleFont = titleFontForLineCount(titleLines.length);
  ctx.font = `800 ${titleFont.size}px "Arial", sans-serif`;
  titleLines.forEach((line, index) => {
    const y = titleSafeY + index * titleFont.lineHeight;
    ctx.lineWidth = 8;
    ctx.strokeText(line, OUTPUT_WIDTH / 2, y);
    ctx.fillText(line, OUTPUT_WIDTH / 2, y);
  });

  ctx.shadowBlur = 34;
  const teaserMaxWidth = 930;
  let teaserFontSize = 112;

  ctx.font = `900 ${teaserFontSize}px "Arial Black", Impact, sans-serif`;

  while (ctx.measureText(teaser.primary).width > teaserMaxWidth && teaserFontSize > 68) {
    teaserFontSize -= 4;
    ctx.font = `900 ${teaserFontSize}px "Arial Black", Impact, sans-serif`;
  }

  const teaserLines =
    ctx.measureText(teaser.primary).width <= teaserMaxWidth
      ? [teaser.primary]
      : wrapTextFully(ctx, teaser.primary, teaserMaxWidth);
  const teaserLineHeight = Math.round(teaserFontSize * 1.08);
  const teaserTop = Math.round(1190 - ((teaserLines.length - 1) * teaserLineHeight) / 2);

  ctx.lineWidth = 10;
  ctx.fillStyle = "#39ff88";
  teaserLines.forEach((line, index) => {
    const y = teaserTop + index * teaserLineHeight;
    ctx.strokeText(line, OUTPUT_WIDTH / 2, y);
    ctx.fillText(line, OUTPUT_WIDTH / 2, y);
  });

  return canvasToPngBytes(canvas);
}

async function downloadTikTokClip(entry: RankingEntry, sessionId: string | null) {
  const response = await fetch("/api/tiktok/download", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: entry.url.trim(), sessionId })
  });

  const payload = (await response.json()) as Partial<DownloadedClipResponse> & {
    error?: string;
  };

  if (!response.ok || !payload.downloadUrl || !payload.sessionId || !payload.fileName) {
    throw new Error(payload.error ?? `Could not download TikTok clip for #${entry.rank}.`);
  }

  const clipResponse = await fetch(payload.downloadUrl);

  if (!clipResponse.ok) {
    throw new Error(`Downloaded clip for #${entry.rank} could not be read.`);
  }

  const blob = await clipResponse.blob();
  const extension = extensionFromName(payload.fileName);
  const file = new File([blob], `tiktok-rank-${entry.rank}.${extension}`, {
    type: blob.type || "video/mp4"
  });

  return { file, sessionId: payload.sessionId };
}

async function cleanupDownloadedClips(sessionId: string) {
  try {
    await fetch("/api/tiktok/cleanup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId })
    });
  } catch (error) {
    console.warn("Temporary TikTok cleanup failed.", error);
  }
}

async function renderSegment({
  ffmpeg,
  inputName,
  overlayName,
  revealName,
  segmentName,
  sfxName,
  startTimeText,
  durationText,
  fadeDuration,
  fadeOutStart
}: {
  ffmpeg: FFmpeg;
  inputName: string;
  overlayName: string;
  revealName: string;
  segmentName: string;
  sfxName: string;
  startTimeText: string;
  durationText: string;
  fadeDuration: number;
  fadeOutStart: string;
}) {
  const safeClipDuration = Number.parseFloat(durationText);
  const progressDuration = (Number.isFinite(safeClipDuration) ? Math.max(0.1, safeClipDuration) : 0.1).toFixed(2);
  const progressOverlayX = `max(-w\\,min(0\\,-w+w*t/${progressDuration}))`;
  const progressY = OUTPUT_HEIGHT - 22;
  const videoFilter = `color=c=0x39ff88@0.95:s=${OUTPUT_WIDTH}x18:r=30:d=${durationText},format=rgba[progressBar];[0:v]setpts=PTS-STARTPTS,scale=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT}:force_original_aspect_ratio=increase,crop=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT},setsar=1,format=rgba[base];[base][1:v]overlay=0:0:format=auto[withOverlay];[2:v]format=rgba,fade=t=out:st=0.48:d=0.32:alpha=1[rankReveal];[withOverlay][rankReveal]overlay=0:0:format=auto:enable='between(t\\,0\\,0.80)',format=yuv420p,drawbox=x=0:y=${progressY}:w=iw:h=18:color=white@0.18:t=fill[progressBase];[progressBase][progressBar]overlay=x='${progressOverlayX}':y=${progressY}:format=auto,format=yuv420p,fade=t=in:st=0:d=${fadeDuration},fade=t=out:st=${fadeOutStart}:d=${fadeDuration}[v]`;
  const sourceAudioFilter = `[0:a]atrim=0:${durationText},asetpts=PTS-STARTPTS,apad=pad_dur=${durationText},atrim=0:${durationText},aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo[clipa]`;
  const sfxAudioFilter = `[3:a]atrim=0:${durationText},asetpts=PTS-STARTPTS,apad=pad_dur=${durationText},atrim=0:${durationText},volume=0.52,aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo[sfx]`;
  const mixedAudioFilter = "[clipa][sfx]amix=inputs=2:duration=first:dropout_transition=0,volume=1.05[a]";
  const silentAudioFilter = `[4:a]atrim=0:${durationText},asetpts=PTS-STARTPTS,aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo[clipa]`;
  const outputSettings = [
    "-map",
    "[v]",
    "-map",
    "[a]",
    "-r",
    "30",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-crf",
    "24",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-ar",
    "44100",
    "-ac",
    "2",
    "-movflags",
    "+faststart",
    segmentName
  ];

  try {
    // First try to carry source clip audio through the same trim window as the
    // video. Audio is normalized so every segment can be concatenated safely.
    await ffmpeg.exec([
      "-y",
      "-ss",
      startTimeText,
      "-i",
      inputName,
      "-loop",
      "1",
      "-i",
      overlayName,
      "-loop",
      "1",
      "-i",
      revealName,
      "-i",
      sfxName,
      "-t",
      durationText,
      "-filter_complex",
      `${videoFilter};${sourceAudioFilter};${sfxAudioFilter};${mixedAudioFilter}`,
      ...outputSettings
    ]);
  } catch {
    // Some TikToks/uploads have no audio stream. Render matching silence instead
    // so the final MP4 still has a stable audio track.
    await ffmpeg.exec([
      "-y",
      "-ss",
      startTimeText,
      "-i",
      inputName,
      "-loop",
      "1",
      "-i",
      overlayName,
      "-loop",
      "1",
      "-i",
      revealName,
      "-i",
      sfxName,
      "-f",
      "lavfi",
      "-t",
      durationText,
      "-i",
      "anullsrc=channel_layout=stereo:sample_rate=44100",
      "-t",
      durationText,
      "-filter_complex",
      `${videoFilter};${silentAudioFilter};${sfxAudioFilter};${mixedAudioFilter}`,
      ...outputSettings
    ]);
  }
}

export default function Home() {
  // Form state is kept in one place so validation, preview labels, and FFmpeg
  // processing all use the same five ranked entries.
  const [title, setTitle] = useState("Top 5 Funniest TikToks This Week");
  const [duration, setDuration] = useState(DEFAULT_DURATION_SECONDS);
  const [smartHighlights, setSmartHighlights] = useState(true);
  const [entries, setEntries] = useState<RankingEntry[]>(initialEntries);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [isGenerating, setIsGenerating] = useState(false);
  const [statusText, setStatusText] = useState("Ready");
  const [progress, setProgress] = useState(0);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [outputBlob, setOutputBlob] = useState<Blob | null>(null);
  const [ffmpegLoaded, setFfmpegLoaded] = useState(false);
  const [isFindingIdea, setIsFindingIdea] = useState(false);
  const [viralIdea, setViralIdea] = useState<ViralIdea | null>(null);
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<string[]>([]);
  const [copiedDescription, setCopiedDescription] = useState(false);
  const [autoUploadToYoutube, setAutoUploadToYoutube] = useState(false);
  const [youtubeStatus, setYoutubeStatus] = useState<YouTubeStatus | null>(null);
  const [isUploadingYoutube, setIsUploadingYoutube] = useState(false);
  const [youtubeUploadUrl, setYoutubeUploadUrl] = useState<string | null>(null);
  const [autoRunEvery15, setAutoRunEvery15] = useState(false);
  const [nextAutoRunAt, setNextAutoRunAt] = useState<number | null>(null);
  const [autoRunCountdown, setAutoRunCountdown] = useState("off");
  const [autoRunCount, setAutoRunCount] = useState(0);
  const [dailyScheduleEnabled, setDailyScheduleEnabled] = useState(false);
  const [dailyScheduleInput, setDailyScheduleInput] = useState(DEFAULT_DAILY_UPLOAD_TIMES);
  const [nextDailyRunAt, setNextDailyRunAt] = useState<number | null>(null);
  const [dailyScheduleCountdown, setDailyScheduleCountdown] = useState("off");
  const [dailyScheduleRunCount, setDailyScheduleRunCount] = useState(0);
  const [githubScheduleEnabled, setGithubScheduleEnabled] = useState(false);
  const [githubScheduleStatus, setGithubScheduleStatus] = useState<GitHubScheduleStatus | null>(null);
  const [githubScheduleMessage, setGithubScheduleMessage] = useState("Not saved to GitHub yet");
  const [githubScheduleTimezone, setGithubScheduleTimezone] = useState("UTC");
  const [isSavingGithubSchedule, setIsSavingGithubSchedule] = useState(false);

  const ffmpegRef = useRef<FFmpeg | null>(null);
  const autoRunEnabledRef = useRef(false);
  const dailyScheduleEnabledRef = useRef(false);
  const autoRunBusyRef = useRef(false);

  const orderedEntries = useMemo(
    // Clips are intentionally processed in countdown order for ranking videos.
    () => [...entries].sort((a, b) => b.rank - a.rank),
    [entries]
  );
  const selectedViralCandidates = useMemo(() => {
    if (!viralIdea) {
      return [];
    }

    return selectedCandidateIds
      .map((id) => viralIdea.candidates.find((candidate) => candidate.id === id))
      .filter((candidate): candidate is ViralCandidate => Boolean(candidate));
  }, [selectedCandidateIds, viralIdea]);
  const copyPasteDescription = useMemo(
    () =>
      viralIdea
        ? buildCopyDescription(viralIdea, selectedViralCandidates)
        : "",
    [selectedViralCandidates, viralIdea]
  );
  const uploadDescription = copyPasteDescription || fallbackUploadDescription(title, entries);
  const uploadTags = useMemo(() => uploadTagsFromDescription(uploadDescription), [uploadDescription]);
  const parsedDailySchedule = useMemo(
    () => parseDailyScheduleInput(dailyScheduleInput),
    [dailyScheduleInput]
  );

  useEffect(() => {
    let isMounted = true;

    fetch("/api/youtube/upload")
      .then((response) => response.json())
      .then((payload: YouTubeStatus) => {
        if (isMounted) {
          setYoutubeStatus(payload);
        }
      })
      .catch(() => {
        if (isMounted) {
          setYoutubeStatus({ configured: false, missing: ["YouTube route unavailable"], privacyStatus: "private" });
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    let isMounted = true;
    const localTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

    setGithubScheduleTimezone(localTimezone);

    fetch("/api/github/schedule")
      .then((response) => response.json())
      .then((payload: GitHubScheduleStatus) => {
        if (!isMounted) {
          return;
        }

        setGithubScheduleStatus(payload);

        if (!payload.configured) {
          setGithubScheduleMessage("Add GitHub schedule env vars to save closed-tab schedules.");
          return;
        }

        const savedSchedule = payload.schedule;

        if (savedSchedule?.times?.length) {
          setDailyScheduleInput(savedSchedule.times.join(", "));
        }

        setGithubScheduleEnabled(Boolean(savedSchedule?.enabled));
        setGithubScheduleTimezone(savedSchedule?.timezone || localTimezone);
        setGithubScheduleMessage(
          savedSchedule?.enabled
            ? `Saved to GitHub Actions for ${savedSchedule.timezone || localTimezone}`
            : "GitHub Actions schedule is saved but disabled"
        );
      })
      .catch(() => {
        if (isMounted) {
          setGithubScheduleMessage("Could not read GitHub schedule settings.");
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    autoRunEnabledRef.current = autoRunEvery15;

    if (autoRunEvery15) {
      setAutoUploadToYoutube(true);
      setYoutubeUploadUrl(null);
      setNextAutoRunAt(Date.now() + AUTO_RUN_INTERVAL_MS);
      setAutoRunCountdown(formatCountdown(AUTO_RUN_INTERVAL_MS));
      setStatusText("Auto-run scheduled");
      setErrors((current) => {
        const { autoRun, ...rest } = current;
        return rest;
      });
      return;
    }

    setNextAutoRunAt(null);
    setAutoRunCountdown("off");
  }, [autoRunEvery15]);

  useEffect(() => {
    if (!autoRunEvery15 || !nextAutoRunAt) {
      return;
    }

    const timer = window.setInterval(() => {
      const remaining = nextAutoRunAt - Date.now();
      setAutoRunCountdown(formatCountdown(remaining));

      if (remaining > 0) {
        return;
      }

      if (isGenerating || isFindingIdea || isUploadingYoutube || autoRunBusyRef.current) {
        setAutoRunCountdown("waiting");
        setNextAutoRunAt(Date.now() + 60 * 1000);
        return;
      }

      setNextAutoRunAt(null);
      void runScheduledCycle("interval");
    }, 1000);

    return () => window.clearInterval(timer);
  }, [autoRunEvery15, nextAutoRunAt, isFindingIdea, isGenerating, isUploadingYoutube]);

  useEffect(() => {
    dailyScheduleEnabledRef.current = dailyScheduleEnabled;

    if (!dailyScheduleEnabled) {
      setNextDailyRunAt(null);
      setDailyScheduleCountdown("off");
      return;
    }

    if (parsedDailySchedule.error || !parsedDailySchedule.times.length) {
      setNextDailyRunAt(null);
      setDailyScheduleCountdown("fix times");
      setErrors((current) => ({
        ...current,
        dailySchedule: parsedDailySchedule.error || "Add at least one upload time."
      }));
      return;
    }

    const nextRun = nextDailyRunTimestamp(parsedDailySchedule.times);
    setAutoUploadToYoutube(true);
    setYoutubeUploadUrl(null);
    setNextDailyRunAt(nextRun);
    setDailyScheduleCountdown(formatCountdown(nextRun - Date.now()));
    setStatusText(`Daily schedule set for ${formatLocalTime(nextRun)}`);
    setErrors((current) => {
      const { dailySchedule, ...rest } = current;
      return rest;
    });
  }, [dailyScheduleEnabled, parsedDailySchedule.error, parsedDailySchedule.times]);

  useEffect(() => {
    if (!dailyScheduleEnabled || !nextDailyRunAt) {
      return;
    }

    const timer = window.setInterval(() => {
      const remaining = nextDailyRunAt - Date.now();
      setDailyScheduleCountdown(formatCountdown(remaining));

      if (remaining > 0) {
        return;
      }

      if (isGenerating || isFindingIdea || isUploadingYoutube || autoRunBusyRef.current) {
        setDailyScheduleCountdown("waiting");
        setNextDailyRunAt(Date.now() + 60 * 1000);
        return;
      }

      setNextDailyRunAt(null);
      void runScheduledCycle("daily");
    }, 1000);

    return () => window.clearInterval(timer);
  }, [dailyScheduleEnabled, nextDailyRunAt, isFindingIdea, isGenerating, isUploadingYoutube]);

  function updateEntry(rank: number, patch: Partial<RankingEntry>) {
    setEntries((current) =>
      current.map((entry) => (entry.rank === rank ? { ...entry, ...patch } : entry))
    );
  }

  function handleFileChange(rank: number, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    updateEntry(rank, { file, duration: undefined });
  }

  async function saveGithubSchedule() {
    if (parsedDailySchedule.error) {
      setErrors((current) => ({ ...current, dailySchedule: parsedDailySchedule.error }));
      setGithubScheduleMessage(parsedDailySchedule.error);
      return;
    }

    setIsSavingGithubSchedule(true);
    setGithubScheduleMessage("Saving to GitHub Actions...");
    setErrors((current) => {
      const { dailySchedule, githubSchedule, ...rest } = current;
      return rest;
    });

    try {
      const response = await fetch("/api/github/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: githubScheduleEnabled,
          times: dailyScheduleInput,
          timezone: githubScheduleTimezone
        })
      });
      const payload = (await response.json()) as GitHubScheduleStatus & { error?: string };

      if (!response.ok) {
        throw new Error(payload.error ?? "Could not save GitHub schedule.");
      }

      setGithubScheduleStatus({
        configured: true,
        missing: [],
        schedule: payload.schedule
      });
      setGithubScheduleMessage(
        payload.schedule?.enabled
          ? `Saved. GitHub Actions will run at ${payload.schedule.times.join(", ")} ${payload.schedule.timezone}.`
          : "Saved. GitHub Actions schedule is disabled."
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not save GitHub schedule.";
      setErrors((current) => ({ ...current, githubSchedule: message }));
      setGithubScheduleMessage(message);
    } finally {
      setIsSavingGithubSchedule(false);
    }
  }

  function applyCandidates(candidates: ViralCandidate[], nextTitle = title) {
    const selected = candidates.slice(0, RANK_COUNT);

    if (selected.length !== RANK_COUNT) {
      setErrors((current) => ({
        ...current,
        idea: "Select exactly 5 TikTok candidates."
      }));
      return;
    }

    setTitle(nextTitle);
    setEntries(entriesFromCandidates(selected));
    setErrors((current) => {
      const { idea, ...rest } = current;
      return rest;
    });
    setStatusText("Idea loaded");
  }

  async function fetchViralIdea() {
    const response = await fetch("/api/ideas/find", { method: "POST" });
    const payload = (await response.json()) as Partial<ViralIdea> & { error?: string };

    if (!response.ok || !payload.title || !Array.isArray(payload.candidates)) {
      throw new Error(payload.error ?? "Could not find a viral idea.");
    }

    return payload as ViralIdea;
  }

  function loadViralIdea(nextIdea: ViralIdea) {
    const nextSelectedIds = candidateIdsFromCandidates(nextIdea.candidates);
    setViralIdea(nextIdea);
    setSelectedCandidateIds(nextSelectedIds);
    setCopiedDescription(false);
    applyCandidates(nextIdea.candidates.slice(0, RANK_COUNT), nextIdea.title);
  }

  async function findViralIdea() {
    if (isFindingIdea || isGenerating) {
      return;
    }

    setIsFindingIdea(true);
    setStatusText("Finding viral idea...");
    setErrors((current) => {
      const { idea, generation, ...rest } = current;
      return rest;
    });

    try {
      loadViralIdea(await fetchViralIdea());
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not find a viral idea.";
      setErrors((current) => ({ ...current, idea: message }));
      setStatusText("Idea search failed");
    } finally {
      setIsFindingIdea(false);
    }
  }

  async function runScheduledCycle(source: "interval" | "daily") {
    const isDailySchedule = source === "daily";
    const isEnabled = isDailySchedule
      ? dailyScheduleEnabledRef.current
      : autoRunEnabledRef.current;
    const sourceLabel = isDailySchedule ? "Daily schedule" : "Auto-run";

    if (!isEnabled || autoRunBusyRef.current) {
      return;
    }

    autoRunBusyRef.current = true;
    setAutoUploadToYoutube(true);
    setYoutubeUploadUrl(null);
    setStatusText(`${sourceLabel}: finding idea...`);
    setErrors((current) => {
      const { autoRun, dailySchedule, generation, idea, youtube, ...rest } = current;
      return rest;
    });

    try {
      const nextIdea = await fetchViralIdea();
      const selectedCandidates = nextIdea.candidates.slice(0, RANK_COUNT);

      if (selectedCandidates.length !== RANK_COUNT) {
        throw new Error(`${sourceLabel} could not find 5 TikTok candidates.`);
      }

      const nextEntries = entriesFromCandidates(selectedCandidates);
      const nextDescription = buildCopyDescription(nextIdea, selectedCandidates);
      const nextTags = uploadTagsFromDescription(nextDescription);

      // Scheduled runs pass the freshly found idea directly into generation so
      // React state timing cannot cause the previous title or clips to be reused.
      loadViralIdea(nextIdea);
      setStatusText(`${sourceLabel}: generating video...`);

      const generated = await generateVideo({
        formTitle: nextIdea.title,
        formEntries: nextEntries,
        forceUpload: true,
        description: nextDescription,
        tags: nextTags
      });

      if (!generated) {
        throw new Error(`${sourceLabel} generation or YouTube upload failed.`);
      }

      if (isDailySchedule) {
        setDailyScheduleRunCount((current) => current + 1);
      } else {
        setAutoRunCount((current) => current + 1);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : `${sourceLabel} failed.`;
      setErrors((current) => ({
        ...current,
        [isDailySchedule ? "dailySchedule" : "autoRun"]: message
      }));
      setStatusText(`${sourceLabel} failed`);
    } finally {
      autoRunBusyRef.current = false;

      if (!isDailySchedule && autoRunEnabledRef.current) {
        setNextAutoRunAt(Date.now() + AUTO_RUN_INTERVAL_MS);
        setAutoRunCountdown(formatCountdown(AUTO_RUN_INTERVAL_MS));
      }

      if (isDailySchedule && dailyScheduleEnabledRef.current) {
        const nextSchedule = parseDailyScheduleInput(dailyScheduleInput);

        if (!nextSchedule.error && nextSchedule.times.length) {
          const nextRun = nextDailyRunTimestamp(nextSchedule.times);
          setNextDailyRunAt(nextRun);
          setDailyScheduleCountdown(formatCountdown(nextRun - Date.now()));
        }
      }
    }
  }

  function toggleCandidate(candidateId: string) {
    setCopiedDescription(false);
    setSelectedCandidateIds((current) => {
      if (current.includes(candidateId)) {
        return current.filter((id) => id !== candidateId);
      }

      if (current.length >= RANK_COUNT) {
        return current;
      }

      return [...current, candidateId];
    });
  }

  function applySelectedCandidates() {
    if (!viralIdea) {
      return;
    }

    const selected = selectedCandidateIds
      .map((id) => viralIdea.candidates.find((candidate) => candidate.id === id))
      .filter((candidate): candidate is ViralCandidate => Boolean(candidate));

    applyCandidates(selected, viralIdea.title);
  }

  async function copyDescription() {
    if (!copyPasteDescription) {
      return;
    }

    try {
      await navigator.clipboard.writeText(copyPasteDescription);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = copyPasteDescription;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
    }

    setCopiedDescription(true);
    window.setTimeout(() => setCopiedDescription(false), 1800);
  }

  async function uploadGeneratedVideo(
    blob: Blob,
    uploadTitle = title,
    description = uploadDescription,
    tags = uploadTags
  ) {
    const formData = new FormData();
    const fileName = downloadFileName(uploadTitle);

    formData.set("video", new File([blob], fileName, { type: "video/mp4" }));
    formData.set("title", viralVideoTitle(uploadTitle));
    formData.set("description", description);
    formData.set("tags", tags.join(","));

    const response = await fetch("/api/youtube/upload", {
      method: "POST",
      body: formData
    });
    const payload = (await response.json()) as { url?: string; error?: string };

    if (!response.ok || !payload.url) {
      throw new Error(payload.error ?? "YouTube upload failed.");
    }

    return payload.url;
  }

  function validateForm(formTitle = title, formEntries = entries) {
    const nextErrors: FieldErrors = {};

    // Validation enforces the fixed five-entry ranking surface and rejects
    // malformed TikTok URLs while still allowing manual uploads as a fallback.
    if (!formTitle.trim()) {
      nextErrors.title = "Enter a main title.";
    }

    if (!Number.isFinite(duration) || duration < 2 || duration > 20) {
      nextErrors.duration = "Choose 2 to 20 seconds per clip.";
    }

    if (formEntries.length !== RANK_COUNT) {
      nextErrors.entries = "Exactly 5 ranked entries are required.";
    }

    formEntries.forEach((entry) => {
      if (!entry.name.trim()) {
        nextErrors[`name-${entry.rank}`] = `Enter a name for #${entry.rank}.`;
      }

      if (entry.url.trim() && !isValidTikTokUrl(entry.url)) {
        nextErrors[`url-${entry.rank}`] = "Enter a valid TikTok URL.";
      }

      if (!entry.url.trim() && !entry.file) {
        nextErrors[`source-${entry.rank}`] = `Add a TikTok URL or upload a clip for #${entry.rank}.`;
      }

      if (entry.file && !entry.file.type.startsWith("video/")) {
        nextErrors[`file-${entry.rank}`] = "Upload a video file.";
      }
    });

    setErrors(nextErrors);
    return nextErrors;
  }

  async function getFfmpeg() {
    if (ffmpegRef.current) {
      return ffmpegRef.current;
    }

    const ffmpeg = new FFmpeg();

    ffmpeg.on("log", ({ message }) => {
      if (message.toLowerCase().includes("error")) {
        console.warn(message);
      }
    });

    setStatusText("Loading FFmpeg...");

    await ffmpeg.load({
      coreURL: "/ffmpeg/ffmpeg-core.js",
      wasmURL: "/ffmpeg/ffmpeg-core.wasm"
    });

    ffmpegRef.current = ffmpeg;
    setFfmpegLoaded(true);
    return ffmpeg;
  }

  async function generateVideo(options: GenerateVideoOptions = {}) {
    if (isGenerating) {
      return false;
    }

    const activeTitle = options.formTitle ?? title;
    const activeEntries = options.formEntries ?? entries;
    const activeDescription = options.description ?? uploadDescription;
    const activeTags = options.tags ?? uploadTags;
    const shouldUpload = options.forceUpload ?? autoUploadToYoutube;
    const nextErrors = validateForm(activeTitle, activeEntries);

    if (Object.keys(nextErrors).length > 0) {
      setStatusText("Fix the highlighted fields.");
      return false;
    }

    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
    }

    setOutputBlob(null);
    setIsGenerating(true);
    setProgress(0);

    let cleanupSessionId: string | null = null;

    try {
      const resolvedEntries: RankingEntry[] = [];

      // Entries are converted to real File objects before FFmpeg starts. Uploaded
      // clips are already available in the browser; TikTok URLs are pulled by the
      // server into a temporary folder, fetched as blobs, then deleted after export.
      for (const [index, entry] of activeEntries.entries()) {
        if (entry.file) {
          resolvedEntries.push(entry);
          continue;
        }

        setStatusText(`Downloading #${entry.rank} from TikTok...`);
        setProgress(Math.round((index / RANK_COUNT) * 18));

        const downloaded = await downloadTikTokClip(entry, cleanupSessionId);
        cleanupSessionId = downloaded.sessionId;
        resolvedEntries.push({ ...entry, file: downloaded.file });
      }

      const ffmpeg = await getFfmpeg();
      const segmentNames: string[] = [];
      const orderedResolvedEntries = [...resolvedEntries].sort((a, b) => b.rank - a.rank);
      const hookEntry = bestHookEntry(resolvedEntries);
      const rankedClipPlans = new Map<number, ClipPlan>();
      const teaser = hookTeaserLines(activeTitle);
      const sfxName = "impact-sfx.wav";
      const blankRevealName = "rank-reveal-blank.png";

      if (!hookEntry?.file) {
        throw new Error("Missing hook clip source.");
      }

      const hookInputName = `hook-input-${hookEntry.rank}.${fileExtension(hookEntry.file)}`;
      const hookOverlayName = "overlay-hook.png";
      const hookSegmentName = "segment-hook.mp4";

      setStatusText("Finding opening hook...");
      setProgress(20);

      const hookPlan = await browserClipPlan(hookEntry, HOOK_DURATION_SECONDS, true);

      for (const [index, entry] of orderedResolvedEntries.entries()) {
        setStatusText(
          smartHighlights ? `Finding highlight for #${entry.rank}...` : `Preparing #${entry.rank}...`
        );
        setProgress(22 + Math.round((index / RANK_COUNT) * 16));

        const clipPlan = await browserClipPlan(entry, duration, smartHighlights);
        rankedClipPlans.set(entry.rank, clipPlan);
      }

      const hookDurationText = hookPlan.duration.toFixed(2);
      const hookStartTimeText = hookPlan.start.toFixed(2);
      const hookFadeDuration = Math.min(0.25, hookPlan.duration / 4);
      const hookFadeOutStart = Math.max(hookPlan.duration - hookFadeDuration, 0).toFixed(2);

      await ffmpeg.writeFile(sfxName, createImpactSfxWavBytes());
      await ffmpeg.writeFile(blankRevealName, await createTransparentOverlayPng());
      await ffmpeg.writeFile(hookInputName, await fetchFile(hookEntry.file));
      await ffmpeg.writeFile(hookOverlayName, await createHookOverlayPng(activeTitle, teaser));

      setStatusText("Rendering opening hook...");

      await renderSegment({
        ffmpeg,
        inputName: hookInputName,
        overlayName: hookOverlayName,
        revealName: blankRevealName,
        segmentName: hookSegmentName,
        sfxName,
        startTimeText: hookStartTimeText,
        durationText: hookDurationText,
        fadeDuration: hookFadeDuration,
        fadeOutStart: hookFadeOutStart
      });

      segmentNames.push(hookSegmentName);

      for (const [index, entry] of orderedResolvedEntries.entries()) {
        if (!entry.file) {
          throw new Error(`Missing uploaded file for #${entry.rank}.`);
        }

        const inputName = `input-${entry.rank}.${fileExtension(entry.file)}`;
        const overlayName = `overlay-${entry.rank}.png`;
        const revealName = `rank-reveal-${entry.rank}.png`;
        const segmentName = `segment-${index}.mp4`;

        setStatusText(`Rendering #${entry.rank}...`);
        setProgress(38 + Math.round((index / RANK_COUNT) * 52));

        const clipPlan = rankedClipPlans.get(entry.rank);

        if (!clipPlan) {
          throw new Error(`Missing render plan for #${entry.rank}.`);
        }

        const durationText = clipPlan.duration.toFixed(2);
        const startTimeText = clipPlan.start.toFixed(2);
        const fadeDuration = Math.min(0.25, clipPlan.duration / 4);
        const fadeOutStart = Math.max(clipPlan.duration - fadeDuration, 0).toFixed(2);

        await ffmpeg.writeFile(inputName, await fetchFile(entry.file));
        await ffmpeg.writeFile(
          overlayName,
          await createOverlayPng(activeTitle, entry, orderedResolvedEntries)
        );
        await ffmpeg.writeFile(revealName, await createRankRevealPng(entry.rank));

        // FFmpeg trims each clip, scales/crops it into a 1080x1920 canvas, adds
        // transition fades, overlays the rank/list PNGs, adds progress/SFX, and
        // keeps normalized source audio.
        await renderSegment({
          ffmpeg,
          inputName,
          overlayName,
          revealName,
          segmentName,
          sfxName,
          startTimeText,
          durationText,
          fadeDuration,
          fadeOutStart
        });

        segmentNames.push(segmentName);
      }

      setStatusText("Stitching final MP4...");
      setProgress(92);

      const concatList = segmentNames
        .map((segmentName) => `file '${escapeConcatPath(segmentName)}'`)
        .join("\n");

      // Export logic uses the concat demuxer because all generated segments have
      // matching dimensions, frame rate, and codec settings.
      await ffmpeg.writeFile("concat.txt", new TextEncoder().encode(concatList));
      await ffmpeg.exec([
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        "concat.txt",
        "-c",
        "copy",
        "ranking-short.mp4"
      ]);

      const output = assertUint8Array(await ffmpeg.readFile("ranking-short.mp4"));
      const blob = new Blob([toArrayBuffer(output)], { type: "video/mp4" });
      const url = URL.createObjectURL(blob);

      setOutputBlob(blob);
      setPreviewUrl(url);
      setProgress(100);

      if (shouldUpload) {
        try {
          setIsUploadingYoutube(true);
          setStatusText("Uploading to YouTube...");
          const uploadUrl = await uploadGeneratedVideo(
            blob,
            activeTitle,
            activeDescription,
            activeTags
          );
          setYoutubeUploadUrl(uploadUrl);
          setStatusText("Uploaded to YouTube");
          return true;
        } catch (error) {
          const message = error instanceof Error ? error.message : "YouTube upload failed.";
          setErrors((current) => ({ ...current, youtube: message }));
          setStatusText("Preview ready; upload failed");
          return false;
        } finally {
          setIsUploadingYoutube(false);
        }
      } else {
        setStatusText("Preview ready");
        return true;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Video generation failed.";
      setErrors((current) => ({ ...current, generation: message }));
      setStatusText("Generation failed");
      return false;
    } finally {
      if (cleanupSessionId) {
        await cleanupDownloadedClips(cleanupSessionId);
      }

      setIsGenerating(false);
    }
  }

  function downloadVideo() {
    if (!outputBlob) {
      return;
    }

    const url = URL.createObjectURL(outputBlob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = downloadFileName(title);
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  const hasErrors = Object.keys(errors).length > 0;

  return (
    <main className="shell">
      <section className="workspace" aria-label="Shorts ranking generator">
        <div className="editor-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Ranking Short</p>
              <h1>YouTube Shorts ranking video generator</h1>
            </div>
            <div className="header-tools">
              <label className="upload-toggle" data-active={dailyScheduleEnabled}>
                <input
                  type="checkbox"
                  checked={dailyScheduleEnabled}
                  onChange={(event) => setDailyScheduleEnabled(event.target.checked)}
                />
                <span className="toggle-track" aria-hidden="true">
                  <span />
                </span>
                <span className="toggle-label">
                  <strong><Clock size={15} /> Daily schedule</strong>
                  <small>
                    {dailyScheduleEnabled
                      ? nextDailyRunAt
                        ? `${formatLocalTime(nextDailyRunAt)} next - ${dailyScheduleRunCount} done`
                        : `${dailyScheduleCountdown} - ${dailyScheduleRunCount} done`
                      : "daily slots"}
                  </small>
                </span>
              </label>
              <label className="upload-toggle" data-active={autoRunEvery15}>
                <input
                  type="checkbox"
                  checked={autoRunEvery15}
                  onChange={(event) => setAutoRunEvery15(event.target.checked)}
                />
                <span className="toggle-track" aria-hidden="true">
                  <span />
                </span>
                <span className="toggle-label">
                  <strong><Clock size={15} /> Auto-run</strong>
                  <small>
                    {autoRunEvery15
                      ? `${autoRunCountdown} next - ${autoRunCount} done`
                      : "15 min cycle"}
                  </small>
                </span>
              </label>
              <label className="upload-toggle" data-active={autoUploadToYoutube}>
                <input
                  type="checkbox"
                  checked={autoUploadToYoutube}
                  onChange={(event) => {
                    setAutoUploadToYoutube(event.target.checked);
                    setYoutubeUploadUrl(null);
                  }}
                />
                <span className="toggle-track" aria-hidden="true">
                  <span />
                </span>
                <span className="toggle-label">
                  <strong><Youtube size={15} /> Auto-upload</strong>
                  <small>
                    {youtubeStatus?.configured
                      ? `${youtubeStatus.privacyStatus} upload`
                      : "setup needed"}
                  </small>
                </span>
              </label>
              <div className="status-pill" data-active={isGenerating || isUploadingYoutube}>
                {isGenerating || isUploadingYoutube ? <Loader2 size={16} className="spin" /> : <Play size={16} />}
                {statusText}
              </div>
            </div>
          </div>

          <section className="idea-panel" aria-label="Viral idea finder">
            <div className="idea-top">
              <div>
                <p className="eyebrow">Automation</p>
                <h2>Find Viral Idea</h2>
              </div>
              <button className="secondary-button idea-button" onClick={findViralIdea} disabled={isFindingIdea || isGenerating}>
                {isFindingIdea ? <Loader2 size={18} className="spin" /> : <Lightbulb size={18} />}
                Find Viral Idea
              </button>
            </div>

            <div className="schedule-row">
              <label className="field schedule-field">
                <span>Daily upload times</span>
                <input
                  value={dailyScheduleInput}
                  onChange={(event) => setDailyScheduleInput(event.target.value)}
                  placeholder="5am, 7am, 9am, 11am"
                />
                {errors.dailySchedule ? (
                  <small className="error-text">{errors.dailySchedule}</small>
                ) : null}
              </label>

              <div className="schedule-status" data-active={dailyScheduleEnabled}>
                <Clock size={18} />
                <div>
                  <strong>{dailyScheduleEnabled ? "Next upload" : "Schedule off"}</strong>
                  <span>
                    {dailyScheduleEnabled && nextDailyRunAt
                      ? `${formatLocalTime(nextDailyRunAt)} local - ${dailyScheduleCountdown}`
                      : parsedDailySchedule.times.join(", ") || "No times set"}
                  </span>
                </div>
              </div>
            </div>

            <div className="github-schedule-panel" data-active={githubScheduleEnabled}>
              <div className="github-schedule-copy">
                <Github size={19} />
                <div>
                  <strong>GitHub Actions schedule</strong>
                  <span>{githubScheduleMessage}</span>
                </div>
              </div>

              <label className="inline-check">
                <input
                  type="checkbox"
                  checked={githubScheduleEnabled}
                  onChange={(event) => setGithubScheduleEnabled(event.target.checked)}
                />
                <span>Run when app is closed</span>
              </label>

              <button
                className="secondary-button compact-button"
                onClick={saveGithubSchedule}
                disabled={isSavingGithubSchedule || Boolean(parsedDailySchedule.error)}
              >
                {isSavingGithubSchedule ? <Loader2 size={17} className="spin" /> : <Github size={17} />}
                Save GitHub Schedule
              </button>
            </div>

            {viralIdea ? (
              <div className="idea-result">
                <div className="idea-summary">
                  <div>
                    <strong>{viralIdea.title}</strong>
                    <span>{viralIdea.source}</span>
                  </div>
                  <button
                    className="secondary-button compact-button"
                    onClick={applySelectedCandidates}
                    disabled={selectedCandidateIds.length !== RANK_COUNT}
                  >
                    <Check size={17} />
                    Use Selected 5
                  </button>
                </div>

                <div className="candidate-grid">
                  {viralIdea.candidates.map((candidate) => {
                    const isSelected = selectedCandidateIds.includes(candidate.id);

                    return (
                      <label className="candidate-card" data-selected={isSelected} key={candidate.id}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleCandidate(candidate.id)}
                        />
                        {candidate.thumbnail ? (
                          <img src={candidate.thumbnail} alt="" />
                        ) : (
                          <div className="candidate-placeholder">
                            <Search size={22} />
                          </div>
                        )}
                        <div className="candidate-info">
                          <span>@{candidate.creator}</span>
                          <strong title={candidate.sourceTitle}>{candidate.name}</strong>
                          <small>
                            {formatMetric(candidate.views)} views · {formatMetric(candidate.likes)} likes · {candidate.duration}s
                          </small>
                        </div>
                        <a href={candidate.url} target="_blank" rel="noreferrer" aria-label={`Open ${candidate.name}`}>
                          <ExternalLink size={16} />
                        </a>
                      </label>
                    );
                  })}
                </div>

                <div className="description-panel">
                  <div className="description-head">
                    <div>
                      <strong>Copy-paste description</strong>
                      <span>{viralIdea.hashtags.length} related hashtags</span>
                    </div>
                    <button className="secondary-button compact-button" onClick={copyDescription}>
                      {copiedDescription ? <Check size={17} /> : <Copy size={17} />}
                      {copiedDescription ? "Copied" : "Copy"}
                    </button>
                  </div>
                  <textarea className="description-area" readOnly value={copyPasteDescription} />
                </div>
              </div>
            ) : null}
          </section>

          <div className="form-grid">
            <label className="field field-wide">
              <span>Main title</span>
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                maxLength={90}
                placeholder="Top 5 Funniest TikToks This Week"
              />
              {errors.title ? <small className="error-text">{errors.title}</small> : null}
            </label>

            <label className="field">
              <span>Seconds per clip</span>
              <input
                type="number"
                min={2}
                max={20}
                value={duration}
                onChange={(event) => setDuration(Number(event.target.value))}
              />
              {errors.duration ? <small className="error-text">{errors.duration}</small> : null}
            </label>

            <label className="field mode-field">
              <span>Clip mode</span>
              <button
                type="button"
                className="mode-toggle"
                data-active={smartHighlights}
                onClick={() => setSmartHighlights((current) => !current)}
              >
                {smartHighlights ? "Smart highlights" : "Fixed start"}
              </button>
            </label>
          </div>

          <div className="entries">
            {entries.map((entry) => (
              <article className="entry-card" key={entry.rank}>
                <div className="rank-badge">#{entry.rank}</div>
                <div className="entry-fields">
                  <label className="field">
                    <span>Video name</span>
                    <input
                      value={entry.name}
                      onChange={(event) => updateEntry(entry.rank, { name: event.target.value })}
                      placeholder={`Rank ${entry.rank} title`}
                      maxLength={90}
                    />
                    {errors[`name-${entry.rank}`] ? (
                      <small className="error-text">{errors[`name-${entry.rank}`]}</small>
                    ) : null}
                  </label>

                  <label className="field">
                    <span>TikTok URL</span>
                    <input
                      value={entry.url}
                      onChange={(event) => updateEntry(entry.rank, { url: event.target.value })}
                      placeholder="https://www.tiktok.com/@user/video/..."
                    />
                    {errors[`url-${entry.rank}`] || errors[`source-${entry.rank}`] ? (
                      <small className="error-text">
                        {errors[`url-${entry.rank}`] ?? errors[`source-${entry.rank}`]}
                      </small>
                    ) : null}
                  </label>

                  <label className="upload-field">
                    <input
                      type="file"
                      accept="video/*"
                      onChange={(event) => handleFileChange(entry.rank, event)}
                    />
                    <Upload size={18} />
                    <span>
                      {entry.file ? entry.file.name : entry.url.trim() ? "Upload fallback" : "Upload clip"}
                    </span>
                  </label>
                  {errors[`file-${entry.rank}`] ? (
                    <small className="error-text file-error">{errors[`file-${entry.rank}`]}</small>
                  ) : null}
                </div>
              </article>
            ))}
          </div>

          {hasErrors ? (
            <div className="error-panel" role="alert">
              <AlertCircle size={18} />
              <span>
                {errors.dailySchedule ??
                  errors.githubSchedule ??
                  errors.autoRun ??
                  errors.generation ??
                  errors.youtube ??
                  errors.idea ??
                  "Some fields need attention."}
              </span>
            </div>
          ) : null}

          {youtubeUploadUrl ? (
            <div className="upload-success">
              <Youtube size={18} />
              <a href={youtubeUploadUrl} target="_blank" rel="noreferrer">
                Uploaded to YouTube
              </a>
            </div>
          ) : null}

          <div className="actions">
            <button className="primary-button" onClick={() => generateVideo()} disabled={isGenerating}>
              {isGenerating ? <Loader2 size={19} className="spin" /> : <Wand2 size={19} />}
              Generate Video
            </button>
            <button className="secondary-button" onClick={downloadVideo} disabled={!outputBlob}>
              <Download size={19} />
              Download MP4
            </button>
          </div>

          <div className="progress-track" aria-label="Generation progress">
            <div className="progress-fill" style={{ width: `${progress}%` }} />
          </div>
        </div>

        <aside className="preview-panel" aria-label="Generated video preview">
          <div className="phone-frame">
            {previewUrl ? (
              <video src={previewUrl} controls playsInline />
            ) : (
              <div className="preview-empty">
                <div className="preview-title">{title || "Your ranking title"}</div>
                <div className="preview-rank">#5</div>
                <ol>
                  {orderedEntries.map((entry) => (
                    <li key={entry.rank}>
                      <span>#{entry.rank}</span>
                      <strong>{entry.name || `Rank ${entry.rank}`}</strong>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </div>
          <div className="preview-meta">
            <strong>1080x1920 MP4</strong>
            <span>{ffmpegLoaded ? "FFmpeg ready" : "FFmpeg loads on generate"}</span>
          </div>
        </aside>
      </section>
    </main>
  );
}
