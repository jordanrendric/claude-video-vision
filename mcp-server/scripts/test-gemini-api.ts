#!/usr/bin/env node
/*
 * Integration test for the Gemini API backend.
 *
 * Exercises the full upload -> poll-for-ACTIVE -> generateContent -> delete
 * path against the real Gemini API. Purpose: reproduce and verify the fix for
 * issue #19 (FAILED_PRECONDITION due to missing file-state poll).
 *
 * Requires:
 *   - GEMINI_API_KEY in environment
 *   - A local video file to analyze
 *
 * Usage:
 *   GEMINI_API_KEY=... npm run test:gemini -- <video-path>
 *
 * Or directly:
 *   GEMINI_API_KEY=... tsx scripts/test-gemini-api.ts <video-path>
 *
 * What it prints:
 *   - Upload result (name, initial state)
 *   - State polling progression (PROCESSING -> ACTIVE)
 *   - Time to reach ACTIVE
 *   - Gemini's analysis response (first ~500 chars)
 *   - Cleanup status
 */

import { statSync } from "fs";
import { analyzeWithGeminiApi } from "../src/backends/gemini-api.js";

async function main() {
  const videoPath = process.argv[2];

  if (!videoPath) {
    console.error("Usage: tsx scripts/test-gemini-api.ts <video-path>");
    console.error("");
    console.error("Requires GEMINI_API_KEY in environment.");
    process.exit(1);
  }

  if (!process.env.GEMINI_API_KEY) {
    console.error("error: GEMINI_API_KEY is not set in the environment");
    process.exit(1);
  }

  let fileInfo;
  try {
    fileInfo = statSync(videoPath);
  } catch (err) {
    console.error(`error: cannot read video file at ${videoPath}`);
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }

  console.log(`Video: ${videoPath}`);
  console.log(`Size: ${(fileInfo.size / 1024 / 1024).toFixed(2)} MB`);
  console.log("");
  console.log("Calling analyzeWithGeminiApi()...");
  console.log("(this will upload -> poll for ACTIVE -> generateContent -> delete)");
  console.log("");

  const startTime = Date.now();

  try {
    const result = await analyzeWithGeminiApi(videoPath);
    const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log(`[OK] Success in ${elapsedSec}s`);
    console.log("");
    console.log("--- Gemini response (first 500 chars) ---");
    console.log((result.full_analysis ?? "").slice(0, 500));
    if ((result.full_analysis ?? "").length > 500) {
      console.log(`... (${result.full_analysis!.length - 500} more chars)`);
    }
    console.log("--- end ---");
    console.log("");
    console.log(`Backend: ${result.backend}`);
    console.log(`Transcription segments: ${result.transcription.length}`);
    console.log(`Audio tags: ${result.audio_tags.length}`);
    console.log(`Full analysis length: ${(result.full_analysis ?? "").length} chars`);
  } catch (err) {
    const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(2);
    console.error(`[FAIL] Failed after ${elapsedSec}s`);
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
          "File did not reach ACTIVE state within the timeout. This could mean:",
        );
        console.error("  - The video is very large and needs more time");
        console.error(
          "  - Gemini is having processing issues (check https://status.cloud.google.com)",
        );
        console.error("  - The default timeout (120s) needs to be increased");
      }
    } else {
      console.error(err);
    }
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("unexpected error:", err instanceof Error ? err.stack : err);
  process.exit(1);
});
