import { google } from "googleapis";
import { createReadStream } from "node:fs";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { promisify } from "node:util";
import { execFile } from "node:child_process";

const execFileAsync = promisify(execFile);

const RANK_COUNT = 5;
const OUTPUT_WIDTH = 1080;
const OUTPUT_HEIGHT = 1920;
const DEFAULT_DURATION_SECONDS = 15;
const HOOK_DURATION_SECONDS = 5;
const SFX_SAMPLE_RATE = 44100;
const TRANSITION_SFX_SECONDS = 0.64;
const DEFAULT_WINDOW_MINUTES = 15;
const ACCENT_COLORS = [
  { ffmpeg: "0x39ff88" },
  { ffmpeg: "0xff335f" },
  { ffmpeg: "0x33a7ff" },
  { ffmpeg: "0xa855ff" },
  { ffmpeg: "0xffcc33" },
  { ffmpeg: "0xff7a2f" },
  { ffmpeg: "0x26f4ff" },
  { ffmpeg: "0xff4de3" }
];
const MEDAL_ROW_BACKGROUNDS = {
  1: { ffmpeg: "0xf7c531" },
  2: { ffmpeg: "0xd7dde8" },
  3: { ffmpeg: "0xc87932" }
};

function normalizeDailyTimeToken(token) {
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

function parseScheduleInput(value) {
  return [
    ...new Set(
      String(value || "")
        .split(/[\s,;]+/)
        .map(normalizeDailyTimeToken)
        .filter(Boolean)
    )
  ].sort();
}

function zonedParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).formatToParts(date);
  const part = (type) => parts.find((item) => item.type === type)?.value ?? "0";

  return {
    date: `${part("year")}-${part("month")}-${part("day")}`,
    hour: Number(part("hour")),
    minute: Number(part("minute"))
  };
}

function scheduledSlotForNow({ force, lastSlot, scheduleTimes, timeZone, windowMinutes }) {
  if (force) {
    return {
      shouldRun: true,
      slotId: `manual-${new Date().toISOString()}`,
      reason: "Manual workflow dispatch requested."
    };
  }

  if (process.env.UPLOAD_SCHEDULE_ENABLED !== "true") {
    return { shouldRun: false, slotId: "", reason: "GitHub upload schedule is disabled." };
  }

  if (!scheduleTimes.length) {
    return { shouldRun: false, slotId: "", reason: "No upload times are configured." };
  }

  const now = zonedParts(new Date(), timeZone);
  const nowMinutes = now.hour * 60 + now.minute;

  for (const time of scheduleTimes) {
    const [hour, minute] = time.split(":").map(Number);
    const slotMinutes = hour * 60 + minute;
    const minutesAfterSlot = nowMinutes - slotMinutes;

    if (minutesAfterSlot >= 0 && minutesAfterSlot < windowMinutes) {
      const slotId = `${now.date}-${time}-${timeZone}`;

      if (slotId === lastSlot) {
        return { shouldRun: false, slotId, reason: `Slot ${slotId} already uploaded.` };
      }

      return { shouldRun: true, slotId, reason: `Matched scheduled slot ${slotId}.` };
    }
  }

  return {
    shouldRun: false,
    slotId: "",
    reason: `No scheduled slot matches ${now.date} ${now.hour}:${now.minute.toString().padStart(2, "0")} ${timeZone}.`
  };
}

function cleanText(value, fallback = "") {
  return String(value || fallback).replace(/\s+/g, " ").trim();
}

function escapeDrawText(value) {
  return cleanText(value)
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'")
    .replace(/,/g, "\\,")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/%/g, "\\%");
}

