"use client";

import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile } from "@ffmpeg/util";
import {
  AlertCircle,
  BookOpen,
  ChevronDown,
  Check,
  Clock,
  Copy,
  Download,
  ExternalLink,
  Gamepad2,
  Github,
  Lightbulb,
  ListOrdered,
  Loader2,
  Mic2,
  Play,
  Plus,
  Search,
  Shuffle,
  SlidersHorizontal,
  Trash2,
  Upload,
  Wand2,
  Youtube
} from "lucide-react";
import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  CREATOR_SEARCH_OPTIONS,
  DEFAULT_IDEA_SEARCH_SETTINGS,
  MAX_CUSTOM_TITLE_LENGTH,
  MAX_CUSTOM_TITLE_VALUES,
  TITLE_SEARCH_OPTIONS,
  normalizeIdeaSearchSettings
} from "./lib/idea-options";
import {
  DEFAULT_REDDIT_STORY_SETTINGS,
  REDDIT_SUBREDDIT_OPTIONS,
  normalizeRedditStorySettings
} from "./lib/reddit-options";

type RankingEntry = {
  rank: number;
  name: string;
  url: string;
  file: File | null;
  duration?: number;
};

type FieldErrors = Record<string, string>;

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

type ManualSearchLink = {
  label: string;
  query: string;
  url: string;
};

type ViralIdea = {
  topic: string;
  title: string;
  source: string;
  description: string;
  hashtags: string[];
  candidates: ViralCandidate[];
  manualSearchLinks?: ManualSearchLink[];
  rateLimited?: boolean;
  cooldownUntil?: string | null;
  searchLimited?: boolean;
  message?: string;
  cacheHit?: boolean;
  generatedAt: string;
};

type YouTubeStatus = {
  configured: boolean;
  missing: string[];
  privacyStatus: string;
};

type UploadContentMode = "random" | "ranking" | "story";

type GitHubScheduleStatus = {
  configured: boolean;
  missing: string[];
  schedule?: {
    enabled: boolean;
    contentMode?: UploadContentMode;
    ideaSearch?: {
      creatorIds: string[];
      titleIds: string[];
      customTitleValues?: string[];
    };
    redditStory?: {
      subredditIds: string[];
    };
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

type AppMode = "ranking" | "reddit";
type IdeaFilterTab = "creators" | "styles" | "custom";

type RedditCaption = {
  text: string;
  start: number;
  end: number;
};

type RedditTtsResponse = {
  audioBase64: string;
  captions: RedditCaption[];
  duration: number;
  mimeType: string;
};

type ClipPlan = {
  duration: number;
  start: number;
};

type HookTeaserLines = {
  primary: string;
};

type AccentColor = {
  hex: string;
  ffmpeg: string;
};

type MedalRowBackground = {
  hex: string;
  ffmpeg: string;
};

const RANK_COUNT = 5;
const OUTPUT_WIDTH = 1080;
const OUTPUT_HEIGHT = 1920;
const DEFAULT_DURATION_SECONDS = 15;
const HOOK_DURATION_SECONDS = 5;
const END_CARD_DURATION_SECONDS = 3.6;
const SFX_SAMPLE_RATE = 44100;
const TRANSITION_SFX_SECONDS = 0.64;
const SMART_AUDIO_BUCKET_SECONDS = 0.1;
const AUTO_RUN_INTERVAL_MS = 15 * 60 * 1000;
const DEFAULT_DAILY_UPLOAD_TIMES = "5am, 7am, 9am, 11am";
const REDDIT_MAX_NARRATION_CHARACTERS = 6000;
const REDDIT_OUTPUT_WIDTH = 1080;
const REDDIT_OUTPUT_HEIGHT = 1920;
const REDDIT_OUTPUT_FPS = 30;
const REDDIT_CAPTION_LEAD_SECONDS = 0.16;
const PARKOUR_VIDEO_URL = "/assets/videos/parkour.mp4";
const PARKOUR_FALLBACK_DURATION_SECONDS = 1041.8;
const REDDIT_VOICES = [
  { id: "en-US-AndrewNeural", label: "Andrew", detail: "Energetic male" },
  { id: "en-US-AvaNeural", label: "Ava", detail: "Bright female" },
  { id: "en-US-BrianNeural", label: "Brian", detail: "Deep male" },
  { id: "en-US-EmmaNeural", label: "Emma", detail: "Natural female" }
];
const UPLOAD_CONTENT_MODE_OPTIONS: Array<{
  id: UploadContentMode;
  label: string;
  detail: string;
}> = [
  { id: "random", label: "Both", detail: "50/50" },
  { id: "ranking", label: "Ranking", detail: "only" },
  { id: "story", label: "Story", detail: "only" }
];

const IDEA_FILTER_TABS: Array<{
  id: IdeaFilterTab;
  label: string;
}> = [
  { id: "creators", label: "Creators" },
  { id: "styles", label: "Title styles" },
  { id: "custom", label: "Custom titles" }
];

function uploadContentModeText(mode: UploadContentMode) {
  return mode === "random" ? "Both (50/50)" : mode === "ranking" ? "Ranking only" : "Story only";
}
const ACCENT_COLORS: AccentColor[] = [
  { hex: "#39ff88", ffmpeg: "0x39ff88" },
  { hex: "#ff335f", ffmpeg: "0xff335f" },
  { hex: "#33a7ff", ffmpeg: "0x33a7ff" },
  { hex: "#a855ff", ffmpeg: "0xa855ff" },
  { hex: "#ffcc33", ffmpeg: "0xffcc33" },
  { hex: "#ff7a2f", ffmpeg: "0xff7a2f" },
  { hex: "#26f4ff", ffmpeg: "0x26f4ff" },
  { hex: "#ff4de3", ffmpeg: "0xff4de3" }
];
const MEDAL_ROW_BACKGROUNDS: Record<number, MedalRowBackground> = {
  1: { hex: "#f7c531", ffmpeg: "0xf7c531" },
  2: { hex: "#d7dde8", ffmpeg: "0xd7dde8" },
  3: { hex: "#c87932", ffmpeg: "0xc87932" }
};

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
  const suffix = cleanTitle.toLowerCase().includes("wait for #1") ? "" : " | Wait for #1";
  const maxBaseLength = Math.max(24, 100 - firstEmoji.length - secondEmoji.length - suffix.length - 4);
  const titleBase =
    cleanTitle.length > maxBaseLength ? `${cleanTitle.slice(0, maxBaseLength - 3).trim()}...` : cleanTitle;

  return `${firstEmoji} ${titleBase}${suffix} ${secondEmoji}`.slice(0, 100);
}

function downloadFileName(value: string, mimeType = "video/mp4") {
  const slug = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const extension = mimeType.includes("webm") ? "webm" : "mp4";
  return `🔥-${slug || "ranking-short"}-😂.${extension}`;
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

function buildViralCopyDescription(idea: ViralIdea, selectedCandidates: ViralCandidate[]) {
  const candidates =
    selectedCandidates.length === RANK_COUNT
      ? selectedCandidates
      : idea.candidates.slice(0, RANK_COUNT);
  const [laughEmoji, fireEmoji, shockEmoji] = emojiPackForTitle(idea.title);
  const featureWords = candidates
    .map((candidate) => candidate.name)
    .filter(Boolean)
    .slice(0, 5)
    .join(", ");
  const hashtags = idea.hashtags?.length
    ? idea.hashtags
    : [
        "#TikTokRankings",
        "#Top5",
        "#ViralClips",
        "#FunnyClips",
        "#WatchTillTheEnd",
        "#Shorts",
        "#YouTubeShorts",
        "#FYP"
      ];

  return [
    `${laughEmoji} ${idea.title} ${fireEmoji}`,
    `${shockEmoji} The countdown gets crazier every clip. Wait for #1.`,
    featureWords
      ? `Featured moments: ${featureWords} ${laughEmoji}`
      : `Which moment deserves the top spot? ${laughEmoji}`,
    "Comment the funniest clip and share this with someone who would replay #1.",
    `New creator rankings dropping soon. Subscribe for more ${fireEmoji}`,
    "",
    hashtags.join(" ")
  ].join("\n");
}

function fallbackViralUploadDescription(title: string, entries: RankingEntry[]) {
  const [laughEmoji, fireEmoji, shockEmoji] = emojiPackForTitle(title);
  const names = entries
    .map((entry) => entry.name.trim())
    .filter(Boolean)
    .slice(0, 5);

  return [
    `${laughEmoji} ${title} ${fireEmoji}`,
    `${shockEmoji} The countdown gets crazier every clip. Wait for #1.`,
    names.length
      ? `Featured moments: ${names.join(", ")} ${laughEmoji}`
      : `Which moment deserves the top spot? ${laughEmoji}`,
    "Comment the funniest clip and share this with someone who would replay #1.",
    `New creator rankings dropping soon. Subscribe for more ${fireEmoji}`,
    "",
    "#Top5 #ViralClips #FunnyClips #WatchTillTheEnd #StreamerMoments #ComedyShorts #Shorts #YouTubeShorts #FYP"
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

function containsMp4Box(bytes: Uint8Array, boxName: string, searchLimit: number) {
  const target = [...boxName].map((character) => character.charCodeAt(0));
  const limit = Math.min(bytes.length - target.length, searchLimit);

  for (let index = 0; index <= limit; index += 1) {
    if (target.every((value, offset) => bytes[index + offset] === value)) {
      return true;
    }
  }

  return false;
}

function assertValidMp4Container(bytes: Uint8Array) {
  const headerSearchLimit = 4 * 1024 * 1024;

  if (
    bytes.length < 100_000 ||
    !containsMp4Box(bytes, "ftyp", 64) ||
    !containsMp4Box(bytes, "moov", headerSearchLimit) ||
    !containsMp4Box(bytes, "mdat", headerSearchLimit)
  ) {
    throw new Error("FFmpeg produced an incomplete MP4. The video was not uploaded.");
  }
}

function assertValidRecordedContainer(bytes: Uint8Array, mimeType: string) {
  if (mimeType.includes("webm")) {
    const hasEbmlHeader =
      bytes.length >= 100_000 &&
      bytes[0] === 0x1a &&
      bytes[1] === 0x45 &&
      bytes[2] === 0xdf &&
      bytes[3] === 0xa3;

    if (!hasEbmlHeader) {
      throw new Error("The browser produced an incomplete WebM video.");
    }

    return;
  }

  assertValidMp4Container(bytes);
}

async function playableVideoUrl(blob: Blob) {
  const url = URL.createObjectURL(blob);
  const video = document.createElement("video");
  video.preload = "metadata";
  video.muted = true;
  video.src = url;

  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(
        () => reject(new Error("The generated MP4 could not be decoded by the browser.")),
        15000
      );

      video.onloadedmetadata = () => {
        window.clearTimeout(timeout);
        resolve();
      };
      video.onerror = () => {
        window.clearTimeout(timeout);
        reject(new Error("The generated MP4 has no supported video track."));
      };
    });

    if (!video.videoWidth || !video.videoHeight || !Number.isFinite(video.duration)) {
      throw new Error("The generated MP4 has invalid video metadata.");
    }

    return url;
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  } finally {
    video.removeAttribute("src");
    video.load();
  }
}

function redditRecorderMimeType() {
  const candidates = [
    "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
    "video/mp4",
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm"
  ];

  return candidates.find((mimeType) => MediaRecorder.isTypeSupported(mimeType)) || "";
}

async function imageBitmapFromPng(bytes: Uint8Array) {
  return createImageBitmap(new Blob([toArrayBuffer(bytes)], { type: "image/png" }));
}

async function renderRedditStoryNatively({
  backgroundStart,
  audioContext,
  narrationBytes,
  headerBytes,
  accentColor,
  captions,
  onProgress
}: {
  backgroundStart: number;
  audioContext: AudioContext;
  narrationBytes: Uint8Array;
  headerBytes: Uint8Array;
  accentColor: AccentColor;
  captions: RedditCaption[];
  onProgress?: (elapsed: number, duration: number) => void;
}) {
  const mimeType = redditRecorderMimeType();

  if (!mimeType) {
    throw new Error("This browser cannot record MP4 or WebM video. Use a current Chrome or Firefox release.");
  }

  const canvas = document.createElement("canvas");
  canvas.width = REDDIT_OUTPUT_WIDTH;
  canvas.height = REDDIT_OUTPUT_HEIGHT;
  const ctx = canvas.getContext("2d", { alpha: false });

  if (!ctx) {
    throw new Error("Canvas video rendering is unavailable.");
  }

  const background = document.createElement("video");
  background.preload = "auto";
  background.muted = true;
  background.loop = true;
  background.playsInline = true;
  const headerBitmap = await imageBitmapFromPng(headerBytes);
  let drawTimer = 0;
  let recorder: MediaRecorder | null = null;

  try {
    const backgroundReady = new Promise<void>((resolve, reject) => {
        background.onloadedmetadata = () => resolve();
        background.onerror = () => reject(new Error("The bundled parkour video could not be decoded."));
      });
    background.src = PARKOUR_VIDEO_URL;
    await Promise.all([
      backgroundReady,
      audioContext.state === "running" ? Promise.resolve() : audioContext.resume()
    ]);

    await new Promise<void>((resolve) => {
      background.onseeked = () => resolve();
      background.currentTime = Math.min(backgroundStart, Math.max(0, background.duration - 0.25));
    });

    const narration = await audioContext.decodeAudioData(toArrayBuffer(narrationBytes));
    const audioSource = audioContext.createBufferSource();
    const audioDestination = audioContext.createMediaStreamDestination();
    audioSource.buffer = narration;
    audioSource.connect(audioDestination);
    const canvasStream = canvas.captureStream(REDDIT_OUTPUT_FPS);
    const outputStream = new MediaStream([
      ...canvasStream.getVideoTracks(),
      ...audioDestination.stream.getAudioTracks()
    ]);
    const chunks: Blob[] = [];
    recorder = new MediaRecorder(outputStream, {
      mimeType,
      videoBitsPerSecond: 8_000_000,
      audioBitsPerSecond: 128_000
    });
    const stopped = new Promise<void>((resolve, reject) => {
      recorder!.ondataavailable = (event) => {
        if (event.data.size) {
          chunks.push(event.data);
        }
      };
      recorder!.onstop = () => resolve();
      recorder!.onerror = () => reject(new Error("The browser video recorder stopped unexpectedly."));
    });
    const recordingStart = audioContext.currentTime + 0.1;

    const drawFrame = () => {
      const sourceWidth = background.videoWidth;
      const sourceHeight = background.videoHeight;
      const targetRatio = REDDIT_OUTPUT_WIDTH / REDDIT_OUTPUT_HEIGHT;
      const sourceRatio = sourceWidth / sourceHeight;
      let sx = 0;
      let sy = 0;
      let sw = sourceWidth;
      let sh = sourceHeight;

      if (sourceRatio > targetRatio) {
        sw = sourceHeight * targetRatio;
        sx = (sourceWidth - sw) / 2;
      } else {
        sh = sourceWidth / targetRatio;
        sy = (sourceHeight - sh) / 2;
      }

      ctx.drawImage(
        background,
        sx,
        sy,
        sw,
        sh,
        0,
        0,
        REDDIT_OUTPUT_WIDTH,
        REDDIT_OUTPUT_HEIGHT
      );
      ctx.drawImage(headerBitmap, 0, 0);
      const elapsed = Math.max(0, audioContext.currentTime - recordingStart);
      const captionTime = elapsed + REDDIT_CAPTION_LEAD_SECONDS;
      const activeCaptionIndex = captions.findIndex(
        (caption) => captionTime >= caption.start && captionTime <= caption.end + 0.08
      );

      if (activeCaptionIndex >= 0) {
        drawRedditCaption(ctx, captions[activeCaptionIndex], activeCaptionIndex, accentColor);
      }

      onProgress?.(elapsed, narration.duration);
    };

    drawFrame();
    await background.play();
    recorder.start(1000);
    drawTimer = window.setInterval(drawFrame, 1000 / REDDIT_OUTPUT_FPS);
    audioSource.onended = () => recorder?.stop();
    audioSource.start(recordingStart);
    await stopped;
    outputStream.getTracks().forEach((track) => track.stop());

    if (!chunks.length) {
      throw new Error("The browser recorder returned an empty video.");
    }

    return new Blob(chunks, { type: recorder.mimeType || mimeType });
  } finally {
    if (drawTimer) {
      window.clearInterval(drawTimer);
    }

    background.pause();
    background.removeAttribute("src");
    background.load();
    headerBitmap.close();
  }
}

function base64ToUint8Array(value: string) {
  const binary = window.atob(value);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

async function ffmpegAssetBlobUrl(url: string, mimeType: string, minimumBytes: number) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 60000);

  try {
    const response = await fetch(url, {
      cache: "force-cache",
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`FFmpeg asset ${url} returned ${response.status}.`);
    }

    const bytes = await response.arrayBuffer();

    if (bytes.byteLength < minimumBytes) {
      throw new Error(`FFmpeg asset ${url} is missing or incomplete.`);
    }

    return URL.createObjectURL(new Blob([bytes], { type: mimeType }));
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(`Downloading ${url} timed out. Check the deployment assets and connection.`);
    }

    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

function narrationCharacterCount(title: string, story: string) {
  return `${title.trim()}. ${story.trim()}`.length;
}

function redditUploadDescription(title: string, story: string, source: string) {
  const cleanStory = story.replace(/\s+/g, " ").trim();
  const firstSentenceEnd = cleanStory.search(/[.!?](?:\s|$)/);
  const rawHook = firstSentenceEnd >= 0 ? cleanStory.slice(0, firstSentenceEnd + 1) : cleanStory;
  const hook = rawHook.length > 170
    ? `${rawHook.slice(0, 167).replace(/\s+\S*$/, "")}...`
    : rawHook;
  const normalizedSource = source.toLowerCase();
  const relatedHashtags = normalizedSource.includes("nosleep")
    ? "#NoSleep #ScaryStories #HorrorStories"
    : normalizedSource.includes("confession")
      ? "#Confession #RedditConfessions #TrueStories"
      : "#RedditStories #Storytime #ViralStories";

  return [
    `📖 ${title} 😳🔥`,
    hook ? `👀 ${hook}` : "👀 This story gets crazier the longer it goes...",
    `This ${source || "Reddit"} story had me watching until the very end. 🤯`,
    "What would YOU have done? Drop your answer in the comments. 👇💬",
    "👍 Like for more stories and subscribe so you do not miss the next one! 🔔⛏️",
    "",
    `${relatedHashtags} #MinecraftParkour #Minecraft #Shorts #YouTubeShorts #FYP`
  ].join("\n");
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

function randomItem<T>(items: T[]) {
  return items[Math.floor(Math.random() * items.length)];
}

function randomAccentColor() {
  return ACCENT_COLORS[Math.floor(Math.random() * ACCENT_COLORS.length)] ?? ACCENT_COLORS[0];
}

function hexToRgba(hex: string, alpha: number) {
  const normalized = hex.replace("#", "");
  const red = Number.parseInt(normalized.slice(0, 2), 16);
  const green = Number.parseInt(normalized.slice(2, 4), 16);
  const blue = Number.parseInt(normalized.slice(4, 6), 16);

  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
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

async function createRedditHeaderPng(title: string, accentColor: AccentColor) {
  const canvas = document.createElement("canvas");
  canvas.width = REDDIT_OUTPUT_WIDTH;
  canvas.height = REDDIT_OUTPUT_HEIGHT;
  const ctx = canvas.getContext("2d");

  if (!ctx) {
    throw new Error("Canvas rendering is unavailable in this browser.");
  }

  ctx.clearRect(0, 0, REDDIT_OUTPUT_WIDTH, REDDIT_OUTPUT_HEIGHT);
  ctx.scale(REDDIT_OUTPUT_WIDTH / OUTPUT_WIDTH, REDDIT_OUTPUT_HEIGHT / OUTPUT_HEIGHT);
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.lineJoin = "round";
  ctx.shadowColor = "rgba(0, 0, 0, 0.82)";
  ctx.shadowBlur = 24;
  ctx.strokeStyle = "rgba(0, 0, 0, 0.9)";

  ctx.fillStyle = accentColor.hex;
  ctx.beginPath();
  ctx.roundRect(350, 132, 380, 62, 18);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = "#080b12";
  ctx.font = '900 31px "Arial Black", Impact, sans-serif';
  ctx.fillText("REDDIT STORY", OUTPUT_WIDTH / 2, 147);

  ctx.shadowBlur = 24;
  ctx.fillStyle = "#ffffff";
  let titleFontSize = 54;
  let lines: string[] = [];

  do {
    ctx.font = `900 ${titleFontSize}px "Arial Black", Impact, sans-serif`;
    lines = wrapTextFully(ctx, title, 900);
    titleFontSize -= 2;
  } while (lines.length > 5 && titleFontSize >= 34);

  const titleLineHeight = Math.max(44, (titleFontSize + 2) * 1.2);
  lines.forEach((line, index) => {
    const y = 225 + index * titleLineHeight;
    ctx.lineWidth = 10;
    ctx.strokeText(line, OUTPUT_WIDTH / 2, y);
    ctx.fillText(line, OUTPUT_WIDTH / 2, y);
  });

  return canvasToPngBytes(canvas);
}

function drawRedditCaption(
  ctx: CanvasRenderingContext2D,
  caption: RedditCaption,
  index: number,
  accentColor: AccentColor
) {
  ctx.save();
  ctx.scale(REDDIT_OUTPUT_WIDTH / OUTPUT_WIDTH, REDDIT_OUTPUT_HEIGHT / OUTPUT_HEIGHT);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.shadowColor = "rgba(0, 0, 0, 0.9)";
  ctx.shadowBlur = 28;
  ctx.strokeStyle = "rgba(0, 0, 0, 0.96)";
  ctx.lineWidth = 18;
  ctx.font = '900 94px "Arial Black", Impact, sans-serif';
  const lines = wrapTextFully(ctx, caption.text.toUpperCase(), 900);
  const lineHeight = 108;
  const startY = 1010 - ((lines.length - 1) * lineHeight) / 2;

  lines.forEach((line, lineIndex) => {
    const y = startY + lineIndex * lineHeight;
    ctx.fillStyle = (index + lineIndex) % 3 === 1 ? accentColor.hex : "#ffffff";
    ctx.strokeText(line, OUTPUT_WIDTH / 2, y);
    ctx.fillText(line, OUTPUT_WIDTH / 2, y);
  });
  ctx.restore();
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
  const result = await audioHighlightFromFile(file, sourceDuration, windowSeconds);
  return result.start;
}

async function audioHighlightFromFile(file: File, sourceDuration: number, windowSeconds: number) {
  const AudioContextConstructor =
    window.AudioContext ||
    (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

  if (!AudioContextConstructor) {
    return {
      start: Math.max(0, (sourceDuration - windowSeconds) / 2),
      score: 0
    };
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

    return {
      start: Math.max(0, Math.min(bestStartSample / sampleRate, sourceDuration - windowSeconds)),
      score: Number.isFinite(bestScore) ? bestScore : 0
    };
  } catch {
    return {
      start: Math.max(0, (sourceDuration - windowSeconds) / 2),
      score: 0
    };
  } finally {
    await audioContext.close();
  }
}

function percentile(values: number[], ratio: number) {
  if (!values.length) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * ratio)))];
}

