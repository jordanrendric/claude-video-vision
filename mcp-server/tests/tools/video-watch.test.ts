import { describe, it, expect } from "vitest";
import { deriveFps } from "../../src/tools/video-watch.js";

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
