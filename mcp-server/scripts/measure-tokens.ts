#!/usr/bin/env node
/*
 * Measure token consumption of video_watch for a given video and settings.
 *
 * Runs fully offline by default:
 *   - Images: Anthropic's published formula (width * height) / 750
 *   - Text:   js-tiktoken cl100k_base (same encoding as GPT-4), ~5% off from
 *             Claude's actual tokenizer for English text
 *
 * Numbers here are a lower-bound estimate. Claude Code's /context tracker
 * adds wrapping overhead on top (frame headers, JSON structure, MCP envelope)
 * that can push the measured total 10-15% higher in practice.
 *
 * Usage:
 *   npm run measure -- <video-path>
 *   npm run measure -- video.mp4 --fps 1 --resolution 512
 *   npm run measure -- video.mp4 --matrix
 *   npm run measure -- video.mp4 --no-audio
 */

import { mkdirSync, rmSync } from "fs";
import { getEncoding } from "js-tiktoken";
import { homedir, tmpdir } from "os";
import { join } from "path";
import { transcribeWithWhisper } from "../src/backends/local.js";
import { loadConfig } from "../src/config.js";
import { extractAudio } from "../src/extractors/audio.js";
import {
  calculateAutoFps,
  extractFrames,
  getVideoMetadata,
} from "../src/extractors/frames.js";
import type { AudioResult, Frame, VideoMetadata } from "../src/types.js";

const CONFIG_PATH = join(homedir(), ".claude-video-vision", "config.json");
const encoder = getEncoding("cl100k_base");

interface MeasureConfig {
  fps: number | "auto";
  resolution: number;
  includeAudio: boolean;
}

interface MeasureResult {
  fps: number;
  resolution: number;
  frameCount: number;
  metadataTokens: number;
  transcriptionTokens: number;
  framesTokens: number;
  totalTokens: number;
  perFrameTokens: number;
}

function countTextTokens(text: string): number {
  return encoder.encode(text).length;
}

function countImageTokens(widthPx: number, heightPx: number): number {
  // Anthropic's published formula for image tokens
  return Math.round((widthPx * heightPx) / 750);
}

function computeScaledDimensions(
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
): { width: number; height: number } {
  const ratio = targetWidth / sourceWidth;
  return {
    width: targetWidth,
    height: Math.round(sourceHeight * ratio),
  };
}