function adaptivePlanFromEnergy(
  energies: number[],
  sourceDuration: number,
  targetDuration: number
): ClipPlan {
  const safeSourceDuration = Math.max(0.5, sourceDuration);
  const safeTargetDuration = Math.min(targetDuration, safeSourceDuration);

  if (!energies.length || safeSourceDuration <= safeTargetDuration + 0.25) {
    return { start: 0, duration: safeTargetDuration };
  }

  const bucketSeconds = safeSourceDuration / energies.length;
  const targetBuckets = Math.max(1, Math.ceil(safeTargetDuration / bucketSeconds));
  const maxStartBucket = Math.max(0, energies.length - targetBuckets);
  const prefix = [0];

  for (const energy of energies) {
    prefix.push(prefix[prefix.length - 1] + energy);
  }

  let bestStartBucket = 0;
  let bestScore = -Infinity;

  for (let startBucket = 0; startBucket <= maxStartBucket; startBucket += 1) {
    const endBucket = Math.min(energies.length, startBucket + targetBuckets);
    const average = (prefix[endBucket] - prefix[startBucket]) / Math.max(1, endBucket - startBucket);
    const centerBias = 1 - Math.abs(startBucket / Math.max(1, maxStartBucket) - 0.5) * 0.08;
    const score = average * centerBias;

    if (score > bestScore) {
      bestScore = score;
      bestStartBucket = startBucket;
    }
  }

  const smoothEnergy = (bucket: number) => {
    const start = Math.max(0, bucket - 1);
    const end = Math.min(energies.length - 1, bucket + 1);
    let total = 0;

    for (let index = start; index <= end; index += 1) {
      total += energies[index];
    }

    return total / Math.max(1, end - start + 1);
  };
  const noiseFloor = percentile(energies, 0.2);
  const typicalEnergy = percentile(energies, 0.65);
  const quietThreshold = Math.max(0.0015, noiseFloor * 1.8, typicalEnergy * 0.34);
  const availableExtension = Math.max(0, safeSourceDuration - safeTargetDuration);
  const maxExtension = Math.min(
    availableExtension,
    Math.max(2, Math.min(6, safeTargetDuration * 0.6))
  );
  const endExtensionBuckets = Math.floor((maxExtension * 0.7) / bucketSeconds);
  const startExtensionBuckets = Math.floor((maxExtension * 0.3) / bucketSeconds);
  const initialEndBucket = Math.min(energies.length, bestStartBucket + targetBuckets);
  const forwardLimit = Math.min(energies.length, initialEndBucket + endExtensionBuckets);
  const backwardLimit = Math.max(0, bestStartBucket - startExtensionBuckets);

  const findForwardBoundary = () => {
    if (initialEndBucket >= energies.length || smoothEnergy(initialEndBucket) <= quietThreshold) {
      return initialEndBucket;
    }

    let quietestBucket = initialEndBucket;
    let quietestEnergy = smoothEnergy(initialEndBucket);

    for (let bucket = initialEndBucket + 1; bucket <= forwardLimit; bucket += 1) {
      const energy = smoothEnergy(bucket);

      if (energy < quietestEnergy) {
        quietestBucket = bucket;
        quietestEnergy = energy;
      }

      if (
        energy <= quietThreshold &&
        smoothEnergy(Math.min(energies.length - 1, bucket + 1)) <= quietThreshold * 1.15
      ) {
        return bucket;
      }
    }

    return quietestEnergy <= smoothEnergy(initialEndBucket) * 0.72
      ? quietestBucket
      : forwardLimit;
  };

  const findBackwardBoundary = () => {
    if (bestStartBucket <= 0 || smoothEnergy(bestStartBucket) <= quietThreshold) {
      return bestStartBucket;
    }

    let quietestBucket = bestStartBucket;
    let quietestEnergy = smoothEnergy(bestStartBucket);

    for (let bucket = bestStartBucket - 1; bucket >= backwardLimit; bucket -= 1) {
      const energy = smoothEnergy(bucket);

      if (energy < quietestEnergy) {
        quietestBucket = bucket;
        quietestEnergy = energy;
      }

      if (
        energy <= quietThreshold &&
        smoothEnergy(Math.max(0, bucket - 1)) <= quietThreshold * 1.15
      ) {
        return bucket;
      }
    }

    return quietestEnergy <= smoothEnergy(bestStartBucket) * 0.72
      ? quietestBucket
      : backwardLimit;
  };

  const start = Math.max(0, findBackwardBoundary() * bucketSeconds);
  const end = Math.min(safeSourceDuration, findForwardBoundary() * bucketSeconds);

  return {
    start,
    duration: Math.min(safeSourceDuration - start, Math.max(safeTargetDuration, end - start))
  };
}

