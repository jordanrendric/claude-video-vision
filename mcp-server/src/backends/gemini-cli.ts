import { exec } from "child_process";
import { promisify } from "util";
import { copyFileSync, mkdirSync, unlinkSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { AudioResult } from "../types.js";

const execAsync = promisify(exec);

const GEMINI_AUDIO_PROMPT = "Use your read_file tool to read the audio file audio.wav. Analyze the audio in detail with timestamps. Provide: 1) TRANSCRIPTION: Complete transcription of all speech with start/end timestamps. 2) AUDIO_EVENTS: Description of non-speech audio events (music, sound effects, ambient sounds, coughs, animal sounds, silence) with timestamps. Be precise with timestamps so they can be cross-referenced with video frames.";

export function getGeminiTmpDir(): string {
  const tmpDir = join(homedir(), ".gemini", "tmp", "claude-video-vision");
  if (!existsSync(tmpDir)) {
    mkdirSync(tmpDir, { recursive: true });
  }
  return tmpDir;
}

export function buildGeminiCommand(workDir: string, customPrompt?: string): string {
  const prompt = customPrompt || GEMINI_AUDIO_PROMPT;
  const safePrompt = prompt.replace(/'/g, "'\\''");
  const safeWorkDir = workDir.replace(/'/g, "'\\''");
  return `gemini -p '${safePrompt}' --output-format json -y --include-directories '${safeWorkDir}'`;
}

export function parseGeminiCliOutput(output: string): AudioResult {
  let fullAnalysis: string;

  try {
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

export async function analyzeWithGeminiCli(wavPath: string): Promise<AudioResult> {
  const tmpDir = getGeminiTmpDir();
  const tmpAudio = join(tmpDir, "audio.wav");

  try {
    console.error(`[cvv] Copying audio to Gemini workspace...`);
    copyFileSync(wavPath, tmpAudio);

    const command = buildGeminiCommand(tmpDir);
    console.error(`[cvv] Running Gemini CLI for audio analysis...`);

    const { stdout, stderr } = await execAsync(command, {
      timeout: 300_000,
      maxBuffer: 50 * 1024 * 1024,
      cwd: tmpDir,
    });

    console.error(`[cvv] Gemini CLI completed`);
    return parseGeminiCliOutput(stdout || stderr);
  } finally {
    try {
      if (existsSync(tmpAudio)) unlinkSync(tmpAudio);
    } catch {
      // ignore cleanup errors
    }
  }
}