function truncate(value, maxLength) {
  const text = cleanText(value);

  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength - 3).trim()}...`;
}

function wrapTextByCharacters(value, maxLength) {
  const words = cleanText(value).split(/\s+/).filter(Boolean);
  const lines = [];
  let currentLine = "";

  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;

    if (testLine.length <= maxLength) {
      currentLine = testLine;
      continue;
    }

    if (currentLine) {
      lines.push(currentLine);
      currentLine = "";
    }

    if (word.length <= maxLength) {
      currentLine = word;
      continue;
    }

    for (let index = 0; index < word.length; index += maxLength) {
      lines.push(word.slice(index, index + maxLength));
    }
  }

  if (currentLine) {
    lines.push(currentLine);
  }

  return lines.length ? lines : [cleanText(value)];
}

function titleTextLayout(title) {
  const lines = wrapTextByCharacters(title, 25);

  if (lines.length <= 2) {
    return { lines, size: 62, lineHeight: 72 };
  }

  if (lines.length === 3) {
    return { lines, size: 54, lineHeight: 64 };
  }

  return { lines, size: 46, lineHeight: 56 };
}

function randomItem(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function randomAccentColor() {
  return ACCENT_COLORS[Math.floor(Math.random() * ACCENT_COLORS.length)] ?? ACCENT_COLORS[0];
}

function hookTeaserLines(value) {
  const lower = cleanText(value).toLowerCase();
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

function hookTeaserLayout(value) {
  const lines = wrapTextByCharacters(value, 13);

  if (lines.length <= 1) {
    return { lines, size: 100, lineHeight: 112 };
  }

  return { lines, size: 82, lineHeight: 94 };
}

function impactSfxWavBuffer() {
  const durationSeconds = 0.48;
  const channels = 2;
  const bitsPerSample = 16;
  const sampleCount = Math.floor(SFX_SAMPLE_RATE * durationSeconds);
  const dataBytes = sampleCount * channels * (bitsPerSample / 8);
  const buffer = Buffer.alloc(44 + dataBytes);
  let offset = 0;

  const writeString = (value) => {
    buffer.write(value, offset, "ascii");
    offset += value.length;
  };
  const writeUInt32 = (value) => {
    buffer.writeUInt32LE(value, offset);
    offset += 4;
  };
  const writeUInt16 = (value) => {
    buffer.writeUInt16LE(value, offset);
    offset += 2;
  };

  writeString("RIFF");
  writeUInt32(36 + dataBytes);
  writeString("WAVE");
  writeString("fmt ");
  writeUInt32(16);
  writeUInt16(1);
  writeUInt16(channels);
  writeUInt32(SFX_SAMPLE_RATE);
  writeUInt32(SFX_SAMPLE_RATE * channels * (bitsPerSample / 8));
  writeUInt16(channels * (bitsPerSample / 8));
  writeUInt16(bitsPerSample);
  writeString("data");
  writeUInt32(dataBytes);

  for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
    const t = sampleIndex / SFX_SAMPLE_RATE;
    const envelope = Math.exp(-t * 8.5);
    const kick = Math.sin(2 * Math.PI * (132 * t - 56 * t * t)) * envelope;
    const click = Math.sin(2 * Math.PI * 760 * t) * Math.exp(-t * 22);
    const noise = (Math.random() * 2 - 1) * Math.exp(-t * 32);
    const mixed = Math.max(-1, Math.min(1, (kick * 0.72 + click * 0.22 + noise * 0.12) * 0.58));
    const pcm = Math.round(mixed * 32767);

    for (let channel = 0; channel < channels; channel += 1) {
      buffer.writeInt16LE(pcm, offset);
      offset += 2;
    }
  }

  return buffer;
}

function emojiPackForTitle(value) {
  const lower = value.toLowerCase();

  if (lower.includes("fail") || lower.includes("crashout")) {
    return ["💀", "😂", "🔥"];
  }

  if (lower.includes("stream") || lower.includes("twitch") || lower.includes("youtube")) {
    return ["🎮", "😂", "🔥"];
  }

  return ["😂", "🔥", "😱"];
}

function viralVideoTitle(value) {
  const [firstEmoji, secondEmoji] = emojiPackForTitle(value);
  const cleanTitle = cleanText(value, "Top 5 Viral Moments");
  const suffix = cleanTitle.toLowerCase().includes("wait for #1") ? "" : " | Wait for #1";
  const maxBaseLength = Math.max(24, 100 - firstEmoji.length - secondEmoji.length - suffix.length - 4);
  const titleBase =
    cleanTitle.length > maxBaseLength ? `${cleanTitle.slice(0, maxBaseLength - 3).trim()}...` : cleanTitle;

  return `${firstEmoji} ${titleBase}${suffix} ${secondEmoji}`.slice(0, 100);
}

function uploadTagsFromDescription(description, fallbackHashtags = []) {
  const tags = [
    ...String(description || "").matchAll(/#([a-zA-Z0-9_]+)/g),
    ...fallbackHashtags.map((tag) => [tag.replace(/^#/, "")])
  ]
    .map((match) => match[1])
    .filter(Boolean);

  return [...new Set(tags.length ? tags : ["Top5", "FunnyMoments", "Shorts"])].slice(0, 20);
}

function buildFallbackDescription(idea, selectedCandidates) {
  const [laughEmoji, fireEmoji, shockEmoji] = emojiPackForTitle(idea.title);
  const names = selectedCandidates.map((candidate) => candidate.name).filter(Boolean).slice(0, 4);
  const hashtags = idea.hashtags?.length
    ? idea.hashtags
    : ["#Top5", "#FunnyMoments", "#Shorts", "#YouTubeShorts", "#FYP"];

  return [
    `${laughEmoji} ${idea.title} ranked from #5 to #1 ${fireEmoji}`,
    `${shockEmoji} Wait for #1... it gets WILD.`,
    names.length ? `Best moments: ${names.join(", ")} ${laughEmoji}` : "Which clip wins?",
    "Who got cooked the hardest? Comment your winner 👇",
    "Subscribe for more funny moments 🏆",
    "",
    hashtags.join(" ")
  ].join("\n");
}

