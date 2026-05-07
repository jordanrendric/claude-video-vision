import { describe, it, expect } from "vitest";
import { existsSync, mkdirSync, writeFileSync, rmSync, utimesSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  buildCaptionAudioResult,
  cleanExpiredDownloads,
  getCaptionFallbackReason,
  isYouTubeUrl,
  parseSubtitleContent,
  resolveVideoInput,
  validateVideoPath,
} from "../../src/utils/video-source.js";

describe("video source resolution", () => {
  it("recognizes supported YouTube URL forms", () => {
    expect(isYouTubeUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe(true);
    expect(isYouTubeUrl("https://youtu.be/dQw4w9WgXcQ")).toBe(true);
    expect(isYouTubeUrl("https://www.youtube.com/shorts/dQw4w9WgXcQ")).toBe(true);
    expect(isYouTubeUrl("https://www.youtube.com/live/dQw4w9WgXcQ")).toBe(true);
    expect(isYouTubeUrl("https://example.com/video.mp4")).toBe(false);
    expect(isYouTubeUrl("/tmp/video.mp4")).toBe(false);
  });

  it("validates local file paths", () => {
    const file = join(tmpdir(), `cvv-video-source-${Date.now()}.mp4`);
    writeFileSync(file, "not a real video, just a path validation fixture");
    try {
      expect(validateVideoPath(file)).toBe(file);
    } finally {
      rmSync(file, { force: true });
    }
  });

  it("rejects non-YouTube URL inputs before download", async () => {
    await expect(resolveVideoInput("https://example.com/video.mp4")).rejects.toThrow(
      "YouTube URLs only",
    );
  });

  it("parses SRT captions into timestamped segments", () => {
    const parsed = parseSubtitleContent(`1
00:00:00,000 --> 00:00:03,280
Intent engineering is the third

2
00:00:03,280 --> 00:00:07,480
discipline &amp; the one nobody is building for yet.
`);

    expect(parsed).toEqual([
      { start: "00:00:00", end: "00:00:03", text: "Intent engineering is the third" },
      { start: "00:00:03", end: "00:00:07", text: "discipline & the one nobody is building for yet." },
    ]);
  });

  it("accepts captions that cover enough of the video", () => {
    expect(
      getCaptionFallbackReason({
        source: "automatic_captions",
        language: "en",
        transcription: [{ start: "00:00:00", end: "00:00:45", text: "hello" }],
        coverage_seconds: 45,
      }, 46),
    ).toBeNull();
  });

  it("falls back when captions cover too little of a longer video", () => {
    expect(
      getCaptionFallbackReason({
        source: "automatic_captions",
        language: "en",
        transcription: [{ start: "00:00:00", end: "00:00:10", text: "hello" }],
        coverage_seconds: 10,
      }, 60),
    ).toContain("cover only");
  });

  it("builds an AudioResult that labels manual vs automatic caption source", () => {
    const audio = buildCaptionAudioResult({
      source: "automatic_captions",
      language: "en",
      transcription: [{ start: "00:00:05", end: "00:00:08", text: "hello" }],
      coverage_seconds: 8,
    }, { startTime: "00:00:05" });

    expect(audio.backend).toBe("youtube-captions");
    expect(audio.transcription_source).toBe("youtube_auto_captions");
    expect(audio.transcription[0].start).toBe("00:00:00");
  });

  it("cleans downloaded videos older than the configured max age", () => {
    const dir = join(tmpdir(), `cvv-download-cleanup-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const oldFile = join(dir, "old.mp4");
    const newFile = join(dir, "new.mp4");
    writeFileSync(oldFile, "old");
    writeFileSync(newFile, "new");
    const oldDate = new Date(Date.now() - 8 * 86400_000);
    utimesSync(oldFile, oldDate, oldDate);

    try {
      cleanExpiredDownloads(dir, 7);
      expect(existsSync(oldFile)).toBe(false);
      expect(existsSync(newFile)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
