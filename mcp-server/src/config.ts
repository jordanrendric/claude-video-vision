import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { existsSync } from "fs";
import { dirname } from "path";
import type { Config } from "./types.js";

export const defaultConfig: Config = {
  backend: "unconfigured",
  whisper_engine: "cpp",
  whisper_model: "auto",
  whisper_at: false,
  frame_mode: "images",
  frame_format: "jpeg",
  frame_resolution: 512,
  default_fps: "auto",
  max_frames: 100,
  frame_describer_model: "sonnet",
  enable_index: false,
  session_max_age_days: 7,
  downloads_max_age_days: 7,
  audio_model: "gemini-3-flash-preview",
  audio_max_output_tokens: 65536,
  audio_chunk_trigger_seconds: 1200,
  audio_chunk_size_seconds: 600,
  audio_chunk_overlap_seconds: 0,
};

export function loadConfig(configPath: string): Config {
  if (!existsSync(configPath)) {
    return { ...defaultConfig };
  }
  const raw = JSON.parse(readFileSync(configPath, "utf-8"));
  return { ...defaultConfig, ...raw };
}

export function saveConfig(configPath: string, config: Config): void {
  const dir = dirname(configPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(configPath, JSON.stringify(config, null, 2));
}