function buildViralFallbackDescription(idea, selectedCandidates) {
  const [laughEmoji, fireEmoji, shockEmoji] = emojiPackForTitle(idea.title);
  const names = selectedCandidates.map((candidate) => candidate.name).filter(Boolean).slice(0, 5);
  const hashtags = idea.hashtags?.length
    ? idea.hashtags
    : [
        "#Top5",
        "#ViralClips",
        "#FunnyClips",
        "#WatchTillTheEnd",
        "#StreamerMoments",
        "#ComedyShorts",
        "#Shorts",
        "#YouTubeShorts",
        "#FYP"
      ];

  return [
    `${laughEmoji} ${idea.title} ${fireEmoji}`,
    `${shockEmoji} The countdown gets crazier every clip. Wait for #1.`,
    names.length ? `Featured moments: ${names.join(", ")} ${laughEmoji}` : "Which moment deserves #1?",
    "Comment the funniest clip and share this with someone who would replay #1.",
    `New creator rankings dropping soon. Subscribe for more ${fireEmoji}`,
    "",
    hashtags.join(" ")
  ].join("\n");
}

async function run(command, args, options = {}) {
  const { stdout, stderr } = await execFileAsync(command, args, {
    maxBuffer: 1024 * 1024 * 20,
    ...options
  });

  if (stdout?.trim()) {
    console.log(stdout.trim());
  }

  if (stderr?.trim()) {
    console.log(stderr.trim());
  }
}

async function findViralIdea() {
  const appBaseUrl = (process.env.APP_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || "").replace(
    /\/$/,
    ""
  );
  const excludeIds = String(process.env.RECENT_TIKTOK_IDS || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  if (!appBaseUrl) {
    throw new Error("APP_BASE_URL is required so GitHub Actions can call /api/ideas/find.");
  }

  const response = await fetch(`${appBaseUrl}/api/ideas/find`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ excludeIds })
  });
  const payload = await response.json();

  if (!response.ok || !payload.title || !Array.isArray(payload.candidates)) {
    throw new Error(payload.error || "Could not find a viral idea.");
  }

  return payload;
}

function isCloudflareChallenge(value) {
  const lower = String(value || "").toLowerCase();
  return (
    lower.includes("just a moment") ||
    lower.includes("challenges.cloudflare.com") ||
    lower.includes("cf-chl") ||
    lower.includes("cloudflare")
  );
}

function normalizeMediaUrl(value) {
  if (value.startsWith("//")) {
    return `https:${value}`;
  }

  return value;
}

function uniqueMediaUrls(values) {
  return [...new Set(values.filter(Boolean).map(normalizeMediaUrl))];
}

async function resolveTikWMMediaUrls(tiktokUrl) {
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

  let payload;

  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error("TikWM returned a non-JSON download response.");
  }

  const mediaUrls = uniqueMediaUrls([
    payload?.data?.play,
    payload?.data?.wmplay,
    payload?.data?.hdplay
  ]);

  if (payload?.code !== 0 || !mediaUrls.length) {
    throw new Error(payload?.msg || "TikWM could not resolve this TikTok link.");
  }

  return mediaUrls;
}

