import { describe, it, expect, afterEach } from "vitest";
import { extractFramesBySegments, generateTimestampsForSegment } from "../../src/extractors/frames.js";
import { join } from "path";
import { rmSync, existsSync } from "fs";
import { tmpdir } from "os";
import type { Segment } from "../../src/types.js";

const FIXTURE = join(import.meta.dirname, "../fixtures/test-3s.mp4");
const OUT_DIR = join(tmpdir(), "cvv-segments-test-" + Date.now());

describe("segment-based frame extraction", () => {
  afterEach(() => {
    if (existsSync(OUT_DIR)) rmSync(OUT_DIR, { recursive: true, force: true });
  });

  describe("generateTimestampsForSegment", () => {
    it("generates timestamps at the given fps within the range", () => {
      const timestamps = generateTimestampsForSegment(
        { start: "00:00:00", end: "00:00:04", fps: 1 },
      );
      expect(timestamps).toEqual(["00:00:00", "00:00:01", "00:00:02", "00:00:03"]);
    });

    it("handles fractional fps", () => {
      const timestamps = generateTimestampsForSegment(
        { start: "00:00:00", end: "00:00:10", fps: 0.5 },
      );
      expect(timestamps).toEqual(["00:00:00", "00:00:02", "00:00:04", "00:00:06", "00:00:08"]);
    });
  });

  describe("extractFramesBySegments", () => {
    it("extracts frames for a single segment", async () => {
      const segments: Segment[] = [
        { start: "00:00:00", end: "00:00:03", fps: 1, resolution: 256 },
      ];
      const result = await extractFramesBySegments(FIXTURE, segments, OUT_DIR);
      expect(result.length).toBeGreaterThanOrEqual(2);
      expect(result[0].timestamp).toBeDefined();
      expect(result[0].image).toBeDefined();
      expect(result[0].resolution).toBe(256);
    });
  });
});
