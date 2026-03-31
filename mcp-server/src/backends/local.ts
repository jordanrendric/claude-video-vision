import { execFile, exec } from "child_process";
import { promisify } from "util";
import { existsSync, mkdirSync } from "fs";
import { dirname } from "path";
import { detectPlatform, recommendWhisperModel } from "../utils/platform.js";
import type { AudioResult, TranscriptionSegment, AudioTag } from "../types.js";
import type { WhisperEngine, WhisperModel } from "../types.js";

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);

function resolveModel(model: WhisperModel): string {
  if (model === "auto") {
    return recommendWhisperModel(detectPlatform().ram_gb);
  }
  return model;
}

export interface WhisperOptions {
  engine: WhisperEngine;
  model: WhisperModel;
  whisperAt: boolean;
  modelDir: string;
}

export async function transcribeWithWhisper(
  wavPath: string,
  options: WhisperOptions,
): Promise<AudioResult> {
  const { engine, model, whisperAt, modelDir } = options;

  if (engine === "cpp") {
    return transcribeWithWhisperCpp(wavPath, model, modelDir);
  }
  return transcribeWithWhisperPython(wavPath, model, whisperAt);
}

async function transcribeWithWhisperCpp(
  wavPath: string,
  model: string,
  modelDir: string,
): Promise<AudioResult> {
  const resolved = resolveModel(model as WhisperModel);
  const modelPath = `${modelDir}/ggml-${resolved}.bin`;

  if (!existsSync(modelPath)) {
    const dir = dirname(modelPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    const downloadUrl = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${resolved}.bin`;
    console.error(`[cvv] Downloading whisper model ggml-${resolved}.bin...`);
    await execAsync(`curl -L -o '${modelPath}' '${downloadUrl}'`, {
      timeout: 600_000, // 10 min for large models
    });
    console.error(`[cvv] Model downloaded to ${modelPath}`);

    if (!existsSync(modelPath)) {
      throw new Error(`Failed to download model from ${downloadUrl}`);
    }
  }

  const { stdout } = await execFileAsync("whisper-cli", [
    "--model", modelPath,
    "--file", wavPath,
    "--output-json",
    "--language", "auto",
  ], { timeout: 600_000, maxBuffer: 50 * 1024 * 1024 });

  return parseWhisperOutput(stdout);
}

async function transcribeWithWhisperPython(
  wavPath: string,
  model: string,
  whisperAt: boolean,
): Promise<AudioResult> {
  const command = whisperAt ? "whisper-at" : "whisper";

  const { stdout } = await execFileAsync(command, [
    wavPath,
    "--model", model,
    "--language", "auto",
    "--output_format", "json",
  ], { timeout: 600_000, maxBuffer: 50 * 1024 * 1024 });

  return parseWhisperOutput(stdout);
}

function parseWhisperOutput(output: string): AudioResult {
  const transcription: TranscriptionSegment[] = [];
  const audioTags: AudioTag[] = [];

  try {
    const parsed = JSON.parse(output);
    const segments = parsed.segments || parsed.transcription || [];

    for (const seg of segments) {
      transcription.push({
        start: formatTime(seg.start ?? seg.from ?? 0),
        end: formatTime(seg.end ?? seg.to ?? 0),
        text: (seg.text || "").trim(),
      });
    }

    if (parsed.audio_tags || parsed.labels) {
      const tags = parsed.audio_tags || parsed.labels || [];
      for (const tag of tags) {
        audioTags.push({
          start: formatTime(tag.start ?? 0),
          end: formatTime(tag.end ?? 0),
          tag: tag.tag || tag.label || tag.name || "unknown",
        });
      }
    }
  } catch {
    if (output.trim()) {
      transcription.push({ start: "00:00:00", end: "00:00:00", text: output.trim() });
    }
  }

  return {
    backend: "local",
    transcription,
    audio_tags: audioTags,
    full_analysis: null,
  };
}

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