async function processVideo(videoPath: string, config: MeasureConfig) {
  const metadata = await getVideoMetadata(videoPath);
  const fps =
    config.fps === "auto" ? calculateAutoFps(metadata.duration_seconds) : config.fps;

  const workDir = join(
    tmpdir(),
    `cvv-measure-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  mkdirSync(workDir, { recursive: true });

  try {
    const framesDir = join(workDir, "frames");
    const frames = await extractFrames(videoPath, {
      fps,
      resolution: config.resolution,
      outputDir: framesDir,
      maxFrames: 1000,
    });

    let audio: AudioResult | null = null;
    if (config.includeAudio && metadata.has_audio) {
      const audioDir = join(workDir, "audio");
      const wavPath = await extractAudio(videoPath, audioDir);
      const persisted = loadConfig(CONFIG_PATH);
      const modelDir = join(homedir(), ".claude-video-vision", "models");
      audio = await transcribeWithWhisper(wavPath, {
        engine: persisted.whisper_engine,
        model: persisted.whisper_model,
        whisperAt: persisted.whisper_at,
        modelDir,
      });
    }

    return { metadata, fps, frames, audio };
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

function estimateTokens(
  metadata: VideoMetadata,
  config: MeasureConfig,
  fpsApplied: number,
  frames: Frame[],
  audio: AudioResult | null,
): MeasureResult {
  // Metadata block (as video_watch would emit it)
  const metadataBlockText = `## Video Metadata\n${JSON.stringify(metadata, null, 2)}`;
  const metadataTokens = countTextTokens(metadataBlockText);

  // Transcription block
  let transcriptionTokens = 0;
  if (audio) {
    const audioText = `\n\n## Audio Analysis\n${JSON.stringify(audio, null, 2)}`;
    transcriptionTokens = countTextTokens(audioText);
  }

  // Frame image blocks
  const { width: frameWidth, height: frameHeight } = computeScaledDimensions(
    metadata.width,
    metadata.height,
    config.resolution,
  );
  const tokensPerFrame = countImageTokens(frameWidth, frameHeight);

  // Plus the "### Frame at HH:MM:SS" text header emitted before each image
  const headerTokensPerFrame = frames.length > 0
    ? countTextTokens(`### Frame at ${frames[0].timestamp}`)
    : 0;

  const framesTokens = frames.length * (tokensPerFrame + headerTokensPerFrame);
  const totalTokens = metadataTokens + transcriptionTokens + framesTokens;

  return {
    fps: fpsApplied,
    resolution: config.resolution,
    frameCount: frames.length,
    metadataTokens,
    transcriptionTokens,
    framesTokens,
    totalTokens,
    perFrameTokens: tokensPerFrame + headerTokensPerFrame,
  };
}

async function measureOnce(
  videoPath: string,
  config: MeasureConfig,
): Promise<MeasureResult> {
  const { metadata, fps, frames, audio } = await processVideo(videoPath, config);
  return estimateTokens(metadata, config, fps, frames, audio);
}

function formatRow(values: (string | number)[], widths: number[]): string {
  return values.map((v, i) => String(v).padEnd(widths[i])).join(" ");
}

function printSingle(
  videoPath: string,
  metadata: VideoMetadata,
  result: MeasureResult,
) {
  console.log(`\nVideo: ${videoPath}`);
  console.log(
    `  duration: ${metadata.duration} (${metadata.duration_seconds.toFixed(2)}s)`,
  );
  console.log(`  source: ${metadata.resolution} @ ${metadata.original_fps}fps`);
  console.log(`  audio: ${metadata.has_audio ? "yes" : "no"}`);
  console.log(`\nConfiguration:`);
  console.log(`  fps: ${result.fps}`);
  console.log(`  resolution: ${result.resolution}px wide`);
  console.log(`  frames extracted: ${result.frameCount}`);
  console.log(`\nToken estimate (offline: cl100k_base for text, (w*h)/750 for images):`);
  console.log(`  Metadata:         ${result.metadataTokens.toLocaleString().padStart(10)}`);
  console.log(`  Transcription:    ${result.transcriptionTokens.toLocaleString().padStart(10)}`);
  console.log(
    `  Frames:           ${result.framesTokens.toLocaleString().padStart(10)} (~${result.perFrameTokens.toLocaleString()}/frame)`,
  );
  console.log(`  ${"".padStart(30, "-")}`);
  console.log(`  Total input:      ${result.totalTokens.toLocaleString().padStart(10)}`);
  console.log(
    `\n(Claude Code's /context typically shows 10-15% higher due to wrapping overhead.)`,
  );
}

function printMatrix(
  videoPath: string,
  metadata: VideoMetadata,
  results: MeasureResult[],
) {
  console.log(`\nVideo: ${videoPath}`);
  console.log(
    `  duration: ${metadata.duration} (${metadata.duration_seconds.toFixed(2)}s), source: ${metadata.resolution} @ ${metadata.original_fps}fps, audio: ${metadata.has_audio ? "yes" : "no"}`,
  );
  console.log(`\nMatrix (offline estimate):\n`);

  const widths = [8, 8, 8, 10, 14, 10, 12];
  console.log(
    formatRow(
      ["fps", "res", "frames", "meta+aud", "frames-tok", "total", "per-frame"],
      widths,
    ),
  );
  console.log("-".repeat(widths.reduce((a, b) => a + b + 1, 0)));

  for (const r of results) {
    console.log(
      formatRow(
        [
          r.fps,
          `${r.resolution}px`,
          r.frameCount,
          r.metadataTokens + r.transcriptionTokens,
          r.framesTokens,
          r.totalTokens,
          r.perFrameTokens,
        ],
        widths,
      ),
    );
  }

  console.log(
    `\n(Claude Code's /context typically shows 10-15% higher due to wrapping overhead.)`,
  );
}

function parseArgs(argv: string[]) {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(arg);
    }
  }

  return { positional, flags };
}

async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const videoPath = positional[0];

  if (!videoPath) {
    console.error("Usage: npm run measure -- <video-path> [options]");
    console.error("");
    console.error("Options:");
    console.error("  --fps <N|auto>      Frames per second (default: auto)");
    console.error("  --resolution <N>    Frame width in px (default: 512)");
    console.error("  --no-audio          Skip audio extraction and transcription");
    console.error("  --matrix            Run a matrix of common configurations");
    process.exit(1);
  }

  const metadata = await getVideoMetadata(videoPath);
  const includeAudio = !flags["no-audio"];

  if (flags.matrix) {
    const configs: MeasureConfig[] = [
      { fps: "auto", resolution: 256, includeAudio },
      { fps: "auto", resolution: 512, includeAudio },
      { fps: "auto", resolution: 1024, includeAudio },
      { fps: 1, resolution: 512, includeAudio },
      { fps: 2, resolution: 512, includeAudio },
    ];

    const results: MeasureResult[] = [];
    for (const config of configs) {
      process.stderr.write(
        `Running: fps=${config.fps}, resolution=${config.resolution}px... `,
      );
      const result = await measureOnce(videoPath, config);
      results.push(result);
      process.stderr.write(`${result.totalTokens.toLocaleString()} tokens\n`);
    }
    printMatrix(videoPath, metadata, results);
  } else {
    const fpsFlag = flags.fps;
    const fps: number | "auto" =
      typeof fpsFlag === "string"
        ? fpsFlag === "auto"
          ? "auto"
          : Number(fpsFlag)
        : "auto";
    const resolution =
      typeof flags.resolution === "string" ? Number(flags.resolution) : 512;

    const config: MeasureConfig = { fps, resolution, includeAudio };
    const result = await measureOnce(videoPath, config);
    printSingle(videoPath, metadata, result);
  }
}

main().catch((err) => {
  console.error("error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
