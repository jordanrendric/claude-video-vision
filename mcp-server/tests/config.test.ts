import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadConfig, saveConfig, defaultConfig } from "../src/config.js";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const TEST_DIR = join(tmpdir(), "cvv-test-" + Date.now());

describe("config", () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("returns default config when no file exists", () => {
    const config = loadConfig(join(TEST_DIR, "config.json"));
    expect(config.backend).toBe("unconfigured");
    expect(config.frame_mode).toBe("images");
    expect(config.frame_resolution).toBe(512);
    expect(config.default_fps).toBe("auto");
    expect(config.max_frames).toBe(100);
    expect(config.whisper_engine).toBe("cpp");
    expect(config.frame_describer_model).toBe("sonnet");
  });

  it("saves and loads config", () => {
    const configPath = join(TEST_DIR, "config.json");
    const custom = { ...defaultConfig, backend: "local" as const, frame_resolution: 768 };
    saveConfig(configPath, custom);
    const loaded = loadConfig(configPath);
    expect(loaded.backend).toBe("local");
    expect(loaded.frame_resolution).toBe(768);
  });

  it("merges partial config with defaults", () => {
    const configPath = join(TEST_DIR, "config.json");
    writeFileSync(configPath, JSON.stringify({ backend: "openai" }));
    const loaded = loadConfig(configPath);
    expect(loaded.backend).toBe("openai");
    expect(loaded.frame_mode).toBe("images");
    expect(loaded.max_frames).toBe(100);
  });
});
