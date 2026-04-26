import { describe, it, expect } from "vitest";
import { createManifest, mergeFrames, getUncachedTimestamps, sampleFrameIndices } from "../../src/session/manifest.js";

describe("manifest", () => {
  describe("createManifest", () => {
    it("creates a manifest with empty resolutions", () => {
      const m = createManifest("abc123", "/test.mp4");
      expect(m.video_hash).toBe("abc123");
      expect(m.resolutions).toEqual({});
      expect(m.created_at).toBeDefined();
    });
  });

  describe("mergeFrames", () => {
    it("adds frames to a new resolution bucket", () => {
      const m = createManifest("abc", "/test.mp4");
      const updated = mergeFrames(m, "512", [
        { timestamp: "00:00:02", file: "512/frame_00_00_02.jpg" },
        { timestamp: "00:00:04", file: "512/frame_00_00_04.jpg" },
      ]);
      expect(updated.resolutions["512"].frames).toHaveLength(2);
    });

    it("deduplicates by timestamp within same resolution", () => {
      const m = createManifest("abc", "/test.mp4");
      m.resolutions["512"] = { frames: [{ timestamp: "00:00:02", file: "512/frame_00_00_02.jpg" }] };
      const updated = mergeFrames(m, "512", [
        { timestamp: "00:00:02", file: "512/frame_00_00_02.jpg" },
        { timestamp: "00:00:06", file: "512/frame_00_00_06.jpg" },
      ]);
      expect(updated.resolutions["512"].frames).toHaveLength(2);
      expect(updated.resolutions["512"].frames.map((f) => f.timestamp)).toEqual(["00:00:02", "00:00:06"]);
    });

    it("keeps different resolutions separate", () => {
      const m = createManifest("abc", "/test.mp4");
      const m1 = mergeFrames(m, "512", [{ timestamp: "00:00:02", file: "512/frame_00_00_02.jpg" }]);
      const m2 = mergeFrames(m1, "1024", [{ timestamp: "00:00:02", file: "1024/frame_00_00_02.jpg" }]);
      expect(Object.keys(m2.resolutions)).toEqual(["512", "1024"]);
    });
  });

  describe("getUncachedTimestamps", () => {
    it("returns all timestamps when nothing is cached", () => {
      const m = createManifest("abc", "/test.mp4");
      expect(getUncachedTimestamps(m, "512", ["00:00:02", "00:00:04"])).toEqual(["00:00:02", "00:00:04"]);
    });

    it("excludes already-cached timestamps", () => {
      const m = createManifest("abc", "/test.mp4");
      m.resolutions["512"] = { frames: [{ timestamp: "00:00:02", file: "512/frame_00_00_02.jpg" }] };
      expect(getUncachedTimestamps(m, "512", ["00:00:02", "00:00:04"])).toEqual(["00:00:04"]);
    });

    it("returns all when resolution bucket does not exist", () => {
      const m = createManifest("abc", "/test.mp4");
      m.resolutions["512"] = { frames: [{ timestamp: "00:00:02", file: "x" }] };
      expect(getUncachedTimestamps(m, "1024", ["00:00:02"])).toEqual(["00:00:02"]);
    });
  });

  describe("sampleFrameIndices", () => {
    it("returns all indices when count >= total", () => {
      expect(sampleFrameIndices(5, 10)).toEqual([0, 1, 2, 3, 4]);
    });
    it("returns evenly spaced indices", () => {
      expect(sampleFrameIndices(10, 3)).toEqual([0, 5, 9]);
    });
    it("returns single index for count=1", () => {
      expect(sampleFrameIndices(10, 1)).toEqual([0]);
    });
    it("returns empty for totalFrames=0", () => {
      expect(sampleFrameIndices(0, 3)).toEqual([]);
    });
  });
});
