import { join } from "path";
import type { AnalysisFilters, SceneChange, Interval } from "../types.js";
import { formatHMS } from "../utils/timestamps.js";

// ---------------------------------------------------------------------------
// Command builder
// ---------------------------------------------------------------------------

export interface AnalysisCommandResult {
  args: string[];
  videoMetaFile: string;
  audioMetaFile: string;
}

/**
 * Builds an ffmpeg args array that runs the selected lavfi filter pipeline and
 * writes per-frame metadata to files.  Transcription is NOT an ffmpeg filter —
 * the caller must handle it separately.
 *
 * Returns `null` when no ffmpeg-based filter is selected.
 */
export function buildAnalysisCommand(
  videoPath: string,
  filters: AnalysisFilters,
  workDir: string,
): AnalysisCommandResult | null {
  const videoMetaFile = join(workDir, "video_meta.txt");
  const audioMetaFile = join(workDir, "audio_meta.txt");

  // Video filter chain
  const videoFilters: string[] = [];

  if (filters.scene_changes) {
    videoFilters.push("scdet=threshold=10");
  }
  if (filters.black_intervals) {
    videoFilters.push("blackdetect=d=0.1:pic_th=0.98:pix_th=0.10");
  }
  if (filters.freeze) {
    videoFilters.push("freezedetect=n=-60dB:d=2");
  }
  if (filters.motion) {
    videoFilters.push("siti=print_summary=1");
  }

  if (filters.blur) {
    videoFilters.push("blurdetect");
  }
  if (filters.exposure) {
    videoFilters.push("signalstats");
  }

  // Always append metadata sink when any video filter is active —
  // scdet, blurdetect, signalstats all write to frame metadata
  if (videoFilters.length > 0) {
    videoFilters.push(`metadata=mode=print:file=${videoMetaFile}`);
  }

  // Audio filter chain
  const audioFilters: string[] = [];

  if (filters.silence) {
    audioFilters.push("silencedetect=n=-40dB:d=0.5");
  }
  if (filters.loudness) {
    audioFilters.push("ebur128=metadata=1");
  }

  if (audioFilters.length > 0) {
    audioFilters.push(`ametadata=mode=print:file=${audioMetaFile}`);
  }

  const hasVideoFilters = videoFilters.length > 0;
  const hasAudioFilters = audioFilters.length > 0;

  if (!hasVideoFilters && !hasAudioFilters) {
    return null;
  }

  // Build args
  const args: string[] = ["-i", videoPath, "-y"];

  if (hasVideoFilters) {
    args.push("-vf", videoFilters.join(","));
  }

  if (hasAudioFilters) {
    args.push("-af", audioFilters.join(","));
  }

  // Discard output — we only care about stderr / metadata files
  args.push("-f", "null", "-");

  return { args, videoMetaFile, audioMetaFile };
}

// ---------------------------------------------------------------------------
// Parser functions
// ---------------------------------------------------------------------------

export function parseScdetOutput(stderr: string): SceneChange[] {
  const results: SceneChange[] = [];
  const re = /lavfi\.scd\.score=([\d.]+)\s+lavfi\.scd\.time=([\d.]+)/g;
  let match: RegExpExecArray | null;

  while ((match = re.exec(stderr)) !== null) {
    results.push({
      score: parseFloat(match[1]),
      time: formatHMS(parseFloat(match[2])),
    });
  }

  return results;
}

export function parseScdetFromMetaFile(content: string, threshold: number = 2): SceneChange[] {
  const results: SceneChange[] = [];
  let currentPtsTime: number | null = null;

  for (const line of content.split("\n")) {
    const ptsMatch = line.match(/pts_time:([\d.]+)/);
    if (ptsMatch) currentPtsTime = parseFloat(ptsMatch[1]);

    const scoreMatch = line.match(/lavfi\.scd\.score=([\d.]+)/);
    if (scoreMatch && currentPtsTime !== null) {
      const score = parseFloat(scoreMatch[1]);
      if (score >= threshold) {
        results.push({ time: formatHMS(currentPtsTime), score });
      }
    }
  }

  return results;
}

