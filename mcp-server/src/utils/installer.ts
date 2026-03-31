import { execFile } from "child_process";
import { promisify } from "util";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { checkCommand, detectPlatform, recommendWhisperModel } from "./platform.js";
import type { Backend, WhisperEngine, WhisperModel } from "../types.js";

const execFileAsync = promisify(execFile);

const CONFIG_DIR = join(homedir(), ".claude-video-vision");
const MODELS_DIR = join(CONFIG_DIR, "models");

export interface SetupResult {
  status: "ready" | "missing_dependencies" | "error";
  message: string;
  missing: string[];
  instructions: string[];
}

export async function checkDependencies(backend: Backend, whisperEngine?: WhisperEngine): Promise<SetupResult> {
  const missing: string[] = [];
  const instructions: string[] = [];

  // ffmpeg is required for all backends
  if (!(await checkCommand("ffmpeg"))) {
    missing.push("ffmpeg");
    const platform = detectPlatform();
    if (platform.os === "macos") instructions.push("brew install ffmpeg");
    else if (platform.os === "linux") instructions.push("sudo apt install ffmpeg");
    else instructions.push("winget install ffmpeg");
  }

  if (!(await checkCommand("ffprobe"))) {
    missing.push("ffprobe");
    instructions.push("ffprobe is included with ffmpeg — install ffmpeg to get it");
  }

  if (backend === "gemini-api") {
    if (!process.env.GEMINI_API_KEY) {
      missing.push("GEMINI_API_KEY");
      instructions.push("Set GEMINI_API_KEY environment variable");
      instructions.push("Get a key at: https://ai.google.dev/gemini-api/docs/api-key");
    }
  }

  if (backend === "local") {
    const whisperCmd = whisperEngine === "python" ? "whisper" : "whisper-cli";
    if (!(await checkCommand(whisperCmd))) {
      missing.push(whisperCmd);
      const platform = detectPlatform();
      if (whisperEngine === "python") {
        instructions.push("pip install openai-whisper");
      } else {
        if (platform.os === "macos") instructions.push("brew install whisper-cpp");
        else instructions.push("See https://github.com/ggerganov/whisper.cpp for installation");
      }
    }
  }

  if (backend === "openai") {
    if (!process.env.OPENAI_API_KEY) {
      missing.push("OPENAI_API_KEY");
      instructions.push("Set OPENAI_API_KEY environment variable");
    }
  }

  if (missing.length === 0) {
    return { status: "ready", message: "All dependencies are installed.", missing: [], instructions: [] };
  }

  return {
    status: "missing_dependencies",
    message: `Missing ${missing.length} dependencies: ${missing.join(", ")}`,
    missing,
    instructions,
  };
}

export function getModelPath(model: WhisperModel): string {
  const resolvedModel = model === "auto" ? recommendWhisperModel(detectPlatform().ram_gb) : model;
  return join(MODELS_DIR, `ggml-${resolvedModel}.bin`);
}

export function isModelDownloaded(model: WhisperModel): boolean {
  return existsSync(getModelPath(model));
}

export function getModelsDir(): string {
  if (!existsSync(MODELS_DIR)) {
    mkdirSync(MODELS_DIR, { recursive: true });
  }
  return MODELS_DIR;
}
