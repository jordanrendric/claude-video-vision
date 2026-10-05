import { execFile } from "child_process";
import { promisify } from "util";
import { join } from "path";
import type { AnalysisFilters, AnalysisIncomplete, SceneChange, Interval } from "../types.js";
import { formatHMS } from "../utils/timestamps.js";

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Command builder
// ---------------------------------------------------------------------------

// lavfi filter values treat `:` as the argument separator and `\` as the
// escape character. On Windows a path like `C:\Users\...` breaks the parser
// twice (drive-letter colon and backslashes). Convert backslashes to forward
// slashes (ffmpeg accepts either) and escape the drive-letter colon.
//
// lavfi uses two levels of escape parsing inside ffmpeg (filtergraph level +
// filter-option-value level), so a literal `:` inside a value must arrive as
// `\\:` (two real backslashes + colon) in the argv string passed to ffmpeg.
// In a JS string literal that's "\\\\:" — four source characters representing
// two `\` characters.
//
// Unix paths are unaffected because they have no drive letter and no `\`.
function escapeLavfiPath(p: string): string {
  return p.replace(/\\/g, "/").replace(/^([A-Za-z]):/, "$1\\\\:");
}

/**
 * Default minimum scdet score for a scene change. Scores of 8+ correlate with
 * hard cuts; below that, handheld motion and fast pans inside a single shot
 * dominate (see #45).
 */
export const DEFAULT_SCDET_THRESHOLD = 8;

/** Resolves the scdet threshold for a filter selection, or null when off. */
export function sceneChangeThreshold(sceneChanges: AnalysisFilters["scene_changes"]): number | null {
  if (sceneChanges === false) return null;
  if (sceneChanges === true) return DEFAULT_SCDET_THRESHOLD;
  return sceneChanges.threshold;
}

export interface AnalysisCommandResult {
  args: string[];
  videoMetaFile: string;
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

  // Video filter chain
  const videoFilters: string[] = [];

  const scdetThreshold = sceneChangeThreshold(filters.scene_changes);
  if (scdetThreshold !== null) {
    videoFilters.push(`scdet=threshold=${scdetThreshold}`);
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
    videoFilters.push(`metadata=mode=print:file=${escapeLavfiPath(videoMetaFile)}`);
  }

  // Audio filter chain
  const audioFilters: string[] = [];

  if (filters.silence) {
    audioFilters.push("silencedetect=n=-40dB:d=0.5");
  }
  if (filters.loudness) {
    audioFilters.push("ebur128=metadata=1");
  }

  // Do not append `ametadata=mode=print:file=...` — it makes silencedetect's stderr events vanish.

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

  return { args, videoMetaFile };
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

const MIN_ANALYSIS_TIMEOUT_MS = 600_000;

/**
 * A single ffmpeg pass decodes the whole source, so long or high-resolution
 * files (e.g. a 2.5h UHD HEVC remux) need far more than a flat 10 minutes.
 * Allow processing as slow as 0.5x realtime before giving up.
 */
export function analysisTimeoutMs(durationSeconds: number): number {
  return Math.max(MIN_ANALYSIS_TIMEOUT_MS, Math.ceil(durationSeconds * 2) * 1000);
}

/** Last `time=HH:MM:SS.xx` progress stamp ffmpeg wrote to stderr, in seconds. */
export function parseFfmpegProgressTime(stderr: string): number | null {
  const re = /time=(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/g;
  let last: number | null = null;
  let match: RegExpExecArray | null;

  while ((match = re.exec(stderr)) !== null) {
    last = parseInt(match[1], 10) * 3600 + parseInt(match[2], 10) * 60 + parseFloat(match[3]);
  }

  return last;
}

type ExecFn = (
  file: string,
  args: string[],
  options: { timeout: number; maxBuffer: number },
) => Promise<{ stdout: string; stderr: string }>;

export interface AnalysisRun {
  stderr: string;
  incomplete?: AnalysisIncomplete;
}

/**
 * Runs the analysis command. A non-zero exit is tolerated (filters still
 * report on stderr), but a timeout kill is reported as `incomplete`: ffmpeg
 * flushes its metadata on SIGTERM, so a killed run otherwise looks like a
 * complete analysis that simply found nothing after the cut-off point.
 */
export async function runAnalysisCommand(
  args: string[],
  durationSeconds: number,
  exec: ExecFn = execFileAsync,
): Promise<AnalysisRun> {
  const timeout = analysisTimeoutMs(durationSeconds);

  try {
    const { stderr } = await exec("ffmpeg", args, { timeout, maxBuffer: 100 * 1024 * 1024 });
    return { stderr };
  } catch (err: any) {
    const stderr: string = err.stderr || "";
    if (!err.killed) return { stderr };

    const progress = parseFfmpegProgressTime(stderr);
    return {
      stderr,
      incomplete: {
        analyzed_until: formatHMS(progress ?? 0),
        reason:
          `ffmpeg analysis timed out after ${Math.round(timeout / 60_000)} min; ` +
          "results are complete up to analyzed_until; anything after it is missing or partial.",
      },
    };
  }
}

// ---------------------------------------------------------------------------
// Parser functions
// ---------------------------------------------------------------------------

export function parseScdetOutput(stderr: string, threshold: number = DEFAULT_SCDET_THRESHOLD): SceneChange[] {
  const results: SceneChange[] = [];
  // Older builds log `score=X time=Y`; current ones log `score: X, time: Y`.
  const re = /lavfi\.scd\.score[=:]\s*([\d.]+),?\s+lavfi\.scd\.time[=:]\s*([\d.]+)/g;
  let match: RegExpExecArray | null;

  while ((match = re.exec(stderr)) !== null) {
    const score = parseFloat(match[1]);
    if (score >= threshold) {
      results.push({
        score,
        time: formatHMS(parseFloat(match[2])),
      });
    }
  }

  return results;
}

export function parseScdetFromMetaFile(content: string, threshold: number = DEFAULT_SCDET_THRESHOLD): SceneChange[] {
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