async function adaptiveAudioClipPlanFromFile(
  file: File,
  sourceDuration: number,
  targetDuration: number
) {
  const AudioContextConstructor =
    window.AudioContext ||
    (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

  if (!AudioContextConstructor) {
    return {
      start: Math.max(0, (sourceDuration - targetDuration) / 2),
      duration: Math.min(targetDuration, sourceDuration)
    };
  }

  const audioContext = new AudioContextConstructor();

  try {
    const decoded = await audioContext.decodeAudioData(await file.arrayBuffer());
    const decodedDuration = decoded.duration || sourceDuration;
    const bucketSamples = Math.max(1, Math.floor(decoded.sampleRate * SMART_AUDIO_BUCKET_SECONDS));
    const sampleStride = Math.max(1, Math.floor(decoded.sampleRate / 300));
    const energies: number[] = [];

    for (let bucketStart = 0; bucketStart < decoded.length; bucketStart += bucketSamples) {
      const bucketEnd = Math.min(decoded.length, bucketStart + bucketSamples);
      let total = 0;
      let samples = 0;

      for (let channel = 0; channel < decoded.numberOfChannels; channel += 1) {
        const data = decoded.getChannelData(channel);

        for (let sample = bucketStart; sample < bucketEnd; sample += sampleStride) {
          total += data[sample] * data[sample];
          samples += 1;
        }
      }

      energies.push(samples ? Math.sqrt(total / samples) : 0);
    }

    return adaptivePlanFromEnergy(energies, decodedDuration, targetDuration);
  } catch {
    return {
      start: Math.max(0, (sourceDuration - targetDuration) / 2),
      duration: Math.min(targetDuration, sourceDuration)
    };
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

  return adaptiveAudioClipPlanFromFile(entry.file, safeSourceDuration, clipDuration);
}

async function browserHookPlanFromLoudestEntry(entries: RankingEntry[]) {
  let best: { entry: RankingEntry & { file: File }; plan: ClipPlan; score: number } | null = null;
  const preferredEntries = entries.filter((entry) => entry.rank !== RANK_COUNT);
  const hookCandidates = preferredEntries.length ? preferredEntries : entries;

  for (const entry of hookCandidates) {
    if (!entry.file) {
      continue;
    }

    const entryWithFile = entry as RankingEntry & { file: File };
    const measuredDuration = await videoDurationFromFile(entry.file);
    const sourceDuration = Math.max(0.5, measuredDuration || entry.duration || HOOK_DURATION_SECONDS);
    const duration = Math.min(HOOK_DURATION_SECONDS, sourceDuration);
    const highlight = sourceDuration <= HOOK_DURATION_SECONDS + 0.25
      ? { start: 0, score: 0 }
      : await audioHighlightFromFile(entry.file, sourceDuration, duration);
    const score = highlight.score || (sourceDuration <= HOOK_DURATION_SECONDS + 0.25 ? 0.0001 : 0);

    if (!best || score > best.score) {
      best = {
        entry: entryWithFile,
        plan: {
          start: highlight.start,
          duration
        },
        score
      };
    }
  }

  if (!best) {
    throw new Error("Missing hook clip source.");
  }

  return best;
}

async function createOverlayPng(
  title: string,
  activeEntry: RankingEntry,
  orderedEntries: RankingEntry[],
  accentColor: AccentColor
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
  ctx.lineJoin = "round";
  ctx.lineWidth = 8;
  ctx.strokeStyle = "rgba(0, 0, 0, 0.82)";
  ctx.fillStyle = accentColor.hex;
  titleLines.forEach((line, index) => {
    const y = titleSafeY + index * titleFont.lineHeight;
    ctx.strokeText(line, OUTPUT_WIDTH / 2, y);
    ctx.fillText(line, OUTPUT_WIDTH / 2, y);
  });

  ctx.textAlign = "left";
  ctx.shadowBlur = 30;
  ctx.font = '900 178px "Arial Black", Impact, sans-serif';
  ctx.lineWidth = 12;
  ctx.strokeStyle = "rgba(0, 0, 0, 0.88)";
  ctx.fillStyle = accentColor.hex;
  ctx.strokeText(`#${activeEntry.rank}`, 70, 1215);
  ctx.fillText(`#${activeEntry.rank}`, 70, 1215);

  ctx.font = '900 64px "Arial", sans-serif';
  ctx.lineWidth = 7;
  ctx.strokeStyle = "rgba(0, 0, 0, 0.84)";
  ctx.fillStyle = accentColor.hex;
  const nameLines = wrapText(ctx, activeEntry.name, 900, 2);
  nameLines.forEach((line, index) => {
    const y = 1400 + index * 74;
    ctx.strokeText(line, 72, y);
    ctx.fillText(line, 72, y);
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
    const medalRowBackground = MEDAL_ROW_BACKGROUNDS[entry.rank];

    ctx.fillStyle = medalRowBackground
      ? hexToRgba(medalRowBackground.hex, isActive ? 0.46 : isComplete ? 0.34 : 0.24)
      : isActive
        ? hexToRgba(accentColor.hex, 0.24)
        : isComplete
          ? "rgba(255, 255, 255, 0.16)"
          : "rgba(255, 255, 255, 0.08)";
    ctx.beginPath();
    ctx.roundRect(listX, y, 940, 44, 18);
    ctx.fill();

    ctx.fillStyle = isActive ? accentColor.hex : isComplete ? "#ffffff" : "rgba(255, 255, 255, 0.68)";

    if (isActive) {
      ctx.lineWidth = 4;
      ctx.strokeStyle = "rgba(0, 0, 0, 0.78)";
      ctx.strokeText(`#${entry.rank}`, listX + 22, y + 22);
    }

    ctx.fillText(`#${entry.rank}`, listX + 22, y + 22);

    ctx.fillStyle = isActive ? "#ffffff" : "rgba(255, 255, 255, 0.78)";
    const trimmedName =
      entry.name.length > 30 ? `${entry.name.slice(0, 29).trim()}...` : entry.name;
    ctx.fillText(trimmedName, listX + 118, y + 22);
  });

  return canvasToPngBytes(canvas);
}

async function createRankRevealPng(rank: number, accentColor: AccentColor) {
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
  ctx.fillStyle = accentColor.hex;
  ctx.strokeText(`#${rank}`, OUTPUT_WIDTH / 2, 820);
  ctx.fillText(`#${rank}`, OUTPUT_WIDTH / 2, 820);

  return canvasToPngBytes(canvas);
}

async function createHookOverlayPng(
  title: string,
  teaser: HookTeaserLines,
  accentColor: AccentColor
) {
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
  ctx.fillStyle = accentColor.hex;
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
  ctx.fillStyle = accentColor.hex;
  teaserLines.forEach((line, index) => {
    const y = teaserTop + index * teaserLineHeight;
    ctx.strokeText(line, OUTPUT_WIDTH / 2, y);
    ctx.fillText(line, OUTPUT_WIDTH / 2, y);
  });

  ctx.shadowBlur = 0;
  ctx.fillStyle = "#ff334e";
  ctx.beginPath();
  ctx.roundRect(185, 1420, 710, 145, 32);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.font = '900 58px "Arial Black", Impact, sans-serif';
  ctx.fillText("SUBSCRIBE", OUTPUT_WIDTH / 2, 1460);

  ctx.fillStyle = "rgba(255, 255, 255, 0.14)";
  ctx.beginPath();
  ctx.roundRect(325, 1650, 430, 120, 28);
  ctx.fill();
  drawLikeIcon(ctx, 365, 1650, 0.72, "#ffffff");
  ctx.textAlign = "left";
  ctx.fillStyle = "#ffffff";
  ctx.font = '900 48px "Arial Black", Impact, sans-serif';
  ctx.fillText("LIKE", 520, 1682);

  return canvasToPngBytes(canvas);
}

function drawLikeIcon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  scale: number,
  color: string
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(0, 42, 26, 66, 8);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(34, 46);
  ctx.lineTo(58, 46);
  ctx.lineTo(76, 8);
  ctx.quadraticCurveTo(82, -4, 94, 2);
  ctx.quadraticCurveTo(102, 6, 99, 20);
  ctx.lineTo(94, 46);
  ctx.lineTo(122, 46);
  ctx.quadraticCurveTo(139, 46, 135, 63);
  ctx.lineTo(126, 96);
  ctx.quadraticCurveTo(123, 108, 109, 108);
  ctx.lineTo(34, 108);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

type EngagementKind = "subscribe" | "like";
type EngagementPlacement = "hook" | "end";
type EngagementBox = {
  x: number;
  y: number;
  width: number;
  height: number;
  radius: number;
};

const ENGAGEMENT_FRAME_RATE = 30;

function drawCheckIcon(
  ctx: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  radius: number
) {
  ctx.save();
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#0b9f58";
  ctx.lineWidth = Math.max(8, radius * 0.22);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(centerX - radius * 0.48, centerY);
  ctx.lineTo(centerX - radius * 0.12, centerY + radius * 0.36);
  ctx.lineTo(centerX + radius * 0.52, centerY - radius * 0.38);
  ctx.stroke();
  ctx.restore();
}

function drawTapIndicator(
  ctx: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  radius: number,
  opacity = 1
) {
  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.95)";
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius * 0.38, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

function easeOutCubic(value: number) {
  const inverse = 1 - clamp01(value);
  return 1 - inverse * inverse * inverse;
}

function easeInOutCubic(value: number) {
  const progress = clamp01(value);
  return progress < 0.5
    ? 4 * progress * progress * progress
    : 1 - Math.pow(-2 * progress + 2, 3) / 2;
}

function easeOutBack(value: number) {
  const progress = clamp01(value);
  const overshoot = 1.70158;
  return 1 + (overshoot + 1) * Math.pow(progress - 1, 3) + overshoot * Math.pow(progress - 1, 2);
}

function lerp(start: number, end: number, progress: number) {
  return start + (end - start) * progress;
}

function mixHexColor(from: string, to: string, progress: number) {
  const amount = clamp01(progress);
  const fromValue = Number.parseInt(from.slice(1), 16);
  const toValue = Number.parseInt(to.slice(1), 16);
  const channels = [16, 8, 0].map((shift) =>
    Math.round(
      lerp((fromValue >> shift) & 255, (toValue >> shift) & 255, amount)
    )
  );
  return `rgb(${channels[0]}, ${channels[1]}, ${channels[2]})`;
}

function engagementBoxes(
  placement: EngagementPlacement,
  kind: EngagementKind
): { base: EngagementBox; settled: EngagementBox } {
  const isHook = placement === "hook";
  const base =
    kind === "subscribe"
      ? isHook
        ? { x: 185, y: 1420, width: 710, height: 145, radius: 32 }
        : { x: 170, y: 1015, width: 740, height: 190, radius: 38 }
      : isHook
        ? { x: 325, y: 1650, width: 430, height: 120, radius: 28 }
        : { x: 300, y: 1355, width: 480, height: 150, radius: 34 };
  const settled =
    kind === "subscribe"
      ? isHook
        ? { x: 165, y: 1405, width: 750, height: 175, radius: 38 }
        : { x: 150, y: 995, width: 780, height: 220, radius: 44 }
      : isHook
        ? { x: 305, y: 1640, width: 470, height: 140, radius: 32 }
        : { x: 275, y: 1335, width: 530, height: 190, radius: 40 };

  return { base, settled };
}

function drawAnimatedEngagementButton(
  ctx: CanvasRenderingContext2D,
  placement: EngagementPlacement,
  kind: EngagementKind,
  localTime: number
) {
  if (localTime < 0) {
    return;
  }

  const isHook = placement === "hook";
  const { base, settled } = engagementBoxes(placement, kind);
  const pressProgress = clamp01(localTime / 0.22);
  const releaseProgress = clamp01((localTime - 0.22) / 0.52);
  const successProgress = easeInOutCubic((localTime - 0.17) / 0.32);
  const boxProgress = easeOutCubic((localTime - 0.18) / 0.48);
  const scale =
    localTime < 0.22
      ? lerp(1, 0.88, easeOutCubic(pressProgress))
      : 1 - 0.12 * Math.exp(-5.5 * releaseProgress) * Math.cos(releaseProgress * Math.PI * 3);
  const centerX = lerp(base.x + base.width / 2, settled.x + settled.width / 2, boxProgress);
  const centerY = lerp(base.y + base.height / 2, settled.y + settled.height / 2, boxProgress);
  const width = lerp(base.width, settled.width, boxProgress);
  const height = lerp(base.height, settled.height, boxProgress);
  const radius = lerp(base.radius, settled.radius, boxProgress);
  const successColor = kind === "subscribe" ? "#12b968" : "#258ee9";
  const pressColor = kind === "subscribe" ? "#bd1731" : "#176da8";
  const currentColor = mixHexColor(pressColor, successColor, successProgress);

  ctx.save();
  ctx.translate(centerX, centerY);
  ctx.scale(scale, scale);
  ctx.shadowColor =
    kind === "subscribe" ? "rgba(18, 185, 104, 0.88)" : "rgba(37, 142, 233, 0.88)";
  ctx.shadowBlur = lerp(16, 38, successProgress);
  ctx.fillStyle = currentColor;
  ctx.beginPath();
  ctx.roundRect(-width / 2, -height / 2, width, height, radius);
  ctx.fill();
  ctx.shadowBlur = 0;
  if (localTime < 0.28) {
    ctx.fillStyle = "rgba(0, 0, 0, 0.16)";
    ctx.beginPath();
    ctx.roundRect(
      -width / 2 + 10,
      -height / 2 + 12,
      width - 20,
      height - 18,
      Math.max(18, radius - 8)
    );
    ctx.fill();
  }

  ctx.fillStyle = "#ffffff";
  if (kind === "subscribe") {
    const iconProgress = easeOutBack((localTime - 0.28) / 0.34);
    if (iconProgress > 0) {
      const iconRadius = (isHook ? 27 : 32) * iconProgress;
      drawCheckIcon(ctx, -width / 2 + (isHook ? 64 : 74), 0, iconRadius);
    }
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const fontSize = isHook ? 52 : 62;
    ctx.font = `900 ${fontSize}px "Arial Black", Impact, sans-serif`;
    ctx.globalAlpha = 1 - successProgress;
    ctx.fillText("SUBSCRIBE", 0, 1);
    ctx.globalAlpha = successProgress;
    ctx.fillText("SUBSCRIBED!", width * 0.06, 1);
  } else {
    const iconScale = (isHook ? 0.78 : 0.98) * (1 + 0.12 * Math.sin(successProgress * Math.PI));
    drawLikeIcon(
      ctx,
      -width / 2 + (isHook ? 38 : 48),
      -height / 2 + (isHook ? 16 : 26),
      iconScale,
      "#ffffff"
    );
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    const fontSize = isHook ? 50 : 64;
    ctx.font = `900 ${fontSize}px "Arial Black", Impact, sans-serif`;
    const textX = -width / 2 + width * 0.45;
    ctx.globalAlpha = 1 - successProgress;
    ctx.fillText("LIKE", textX, 1);
    ctx.globalAlpha = successProgress;
    ctx.fillText("LIKED!", textX, 1);
  }
  ctx.restore();

  const tapProgress = clamp01(localTime / 0.3);
  if (tapProgress < 1) {
    drawTapIndicator(
      ctx,
      centerX + width * 0.34,
      centerY + height * 0.25,
      lerp(isHook ? 16 : 20, isHook ? 38 : 46, tapProgress),
      1 - tapProgress
    );
  }

  const burstProgress = clamp01((localTime - 0.24) / 0.78);
  if (burstProgress > 0 && burstProgress < 1) {
    const ringOpacity = Math.pow(1 - burstProgress, 1.45);
    ctx.save();
    ctx.strokeStyle = successColor;
    ctx.globalAlpha = ringOpacity;
    ctx.lineWidth = lerp(12, 4, burstProgress);
    [0, 1].forEach((ringIndex) => {
      const delayed = clamp01((burstProgress - ringIndex * 0.12) / (1 - ringIndex * 0.12));
      if (delayed <= 0) {
        return;
      }
      const expansion = lerp(14, isHook ? 92 : 112, easeOutCubic(delayed));
      ctx.beginPath();
      ctx.roundRect(
        centerX - width / 2 - expansion,
        centerY - height / 2 - expansion * 0.55,
        width + expansion * 2,
        height + expansion * 1.1,
        radius + expansion * 0.35
      );
      ctx.stroke();
    });

    const particleCount = 14;
    for (let index = 0; index < particleCount; index += 1) {
      const angle = (Math.PI * 2 * index) / particleCount - Math.PI / 2;
      const distance = lerp(width * 0.48, width * 0.72, easeOutCubic(burstProgress));
      const particleX = centerX + Math.cos(angle) * distance;
      const particleY =
        centerY +
        Math.sin(angle) * distance * 0.38 +
        42 * burstProgress * burstProgress;
      ctx.save();
      ctx.translate(particleX, particleY);
      ctx.rotate(angle + burstProgress * 2.4);
      ctx.globalAlpha = ringOpacity;
      ctx.fillStyle = index % 3 === 0 ? "#ffffff" : successColor;
      const particleLength = lerp(isHook ? 34 : 42, 10, burstProgress);
      ctx.beginPath();
      ctx.roundRect(-6, -particleLength / 2, 12, particleLength, 6);
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }
}

async function writeEngagementAnimationFrames(
  ffmpeg: FFmpeg,
  prefix: string,
  placement: EngagementPlacement
) {
  const canvas = document.createElement("canvas");
  canvas.width = OUTPUT_WIDTH;
  canvas.height = OUTPUT_HEIGHT;
  const ctx = canvas.getContext("2d");

  if (!ctx) {
    throw new Error("Canvas rendering is unavailable in this browser.");
  }

  const subscribeStart = placement === "hook" ? 0.58 : 0.46;
  const likeStart = placement === "hook" ? 2.1 : 1.64;
  const animationDuration = likeStart + 1.08;
  const frameCount = Math.ceil(animationDuration * ENGAGEMENT_FRAME_RATE) + 1;

  for (let frame = 0; frame < frameCount; frame += 1) {
    const time = frame / ENGAGEMENT_FRAME_RATE;
    ctx.clearRect(0, 0, OUTPUT_WIDTH, OUTPUT_HEIGHT);
    drawAnimatedEngagementButton(ctx, placement, "subscribe", time - subscribeStart);
    drawAnimatedEngagementButton(ctx, placement, "like", time - likeStart);
    const frameName = `${prefix}-${String(frame).padStart(3, "0")}.png`;
    await ffmpeg.writeFile(frameName, await canvasToPngBytes(canvas));
  }
}

async function createEndCardBasePng(accentColor: AccentColor) {
  const canvas = document.createElement("canvas");
  canvas.width = OUTPUT_WIDTH;
  canvas.height = OUTPUT_HEIGHT;
  const ctx = canvas.getContext("2d");

  if (!ctx) {
    throw new Error("Canvas rendering is unavailable in this browser.");
  }

  ctx.fillStyle = "#07090f";
  ctx.fillRect(0, 0, OUTPUT_WIDTH, OUTPUT_HEIGHT);
  ctx.fillStyle = accentColor.hex;
  ctx.fillRect(0, 0, OUTPUT_WIDTH, 24);
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.lineJoin = "round";
  ctx.shadowColor = "rgba(0, 0, 0, 0.8)";
  ctx.shadowBlur = 28;
  ctx.strokeStyle = "rgba(0, 0, 0, 0.9)";
  ctx.lineWidth = 10;
  ctx.fillStyle = "#ffffff";
  ctx.font = '900 112px "Arial Black", Impact, sans-serif';
  ctx.strokeText("SUBSCRIBE", OUTPUT_WIDTH / 2, 260);
  ctx.fillText("SUBSCRIBE", OUTPUT_WIDTH / 2, 260);
  ctx.font = '900 84px "Arial Black", Impact, sans-serif';
  ctx.strokeText("TO CHOOSE", OUTPUT_WIDTH / 2, 390);
  ctx.fillText("TO CHOOSE", OUTPUT_WIDTH / 2, 390);
  ctx.fillStyle = accentColor.hex;
  ctx.font = '900 100px "Arial Black", Impact, sans-serif';
  ctx.strokeText("THE NEXT CLIPS", OUTPUT_WIDTH / 2, 500);
  ctx.fillText("THE NEXT CLIPS", OUTPUT_WIDTH / 2, 500);

  ctx.shadowBlur = 0;
  ctx.fillStyle = "rgba(255, 255, 255, 0.76)";
  ctx.font = '800 38px "Arial", sans-serif';
  ctx.fillText("YOUR COMMENT COULD BECOME", OUTPUT_WIDTH / 2, 675);
  ctx.fillText("THE NEXT #1", OUTPUT_WIDTH / 2, 724);

  ctx.fillStyle = "#ff334e";
  ctx.beginPath();
  ctx.roundRect(170, 1015, 740, 190, 38);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.font = '900 76px "Arial Black", Impact, sans-serif';
  ctx.fillText("SUBSCRIBE", OUTPUT_WIDTH / 2, 1064);

  ctx.fillStyle = "rgba(255, 255, 255, 0.1)";
  ctx.beginPath();
  ctx.roundRect(300, 1355, 480, 150, 34);
  ctx.fill();
  drawLikeIcon(ctx, 350, 1375, 0.9, "#ffffff");
  ctx.textAlign = "left";
  ctx.fillStyle = "#ffffff";
  ctx.font = '900 62px "Arial Black", Impact, sans-serif';
  ctx.fillText("LIKE", 510, 1395);

  ctx.textAlign = "center";
  ctx.fillStyle = "rgba(255, 255, 255, 0.56)";
  ctx.font = '800 34px "Arial", sans-serif';
  ctx.fillText("VOTE IN THE COMMENTS", OUTPUT_WIDTH / 2, 1660);
  ctx.fillText("FOR THE NEXT RANKING", OUTPUT_WIDTH / 2, 1705);

  return canvasToPngBytes(canvas);
}

async function downloadTikTokClip(entry: RankingEntry, sessionId: string | null) {
  const response = await fetch("/api/tiktok/download", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: entry.url.trim(), sessionId })
  });

  if (!response.ok) {
    const text = await response.text();
    let message = `Could not download TikTok clip for #${entry.rank}.`;

    try {
      const payload = JSON.parse(text) as { error?: string };
      message = payload.error ?? message;
    } catch {
      if (text.trim()) {
        message = text.slice(0, 220);
      }
    }

    throw new Error(message);
  }

  const blob = await response.blob();

  if (!blob.size) {
    throw new Error(`Downloaded clip for #${entry.rank} was empty.`);
  }

  const file = new File([blob], `tiktok-rank-${entry.rank}.mp4`, {
    type: blob.type || "video/mp4"
  });

  return { file, sessionId: null };
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
  accentColor,
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
  accentColor: AccentColor;
  ffmpeg: FFmpeg;
  inputName: string;
  overlayName: string;
  revealName: string;
  segmentName: string;
  sfxName?: string | null;
  startTimeText: string;
  durationText: string;
  fadeDuration: number;
  fadeOutStart: string;
}) {
  const safeClipDuration = Number.parseFloat(durationText);
  const progressDuration = (Number.isFinite(safeClipDuration) ? Math.max(0.1, safeClipDuration) : 0.1).toFixed(2);
  const hasTransition = Boolean(sfxName);
  const transitionDuration = hasTransition ? TRANSITION_SFX_SECONDS : 0;
  const transitionDurationText = transitionDuration.toFixed(2);
  const outputDuration = (Number.isFinite(safeClipDuration) ? safeClipDuration : 0) + transitionDuration;
  const outputDurationText = Math.max(0.1, outputDuration).toFixed(2);
  const transitionDelayMs = Math.round(transitionDuration * 1000);
  const progressOverlayX = `max(-w\\,min(0\\,-w+w*t/${progressDuration}))`;
  const progressY = OUTPUT_HEIGHT - 22;
  const clipVideoLabel = hasTransition ? "clipVideo" : "v";
  const transitionVideoFilter = hasTransition
    ? `;color=c=black:s=${OUTPUT_WIDTH}x${OUTPUT_HEIGHT}:r=30:d=${transitionDurationText},format=yuv420p[transitionVideo];[transitionVideo][clipVideo]concat=n=2:v=1:a=0[v]`
    : "";
  const videoFilter = `color=c=${accentColor.ffmpeg}@0.95:s=${OUTPUT_WIDTH}x18:r=30:d=${durationText},format=rgba[progressBar];[0:v]setpts=PTS-STARTPTS,scale=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT}:force_original_aspect_ratio=increase,crop=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT},setsar=1,format=rgba[base];[base][1:v]overlay=0:0:format=auto[withOverlay];[2:v]format=rgba,fade=t=out:st=0.48:d=0.32:alpha=1[rankReveal];[withOverlay][rankReveal]overlay=0:0:format=auto:enable='between(t\\,0\\,0.80)',format=yuv420p,drawbox=x=0:y=${progressY}:w=iw:h=18:color=white@0.18:t=fill[progressBase];[progressBase][progressBar]overlay=x='${progressOverlayX}':y=${progressY}:format=auto,format=yuv420p,fade=t=in:st=0:d=${fadeDuration},fade=t=out:st=${fadeOutStart}:d=${fadeDuration},trim=0:${durationText},setpts=PTS-STARTPTS,fps=30,format=yuv420p[${clipVideoLabel}]${transitionVideoFilter}`;
  const sourceAudioDelay = hasTransition ? `,adelay=${transitionDelayMs}|${transitionDelayMs}` : "";
  const sourceAudioFilter = `[0:a]atrim=0:${durationText},asetpts=PTS-STARTPTS,aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo${sourceAudioDelay},apad=pad_dur=${outputDurationText},atrim=0:${outputDurationText}[clipa]`;
  const sfxAudioFilter = sfxName
    ? `[3:a]atrim=0:${transitionDurationText},asetpts=PTS-STARTPTS,volume=2.05,aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo,apad=pad_dur=${outputDurationText},atrim=0:${outputDurationText}[sfx]`
    : "";
  const mixedAudioFilter = sfxName
    ? `[clipa][sfx]amix=inputs=2:duration=longest:dropout_transition=0,atrim=0:${outputDurationText},asetpts=PTS-STARTPTS,volume=1.05[a]`
    : "[clipa]volume=1[a]";
  const silentInputIndex = sfxName ? 4 : 3;
  const silentAudioFilter = `[${silentInputIndex}:a]atrim=0:${outputDurationText},asetpts=PTS-STARTPTS,aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo[clipa]`;
  const sfxInputs = sfxName ? ["-i", sfxName] : [];
  const audioFilters = [sourceAudioFilter, sfxAudioFilter, mixedAudioFilter].filter(Boolean).join(";");
  const silentAudioFilters = [silentAudioFilter, sfxAudioFilter, mixedAudioFilter].filter(Boolean).join(";");
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
      ...sfxInputs,
      "-t",
      outputDurationText,
      "-filter_complex",
      `${videoFilter};${audioFilters}`,
      ...outputSettings
    ]);
  } catch (error) {
    console.warn(`Source audio could not be rendered for ${segmentName}; using generated silence.`, error);
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
      ...sfxInputs,
      "-f",
      "lavfi",
      "-t",
      outputDurationText,
      "-i",
      "anullsrc=channel_layout=stereo:sample_rate=44100",
      "-t",
      outputDurationText,
      "-filter_complex",
      `${videoFilter};${silentAudioFilters}`,
      ...outputSettings
    ]);
  }
}

