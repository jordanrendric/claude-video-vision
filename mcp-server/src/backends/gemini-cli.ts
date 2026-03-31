import { execFile } from "child_process";
import { promisify } from "util";
import type { AudioResult } from "../types.js";

const execFileAsync = promisify(execFile);

const GEMINI_PROMPT = `Analyze this video in detail. Provide:
1. A complete transcription of all speech with timestamps
2. Description of non-speech audio events (music, sound effects, ambient sounds, coughs, animal sounds, etc.) with timestamps
3. A detailed visual description of what happens in the video

Format your response as structured text with clear sections for: TRANSCRIPTION, AUDIO_EVENTS, and VISUAL_DESCRIPTION.`;

export function buildGeminiCliArgs(videoPath: string, customPrompt?: string): string[] {
  return [
    "-p",
    customPrompt || GEMINI_PROMPT,
    "--file",
    videoPath,
    "--output-format",
    "json",
  ];
}

export function parseGeminiCliOutput(output: string): AudioResult {
  let fullAnalysis: string;

  try {
    const parsed = JSON.parse(output);
    fullAnalysis = parsed.response || parsed.text || output;
  } catch {
    fullAnalysis = output;
  }

  return {
    backend: "gemini-cli",
    transcription: [],
    audio_tags: [],
    full_analysis: fullAnalysis,
  };
}

export async function analyzeWithGeminiCli(videoPath: string): Promise<AudioResult> {
  const args = buildGeminiCliArgs(videoPath);

  const { stdout } = await execFileAsync("gemini", args, {
    timeout: 300_000, // 5 min timeout for long videos
    maxBuffer: 50 * 1024 * 1024, // 50MB buffer
  });

  return parseGeminiCliOutput(stdout);
}
