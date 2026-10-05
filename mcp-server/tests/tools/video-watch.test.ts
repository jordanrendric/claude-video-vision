import { describe, it, expect, afterEach } from "vitest";
import { join } from "path";
import { tmpdir } from "os";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { deriveFps, persistFramesToSession } from "../../src/tools/video-watch.js";
import { createManifest } from "../../src/session/manifest.js";

describe("persistFramesToSession", () => {
  let root: string;

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it("copies each frame to a timestamp-named file and indexes that copy", () => {
    root = mkdtempSync(join(tmpdir(), "cvv-persist-test-"));
    const sessionDir = join(root, "session");
    // Two segments extracted separately: ffmpeg names both outputs frame_0001.
    const segA = join(root, "work", "seg-a");
    const segB = join(root, "work", "seg-b");
    mkdirSync(segA, { recursive: true });
    mkdirSync(segB, { recursive: true });
    writeFileSync(join(segA, "frame_0001.png"), "frame-a");
    writeFileSync(join(segB, "frame_0001.png"), "frame-b");

    const manifest = persistFramesToSession(createManifest("hash", "/video.mp4"), sessionDir, "png", [
      { timestamp: "00:01:29", resolution: 256, sourcePath: join(segA, "frame_0001.png") },
      { timestamp: "00:01:33", resolution: 256, sourcePath: join(segB, "frame_0001.png") },
    ]);
    rmSync(join(root, "work"), { recursive: true, force: true });

    const resDir = join(sessionDir, "frames", "png", "256");
    expect(manifest.resolutions["256/png"].frames).toEqual([
      { timestamp: "00:01:29", file: join(resDir, "00-01-29.png") },
      { timestamp: "00:01:33", file: join(resDir, "00-01-33.png") },
    ]);
    expect(readFileSync(join(resDir, "00-01-29.png"), "utf8")).toBe("frame-a");
    expect(readFileSync(join(resDir, "00-01-33.png"), "utf8")).toBe("frame-b");
  });
});

describe("deriveFps", () => {
  it("respects explicit numeric fps", () => {
    expect(deriveFps({ fps: 2, duration_seconds: 100 })).toBe(2);
    expect(deriveFps({ fps: 0.5, duration_seconds: 1000 })).toBe(0.5);
  });

  it("uses calculateAutoFps when no view_sample and fps=auto", () => {
    // calculateAutoFps for short video (e.g. 10s) gives a higher fps; we just
    // verify that the auto path is taken (returns a non-derived value).
    const result = deriveFps({ fps: "auto", duration_seconds: 100 });
    expect(typeof result).toBe("number");
    expect(result).toBeGreaterThan(0);
  });

  it("derives fps from view_sample / active duration when fps=auto and view_sample set", () => {
    // 36-min video, view_sample=8 → fps = 8 / 2184 ≈ 0.00366
    const result = deriveFps({ fps: "auto", view_sample: 8, duration_seconds: 2184 });
    expect(result).toBeCloseTo(8 / 2184, 6);
  });

  it("respects start_time and end_time when computing active duration", () => {
    // 36-min video, range 5:00-15:00 (600s), view_sample=10 → fps = 10 / 600
    const result = deriveFps({
      fps: "auto",
      view_sample: 10,
      start_time: "00:05:00",
      end_time: "00:15:00",
      duration_seconds: 2184,
    });
    expect(result).toBeCloseTo(10 / 600, 6);
  });

  it("uses calculateAutoFps when view_sample is set but segments are also provided", () => {
    // Per-segment fps overrides; the view_sample-derived fps shouldn't apply.
    const result = deriveFps({
      fps: "auto",
      view_sample: 8,
      segments: [{ start: "00:00:00", end: "00:01:00" }],
      duration_seconds: 2184,
    });
    // Should fall through to calculateAutoFps, not 8/2184
    expect(result).not.toBeCloseTo(8 / 2184, 6);
  });

  it("clamps active duration to minimum 1 second to avoid div-by-zero", () => {
    // start == end edge case
    const result = deriveFps({
      fps: "auto",
      view_sample: 5,
      start_time: "00:00:30",
      end_time: "00:00:30",
      duration_seconds: 100,
    });
    expect(result).toBe(5); // 5 / 1
  });
});