async function renderAnimatedHook({
  ffmpeg,
  inputName,
  overlayName,
  engagementPattern,
  segmentName,
  startTimeText,
  durationText,
  fadeDuration,
  fadeOutStart
}: {
  ffmpeg: FFmpeg;
  inputName: string;
  overlayName: string;
  engagementPattern: string;
  segmentName: string;
  startTimeText: string;
  durationText: string;
  fadeDuration: number;
  fadeOutStart: string;
}) {
  const videoFilter = [
    `[0:v]setpts=PTS-STARTPTS,scale=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT}:force_original_aspect_ratio=increase,crop=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT},setsar=1,format=rgba[base]`,
    "[1:v]format=rgba[overlay]",
    "[base][overlay]overlay=0:0:format=auto[withOverlay]",
    "[2:v]setpts=PTS-STARTPTS,format=rgba[engagement]",
    `[withOverlay][engagement]overlay=0:0:format=auto:eof_action=repeat:repeatlast=1,fade=t=in:st=0:d=${fadeDuration},fade=t=out:st=${fadeOutStart}:d=${fadeDuration},trim=0:${durationText},setpts=PTS-STARTPTS,fps=30,format=yuv420p[v]`
  ].join(";");
  const sourceAudioFilter = `[0:a]atrim=0:${durationText},asetpts=PTS-STARTPTS,apad=pad_dur=${durationText},atrim=0:${durationText},aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo[a]`;
  const silentAudioFilter = `[3:a]atrim=0:${durationText},asetpts=PTS-STARTPTS,aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo[a]`;
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
  const visualInputs = [
    "-loop",
    "1",
    "-i",
    overlayName,
    "-framerate",
    String(ENGAGEMENT_FRAME_RATE),
    "-start_number",
    "0",
    "-i",
    engagementPattern
  ];

  try {
    await ffmpeg.exec([
      "-y",
      "-ss",
      startTimeText,
      "-i",
      inputName,
      ...visualInputs,
      "-t",
      durationText,
      "-filter_complex",
      `${videoFilter};${sourceAudioFilter}`,
      ...outputSettings
    ]);
  } catch (error) {
    console.warn("Hook audio could not be rendered; using generated silence.", error);
    await ffmpeg.exec([
      "-y",
      "-ss",
      startTimeText,
      "-i",
      inputName,
      ...visualInputs,
      "-f",
      "lavfi",
      "-t",
      durationText,
      "-i",
      "anullsrc=channel_layout=stereo:sample_rate=44100",
      "-t",
      durationText,
      "-filter_complex",
      `${videoFilter};${silentAudioFilter}`,
      ...outputSettings
    ]);
  }
}

