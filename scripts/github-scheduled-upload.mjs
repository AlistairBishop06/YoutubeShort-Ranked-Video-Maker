import { google } from "googleapis";
import { createReadStream } from "node:fs";
import { mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { create as createYoutubeDl } from "youtube-dl-exec";

const execFileAsync = promisify(execFile);

const RANK_COUNT = 5;
const OUTPUT_WIDTH = 1080;
const OUTPUT_HEIGHT = 1920;
const DEFAULT_DURATION_SECONDS = 15;
const DEFAULT_WINDOW_MINUTES = 15;

const youtubeDl = createYoutubeDl(
  resolve(
    process.cwd(),
    "node_modules",
    "youtube-dl-exec",
    "bin",
    process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp"
  )
);

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

  return `${firstEmoji} ${cleanTitle} ${secondEmoji}`.slice(0, 100);
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

  if (!appBaseUrl) {
    throw new Error("APP_BASE_URL is required so GitHub Actions can call /api/ideas/find.");
  }

  const response = await fetch(`${appBaseUrl}/api/ideas/find`, { method: "POST" });
  const payload = await response.json();

  if (!response.ok || !payload.title || !Array.isArray(payload.candidates)) {
    throw new Error(payload.error || "Could not find a viral idea.");
  }

  return payload;
}

async function downloadTikTokClip(candidate, workDir, rank) {
  const outputTemplate = join(workDir, `rank-${rank}.%(ext)s`);

  await youtubeDl(candidate.url, {
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

  const files = await readdir(workDir);
  const fileName = files.find((file) => file.startsWith(`rank-${rank}.`));

  if (!fileName) {
    throw new Error(`Could not find downloaded clip for #${rank}.`);
  }

  return join(workDir, fileName);
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

function drawText({ text, x, y, size, color = "white", border = 4 }) {
  const fontFile = process.env.FFMPEG_FONTFILE || "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";

  return [
    "drawtext",
    `fontfile=${fontFile}`,
    `text='${escapeDrawText(text)}'`,
    `x=${x}`,
    `y=${y}`,
    `fontsize=${size}`,
    `fontcolor=${color}`,
    `borderw=${border}`,
    "bordercolor=black@0.82"
  ].join(":");
}

function videoFilters({ activeEntry, orderedEntries, title, duration, fadeDuration, fadeOutStart }) {
  const filters = [
    `scale=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT}:force_original_aspect_ratio=increase`,
    `crop=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT}`,
    "setsar=1",
    "format=yuv420p",
    "drawbox=x=0:y=0:w=iw:h=430:color=black@0.66:t=fill",
    "drawbox=x=0:y=1165:w=iw:h=755:color=black@0.72:t=fill",
    drawText({
      text: truncate(title, 40),
      x: "(w-text_w)/2",
      y: 64,
      size: 62,
      color: "white",
      border: 5
    }),
    drawText({
      text: `#${activeEntry.rank}`,
      x: 70,
      y: 1210,
      size: 166,
      color: "0x39ff88",
      border: 5
    }),
    drawText({
      text: truncate(activeEntry.name, 34),
      x: 72,
      y: 1402,
      size: 58,
      color: "white",
      border: 4
    })
  ];

  orderedEntries.forEach((entry, index) => {
    const y = 1575 + index * 60;
    const isActive = entry.rank === activeEntry.rank;

    filters.push(
      `drawbox=x=70:y=${y}:w=940:h=46:color=${isActive ? "0x39ff88@0.24" : "white@0.10"}:t=fill`,
      drawText({
        text: `#${entry.rank}`,
        x: 92,
        y: y + 8,
        size: 30,
        color: isActive ? "0x39ff88" : "white",
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

  filters.push(
    `fade=t=in:st=0:d=${fadeDuration}`,
    `fade=t=out:st=${fadeOutStart}:d=${fadeDuration}`,
    `trim=0:${duration}`,
    "setpts=PTS-STARTPTS"
  );

  return filters.join(",");
}

async function renderSegment({ activeEntry, duration, inputPath, orderedEntries, outputPath, title }) {
  const fadeDuration = Math.min(0.25, duration / 4);
  const fadeOutStart = Math.max(duration - fadeDuration, 0).toFixed(2);
  const durationText = duration.toFixed(2);
  const filter = videoFilters({
    activeEntry,
    orderedEntries,
    title,
    duration: durationText,
    fadeDuration,
    fadeOutStart
  });
  const hasAudio = await hasAudioStream(inputPath);
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
      "-i",
      inputPath,
      "-t",
      durationText,
      "-filter_complex",
      `[0:v]${filter}[v];[0:a]atrim=0:${durationText},asetpts=PTS-STARTPTS,apad=pad_dur=${durationText},atrim=0:${durationText},aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo[a]`,
      ...outputArgs
    ]);
    return;
  }

  await run("ffmpeg", [
    "-y",
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
    `[0:v]${filter}[v];[1:a]atrim=0:${durationText},asetpts=PTS-STARTPTS,aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo[a]`,
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
        name: cleanText(candidate.name, `Rank ${rank}`),
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

  for (const [index, entry] of orderedEntries.entries()) {
    const outputPath = join(workDir, `segment-${index}.mp4`);
    console.log(`Rendering #${entry.rank}`);
    await renderSegment({
      activeEntry: entry,
      duration,
      inputPath: entry.inputPath,
      orderedEntries,
      outputPath,
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
    const { outputPath } = await renderRankingVideo({
      idea: { ...idea, candidates: selectedCandidates },
      selectedCandidates,
      workDir
    });
    const description = idea.description || buildFallbackDescription(idea, selectedCandidates.slice(0, RANK_COUNT));
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
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
