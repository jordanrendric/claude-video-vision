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
  frame_resolution: 512,
  default_fps: "auto",
  max_frames: 100,
  frame_describer_model: "sonnet",
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