async function downloadMediaToFile(mediaUrl, outputPath) {
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

async function downloadTikTokClip(candidate, workDir, rank) {
  const mediaUrls = await resolveTikWMMediaUrls(candidate.url);
  let firstDownloadedPath = "";
  let lastError = null;

  for (let index = 0; index < mediaUrls.length; index += 1) {
    const candidatePath = join(workDir, `rank-${rank}-${index}.mp4`);

    try {
      await downloadMediaToFile(mediaUrls[index], candidatePath);
      firstDownloadedPath ||= candidatePath;

      if (await hasAudioStream(candidatePath)) {
        return candidatePath;
      }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("Resolved TikTok media could not be downloaded.");
    }
  }

  if (firstDownloadedPath) {
    console.warn(`Downloaded #${rank}, but no TikWM media variant contained an audio stream.`);
    return firstDownloadedPath;
  }

  throw lastError ?? new Error(`Could not download clip for #${rank}.`);
}

async function hasAudioStream(inputPath) {
  try {
    const { stdout } = await execFileAsync(
      "ffprobe",
      ["-v", "error", "-select_streams", "a:0", "-show_entries", "stream=codec_type", "-of", "csv=p=0", inputPath],
      { maxBuffer: 1024 * 1024 }
    );

    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

async function probeDuration(inputPath) {
  try {
    const { stdout } = await execFileAsync(
      "ffprobe",
      ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", inputPath],
      { maxBuffer: 1024 * 1024 }
    );
    const duration = Number.parseFloat(stdout.trim());

    return Number.isFinite(duration) ? duration : 0;
  } catch {
    return 0;
  }
}

async function audioHighlightStart(inputPath, sourceDuration, windowSeconds) {
  const result = await audioHighlight(inputPath, sourceDuration, windowSeconds);
  return result.start;
}

async function audioHighlight(inputPath, sourceDuration, windowSeconds) {
  try {
    const { stdout } = await execFileAsync(
      "ffmpeg",
      ["-v", "error", "-i", inputPath, "-vn", "-ac", "1", "-ar", "16000", "-f", "s16le", "pipe:1"],
      { encoding: "buffer", maxBuffer: 1024 * 1024 * 16 }
    );
    const sampleRate = 16000;
    const sampleCount = Math.floor(stdout.length / 2);
    const windowSamples = Math.max(1, Math.floor(windowSeconds * sampleRate));
    const stepSamples = Math.max(1, Math.floor(0.5 * sampleRate));
    const sampleStride = 160;
    const maxStartSample = Math.max(0, sampleCount - windowSamples);
    let bestStartSample = 0;
    let bestScore = -Infinity;

    for (let startSample = 0; startSample <= maxStartSample; startSample += stepSamples) {
      const endSample = Math.min(sampleCount, startSample + windowSamples);
      let total = 0;
      let samples = 0;

      for (let sample = startSample; sample < endSample; sample += sampleStride) {
        const value = stdout.readInt16LE(sample * 2) / 32768;
        total += value * value;
        samples += 1;
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
  }
}

async function smartClipPlan(inputPath, sourceDurationHint, maxDuration) {
  const measuredDuration = await probeDuration(inputPath);
  const sourceDuration = Math.max(0.5, measuredDuration || sourceDurationHint || maxDuration);
  const duration = Math.min(maxDuration, sourceDuration);

  if (sourceDuration <= maxDuration + 0.25) {
    return { start: 0, duration };
  }

  return {
    start: await audioHighlightStart(inputPath, sourceDuration, duration),
    duration
  };
}

async function clipPlan(inputPath, sourceDurationHint, maxDuration) {
  if (process.env.CLIP_MODE === "fixed") {
    return { start: 0, duration: maxDuration };
  }

  return smartClipPlan(inputPath, sourceDurationHint, maxDuration);
}

async function loudestHookPlan(entries) {
  let best = null;

  for (const entry of entries) {
    const measuredDuration = await probeDuration(entry.inputPath);
    const sourceDuration = Math.max(
      0.5,
      measuredDuration || entry.sourceDuration || HOOK_DURATION_SECONDS
    );
    const duration = Math.min(HOOK_DURATION_SECONDS, sourceDuration);
    const highlight =
      sourceDuration <= HOOK_DURATION_SECONDS + 0.25
        ? { start: 0, score: 0.0001 }
        : await audioHighlight(entry.inputPath, sourceDuration, duration);
    const score = highlight.score || 0;

    if (!best || score > best.score) {
      best = {
        entry,
        plan: {
          start: highlight.start,
          duration
        },
        score
      };
    }
  }

  if (!best) {
    throw new Error("No usable clip is available for the opening hook.");
  }

  return best;
}

function drawText({ text, x, y, size, color = "white", border = 4, enable }) {
  const fontFile = process.env.FFMPEG_FONTFILE || "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";
  const parts = [
    "drawtext=fontfile=" + fontFile,
    `text='${escapeDrawText(text)}'`,
    `x=${x}`,
    `y=${y}`,
    `fontsize=${size}`,
    `fontcolor=${color}`,
    `borderw=${border}`,
    "bordercolor=black@0.82"
  ];

  if (enable) {
    parts.push(`enable='${enable}'`);
  }

  return parts.join(":");
}

function progressBarGraph(inputLabel, outputLabel, duration, accentColor) {
  const safeDuration = Math.max(0.1, Number.parseFloat(String(duration))).toFixed(2);
  const y = OUTPUT_HEIGHT - 22;
  const xExpression = `max(-w\\,min(0\\,-w+w*t/${safeDuration}))`;

  return [
    `color=c=${accentColor.ffmpeg}@0.95:s=${OUTPUT_WIDTH}x18:r=30:d=${duration},format=rgba[progressBar]`,
    `[${inputLabel}]drawbox=x=0:y=${y}:w=iw:h=18:color=white@0.18:t=fill[progressBase]`,
    `[progressBase][progressBar]overlay=x='${xExpression}':y=${y}:format=auto,format=yuv420p[${outputLabel}]`
  ].join(";");
}

function videoFilters({
  accentColor,
  activeEntry,
  orderedEntries,
  title,
  duration,
  fadeDuration,
  fadeOutStart
}) {
  const titleLayout = titleTextLayout(title);
  const filters = [
    "setpts=PTS-STARTPTS",
    `scale=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT}:force_original_aspect_ratio=increase`,
    `crop=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT}`,
    "setsar=1",
    "format=yuv420p"
  ];

  titleLayout.lines.forEach((line, index) => {
    filters.push(drawText({
      text: line,
      x: "(w-text_w)/2",
      y: 140 + index * titleLayout.lineHeight,
      size: titleLayout.size,
      color: accentColor.ffmpeg,
      border: 5
    }));
  });

  filters.push(
    drawText({
      text: `#${activeEntry.rank}`,
      x: "(w-text_w)/2",
      y: 625,
      size: 290,
      color: accentColor.ffmpeg,
      border: 10,
      enable: "between(t\\,0\\,0.80)"
    }),
    drawText({
      text: `#${activeEntry.rank}`,
      x: 70,
      y: 1210,
      size: 166,
      color: accentColor.ffmpeg,
      border: 5
    })
  );

  filters.push(
    drawText({
      text: truncate(activeEntry.name, 34),
      x: 72,
      y: 1402,
      size: 58,
      color: accentColor.ffmpeg,
      border: 4
    })
  );

  orderedEntries.forEach((entry, index) => {
    const y = 1575 + index * 60;
    const isActive = entry.rank === activeEntry.rank;
    const medalRowBackground = MEDAL_ROW_BACKGROUNDS[entry.rank];
    const rowColor = medalRowBackground
      ? `${medalRowBackground.ffmpeg}@${isActive ? "0.46" : "0.24"}`
      : isActive
        ? `${accentColor.ffmpeg}@0.24`
        : "white@0.10";

    filters.push(
      `drawbox=x=70:y=${y}:w=940:h=46:color=${rowColor}:t=fill`,
      drawText({
        text: `#${entry.rank}`,
        x: 92,
        y: y + 8,
        size: 30,
        color: isActive ? accentColor.ffmpeg : "white",
        border: 2
      }),
      drawText({
        text: truncate(entry.name, 30),
        x: 188,
        y: y + 8,
        size: 30,
        color: "white",
        border: 2
      })
    );
  });

  return [
    `[0:v]${filters.join(",")}[rankBase]`,
    progressBarGraph("rankBase", "rankProgress", duration, accentColor),
    `[rankProgress]fade=t=in:st=0:d=${fadeDuration},fade=t=out:st=${fadeOutStart}:d=${fadeDuration},trim=0:${duration},setpts=PTS-STARTPTS,fps=30,format=yuv420p[rankClip]`,
    `color=c=black:s=${OUTPUT_WIDTH}x${OUTPUT_HEIGHT}:r=30:d=${TRANSITION_SFX_SECONDS.toFixed(2)},format=yuv420p[transitionVideo]`,
    "[transitionVideo][rankClip]concat=n=2:v=1:a=0[v]"
  ].join(";");
}

function hookVideoFilters({
  accentColor,
  title,
  duration,
  fadeDuration,
  fadeOutStart,
  teaser
}) {
  const titleLayout = titleTextLayout(title);
  const filters = [
    "setpts=PTS-STARTPTS",
    `scale=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT}:force_original_aspect_ratio=increase`,
    `crop=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT}`,
    "setsar=1",
    "format=yuv420p"
  ];

  titleLayout.lines.forEach((line, index) => {
    filters.push(drawText({
      text: line,
      x: "(w-text_w)/2",
      y: 140 + index * titleLayout.lineHeight,
      size: titleLayout.size,
      color: accentColor.ffmpeg,
      border: 5
    }));
  });

  const teaserLayout = hookTeaserLayout(teaser.primary);
  const teaserStartY = Math.round(
    1190 - ((teaserLayout.lines.length - 1) * teaserLayout.lineHeight) / 2
  );

  teaserLayout.lines.forEach((line, index) => {
    filters.push(drawText({
      text: line,
      x: "(w-text_w)/2",
      y: teaserStartY + index * teaserLayout.lineHeight,
      size: teaserLayout.size,
      color: accentColor.ffmpeg,
      border: 7
    }));
  });

  return [
    `[0:v]${filters.join(",")}[hookBase]`,
    progressBarGraph("hookBase", "hookProgress", duration, accentColor),
    `[hookProgress]fade=t=in:st=0:d=${fadeDuration},fade=t=out:st=${fadeOutStart}:d=${fadeDuration},trim=0:${duration},setpts=PTS-STARTPTS[v]`
  ].join(";");
}

async function renderSegment({
  accentColor,
  activeEntry,
  duration,
  inputPath,
  orderedEntries,
  outputPath,
  sfxPath,
  startTime,
  title
}) {
  const fadeDuration = Math.min(0.25, duration / 4);
  const fadeOutStart = Math.max(duration - fadeDuration, 0).toFixed(2);
  const durationText = duration.toFixed(2);
  const startTimeText = startTime.toFixed(2);
  const transitionDurationText = TRANSITION_SFX_SECONDS.toFixed(2);
  const outputDurationText = (duration + TRANSITION_SFX_SECONDS).toFixed(2);
  const transitionDelayMs = Math.round(TRANSITION_SFX_SECONDS * 1000);
  const filter = videoFilters({
    accentColor,
    activeEntry,
    orderedEntries,
    title,
    duration: durationText,
    fadeDuration,
    fadeOutStart
  });
  const hasAudio = await hasAudioStream(inputPath);
  const sourceAudioFilter = `[0:a]atrim=0:${durationText},asetpts=PTS-STARTPTS,aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo,adelay=${transitionDelayMs}|${transitionDelayMs},apad=pad_dur=${transitionDurationText},atrim=0:${outputDurationText}[clipa]`;
  const sfxAudioFilter = `[1:a]atrim=0:${transitionDurationText},asetpts=PTS-STARTPTS,volume=1.35,aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo,apad=pad_dur=${durationText},atrim=0:${outputDurationText}[sfx]`;
  const mixedAudioFilter = "[clipa][sfx]amix=inputs=2:duration=first:dropout_transition=0,volume=1.05[a]";
  const silentAudioFilter = `[2:a]atrim=0:${outputDurationText},asetpts=PTS-STARTPTS,aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo[clipa]`;
  const outputArgs = [
    "-map",
    "[v]",
    "-map",
    "[a]",
    "-r",
    "30",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
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
    outputPath
  ];

  if (hasAudio) {
    await run("ffmpeg", [
      "-y",
      "-ss",
      startTimeText,
      "-i",
      inputPath,
      "-i",
      sfxPath,
      "-t",
      outputDurationText,
      "-filter_complex",
      `${filter};${sourceAudioFilter};${sfxAudioFilter};${mixedAudioFilter}`,
      ...outputArgs
    ]);
    return;
  }

  await run("ffmpeg", [
    "-y",
    "-ss",
    startTimeText,
    "-i",
    inputPath,
    "-i",
    sfxPath,
    "-f",
    "lavfi",
    "-t",
    outputDurationText,
    "-i",
    "anullsrc=channel_layout=stereo:sample_rate=44100",
    "-t",
    outputDurationText,
    "-filter_complex",
    `${filter};${silentAudioFilter};${sfxAudioFilter};${mixedAudioFilter}`,
    ...outputArgs
  ]);
}

async function renderHookSegment({
  accentColor,
  duration,
  inputPath,
  outputPath,
  startTime,
  teaser,
  title
}) {
  const fadeDuration = Math.min(0.25, duration / 4);
  const fadeOutStart = Math.max(duration - fadeDuration, 0).toFixed(2);
  const durationText = duration.toFixed(2);
  const startTimeText = startTime.toFixed(2);
  const filter = hookVideoFilters({
    accentColor,
    title,
    duration: durationText,
    fadeDuration,
    fadeOutStart,
    teaser
  });
  const hasAudio = await hasAudioStream(inputPath);
  const sourceAudioFilter = `[0:a]atrim=0:${durationText},asetpts=PTS-STARTPTS,apad=pad_dur=${durationText},atrim=0:${durationText},aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo[a]`;
  const silentAudioFilter = `[1:a]atrim=0:${durationText},asetpts=PTS-STARTPTS,aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo[a]`;
  const outputArgs = [
    "-map",
    "[v]",
    "-map",
    "[a]",
    "-r",
    "30",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
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
    outputPath
  ];

  if (hasAudio) {
    await run("ffmpeg", [
      "-y",
      "-ss",
      startTimeText,
      "-i",
      inputPath,
      "-t",
      durationText,
      "-filter_complex",
      `${filter};${sourceAudioFilter}`,
      ...outputArgs
    ]);
    return;
  }

  await run("ffmpeg", [
    "-y",
    "-ss",
    startTimeText,
    "-i",
    inputPath,
    "-f",
    "lavfi",
    "-t",
    durationText,
    "-i",
    "anullsrc=channel_layout=stereo:sample_rate=44100",
    "-t",
    durationText,
    "-filter_complex",
    `${filter};${silentAudioFilter}`,
    ...outputArgs
  ]);
}

function concatPath(path) {
  return path.replace(/'/g, "'\\''");
}

async function renderRankingVideo({ idea, selectedCandidates, workDir }) {
  const duration = Number(process.env.CLIP_DURATION_SECONDS || DEFAULT_DURATION_SECONDS);
  const entries = [];

  for (const candidate of idea.candidates) {
    if (entries.length === RANK_COUNT) {
      break;
    }

    const rank = entries.length + 1;

    try {
      console.log(`Downloading #${rank}: ${candidate.url}`);
      const inputPath = await downloadTikTokClip(candidate, workDir, rank);
      entries.push({
        rank,
        id: candidate.id,
        name: cleanText(candidate.name, `Rank ${rank}`),
        sourceDuration: candidate.duration || 0,
        url: candidate.url,
        inputPath
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "download failed";
      console.warn(`Skipping candidate ${candidate.url}: ${message}`);
    }
  }

  if (entries.length !== RANK_COUNT) {
    throw new Error(`Only downloaded ${entries.length} usable TikTok clips.`);
  }

  const orderedEntries = [...entries].sort((a, b) => b.rank - a.rank);
  const segmentPaths = [];
  const rankedPlans = new Map();
  const teaser = hookTeaserLines(idea.title);
  const accentColor = randomAccentColor();
  const sfxPath = resolve(process.cwd(), "app", "assets", "sounds", "boom.mp3");
  const loudestHook = await loudestHookPlan(entries);
  const hookEntry = loudestHook.entry;
  const hookPlan = loudestHook.plan;
  const hookOutputPath = join(workDir, "segment-hook.mp4");

  for (const entry of orderedEntries) {
    const plan = await clipPlan(entry.inputPath, entry.sourceDuration, duration);
    rankedPlans.set(entry.rank, plan);
  }

  console.log(
    `Rendering opening hook from #${hookEntry.rank} at ${hookPlan.start.toFixed(2)}s for ${hookPlan.duration.toFixed(2)}s`
  );
  await renderHookSegment({
    accentColor,
    duration: hookPlan.duration,
    inputPath: hookEntry.inputPath,
    outputPath: hookOutputPath,
    startTime: hookPlan.start,
    teaser,
    title: idea.title
  });
  segmentPaths.push(hookOutputPath);

  for (const [index, entry] of orderedEntries.entries()) {
    const outputPath = join(workDir, `segment-${index}.mp4`);
    const plan = rankedPlans.get(entry.rank);

    if (!plan) {
      throw new Error(`Missing render plan for #${entry.rank}.`);
    }

    console.log(
      `Rendering #${entry.rank} from ${plan.start.toFixed(2)}s for ${plan.duration.toFixed(2)}s`
    );
    await renderSegment({
      accentColor,
      activeEntry: entry,
      duration: plan.duration,
      inputPath: entry.inputPath,
      orderedEntries,
      outputPath,
      sfxPath,
      startTime: plan.start,
      title: idea.title
    });
    segmentPaths.push(outputPath);
  }

  const concatFile = join(workDir, "concat.txt");
  const outputPath = join(workDir, "ranking-short.mp4");
  await writeFile(concatFile, segmentPaths.map((path) => `file '${concatPath(path)}'`).join("\n"));
  await run("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", concatFile, "-c", "copy", outputPath]);

  const outputStat = await stat(outputPath);
  console.log(`Rendered ${Math.round(outputStat.size / 1024 / 1024)} MB MP4`);

  return { outputPath, selectedCandidates: entries };
}

function youtubeAuth() {
  const missing = ["YOUTUBE_CLIENT_ID", "YOUTUBE_CLIENT_SECRET", "YOUTUBE_REFRESH_TOKEN"].filter(
    (key) => !process.env[key]
  );

  if (missing.length) {
    throw new Error(`Missing YouTube env vars: ${missing.join(", ")}.`);
  }

  const oauth2Client = new google.auth.OAuth2(
    process.env.YOUTUBE_CLIENT_ID,
    process.env.YOUTUBE_CLIENT_SECRET
  );

  oauth2Client.setCredentials({
    refresh_token: process.env.YOUTUBE_REFRESH_TOKEN
  });

  return oauth2Client;
}

async function uploadToYouTube({ description, filePath, hashtags, title }) {
  const youtube = google.youtube({ version: "v3", auth: youtubeAuth() });
  const response = await youtube.videos.insert({
    part: ["snippet", "status"],
    requestBody: {
      snippet: {
        title: viralVideoTitle(title),
        description: description.slice(0, 5000),
        tags: uploadTagsFromDescription(description, hashtags),
        categoryId: process.env.YOUTUBE_CATEGORY_ID || "24"
      },
      status: {
        privacyStatus: process.env.YOUTUBE_PRIVACY_STATUS || "private",
        selfDeclaredMadeForKids: false
      }
    },
    media: {
      mimeType: "video/mp4",
      body: Readable.from(createReadStream(filePath))
    }
  });

  if (!response.data.id) {
    throw new Error("YouTube upload did not return a video id.");
  }

  return `https://www.youtube.com/watch?v=${response.data.id}`;
}

async function upsertRepoVariable(name, value) {
  const token = process.env.GITHUB_TOKEN;
  const repository = process.env.GITHUB_REPOSITORY;

  if (!token || !repository) {
    console.warn(`Could not persist ${name}; GITHUB_TOKEN or GITHUB_REPOSITORY is missing.`);
    return;
  }

  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "X-GitHub-Api-Version": "2022-11-28"
  };
  const baseUrl = `https://api.github.com/repos/${repository}/actions/variables`;
  const patchResponse = await fetch(`${baseUrl}/${name}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ name, value })
  });

  if (patchResponse.status === 404) {
    const createResponse = await fetch(baseUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({ name, value })
    });

    if (!createResponse.ok) {
      console.warn(`Could not create ${name}: ${createResponse.status}`);
    }

    return;
  }

  if (!patchResponse.ok) {
    console.warn(`Could not update ${name}: ${patchResponse.status}`);
  }
}

async function rememberUploadedTikToks(selectedCandidates) {
  const previousIds = String(process.env.RECENT_TIKTOK_IDS || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  const nextIds = selectedCandidates
    .map((candidate) => candidate.id)
    .filter(Boolean);
  const uniqueIds = [...new Set([...nextIds, ...previousIds])].slice(0, 120);

  await upsertRepoVariable("RECENT_TIKTOK_IDS", uniqueIds.join(","));
}

async function main() {
  const force = process.env.FORCE_UPLOAD === "true";
  const scheduleTimes = parseScheduleInput(process.env.UPLOAD_SCHEDULE_TIMES);
  const timeZone = process.env.UPLOAD_SCHEDULE_TIMEZONE || "UTC";
  const windowMinutes = Number(process.env.UPLOAD_SCHEDULE_WINDOW_MINUTES || DEFAULT_WINDOW_MINUTES);
  const slot = scheduledSlotForNow({
    force,
    lastSlot: process.env.LAST_UPLOAD_SLOT || "",
    scheduleTimes,
    timeZone,
    windowMinutes
  });

  console.log(slot.reason);

  if (!slot.shouldRun) {
    return;
  }

  const workDir = await mkdtemp(join(tmpdir(), "ytshort-action-"));

  try {
    const idea = await findViralIdea();
    const selectedCandidates = idea.candidates.slice(0, 12);
    const { outputPath, selectedCandidates: uploadedCandidates } = await renderRankingVideo({
      idea: { ...idea, candidates: selectedCandidates },
      selectedCandidates,
      workDir
    });
    const description = idea.description || buildViralFallbackDescription(idea, selectedCandidates.slice(0, RANK_COUNT));
    const url = await uploadToYouTube({
      description,
      filePath: outputPath,
      hashtags: idea.hashtags || [],
      title: idea.title
    });

    console.log(`Uploaded: ${url}`);

    if (!force && slot.slotId) {
      await upsertRepoVariable("LAST_UPLOAD_SLOT", slot.slotId);
    }

    await rememberUploadedTikToks(uploadedCandidates);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
