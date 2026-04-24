import type { AudioResult, AudioTag, TranscriptionSegment } from "../types.js";

export function parseHMS(timestamp: string): number {
  const parts = timestamp.split(":").map(Number);
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) {
    throw new Error(`Invalid HH:MM:SS timestamp: ${timestamp}`);
  }
  const [h, m, s] = parts;
  return h * 3600 + m * 60 + s;
}

export function formatHMS(seconds: number): string {
  const clamped = Math.max(0, seconds);
  const h = Math.floor(clamped / 3600);
  const m = Math.floor((clamped % 3600) / 60);
  const s = Math.floor(clamped % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function shiftAudioResult(
  result: AudioResult,
  offsetSeconds: number,
): AudioResult {
  if (offsetSeconds === 0) {
    return result;
  }

  const shiftSegment = <T extends TranscriptionSegment | AudioTag>(entry: T): T => ({
    ...entry,
    start: formatHMS(parseHMS(entry.start) + offsetSeconds),
    end: formatHMS(parseHMS(entry.end) + offsetSeconds),
  });

  return {
    ...result,
    transcription: result.transcription.map(shiftSegment),
    audio_tags: result.audio_tags.map(shiftSegment),
  };
}
