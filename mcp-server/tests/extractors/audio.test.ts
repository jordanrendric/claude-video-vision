import { describe, it, expect, afterEach } from "vitest";
import { extractAudio } from "../../src/extractors/audio.js";
import { join } from "path";
import { rmSync, existsSync } from "fs";
import { tmpdir } from "os";

const FIXTURE = join(import.meta.dirname, "../fixtures/test-3s.mp4");
const OUT_DIR = join(tmpdir(), "cvv-audio-test-" + Date.now());

describe("audio extraction", () => {
  afterEach(() => {
    if (existsSync(OUT_DIR)) rmSync(OUT_DIR, { recursive: true, force: true });
  });

  it("extracts audio as WAV file", async () => {
    const wavPath = await extractAudio(FIXTURE, OUT_DIR);
    expect(existsSync(wavPath)).toBe(true);
    expect(wavPath.endsWith(".wav")).toBe(true);
  });

  it("supports start_time and end_time", async () => {
    const wavPath = await extractAudio(FIXTURE, OUT_DIR, {
      startTime: "00:00:00",
      endTime: "00:00:02",
    });
    expect(existsSync(wavPath)).toBe(true);
  });
});