export function parseBlackdetectOutput(stderr: string): Interval[] {
  const results: Interval[] = [];
  const re = /black_start:([\d.]+)\s+black_end:([\d.]+)\s+black_duration:([\d.]+)/g;
  let match: RegExpExecArray | null;

  while ((match = re.exec(stderr)) !== null) {
    results.push({
      start: formatHMS(parseFloat(match[1])),
      end: formatHMS(parseFloat(match[2])),
      duration: parseFloat(match[3]),
    });
  }

  return results;
}

export function parseSilenceOutput(stderr: string): Interval[] {
  const results: Interval[] = [];

  const startRe = /silence_start:\s*([\d.]+)/g;
  const endRe = /silence_end:\s*([\d.]+)\s*\|\s*silence_duration:\s*([\d.]+)/g;

  const starts: number[] = [];
  const ends: Array<{ t: number; d: number }> = [];

  let m: RegExpExecArray | null;

  while ((m = startRe.exec(stderr)) !== null) starts.push(parseFloat(m[1]));
  while ((m = endRe.exec(stderr)) !== null) ends.push({ t: parseFloat(m[1]), d: parseFloat(m[2]) });

  const count = Math.min(starts.length, ends.length);
  for (let i = 0; i < count; i++) {
    results.push({
      start: formatHMS(starts[i]),
      end: formatHMS(ends[i].t),
      duration: ends[i].d,
    });
  }

  // Edge case: clip ended inside a silence block
  if (starts.length > ends.length) {
    for (let i = ends.length; i < starts.length; i++) {
      results.push({ start: formatHMS(starts[i]), end: formatHMS(starts[i]), duration: 0 });
    }
  }

  return results;
}

export function parseFreezeOutput(stderr: string): Interval[] {
  const results: Interval[] = [];

  const startRe = /freeze_start:\s*([\d.]+)/g;
  const endRe = /freeze_end:\s*([\d.]+)/g;
  const durRe = /freeze_duration:\s*([\d.]+)/g;

  const starts: number[] = [];
  const ends: number[] = [];
  const durations: number[] = [];

  let m: RegExpExecArray | null;
  while ((m = startRe.exec(stderr)) !== null) starts.push(parseFloat(m[1]));
  while ((m = endRe.exec(stderr)) !== null) ends.push(parseFloat(m[1]));
  while ((m = durRe.exec(stderr)) !== null) durations.push(parseFloat(m[1]));

  for (let i = 0; i < starts.length; i++) {
    results.push({
      start: formatHMS(starts[i]),
      end: formatHMS(ends[i] ?? starts[i] + (durations[i] ?? 0)),
      duration: durations[i] ?? 0,
    });
  }

  return results;
}

export function parseSitiOutput(stderr: string): { siAvg?: number; tiAvg?: number } {
  const siMatch = stderr.match(/Spatial Information:\s*\n\s*Average:\s*([\d.]+)/);
  const tiMatch = stderr.match(/Temporal Information:\s*\n\s*Average:\s*([\d.]+)/);

  if (siMatch || tiMatch) {
    return {
      siAvg: siMatch ? parseFloat(siMatch[1]) : undefined,
      tiAvg: tiMatch ? parseFloat(tiMatch[1]) : undefined,
    };
  }

  // Fallback: per-frame metadata entries
  const siValues: number[] = [];
  const tiValues: number[] = [];

  const siRe = /lavfi\.siti\.si=([\d.]+)/g;
  const tiRe = /lavfi\.siti\.ti=([\d.]+)/g;

  let m: RegExpExecArray | null;
  while ((m = siRe.exec(stderr)) !== null) siValues.push(parseFloat(m[1]));
  while ((m = tiRe.exec(stderr)) !== null) tiValues.push(parseFloat(m[1]));

  const avg = (arr: number[]): number | undefined =>
    arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : undefined;

  return { siAvg: avg(siValues), tiAvg: avg(tiValues) };
}

