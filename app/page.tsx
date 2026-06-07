"use client";

import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile } from "@ffmpeg/util";
import {
  AlertCircle,
  Download,
  Loader2,
  Play,
  Upload,
  Wand2
} from "lucide-react";
import { ChangeEvent, useMemo, useRef, useState } from "react";

type RankingEntry = {
  rank: number;
  name: string;
  url: string;
  file: File | null;
};

type FieldErrors = Record<string, string>;

type DownloadedClipResponse = {
  sessionId: string;
  clipId: string;
  fileName: string;
  size: number;
  downloadUrl: string;
};

const RANK_COUNT = 5;
const OUTPUT_WIDTH = 1080;
const OUTPUT_HEIGHT = 1920;
const DEFAULT_DURATION_SECONDS = 5;

const initialEntries = Array.from({ length: RANK_COUNT }, (_, index) => ({
  rank: index + 1,
  name: "",
  url: "",
  file: null
}));

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

  const topGradient = ctx.createLinearGradient(0, 0, 0, 520);
  topGradient.addColorStop(0, "rgba(0, 0, 0, 0.84)");
  topGradient.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = topGradient;
  ctx.fillRect(0, 0, OUTPUT_WIDTH, 520);

  const bottomGradient = ctx.createLinearGradient(0, 1180, 0, OUTPUT_HEIGHT);
  bottomGradient.addColorStop(0, "rgba(0, 0, 0, 0)");
  bottomGradient.addColorStop(1, "rgba(0, 0, 0, 0.88)");
  ctx.fillStyle = bottomGradient;
  ctx.fillRect(0, 1180, OUTPUT_WIDTH, 740);

  // Text overlays are rendered to a transparent PNG first, then FFmpeg places
  // that PNG on top of each clip. This avoids browser FFmpeg font issues.
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillStyle = "#ffffff";
  ctx.shadowColor = "rgba(0, 0, 0, 0.72)";
  ctx.shadowBlur = 22;
  ctx.font = '800 68px "Arial", sans-serif';

  const titleLines = wrapText(ctx, title, 910, 2);
  titleLines.forEach((line, index) => {
    ctx.fillText(line, OUTPUT_WIDTH / 2, 58 + index * 78);
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
  segmentName,
  durationText,
  fadeDuration,
  fadeOutStart
}: {
  ffmpeg: FFmpeg;
  inputName: string;
  overlayName: string;
  segmentName: string;
  durationText: string;
  fadeDuration: number;
  fadeOutStart: string;
}) {
  const videoFilter = `[0:v]scale=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT}:force_original_aspect_ratio=increase,crop=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT},setsar=1,format=rgba[base];[base][1:v]overlay=0:0:format=auto,format=yuv420p,fade=t=in:st=0:d=${fadeDuration},fade=t=out:st=${fadeOutStart}:d=${fadeDuration}[v]`;
  const audioFilter = `[0:a]atrim=0:${durationText},asetpts=PTS-STARTPTS,apad=pad_dur=${durationText},atrim=0:${durationText},aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo[a]`;
  const silentAudioFilter = `[2:a]atrim=0:${durationText},asetpts=PTS-STARTPTS,aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo[a]`;
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
      "-i",
      inputName,
      "-loop",
      "1",
      "-i",
      overlayName,
      "-t",
      durationText,
      "-filter_complex",
      `${videoFilter};${audioFilter}`,
      ...outputSettings
    ]);
  } catch {
    // Some TikToks/uploads have no audio stream. Render matching silence instead
    // so the final MP4 still has a stable audio track.
    await ffmpeg.exec([
      "-y",
      "-i",
      inputName,
      "-loop",
      "1",
      "-i",
      overlayName,
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

export default function Home() {
  // Form state is kept in one place so validation, preview labels, and FFmpeg
  // processing all use the same five ranked entries.
  const [title, setTitle] = useState("Top 5 Funniest TikToks This Week");
  const [duration, setDuration] = useState(DEFAULT_DURATION_SECONDS);
  const [entries, setEntries] = useState<RankingEntry[]>(initialEntries);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [isGenerating, setIsGenerating] = useState(false);
  const [statusText, setStatusText] = useState("Ready");
  const [progress, setProgress] = useState(0);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [outputBlob, setOutputBlob] = useState<Blob | null>(null);
  const [ffmpegLoaded, setFfmpegLoaded] = useState(false);

  const ffmpegRef = useRef<FFmpeg | null>(null);

  const orderedEntries = useMemo(
    // Clips are intentionally processed in countdown order for ranking videos.
    () => [...entries].sort((a, b) => b.rank - a.rank),
    [entries]
  );

  function updateEntry(rank: number, patch: Partial<RankingEntry>) {
    setEntries((current) =>
      current.map((entry) => (entry.rank === rank ? { ...entry, ...patch } : entry))
    );
  }

  function handleFileChange(rank: number, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    updateEntry(rank, { file });
  }

  function validateForm() {
    const nextErrors: FieldErrors = {};

    // Validation enforces the fixed five-entry ranking surface and rejects
    // malformed TikTok URLs while still allowing manual uploads as a fallback.
    if (!title.trim()) {
      nextErrors.title = "Enter a main title.";
    }

    if (!Number.isFinite(duration) || duration < 2 || duration > 20) {
      nextErrors.duration = "Choose 2 to 20 seconds per clip.";
    }

    if (entries.length !== RANK_COUNT) {
      nextErrors.entries = "Exactly 5 ranked entries are required.";
    }

    entries.forEach((entry) => {
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

  async function generateVideo() {
    if (isGenerating) {
      return;
    }

    const nextErrors = validateForm();

    if (Object.keys(nextErrors).length > 0) {
      setStatusText("Fix the highlighted fields.");
      return;
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
      for (const [index, entry] of entries.entries()) {
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
      const durationText = duration.toFixed(2);
      const fadeDuration = Math.min(0.25, duration / 4);
      const fadeOutStart = Math.max(duration - fadeDuration, 0).toFixed(2);
      const orderedResolvedEntries = [...resolvedEntries].sort((a, b) => b.rank - a.rank);

      for (const [index, entry] of orderedResolvedEntries.entries()) {
        if (!entry.file) {
          throw new Error(`Missing uploaded file for #${entry.rank}.`);
        }

        const inputName = `input-${entry.rank}.${fileExtension(entry.file)}`;
        const overlayName = `overlay-${entry.rank}.png`;
        const segmentName = `segment-${index}.mp4`;

        setStatusText(`Preparing #${entry.rank}...`);
        setProgress(20 + Math.round((index / RANK_COUNT) * 70));

        await ffmpeg.writeFile(inputName, await fetchFile(entry.file));
        await ffmpeg.writeFile(
          overlayName,
          await createOverlayPng(title, entry, orderedResolvedEntries)
        );

        setStatusText(`Rendering #${entry.rank}...`);

        // FFmpeg trims each clip, scales/crops it into a 1080x1920 canvas, adds
        // transition fades, overlays the rank/title/list PNG, and keeps audio.
        await renderSegment({
          ffmpeg,
          inputName,
          overlayName,
          segmentName,
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
      setStatusText("Preview ready");
      setProgress(100);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Video generation failed.";
      setErrors((current) => ({ ...current, generation: message }));
      setStatusText("Generation failed");
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
    anchor.download = `${title.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-") || "ranking-short"}.mp4`;
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
            <div className="status-pill" data-active={isGenerating}>
              {isGenerating ? <Loader2 size={16} className="spin" /> : <Play size={16} />}
              {statusText}
            </div>
          </div>

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
                      maxLength={64}
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
              <span>{errors.generation ?? "Some fields need attention."}</span>
            </div>
          ) : null}

          <div className="actions">
            <button className="primary-button" onClick={generateVideo} disabled={isGenerating}>
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
