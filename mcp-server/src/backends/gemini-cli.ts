import { spawn } from "child_process";
import type { AudioResult } from "../types.js";

const GEMINI_PROMPT = "Analyze this video in detail. Provide: 1) A complete transcription of all speech with timestamps. 2) Description of non-speech audio events (music, sound effects, ambient sounds, coughs, animal sounds) with timestamps. 3) A detailed visual description of what happens. Format with sections: TRANSCRIPTION, AUDIO_EVENTS, VISUAL_DESCRIPTION.";

export function buildGeminiArgs(customPrompt?: string): string[] {
  return ["-p", customPrompt || GEMINI_PROMPT, "--output-format", "json"];
}

export function buildStdinContent(videoPath: string): string {
  return `@${videoPath}`;
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
  const args = buildGeminiArgs();
  const stdinContent = buildStdinContent(videoPath);

  return new Promise((resolve, reject) => {
    const proc = spawn("gemini", args, {
      timeout: 300_000,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      if (code !== 0 && !stdout.includes("response")) {
        reject(new Error(`Gemini CLI exited with code ${code}: ${stderr || stdout}`));
        return;
      }
      resolve(parseGeminiCliOutput(stdout));
    });

    proc.on("error", (err) => {
      reject(new Error(`Failed to start Gemini CLI: ${err.message}`));
    });

    // Write file reference to stdin and close
    proc.stdin.write(stdinContent);
    proc.stdin.end();
  });
}
