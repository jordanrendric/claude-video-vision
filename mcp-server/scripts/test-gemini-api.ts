#!/usr/bin/env node
/*
 * Integration test for the Gemini API backend.
 *
 * Mirrors the real video_watch flow: extracts audio from the video via ffmpeg
 * (16kHz mono wav), then runs the full upload -> poll-for-ACTIVE ->
 * generateContent -> delete path against the real Gemini API.
 *
 * The backend requests structured JSON output from Gemini with HH:MM:SS
 * timestamps for both speech segments and non-speech audio events.
 *
 * Purpose: reproduce and verify the fix for issue #19 (FAILED_PRECONDITION
 * due to missing file-state poll), and confirm the structured output works
 * end-to-end.
 *
 * Why audio only: the gemini-api backend is an audio-analysis backend. Visual
 * understanding is covered separately by the frame extraction pipeline. The
 * audio-first flow matches the pattern used by the local and openai backends
 * and is both cheaper and faster than uploading the full video.
 *
 * Requires:
 *   - GEMINI_API_KEY in environment
 *   - ffmpeg available on PATH
 *   - A local video file to analyze
 *
 * Usage:
 *   GEMINI_API_KEY=... npm run test:gemini -- <video-path>
 *
 * Or directly:
 *   GEMINI_API_KEY=... tsx scripts/test-gemini-api.ts <video-path>
 *
 * What it prints:
 *   - Audio extraction step (source video -> wav, size)
 *   - analyzeWithGeminiApi() elapsed time
 *   - Structured transcription segments (start/end/text)
 *   - Structured audio_tags (start/end/tag)
 *   - Counts and schema-compliance summary
 */

import { mkdirSync, rmSync, statSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { analyzeWithGeminiApi } from "../src/backends/gemini-api.js";
import { extractAudio } from "../src/extractors/audio.js";

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}... (+${text.length - max} more chars)`;
}

async function main() {
  const videoPath = process.argv[2];

  if (!videoPath) {
    console.error("Usage: tsx scripts/test-gemini-api.ts <video-path>");
    console.error("");
    console.error("Requires GEMINI_API_KEY in environment and ffmpeg on PATH.");
    process.exit(1);
  }

  if (!process.env.GEMINI_API_KEY) {
    console.error("error: GEMINI_API_KEY is not set in the environment");
    process.exit(1);
  }

  let videoInfo;
  try {
    videoInfo = statSync(videoPath);
  } catch (err) {
    console.error(`error: cannot read video file at ${videoPath}`);
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }

  console.log(`Video: ${videoPath}`);
  console.log(`Size: ${(videoInfo.size / 1024 / 1024).toFixed(2)} MB`);
  console.log("");

  const workDir = join(
    tmpdir(),
    `cvv-gemini-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  mkdirSync(workDir, { recursive: true });

  try {
    console.log("Step 1: extracting audio via ffmpeg (16kHz mono wav)...");
    const audioStart = Date.now();
    const wavPath = await extractAudio(videoPath, workDir);
    const audioElapsedSec = ((Date.now() - audioStart) / 1000).toFixed(2);
    const wavInfo = statSync(wavPath);
    console.log(
      `  -> ${wavPath} (${(wavInfo.size / 1024).toFixed(2)} KB, ${audioElapsedSec}s)`,
    );
    console.log("");

    console.log("Step 2: calling analyzeWithGeminiApi(wavPath)...");
    console.log("(upload -> poll for ACTIVE -> generateContent [JSON schema] -> delete)");
    console.log("");

    const analyzeStart = Date.now();
    const result = await analyzeWithGeminiApi(wavPath);
    const analyzeElapsedSec = ((Date.now() - analyzeStart) / 1000).toFixed(2);

    console.log(`[OK] Success in ${analyzeElapsedSec}s`);
    console.log(`Backend: ${result.backend}`);
    console.log("");

    console.log(`--- TRANSCRIPTION (${result.transcription.length} segments) ---`);
    if (result.transcription.length === 0) {
      console.log("(no speech detected)");
    } else {
      for (const seg of result.transcription) {
        console.log(`  [${seg.start} -> ${seg.end}] ${truncate(seg.text, 120)}`);
      }
    }
    console.log("");

    console.log(`--- AUDIO_TAGS (${result.audio_tags.length} events) ---`);
    if (result.audio_tags.length === 0) {
      console.log("(no non-speech events detected)");
    } else {
      for (const tag of result.audio_tags) {
        console.log(`  [${tag.start} -> ${tag.end}] ${tag.tag}`);
      }
    }
    console.log("");

    console.log("--- Schema compliance ---");
    const schemaOk =
      result.transcription.every(
        (s) =>
          typeof s.start === "string" &&
          typeof s.end === "string" &&
          typeof s.text === "string",
      ) &&
      result.audio_tags.every(
        (t) =>
          typeof t.start === "string" &&
          typeof t.end === "string" &&
          typeof t.tag === "string",
      );
    console.log(`  All entries match schema: ${schemaOk ? "yes" : "NO"}`);
    console.log(`  full_analysis field: ${result.full_analysis === null ? "null (expected)" : "non-null (unexpected)"}`);
  } catch (err) {
    console.error("[FAIL]");
    console.error("");

    if (err instanceof Error) {
      console.error(`Error: ${err.message}`);
      if (err.message.includes("FAILED_PRECONDITION")) {
        console.error("");
        console.error(
          "This is the exact error from issue #19. The fix should prevent it.",
        );
      }
      if (err.message.includes("stuck in state")) {
        console.error("");
        console.error(
          "File did not reach ACTIVE state within the timeout. Could mean:",
        );
        console.error("  - The audio is very long and needs more time");
        console.error(
          "  - Gemini is having processing issues (check https://status.cloud.google.com)",
        );
        console.error("  - The default timeout (120s) needs to be increased");
      }
      if (err.message.includes("non-JSON response")) {
        console.error("");
        console.error(
          "Gemini did not honor the responseMimeType=application/json config.",
        );
        console.error(
          "Could be a model or SDK version issue. Check @google/genai and gemini-2.5-flash compatibility.",
        );
      }
    } else {
      console.error(err);
    }
    process.exit(1);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error("unexpected error:", err instanceof Error ? err.stack : err);
  process.exit(1);
});
