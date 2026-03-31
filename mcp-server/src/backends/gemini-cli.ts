import { exec } from "child_process";
import { promisify } from "util";
import type { AudioResult } from "../types.js";

const execAsync = promisify(exec);

const GEMINI_PROMPT = `Analyze this video in detail. Provide:
1. A complete transcription of all speech with timestamps
2. Description of non-speech audio events (music, sound effects, ambient sounds, coughs, animal sounds, etc.) with timestamps
3. A detailed visual description of what happens in the video

Format your response as structured text with clear sections for: TRANSCRIPTION, AUDIO_EVENTS, and VISUAL_DESCRIPTION.`;

export function buildGeminiCommand(videoPath: string, customPrompt?: string): string {
  const prompt = customPrompt || GEMINI_PROMPT;
  const escapedPrompt = prompt.replace(/"/g, '\\"');
  const escapedPath = videoPath.replace(/"/g, '\\"');
  return `echo "@${escapedPath}" | gemini -p "${escapedPrompt}" --output-format json`;
}

export function parseGeminiCliOutput(output: string): AudioResult {
  let fullAnalysis: string;

  try {
    // Gemini CLI outputs debug/loading lines before JSON — find the JSON object
    const jsonMatch = output.match(/\{[\s\S]*"response"[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      fullAnalysis = parsed.response || parsed.text || output;
    } else {
      fullAnalysis = output;
    }
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
  const command = buildGeminiCommand(videoPath);

  const { stdout } = await execAsync(command, {
    timeout: 300_000, // 5 min timeout for long videos
    maxBuffer: 50 * 1024 * 1024, // 50MB buffer
  });

  return parseGeminiCliOutput(stdout);
}