async function renderEndCard({
  ffmpeg,
  baseName,
  engagementPattern,
  segmentName
}: {
  ffmpeg: FFmpeg;
  baseName: string;
  engagementPattern: string;
  segmentName: string;
}) {
  const durationText = END_CARD_DURATION_SECONDS.toFixed(2);
  const fadeOutStart = (END_CARD_DURATION_SECONDS - 0.35).toFixed(2);
  const filter = [
    `[0:v]setpts=PTS-STARTPTS,scale=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT},format=rgba[base]`,
    "[1:v]setpts=PTS-STARTPTS,format=rgba[engagement]",
    `[base][engagement]overlay=0:0:format=auto:eof_action=repeat:repeatlast=1,fade=t=in:st=0:d=0.18,fade=t=out:st=${fadeOutStart}:d=0.35,trim=0:${durationText},setpts=PTS-STARTPTS,fps=30,format=yuv420p[v]`,
    `[2:a]atrim=0:${durationText},asetpts=PTS-STARTPTS,aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo[a]`
  ].join(";");

  await ffmpeg.exec([
    "-y",
    "-loop",
    "1",
    "-i",
    baseName,
    "-framerate",
    String(ENGAGEMENT_FRAME_RATE),
    "-start_number",
    "0",
    "-i",
    engagementPattern,
    "-f",
    "lavfi",
    "-t",
    durationText,
    "-i",
    "anullsrc=channel_layout=stereo:sample_rate=44100",
    "-t",
    durationText,
    "-filter_complex",
    filter,
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
  ]);
}

async function videoDurationFromUrl(url: string) {
  try {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.src = url;

    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error("Could not read bundled parkour metadata."));
    });

    video.removeAttribute("src");
    video.load();
    return Number.isFinite(video.duration) && video.duration > 0
      ? video.duration
      : PARKOUR_FALLBACK_DURATION_SECONDS;
  } catch {
    return PARKOUR_FALLBACK_DURATION_SECONDS;
  }
}

