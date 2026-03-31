import { exec } from "child_process";
import { promisify } from "util";
import type { AudioResult } from "../types.js";

const execAsync = promisify(exec);

const GEMINI_PROMPT = "Analyze this video in detail. Provide: 1) A complete transcription of all speech with timestamps. 2) Description of non-speech audio events (music, sound effects, ambient sounds, coughs, animal sounds) with timestamps. 3) A detailed visual description of what happens. Format with sections: TRANSCRIPTION, AUDIO_EVENTS, VISUAL_DESCRIPTION.";

export function buildGeminiCommand(videoPath: string, customPrompt?: string): string {
  const prompt = customPrompt || GEMINI_PROMPT;
  // Escape single quotes in path and prompt for shell safety
  const safePath = videoPath.replace(/'/g, "'\\''");
  const safePrompt = prompt.replace(/'/g, "'\\''");
  return `echo '@${safePath}' | gemini -p '${safePrompt}' --output-format json`;
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

  const { stdout, stderr } = await execAsync(command, {
    timeout: 300_000, // 5 min timeout
    maxBuffer: 50 * 1024 * 1024, // 50MB buffer
  });

  return parseGeminiCliOutput(stdout || stderr);
}
