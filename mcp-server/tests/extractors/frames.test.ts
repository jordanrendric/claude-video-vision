import { describe, it, expect, afterEach } from "vitest";
import { extractFrames, getVideoMetadata, calculateAutoFps } from "../../src/extractors/frames.js";
import { join } from "path";
import { rmSync, existsSync } from "fs";
import { tmpdir } from "os";

const FIXTURE = join(import.meta.dirname, "../fixtures/test-3s.mp4");
const OUT_DIR = join(tmpdir(), "cvv-frames-test-" + Date.now());

describe("frame extraction", () => {
  afterEach(() => {
    if (existsSync(OUT_DIR)) rmSync(OUT_DIR, { recursive: true, force: true });
  });

  describe("getVideoMetadata", () => {
    it("returns correct metadata for test video", async () => {
      const meta = await getVideoMetadata(FIXTURE);
      expect(meta.has_audio).toBe(true);
      expect(meta.duration_seconds).toBeCloseTo(3, 0);
      expect(meta.width).toBe(320);
      expect(meta.height).toBe(240);
      expect(meta.codec).toContain("h264");
    });
  });

  describe("calculateAutoFps", () => {
    it("returns 2 for videos under 1 minute", () => {
      expect(calculateAutoFps(30)).toBe(2);
    });

    it("returns 1 for videos 1-5 minutes", () => {
      expect(calculateAutoFps(120)).toBe(1);
    });

    it("returns 0.5 for videos 5-15 minutes", () => {
      expect(calculateAutoFps(600)).toBe(0.5);
    });

    it("returns 0.2 for videos 15-60 minutes", () => {
      expect(calculateAutoFps(1800)).toBe(0.2);
    });

    it("returns 0.1 for videos over 60 minutes", () => {
      expect(calculateAutoFps(7200)).toBe(0.1);
    });
  });

  describe("extractFrames", () => {
    it("extracts frames as base64 images with timestamps", async () => {
      const result = await extractFrames(FIXTURE, {
        fps: 1,
        resolution: 256,
        outputDir: OUT_DIR,
      });
      expect(result.length).toBeGreaterThanOrEqual(2);
      expect(result[0].timestamp).toBeDefined();
      expect(result[0].image).toBeDefined();
      expect(result[0].image!.length).toBeGreaterThan(100); // base64 data
    });
  });
});