export default function Home() {
  // Form state is kept in one place so validation, preview labels, and FFmpeg
  // processing all use the same five ranked entries.
  const [appMode, setAppMode] = useState<AppMode>("ranking");
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
  const [uploadContentMode, setUploadContentMode] = useState<UploadContentMode>("random");
  const [githubScheduleStatus, setGithubScheduleStatus] = useState<GitHubScheduleStatus | null>(null);
  const [githubScheduleMessage, setGithubScheduleMessage] = useState("Not saved to GitHub yet");
  const [githubScheduleTimezone, setGithubScheduleTimezone] = useState("UTC");
  const [isSavingGithubSchedule, setIsSavingGithubSchedule] = useState(false);
  const [ideaSearchOpen, setIdeaSearchOpen] = useState(false);
  const [ideaFilterTab, setIdeaFilterTab] = useState<IdeaFilterTab>("creators");
  const [ideaCreatorIds, setIdeaCreatorIds] = useState<string[]>(DEFAULT_IDEA_SEARCH_SETTINGS.creatorIds);
  const [ideaTitleIds, setIdeaTitleIds] = useState<string[]>(DEFAULT_IDEA_SEARCH_SETTINGS.titleIds);
  const [ideaCustomTitleValues, setIdeaCustomTitleValues] = useState<string[]>(
    DEFAULT_IDEA_SEARCH_SETTINGS.customTitleValues
  );
  const [customIdeaTitleInput, setCustomIdeaTitleInput] = useState("");
  const [redditSourceOpen, setRedditSourceOpen] = useState(false);
  const [redditSubredditIds, setRedditSubredditIds] = useState<string[]>(
    DEFAULT_REDDIT_STORY_SETTINGS.subredditIds
  );
  const [redditUrl, setRedditUrl] = useState("");
  const [redditTitle, setRedditTitle] = useState("The Most Awkward Thing That Happened at Work");
  const [redditStory, setRedditStory] = useState("");
  const [redditSource, setRedditSource] = useState("");
  const [redditVoice, setRedditVoice] = useState("en-US-AndrewNeural");
  const [redditRate, setRedditRate] = useState(12);
  const [isFindingRedditIdea, setIsFindingRedditIdea] = useState(false);
  const [isImportingReddit, setIsImportingReddit] = useState(false);

  const ffmpegRef = useRef<FFmpeg | null>(null);
  const ffmpegLoadPromiseRef = useRef<Promise<FFmpeg> | null>(null);
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
        ? buildViralCopyDescription(viralIdea, selectedViralCandidates)
        : "",
    [selectedViralCandidates, viralIdea]
  );
  const redditCopyPasteDescription = useMemo(
    () => redditUploadDescription(redditTitle.trim(), redditStory, redditSource),
    [redditSource, redditStory, redditTitle]
  );
  const activeCopyPasteDescription = appMode === "reddit"
    ? redditCopyPasteDescription
    : copyPasteDescription;
  const redditDescriptionTags = useMemo(
    () => uploadTagsFromDescription(redditCopyPasteDescription),
    [redditCopyPasteDescription]
  );
  const uploadDescription = copyPasteDescription || fallbackViralUploadDescription(title, entries);
  const uploadTags = useMemo(() => uploadTagsFromDescription(uploadDescription), [uploadDescription]);
  const parsedDailySchedule = useMemo(
    () => parseDailyScheduleInput(dailyScheduleInput),
    [dailyScheduleInput]
  );
  const selectedIdeaSearch = useMemo(
    () =>
      normalizeIdeaSearchSettings({
        creatorIds: ideaCreatorIds,
        titleIds: ideaTitleIds,
        customTitleValues: ideaCustomTitleValues
      }),
    [ideaCreatorIds, ideaTitleIds, ideaCustomTitleValues]
  );
  const selectedRedditStorySettings = useMemo(
    () => normalizeRedditStorySettings({ subredditIds: redditSubredditIds }),
    [redditSubredditIds]
  );
  const ideaSearchError = ideaCustomTitleValues.length
    ? ""
    : !ideaCreatorIds.length
      ? "Select at least one creator."
      : !ideaTitleIds.length
        ? "Select at least one title style."
        : "";
  const ideaSearchSummary = selectedIdeaSearch.usesCustomTitles
    ? `${selectedIdeaSearch.customTitleValues.length} custom topic${
        selectedIdeaSearch.customTitleValues.length === 1 ? "" : "s"
      }`
    : `${ideaCreatorIds.length} creators - ${ideaTitleIds.length} titles`;
  const redditSourceError = redditSubredditIds.length ? "" : "Select at least one subreddit.";
  const redditSourceSummary = `${redditSubredditIds.length} subreddit${
    redditSubredditIds.length === 1 ? "" : "s"
  }`;
  const uploadContentModeSummary = uploadContentModeText(uploadContentMode);
  const redditCharacterCount = useMemo(
    () => narrationCharacterCount(redditTitle, redditStory),
    [redditStory, redditTitle]
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

        setUploadContentMode(savedSchedule?.contentMode || "random");

        if (savedSchedule?.times?.length) {
          setDailyScheduleInput(savedSchedule.times.join(", "));
        }

        if (savedSchedule?.ideaSearch) {
          const savedIdeaSearch = normalizeIdeaSearchSettings(savedSchedule.ideaSearch);
          setIdeaCreatorIds(savedIdeaSearch.creatorIds);
          setIdeaTitleIds(savedIdeaSearch.titleIds);
          setIdeaCustomTitleValues(savedIdeaSearch.customTitleValues);
          if (savedIdeaSearch.usesCustomTitles) {
            setIdeaFilterTab("custom");
          }
        }

        if (savedSchedule?.redditStory) {
          const savedRedditStory = normalizeRedditStorySettings(savedSchedule.redditStory);
          setRedditSubredditIds(savedRedditStory.subredditIds);
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

  function selectUploadContentMode(nextMode: UploadContentMode) {
    setUploadContentMode(nextMode);
    setGithubScheduleMessage(`${uploadContentModeText(nextMode)} selected. Save to apply to GitHub runs.`);

    if (nextMode === "ranking") {
      setAppMode("ranking");
    } else if (nextMode === "story") {
      setAppMode("reddit");
    }
  }

  function updateEntry(rank: number, patch: Partial<RankingEntry>) {
    setEntries((current) =>
      current.map((entry) => (entry.rank === rank ? { ...entry, ...patch } : entry))
    );
  }

  function handleFileChange(rank: number, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    updateEntry(rank, { file, duration: undefined });
  }

  function updateIdeaSearchIds(kind: "creator" | "title", ids: string[]) {
    const uniqueIds = [...new Set(ids)];

    if (kind === "creator") {
      setIdeaCreatorIds(uniqueIds);
    } else {
      setIdeaTitleIds(uniqueIds);
    }

    setErrors((current) => {
      const { ideaSearch, ...rest } = current;
      return rest;
    });
  }

  function toggleIdeaSearchOption(kind: "creator" | "title", id: string) {
    const currentIds = kind === "creator" ? ideaCreatorIds : ideaTitleIds;
    const nextIds = currentIds.includes(id)
      ? currentIds.filter((currentId) => currentId !== id)
      : [...currentIds, id];

    updateIdeaSearchIds(kind, nextIds);
  }

  function setAllIdeaSearchOptions(kind: "creator" | "title") {
    updateIdeaSearchIds(
      kind,
      kind === "creator"
        ? DEFAULT_IDEA_SEARCH_SETTINGS.creatorIds
        : DEFAULT_IDEA_SEARCH_SETTINGS.titleIds
    );
  }

  function clearIdeaSearchOptions(kind: "creator" | "title") {
    updateIdeaSearchIds(kind, []);
  }

  function updateCustomIdeaTitles(values: string[]) {
    const normalized = normalizeIdeaSearchSettings({
      creatorIds: ideaCreatorIds,
      titleIds: ideaTitleIds,
      customTitleValues: values
    }).customTitleValues;

    setIdeaCustomTitleValues(normalized);
    setErrors((current) => {
      const { ideaSearch, ...rest } = current;
      return rest;
    });
    setGithubScheduleMessage(
      normalized.length
        ? `${normalized.length} custom title${normalized.length === 1 ? "" : "s"} selected. Save to apply to GitHub runs.`
        : "Custom titles cleared. Save to apply title styles to GitHub runs."
    );
  }

  function addCustomIdeaTitle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const beforeCount = ideaCustomTitleValues.length;
    const nextTitles = normalizeIdeaSearchSettings({
      creatorIds: ideaCreatorIds,
      titleIds: ideaTitleIds,
      customTitleValues: [...ideaCustomTitleValues, customIdeaTitleInput]
    }).customTitleValues;

    if (!customIdeaTitleInput.trim()) {
      setErrors((current) => ({ ...current, ideaSearch: "Type a custom title first." }));
      return;
    }

    if (nextTitles.length === beforeCount) {
      setErrors((current) => ({ ...current, ideaSearch: "That custom title is already added." }));
      return;
    }

    setIdeaCustomTitleValues(nextTitles);
    setCustomIdeaTitleInput("");
    setIdeaFilterTab("custom");
    setErrors((current) => {
      const { ideaSearch, ...rest } = current;
      return rest;
    });
    setGithubScheduleMessage("Custom title added. Save to apply to GitHub runs.");
  }

  function removeCustomIdeaTitle(titleValue: string) {
    updateCustomIdeaTitles(
      ideaCustomTitleValues.filter((value) => value.toLowerCase() !== titleValue.toLowerCase())
    );
  }

  function updateRedditSubredditIds(ids: string[]) {
    setRedditSubredditIds([...new Set(ids)]);
    setErrors((current) => {
      const { redditSource, ...rest } = current;
      return rest;
    });
  }

  function toggleRedditSubreddit(id: string) {
    updateRedditSubredditIds(
      redditSubredditIds.includes(id)
        ? redditSubredditIds.filter((currentId) => currentId !== id)
        : [...redditSubredditIds, id]
    );
  }

  async function saveGithubSchedule() {
    if (parsedDailySchedule.error) {
      setErrors((current) => ({ ...current, dailySchedule: parsedDailySchedule.error }));
      setGithubScheduleMessage(parsedDailySchedule.error);
      return;
    }

    if (ideaSearchError) {
      setErrors((current) => ({ ...current, ideaSearch: ideaSearchError }));
      setGithubScheduleMessage(ideaSearchError);
      return;
    }

    if (redditSourceError) {
      setErrors((current) => ({ ...current, redditSource: redditSourceError }));
      setGithubScheduleMessage(redditSourceError);
      return;
    }

    setIsSavingGithubSchedule(true);
    setGithubScheduleMessage("Saving to GitHub Actions...");
    setErrors((current) => {
      const { dailySchedule, githubSchedule, ideaSearch, redditSource, ...rest } = current;
      return rest;
    });

    try {
      const response = await fetch("/api/github/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: githubScheduleEnabled,
          contentMode: uploadContentMode,
          ideaSearch: {
            creatorIds: selectedIdeaSearch.creatorIds,
            titleIds: selectedIdeaSearch.titleIds,
            customTitleValues: selectedIdeaSearch.customTitleValues
          },
          redditStory: {
            subredditIds: selectedRedditStorySettings.subredditIds
          },
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
          ? `Saved. ${uploadContentModeSummary} at ${payload.schedule.times.join(", ")} ${payload.schedule.timezone}.`
          : `Saved ${uploadContentModeSummary}; GitHub Actions schedule is disabled.`
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
    if (ideaSearchError) {
      throw new Error(ideaSearchError);
    }

    const response = await fetch("/api/ideas/find", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ideaSearch: {
          creatorIds: selectedIdeaSearch.creatorIds,
          titleIds: selectedIdeaSearch.titleIds,
          customTitleValues: selectedIdeaSearch.customTitleValues
        }
      })
    });
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

    if (nextIdea.candidates.length >= RANK_COUNT) {
      applyCandidates(nextIdea.candidates.slice(0, RANK_COUNT), nextIdea.title);
      return;
    }

    setTitle(nextIdea.title);
    setErrors((current) => ({
      ...current,
      idea:
        nextIdea.message ??
        "Automated TikTok search is unavailable. Open the manual search links and paste selected TikTok URLs into the editor."
    }));
    setStatusText(nextIdea.rateLimited ? "TikWM cooling down" : "Manual idea ready");
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
      const nextDescription = buildViralCopyDescription(nextIdea, selectedCandidates);
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

  function candidatesFromSelectedIds(candidateIds: string[], nextIdea: ViralIdea) {
    return candidateIds
      .map((id) => nextIdea.candidates.find((candidate) => candidate.id === id))
      .filter((candidate): candidate is ViralCandidate => Boolean(candidate));
  }

  function syncSelectedCandidates(candidateIds: string[], nextIdea = viralIdea) {
    if (!nextIdea) {
      return;
    }

    const selected = candidatesFromSelectedIds(candidateIds, nextIdea);

    if (selected.length === RANK_COUNT) {
      applyCandidates(selected, nextIdea.title);
    }
  }

  function toggleCandidate(candidateId: string) {
    if (!viralIdea) {
      return;
    }

    setCopiedDescription(false);

    const nextSelectedIds = selectedCandidateIds.includes(candidateId)
      ? selectedCandidateIds.filter((id) => id !== candidateId)
      : selectedCandidateIds.length >= RANK_COUNT
        ? [...selectedCandidateIds.slice(0, RANK_COUNT - 1), candidateId]
        : [...selectedCandidateIds, candidateId];

    setSelectedCandidateIds(nextSelectedIds);
    syncSelectedCandidates(nextSelectedIds, viralIdea);
  }

  function applySelectedCandidates() {
    if (!viralIdea) {
      return;
    }

    const selected = candidatesFromSelectedIds(selectedCandidateIds, viralIdea);

    applyCandidates(selected, viralIdea.title);
  }

  async function copyDescription() {
    if (!activeCopyPasteDescription) {
      return;
    }

    try {
      await navigator.clipboard.writeText(activeCopyPasteDescription);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = activeCopyPasteDescription;
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

  async function findRedditStoryIdea() {
    if (isFindingRedditIdea) {
      return;
    }

    if (redditSourceError) {
      setErrors((current) => ({ ...current, redditSource: redditSourceError }));
      setStatusText("Choose a story source");
      return;
    }

    setIsFindingRedditIdea(true);
    setStatusText("Finding a Reddit story...");
    setErrors((current) => {
      const { reddit, ...rest } = current;
      return rest;
    });

    try {
      const query = new URLSearchParams({
        subredditIds: selectedRedditStorySettings.subredditIds.join(",")
      });
      const response = await fetch(`/api/reddit/story?${query}`, { cache: "no-store" });
      const rawPayload = await response.text();
      const payload = rawPayload
        ? (JSON.parse(rawPayload) as {
            title?: string;
            story?: string;
            subreddit?: string;
            sourceUrl?: string;
            error?: string;
          })
        : null;

      if (!response.ok || !payload?.title || !payload.story) {
        throw new Error(payload?.error || "Could not find a Reddit story.");
      }

      setRedditTitle(payload.title);
      setRedditStory(payload.story);
      setRedditSource(payload.subreddit || "Reddit");
      setRedditUrl(payload.sourceUrl || "");
      setStatusText(`Story found from ${payload.subreddit || "Reddit"}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not find a Reddit story.";
      setErrors((current) => ({ ...current, reddit: message }));
      setStatusText("Reddit idea search failed");
    } finally {
      setIsFindingRedditIdea(false);
    }
  }

  async function importRedditStory() {
    if (isImportingReddit || !redditUrl.trim()) {
      return;
    }

    setIsImportingReddit(true);
    setStatusText("Importing Reddit story...");
    setErrors((current) => {
      const { reddit, ...rest } = current;
      return rest;
    });

    try {
      const response = await fetch("/api/reddit/story", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: redditUrl.trim() })
      });
      const payload = (await response.json()) as {
        title?: string;
        story?: string;
        subreddit?: string;
        sourceUrl?: string;
        error?: string;
      };

      if (!response.ok || !payload.title || !payload.story) {
        throw new Error(payload.error || "Could not import that Reddit post.");
      }

      setRedditTitle(payload.title);
      setRedditStory(payload.story);
      setRedditSource(payload.subreddit || "Reddit");
      setRedditUrl(payload.sourceUrl || redditUrl);
      setStatusText("Reddit story imported");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not import the Reddit story.";
      setErrors((current) => ({ ...current, reddit: message }));
      setStatusText("Reddit import failed");
    } finally {
      setIsImportingReddit(false);
    }
  }

  async function uploadGeneratedVideo(
    blob: Blob,
    uploadTitle = title,
    description = uploadDescription,
    tags = uploadTags
  ) {
    const formData = new FormData();
    const fileName = downloadFileName(uploadTitle, blob.type);

    formData.set("video", new File([blob], fileName, { type: blob.type || "video/mp4" }));
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

    if (ffmpegLoadPromiseRef.current) {
      return ffmpegLoadPromiseRef.current;
    }

    const loadPromise = (async () => {
      const ffmpeg = new FFmpeg();
      let coreBlobUrl = "";
      let wasmBlobUrl = "";

      ffmpeg.on("log", ({ message }) => {
        if (message.toLowerCase().includes("error")) {
          console.warn(message);
        }
      });

      try {
        setStatusText("Downloading FFmpeg engine (32 MB)...");
        [coreBlobUrl, wasmBlobUrl] = await Promise.all([
          ffmpegAssetBlobUrl("/ffmpeg/ffmpeg-core.js", "text/javascript", 10_000),
          ffmpegAssetBlobUrl("/ffmpeg/ffmpeg-core.wasm", "application/wasm", 1_000_000)
        ]);
        setStatusText("Starting FFmpeg...");

        let startupTimeout = 0;
        const startupGuard = new Promise<never>((_, reject) => {
          startupTimeout = window.setTimeout(
            () => reject(new Error("FFmpeg startup timed out. Refresh the page and try again.")),
            45000
          );
        });

        try {
          await Promise.race([
            ffmpeg.load({
              coreURL: coreBlobUrl,
              wasmURL: wasmBlobUrl
            }),
            startupGuard
          ]);
        } finally {
          window.clearTimeout(startupTimeout);
        }

        ffmpegRef.current = ffmpeg;
        setFfmpegLoaded(true);
        return ffmpeg;
      } catch (error) {
        ffmpeg.terminate();
        ffmpegRef.current = null;
        setFfmpegLoaded(false);
        throw error;
      } finally {
        if (coreBlobUrl) {
          URL.revokeObjectURL(coreBlobUrl);
        }

        if (wasmBlobUrl) {
          URL.revokeObjectURL(wasmBlobUrl);
        }
      }
    })();

    ffmpegLoadPromiseRef.current = loadPromise;

    try {
      return await loadPromise;
    } finally {
      ffmpegLoadPromiseRef.current = null;
    }
  }

  async function generateRedditStoryVideo() {
    if (isGenerating) {
      return false;
    }

    const nextErrors: FieldErrors = {};
    if (!redditTitle.trim()) {
      nextErrors.redditTitle = "Enter a story title.";
    }

    if (!redditStory.trim()) {
      nextErrors.redditStory = "Paste or import a Reddit story.";
    }

    if (redditCharacterCount > REDDIT_MAX_NARRATION_CHARACTERS) {
      nextErrors.redditStory = `Keep the title and story under ${REDDIT_MAX_NARRATION_CHARACTERS.toLocaleString()} characters.`;
    }

    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors);
      setStatusText("Fix the highlighted fields.");
      return false;
    }

    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
    }

    setOutputBlob(null);
    setYoutubeUploadUrl(null);
    setErrors({});
    setIsGenerating(true);
    setProgress(3);
    const AudioContextConstructor =
      window.AudioContext ||
      (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    const storyAudioContext = AudioContextConstructor ? new AudioContextConstructor() : null;
    const storyAudioResume = storyAudioContext?.resume();

    try {
      if (!storyAudioContext || !storyAudioResume) {
        throw new Error("This browser does not support audio recording.");
      }

      await storyAudioResume;
      setStatusText("Generating narration...");
      const narrationText = `${redditTitle.trim()}. ${redditStory.trim()}`;
      const response = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: narrationText,
          voice: redditVoice,
          rate: redditRate
        })
      });
      const rawPayload = await response.text();
      const payload = rawPayload
        ? (JSON.parse(rawPayload) as RedditTtsResponse & { error?: string })
        : null;

      if (!response.ok || !payload?.audioBase64 || !payload.captions?.length) {
        throw new Error(payload?.error || "The text-to-speech service returned no narration.");
      }

      setProgress(20);
      setStatusText("Preparing parkour and captions...");
      const accentColor = randomAccentColor();
      const parkourDuration = await videoDurationFromUrl(PARKOUR_VIDEO_URL);
      const backgroundStart = Math.random() * Math.max(0, parkourDuration - 2);
      const narrationBytes = base64ToUint8Array(payload.audioBase64);
      const headerBytes = await createRedditHeaderPng(redditTitle.trim(), accentColor);

      setStatusText("Recording story video in real time...");
      setProgress(50);
      let lastReportedSecond = -1;
      const blob = await renderRedditStoryNatively({
        backgroundStart,
        audioContext: storyAudioContext,
        narrationBytes,
        headerBytes,
        accentColor,
        captions: payload.captions,
        onProgress: (elapsed, total) => {
          const elapsedSecond = Math.floor(Math.min(elapsed, total));

          if (elapsedSecond !== lastReportedSecond) {
            lastReportedSecond = elapsedSecond;
            setStatusText(`Recording story video: ${elapsedSecond}s / ${Math.ceil(total)}s`);
            setProgress(50 + Math.round((Math.min(elapsed, total) / total) * 44));
          }
        }
      });

      setStatusText("Validating video preview...");
      setProgress(94);
      const output = new Uint8Array(await blob.arrayBuffer());
      assertValidRecordedContainer(output, blob.type);
      const url = await playableVideoUrl(blob);
      setOutputBlob(blob);
      setPreviewUrl(url);
      setProgress(100);

      if (autoUploadToYoutube) {
        try {
          setIsUploadingYoutube(true);
          setStatusText("Uploading story to YouTube...");
          const description = redditCopyPasteDescription;
          const uploadUrl = await uploadGeneratedVideo(
            blob,
            redditTitle.trim(),
            description,
            uploadTagsFromDescription(description)
          );
          setYoutubeUploadUrl(uploadUrl);
          setStatusText("Story uploaded to YouTube");
        } catch (error) {
          const message = error instanceof Error ? error.message : "YouTube upload failed.";
          setErrors((current) => ({ ...current, youtube: message }));
          setStatusText("Story preview ready; upload failed");
          return false;
        } finally {
          setIsUploadingYoutube(false);
        }
      } else {
        setStatusText("Story preview ready");
      }

      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Reddit story generation failed.";
      setErrors((current) => ({ ...current, reddit: message }));
      setStatusText("Story generation failed");
      return false;
    } finally {
      await storyAudioContext?.close().catch(() => undefined);
      setIsGenerating(false);
    }
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
      const rankedClipPlans = new Map<number, ClipPlan>();
      const teaser = hookTeaserLines(activeTitle);
      const accentColor = randomAccentColor();
      const sfxName = "transition-boom.mp3";
      const hookEngagementPrefix = "hook-engagement";
      const hookEngagementPattern = `${hookEngagementPrefix}-%03d.png`;
      const endCardBaseName = "end-card-base.png";
      const endCardEngagementPrefix = "end-card-engagement";
      const endCardEngagementPattern = `${endCardEngagementPrefix}-%03d.png`;
      const endCardSegmentName = "segment-end-card.mp4";

      setStatusText("Finding opening hook...");
      setProgress(20);

      const loudestHook = await browserHookPlanFromLoudestEntry(resolvedEntries);
      const hookEntry = loudestHook.entry;
      const hookPlan = loudestHook.plan;
      const hookInputName = `hook-input-${hookEntry.rank}.${fileExtension(hookEntry.file)}`;
      const hookOverlayName = "overlay-hook.png";
      const hookSegmentName = "segment-hook.mp4";

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

      await ffmpeg.writeFile(sfxName, await fetchFile("/api/sfx/boom"));
      await ffmpeg.writeFile(hookInputName, await fetchFile(hookEntry.file));
      await ffmpeg.writeFile(
        hookOverlayName,
        await createHookOverlayPng(activeTitle, teaser, accentColor)
      );
      await writeEngagementAnimationFrames(ffmpeg, hookEngagementPrefix, "hook");

      setStatusText("Rendering opening hook...");

      await renderAnimatedHook({
        ffmpeg,
        inputName: hookInputName,
        overlayName: hookOverlayName,
        engagementPattern: hookEngagementPattern,
        segmentName: hookSegmentName,
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

        const clipPlan = rankedClipPlans.get(entry.rank);

        if (!clipPlan) {
          throw new Error(`Missing render plan for #${entry.rank}.`);
        }

        const durationText = clipPlan.duration.toFixed(2);
        const startTimeText = clipPlan.start.toFixed(2);
        const fadeDuration = Math.min(0.25, clipPlan.duration / 4);
        const fadeOutStart = Math.max(clipPlan.duration - fadeDuration, 0).toFixed(2);

        setStatusText(`Rendering #${entry.rank} (${durationText}s)...`);
        setProgress(38 + Math.round((index / RANK_COUNT) * 52));

        await ffmpeg.writeFile(inputName, await fetchFile(entry.file));
        await ffmpeg.writeFile(
          overlayName,
          await createOverlayPng(activeTitle, entry, orderedResolvedEntries, accentColor)
        );
        await ffmpeg.writeFile(revealName, await createRankRevealPng(entry.rank, accentColor));

        // FFmpeg trims each clip, scales/crops it into a 1080x1920 canvas, adds
        // transition fades, overlays the rank/list PNGs, adds progress/SFX, and
        // keeps normalized source audio.
        await renderSegment({
          accentColor,
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

      setStatusText("Rendering subscribe end card...");
      setProgress(90);
      await ffmpeg.writeFile(endCardBaseName, await createEndCardBasePng(accentColor));
      await writeEngagementAnimationFrames(
        ffmpeg,
        endCardEngagementPrefix,
        "end"
      );
      await renderEndCard({
        ffmpeg,
        baseName: endCardBaseName,
        engagementPattern: endCardEngagementPattern,
        segmentName: endCardSegmentName
      });
      segmentNames.push(endCardSegmentName);

      setStatusText("Stitching final MP4...");
      setProgress(94);

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
    anchor.download = downloadFileName(
      appMode === "reddit" ? redditTitle : title,
      outputBlob.type
    );
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  const hasErrors = Object.keys(errors).length > 0;

  return (
    <main className="shell">
      <section className="workspace" aria-label="Shorts video generator">
        <div className="editor-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">{appMode === "ranking" ? "Ranking Short" : "Story Short"}</p>
              <h1>
                {appMode === "ranking"
                  ? "YouTube Shorts ranking video generator"
                  : "Reddit story video generator"}
              </h1>
            </div>
            <div className="header-tools">
              {appMode === "ranking" ? <label className="upload-toggle" data-active={dailyScheduleEnabled}>
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
              </label> : null}
              {appMode === "ranking" ? <label className="upload-toggle" data-active={autoRunEvery15}>
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
              </label> : null}
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

          <div className="upload-content-mode" aria-label="Scheduled video type">
            <div className="upload-content-mode-heading">
              <Shuffle size={19} />
              <div>
                <strong>Scheduled video mix</strong>
                <span>{uploadContentModeSummary}</span>
              </div>
            </div>

            <div className="upload-content-mode-options" role="radiogroup" aria-label="Scheduled video mix">
              {UPLOAD_CONTENT_MODE_OPTIONS.map((option) => (
                <button
                  type="button"
                  role="radio"
                  aria-checked={uploadContentMode === option.id}
                  data-active={uploadContentMode === option.id}
                  onClick={() => selectUploadContentMode(option.id)}
                  key={option.id}
                >
                  {option.id === "random" ? (
                    <Shuffle size={17} />
                  ) : option.id === "ranking" ? (
                    <ListOrdered size={17} />
                  ) : (
                    <BookOpen size={17} />
                  )}
                  <span>
                    <strong>{option.label}</strong>
                    <small>{option.detail}</small>
                  </span>
                </button>
              ))}
            </div>

            <button
              type="button"
              className="secondary-button compact-button upload-content-mode-save"
              onClick={saveGithubSchedule}
              disabled={
                isSavingGithubSchedule ||
                Boolean(parsedDailySchedule.error || ideaSearchError || redditSourceError)
              }
            >
              {isSavingGithubSchedule ? <Loader2 size={17} className="spin" /> : <Github size={17} />}
              Save
            </button>
          </div>

          <div className="creation-mode-switch" role="tablist" aria-label="Video type">
            <button
              type="button"
              role="tab"
              aria-selected={appMode === "ranking"}
              data-active={appMode === "ranking"}
              onClick={() => {
                setAppMode("ranking");
                setErrors({});
              }}
            >
              <ListOrdered size={18} />
              Ranking
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={appMode === "reddit"}
              data-active={appMode === "reddit"}
              onClick={() => {
                setAppMode("reddit");
                setErrors({});
              }}
            >
              <BookOpen size={18} />
              Reddit Story
            </button>
          </div>

          {appMode === "ranking" ? <section className="idea-panel" aria-label="Viral idea finder">
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

            <div className="idea-filter">
              <button
                type="button"
                className="filter-toggle"
                aria-expanded={ideaSearchOpen}
                onClick={() => setIdeaSearchOpen((current) => !current)}
              >
                <SlidersHorizontal size={18} />
                <span>
                  <strong>Search filters</strong>
                  <small>{selectedIdeaSearch.isCustom ? ideaSearchSummary : "All creators - all titles"}</small>
                </span>
                <ChevronDown size={18} data-open={ideaSearchOpen} />
              </button>

              {ideaSearchOpen ? (
                <div className="filter-menu">
                  <div className="filter-tabs" role="tablist" aria-label="Ranking search filter tabs">
                    {IDEA_FILTER_TABS.map((tab) => (
                      <button
                        type="button"
                        role="tab"
                        aria-selected={ideaFilterTab === tab.id}
                        data-active={ideaFilterTab === tab.id}
                        onClick={() => setIdeaFilterTab(tab.id)}
                        key={tab.id}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>

                  {ideaFilterTab === "creators" ? (
                    <div className="filter-section">
                      <div className="filter-section-head">
                        <div>
                          <strong>Creators</strong>
                          <span>
                            {selectedIdeaSearch.usesCustomTitles
                              ? "ignored"
                              : `${ideaCreatorIds.length} selected`}
                          </span>
                        </div>
                        <div>
                          <button type="button" onClick={() => setAllIdeaSearchOptions("creator")}>
                            All
                          </button>
                          <button type="button" onClick={() => clearIdeaSearchOptions("creator")}>
                            Clear
                          </button>
                        </div>
                      </div>
                      <div className="option-grid">
                        {CREATOR_SEARCH_OPTIONS.map((option) => {
                          const checked = ideaCreatorIds.includes(option.id);

                          return (
                            <label className="option-tile" data-checked={checked} key={option.id}>
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleIdeaSearchOption("creator", option.id)}
                              />
                              <span>{option.label}</span>
                              <small>{option.group}</small>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}

                  {ideaFilterTab === "styles" ? (
                    <div className="filter-section">
                      <div className="filter-section-head">
                        <div>
                          <strong>Title styles</strong>
                          <span>
                            {selectedIdeaSearch.usesCustomTitles
                              ? "ignored"
                              : `${ideaTitleIds.length} selected`}
                          </span>
                        </div>
                        <div>
                          <button type="button" onClick={() => setAllIdeaSearchOptions("title")}>
                            All
                          </button>
                          <button type="button" onClick={() => clearIdeaSearchOptions("title")}>
                            Clear
                          </button>
                        </div>
                      </div>
                      <div className="option-grid option-grid-compact">
                        {TITLE_SEARCH_OPTIONS.map((option) => {
                          const checked = ideaTitleIds.includes(option.id);

                          return (
                            <label className="option-tile" data-checked={checked} key={option.id}>
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleIdeaSearchOption("title", option.id)}
                              />
                              <span>{option.label}</span>
                              <small>{option.group}</small>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}

                  {ideaFilterTab === "custom" ? (
                    <div className="filter-section custom-title-section">
                      <div className="filter-section-head">
                        <div>
                          <strong>Custom titles</strong>
                          <span>{selectedIdeaSearch.customTitleValues.length} added</span>
                        </div>
                        <div>
                          <button type="button" onClick={() => updateCustomIdeaTitles([])}>
                            Clear
                          </button>
                        </div>
                      </div>

                      <form className="custom-title-form" onSubmit={addCustomIdeaTitle}>
                        <input
                          value={customIdeaTitleInput}
                          onChange={(event) => setCustomIdeaTitleInput(event.target.value)}
                          placeholder="world cup moments"
                          maxLength={MAX_CUSTOM_TITLE_LENGTH}
                        />
                        <button
                          type="submit"
                          disabled={
                            !customIdeaTitleInput.trim() ||
                            ideaCustomTitleValues.length >= MAX_CUSTOM_TITLE_VALUES
                          }
                        >
                          <Plus size={16} />
                          Submit
                        </button>
                      </form>

                      <div className="custom-title-list">
                        {selectedIdeaSearch.customTitleValues.length ? (
                          selectedIdeaSearch.customTitleValues.map((customTitle) => (
                            <div className="custom-title-row" key={customTitle}>
                              <span>{customTitle}</span>
                              <button
                                type="button"
                                onClick={() => removeCustomIdeaTitle(customTitle)}
                                aria-label={`Delete ${customTitle}`}
                              >
                                <Trash2 size={15} />
                              </button>
                            </div>
                          ))
                        ) : (
                          <div className="custom-title-empty">
                            Add a full topic to ignore creators and title styles
                          </div>
                        )}
                      </div>
                    </div>
                  ) : null}

                  {ideaSearchError || errors.ideaSearch ? (
                    <small className="error-text">{errors.ideaSearch || ideaSearchError}</small>
                  ) : null}

                  <div className="reddit-filter-save">
                    <button
                      type="button"
                      className="secondary-button compact-button"
                      onClick={saveGithubSchedule}
                      disabled={
                        isSavingGithubSchedule ||
                        Boolean(parsedDailySchedule.error || ideaSearchError || redditSourceError)
                      }
                    >
                      {isSavingGithubSchedule ? <Loader2 size={17} className="spin" /> : <Github size={17} />}
                      Save for GitHub runs
                    </button>
                  </div>
                </div>
              ) : null}
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
                disabled={
                  isSavingGithubSchedule ||
                  Boolean(parsedDailySchedule.error || ideaSearchError || redditSourceError)
                }
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

                {viralIdea.manualSearchLinks?.length ? (
                  <div className="manual-search-panel" data-limited={viralIdea.searchLimited}>
                    <div>
                      <strong>
                        {viralIdea.rateLimited ? "TikWM cooldown active" : "Manual clip search fallback"}
                      </strong>
                      <span>
                        {viralIdea.cooldownUntil
                          ? `Automated search is paused until ${new Date(viralIdea.cooldownUntil).toLocaleTimeString([], {
                              hour: "numeric",
                              minute: "2-digit"
                            })}.`
                          : "Open a search, choose clips, then paste the TikTok links into the ranked editor."}
                      </span>
                    </div>
                    <div className="manual-link-grid">
                      {viralIdea.manualSearchLinks.map((link) => (
                        <a href={link.url} target="_blank" rel="noreferrer" key={link.url}>
                          <Search size={15} />
                          {link.label}
                          <ExternalLink size={14} />
                        </a>
                      ))}
                    </div>
                  </div>
                ) : null}

                {viralIdea.candidates.length ? (
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
                ) : null}

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
          </section> : null}

          {appMode === "ranking" ? <>
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
              <span>{smartHighlights ? "Target seconds per clip" : "Seconds per clip"}</span>
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
          </> : (
            <section className="reddit-editor" aria-label="Reddit story editor">
              <div className="reddit-editor-head">
                <div>
                  <p className="eyebrow">Story Source</p>
                  <h2>Reddit narration over Minecraft parkour</h2>
                </div>
                <div className="reddit-source-actions">
                  {redditSource ? <span className="source-chip">{redditSource}</span> : null}
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={findRedditStoryIdea}
                    disabled={isFindingRedditIdea || isImportingReddit || Boolean(redditSourceError)}
                  >
                    {isFindingRedditIdea ? <Loader2 size={18} className="spin" /> : <Lightbulb size={18} />}
                    Generate Story Idea
                  </button>
                </div>
              </div>

              <div className="idea-filter reddit-source-filter">
                <button
                  type="button"
                  className="filter-toggle"
                  aria-expanded={redditSourceOpen}
                  onClick={() => setRedditSourceOpen((current) => !current)}
                >
                  <SlidersHorizontal size={18} />
                  <span>
                    <strong>Story sources</strong>
                    <small>
                      {selectedRedditStorySettings.isCustom
                        ? redditSourceSummary
                        : "All subreddits"}
                    </small>
                  </span>
                  <ChevronDown size={18} data-open={redditSourceOpen} />
                </button>

                {redditSourceOpen ? (
                  <div className="filter-menu">
                    <div className="filter-section">
                      <div className="filter-section-head">
                        <div>
                          <strong>Subreddits</strong>
                          <span>{redditSubredditIds.length} selected</span>
                        </div>
                        <div>
                          <button
                            type="button"
                            onClick={() =>
                              updateRedditSubredditIds(DEFAULT_REDDIT_STORY_SETTINGS.subredditIds)
                            }
                          >
                            All
                          </button>
                          <button type="button" onClick={() => updateRedditSubredditIds([])}>
                            Clear
                          </button>
                        </div>
                      </div>

                      <div className="option-grid option-grid-compact">
                        {REDDIT_SUBREDDIT_OPTIONS.map((option) => {
                          const checked = redditSubredditIds.includes(option.id);

                          return (
                            <label className="option-tile" data-checked={checked} key={option.id}>
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleRedditSubreddit(option.id)}
                              />
                              <span>r/{option.value}</span>
                              <small>{option.group}</small>
                            </label>
                          );
                        })}
                      </div>
                    </div>

                    {redditSourceError || errors.redditSource ? (
                      <small className="error-text">{errors.redditSource || redditSourceError}</small>
                    ) : null}

                    <div className="reddit-filter-save">
                      <span>{githubScheduleMessage}</span>
                      <button
                        type="button"
                        className="secondary-button compact-button"
                        onClick={saveGithubSchedule}
                        disabled={
                          isSavingGithubSchedule ||
                          Boolean(parsedDailySchedule.error || ideaSearchError || redditSourceError)
                        }
                      >
                        {isSavingGithubSchedule ? (
                          <Loader2 size={17} className="spin" />
                        ) : (
                          <Github size={17} />
                        )}
                        Save for GitHub runs
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="reddit-import-row">
                <label className="field">
                  <span>Reddit post URL</span>
                  <input
                    value={redditUrl}
                    onChange={(event) => setRedditUrl(event.target.value)}
                    placeholder="https://www.reddit.com/r/.../comments/..."
                  />
                </label>
                <button
                  type="button"
                  className="secondary-button reddit-import-button"
                  onClick={importRedditStory}
                  disabled={isImportingReddit || !redditUrl.trim()}
                >
                  {isImportingReddit ? <Loader2 size={18} className="spin" /> : <BookOpen size={18} />}
                  Import Post
                </button>
              </div>

              <div className="reddit-form-grid">
                <label className="field reddit-title-field">
                  <span>Story title</span>
                  <input
                    value={redditTitle}
                    onChange={(event) => setRedditTitle(event.target.value)}
                    maxLength={120}
                    placeholder="The title viewers see at the top"
                  />
                  {errors.redditTitle ? <small className="error-text">{errors.redditTitle}</small> : null}
                </label>

                <label className="field">
                  <span><Mic2 size={15} /> Voice</span>
                  <select value={redditVoice} onChange={(event) => setRedditVoice(event.target.value)}>
                    {REDDIT_VOICES.map((voice) => (
                      <option value={voice.id} key={voice.id}>
                        {voice.label} - {voice.detail}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="field reddit-story-field">
                  <span>Story text</span>
                  <textarea
                    value={redditStory}
                    onChange={(event) => setRedditStory(event.target.value)}
                    maxLength={REDDIT_MAX_NARRATION_CHARACTERS}
                    placeholder="Import a Reddit post or paste the story here..."
                  />
                  <small data-over-limit={redditCharacterCount > REDDIT_MAX_NARRATION_CHARACTERS}>
                    {redditCharacterCount.toLocaleString()}/{REDDIT_MAX_NARRATION_CHARACTERS.toLocaleString()} narration characters
                  </small>
                  {errors.redditStory ? <small className="error-text">{errors.redditStory}</small> : null}
                </label>

                <div className="reddit-settings-column">
                  <label className="field">
                    <span>Voice pace: +{redditRate}%</span>
                    <input
                      type="range"
                      min={0}
                      max={30}
                      step={2}
                      value={redditRate}
                      onChange={(event) => setRedditRate(Number(event.target.value))}
                    />
                  </label>

                  <div className="parkour-source">
                    <Gamepad2 size={20} />
                    <div>
                      <strong>parkour.mp4</strong>
                      <span>Random start, loops automatically</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="description-panel">
                <div className="description-head">
                  <div>
                    <strong>Copy-paste YouTube description</strong>
                    <span>{redditDescriptionTags.length} story-related hashtags</span>
                  </div>
                  <button
                    type="button"
                    className="secondary-button compact-button"
                    onClick={copyDescription}
                  >
                    {copiedDescription ? <Check size={17} /> : <Copy size={17} />}
                    {copiedDescription ? "Copied" : "Copy"}
                  </button>
                </div>
                <textarea
                  className="description-area"
                  readOnly
                  value={redditCopyPasteDescription}
                />
              </div>
            </section>
          )}

          {hasErrors ? (
            <div className="error-panel" role="alert">
              <AlertCircle size={18} />
              <span>
                {errors.dailySchedule ??
                  errors.githubSchedule ??
                  errors.autoRun ??
                  errors.redditSource ??
                  errors.reddit ??
                  errors.redditStory ??
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
            <button
              className="primary-button"
              onClick={() => appMode === "ranking" ? generateVideo() : generateRedditStoryVideo()}
              disabled={isGenerating}
            >
              {isGenerating ? <Loader2 size={19} className="spin" /> : <Wand2 size={19} />}
              {appMode === "ranking" ? "Generate Ranking" : "Generate Story Video"}
            </button>
            <button className="secondary-button" onClick={downloadVideo} disabled={!outputBlob}>
              <Download size={19} />
              Download Video
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
            ) : appMode === "ranking" ? (
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
            ) : (
              <div className="preview-empty reddit-preview-empty">
                <span className="reddit-preview-label">REDDIT STORY</span>
                <div className="preview-title">{redditTitle || "Your Reddit story"}</div>
                <div className="reddit-preview-caption">
                  {redditStory.trim()
                    ? redditStory.trim().split(/\s+/).slice(0, 5).join(" ").toUpperCase()
                    : "AUTO CAPTIONS APPEAR HERE"}
                </div>
                <Gamepad2 size={38} />
              </div>
            )}
          </div>
          <div className="preview-meta">
            <strong>1080x1920 MP4</strong>
            <span>
              {appMode === "reddit"
                ? "TTS + timed captions"
                : ffmpegLoaded
                  ? "FFmpeg ready"
                  : "FFmpeg loads on generate"}
            </span>
          </div>
        </aside>
      </section>
    </main>
  );
}
