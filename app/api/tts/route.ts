import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_NARRATION_CHARACTERS = 6000;
const TTS_CHUNK_CHARACTERS = 950;
const TTS_PARALLEL_CHUNKS = 3;

const VOICES = new Set([
  "en-US-AndrewNeural",
  "en-US-AvaNeural",
  "en-US-BrianNeural",
  "en-US-EmmaNeural"
]);

type WordBoundary = {
  part: string;
  start: number;
  end: number;
};

function cleanNarration(value: unknown) {
  return String(value || "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function splitNarration(text: string) {
  const sentences = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [text];
  const chunks: string[] = [];
  let current = "";

  const pushCurrent = () => {
    if (current.trim()) {
      chunks.push(current.trim());
      current = "";
    }
  };

  sentences.forEach((sentence) => {
    const cleanSentence = sentence.trim();

    if (!cleanSentence) {
      return;
    }

    if (cleanSentence.length <= TTS_CHUNK_CHARACTERS) {
      const combined = current ? `${current} ${cleanSentence}` : cleanSentence;

      if (combined.length > TTS_CHUNK_CHARACTERS) {
        pushCurrent();
      }

      current = current ? `${current} ${cleanSentence}` : cleanSentence;
      return;
    }

    pushCurrent();
    const words = cleanSentence.split(/\s+/);

    words.forEach((word) => {
      const combined = current ? `${current} ${word}` : word;

      if (combined.length > TTS_CHUNK_CHARACTERS) {
        pushCurrent();
      }

      current = current ? `${current} ${word}` : word;
    });
  });

  pushCurrent();
  return chunks;
}

function captionCues(boundaries: WordBoundary[]) {
  const cues: Array<{ text: string; start: number; end: number }> = [];
  let words: WordBoundary[] = [];

  const flush = () => {
    if (!words.length) {
      return;
    }

    cues.push({
      text: words.map((word) => word.part.trim()).filter(Boolean).join(" "),
      start: words[0].start / 1000,
      end: words[words.length - 1].end / 1000
    });
    words = [];
  };

  boundaries.forEach((boundary) => {
    const word = boundary.part.trim();

    if (!word) {
      return;
    }

    const nextText = [...words.map((item) => item.part.trim()), word].join(" ");
    const previous = words.at(-1);
    const longGap = previous ? boundary.start - previous.end > 360 : false;

    if (words.length >= 3 || nextText.length > 24 || longGap) {
      flush();
    }

    words.push({ ...boundary, part: word });

    if (/[.!?]$/.test(word) && words.length >= 2) {
      flush();
    }
  });

  flush();
  return cues;
}

export async function POST(request: NextRequest) {
  const workDir = await mkdtemp(join(tmpdir(), "ytshort-tts-"));

  try {
    const payload = (await request.json()) as {
      text?: string;
      voice?: string;
      rate?: number;
    };
    const text = cleanNarration(payload.text);
    const voice = VOICES.has(String(payload.voice))
      ? String(payload.voice)
      : "en-US-AndrewNeural";
    const rate = Math.min(30, Math.max(0, Number(payload.rate) || 12));

    if (!text) {
      return NextResponse.json({ error: "Enter story text to narrate." }, { status: 400 });
    }

    if (text.length > MAX_NARRATION_CHARACTERS) {
      return NextResponse.json(
        { error: `Keep the title and story under ${MAX_NARRATION_CHARACTERS.toLocaleString()} characters.` },
        { status: 400 }
      );
    }

    process.env.WS_NO_BUFFER_UTIL = "1";
    process.env.WS_NO_UTF_8_VALIDATE = "1";
    const { EdgeTTS } = await import("node-edge-tts");
    const chunks = splitNarration(text);
    const chunkResults: Array<{ audio: Buffer; boundaries: WordBoundary[] }> = [];

    // Long stories are synthesized in bounded parallel batches so one large
    // WebSocket request cannot time out before subtitle metadata is written.
    for (let index = 0; index < chunks.length; index += TTS_PARALLEL_CHUNKS) {
      const batch = chunks.slice(index, index + TTS_PARALLEL_CHUNKS);
      const results = await Promise.all(
        batch.map(async (chunk, batchIndex) => {
          const chunkIndex = index + batchIndex;
          const outputPath = join(workDir, `narration-${chunkIndex}.mp3`);
          const tts = new EdgeTTS({
            voice,
            lang: "en-US",
            outputFormat: "audio-24khz-48kbitrate-mono-mp3",
            saveSubtitles: true,
            pitch: "+2Hz",
            rate: `+${rate}%`,
            volume: "+0%",
            timeout: 30000
          });

          await tts.ttsPromise(chunk, outputPath);
          const [audio, rawBoundaries] = await Promise.all([
            readFile(outputPath),
            readFile(`${outputPath}.json`, "utf8")
          ]);

          return {
            audio,
            boundaries: JSON.parse(rawBoundaries) as WordBoundary[]
          };
        })
      );
      chunkResults.push(...results);
    }

    let timelineOffsetMs = 0;
    const boundaries = chunkResults.flatMap((chunk) => {
      const adjusted = chunk.boundaries.map((boundary) => ({
        ...boundary,
        start: boundary.start + timelineOffsetMs,
        end: boundary.end + timelineOffsetMs
      }));
      timelineOffsetMs += (chunk.boundaries.at(-1)?.end || 0) + 80;
      return adjusted;
    });
    const audio = Buffer.concat(chunkResults.map((chunk) => chunk.audio));
    const captions = captionCues(boundaries);
    const duration = (boundaries.at(-1)?.end || 0) / 1000 + 0.55;

    if (!audio.length || !captions.length || duration <= 0.5) {
      throw new Error("The speech service returned an incomplete narration.");
    }

    return NextResponse.json({
      audioBase64: audio.toString("base64"),
      captions,
      duration,
      mimeType: "audio/mpeg"
    });
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : error === "Timed out"
        ? "Speech synthesis timed out. Try again or slightly shorten the story."
        : "Text-to-speech generation failed.";
    return NextResponse.json({ error: message }, { status: 502 });
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}
