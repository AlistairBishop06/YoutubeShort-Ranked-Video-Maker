import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const coreEntryPath = require.resolve("@ffmpeg/core");
const coreDistRoot = dirname(dirname(coreEntryPath));
const candidates = [
  join(coreDistRoot, "umd"),
  join(coreDistRoot, "esm"),
  dirname(coreEntryPath),
  coreDistRoot
];
const outputDir = join(process.cwd(), "public", "ffmpeg");
const parkourSource = join(process.cwd(), "app", "assets", "videos", "parkour.mp4");
const parkourOutputDir = join(process.cwd(), "public", "assets", "videos");
const parkourOutput = join(parkourOutputDir, "parkour.mp4");

const sourceDir = candidates.find(
  (candidate) =>
    existsSync(join(candidate, "ffmpeg-core.js")) &&
    existsSync(join(candidate, "ffmpeg-core.wasm"))
);

if (!sourceDir) {
  const seen = candidates
    .filter(existsSync)
    .flatMap((candidate) => readdirSync(candidate).map((file) => join(candidate, file)));
  throw new Error(
    `Could not find ffmpeg-core.js and ffmpeg-core.wasm. Checked: ${seen.join(", ")}`
  );
}

mkdirSync(outputDir, { recursive: true });
copyFileSync(join(sourceDir, "ffmpeg-core.js"), join(outputDir, "ffmpeg-core.js"));
copyFileSync(join(sourceDir, "ffmpeg-core.wasm"), join(outputDir, "ffmpeg-core.wasm"));

console.log(`Copied FFmpeg core assets from ${sourceDir} to ${outputDir}`);

if (!existsSync(parkourSource)) {
  throw new Error(`Could not find the bundled parkour video at ${parkourSource}`);
}

mkdirSync(parkourOutputDir, { recursive: true });
copyFileSync(parkourSource, parkourOutput);
console.log(`Copied bundled parkour video to ${parkourOutput}`);