export function parseBlurOutput(
  metaFileContent: string,
): Array<{ timestamp: string; blur: number }> {
  const results: Array<{ timestamp: string; blur: number }> = [];
  const frameRe = /# frame:\d+.*?pts_time:([\d.]+)([\s\S]*?)(?=# frame:|$)/g;
  const blurRe = /lavfi\.blur=([\d.]+)/;

  let m: RegExpExecArray | null;
  while ((m = frameRe.exec(metaFileContent)) !== null) {
    const blurMatch = blurRe.exec(m[2]);
    if (blurMatch) {
      results.push({ timestamp: formatHMS(parseFloat(m[1])), blur: parseFloat(blurMatch[1]) });
    }
  }

  return results;
}

export function parseSignalstatsOutput(
  metaFileContent: string,
): Array<{ timestamp: string; brightness?: number; saturation?: number }> {
  const results: Array<{ timestamp: string; brightness?: number; saturation?: number }> = [];
  const frameRe = /# frame:\d+.*?pts_time:([\d.]+)([\s\S]*?)(?=# frame:|$)/g;
  const yAvgRe = /lavfi\.signalstats\.YAVG=([\d.]+)/;
  const uAvgRe = /lavfi\.signalstats\.UAVG=([\d.]+)/;
  const vAvgRe = /lavfi\.signalstats\.VAVG=([\d.]+)/;

  let m: RegExpExecArray | null;
  while ((m = frameRe.exec(metaFileContent)) !== null) {
    const block = m[2];
    const yMatch = yAvgRe.exec(block);
    const uMatch = uAvgRe.exec(block);
    const vMatch = vAvgRe.exec(block);

    const brightness = yMatch ? parseFloat(yMatch[1]) : undefined;
    let saturation: number | undefined;
    if (uMatch && vMatch) {
      const u = parseFloat(uMatch[1]) - 128;
      const v = parseFloat(vMatch[1]) - 128;
      saturation = Math.sqrt(u * u + v * v);
    }

    results.push({ timestamp: formatHMS(parseFloat(m[1])), brightness, saturation });
  }

  return results;
}

export function parseEbur128Output(
  stderr: string,
): { mean_lufs: number; range_lu: number } | undefined {
  const integratedRe = /I:\s*([-\d.]+)\s*LUFS/i;
  const rangeRe = /LRA:\s*([\d.]+)\s*LU/i;

  const intMatch = integratedRe.exec(stderr);
  const rangeMatch = rangeRe.exec(stderr);

  if (!intMatch || !rangeMatch) return undefined;

  return {
    mean_lufs: parseFloat(intMatch[1]),
    range_lu: parseFloat(rangeMatch[1]),
  };
}

// ---------------------------------------------------------------------------
// Content profile derivation
// ---------------------------------------------------------------------------

export function deriveContentProfile(siAvg?: number, tiAvg?: number): string {
  if (siAvg === undefined && tiAvg === undefined) {
    return "unknown (no motion analysis data)";
  }

  const siClass =
    siAvg === undefined ? "unknown" : siAvg > 50 ? "high" : siAvg > 25 ? "moderate" : "low";
  const tiClass =
    tiAvg === undefined ? "unknown" : tiAvg > 30 ? "high" : tiAvg > 10 ? "moderate" : "low";

  const descriptions: Record<string, Record<string, string>> = {
    high: {
      high: "high visual complexity, high motion (busy action scenes)",
      moderate: "high visual complexity, moderate motion (detailed moving shots)",
      low: "high visual complexity, low motion (detailed static shots)",
      unknown: "high visual complexity, unknown motion",
    },
    moderate: {
      high: "moderate visual complexity, high motion (action with mid-detail scenes)",
      moderate: "moderate visual complexity, moderate motion (typical narrative content)",
      low: "moderate visual complexity, low motion (static mid-detail shots)",
      unknown: "moderate visual complexity, unknown motion",
    },
    low: {
      high: "low visual complexity, high motion (simple fast-moving scenes or animations)",
      moderate: "low visual complexity, moderate motion (simple scenes with some movement)",
      low: "low visual complexity, low motion (simple static shots, slides, or graphics)",
      unknown: "low visual complexity, unknown motion",
    },
    unknown: {
      high: "unknown visual complexity, high motion",
      moderate: "unknown visual complexity, moderate motion",
      low: "unknown visual complexity, low motion",
      unknown: "unknown content profile",
    },
  };

  return descriptions[siClass]?.[tiClass] ?? "unknown content profile";
}
