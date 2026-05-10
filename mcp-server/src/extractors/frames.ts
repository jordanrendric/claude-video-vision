import { execFile } from "child_process";
import { promisify } from "util";
import { readFileSync, readdirSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import type { VideoMetadata, Frame, FrameFormat, Segment } from "../types.js";
import { formatHMS, parseHMS } from "../utils/timestamps.js";

const execFileAsync = promisify(execFile);

export async function getVideoMetadata(videoPath: string): Promise<VideoMetadata> {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v", "quiet",
    "-print_format", "json",
    "-show_format",
    "-show_streams",
    videoPath,
  ]);

  const probe = JSON.parse(stdout);
  const videoStream = probe.streams.find((s: any) => s.codec_type === "video");
  const audioStream = probe.streams.find((s: any) => s.codec_type === "audio");
  const format = probe.format;

  const durationSec = parseFloat(format.duration || videoStream?.duration || "0");
  const minutes = Math.floor(durationSec / 60);
  const seconds = Math.floor(durationSec % 60);
  const duration = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;

  const fileSizeBytes = parseInt(format.size || "0", 10);
  const fileSizeMB = (fileSizeBytes / (1024 * 1024)).toFixed(1);

  const fpsStr = videoStream?.r_frame_rate || "30/1";
  const [num, den] = fpsStr.split("/").map(Number);
  const originalFps = Math.round(num / (den || 1));

  return {
    duration,
    duration_seconds: durationSec,
    resolution: `${videoStream?.width || 0}x${videoStream?.height || 0}`,
    width: videoStream?.width || 0,
    height: videoStream?.height || 0,
    codec: videoStream?.codec_name || "unknown",
    original_fps: originalFps,
    file_size: `${fileSizeMB}MB`,
    has_audio: !!audioStream,
  };
}

export function calculateAutoFps(durationSeconds: number): number {
  if (durationSeconds < 60) return 2;
  if (durationSeconds < 300) return 1;
  if (durationSeconds < 900) return 0.5;
  if (durationSeconds < 3600) return 0.2;
  return 0.1;
}

export interface ExtractFramesOptions {
  fps: number;
  resolution: number;
  outputDir: string;
  format?: FrameFormat;
  startTime?: string;
  endTime?: string;
  maxFrames?: number;
}

export function frameFormatExtension(format: FrameFormat): string {
  return format === "jpeg" ? "jpg" : format;
}

export function frameFormatMimeType(format: FrameFormat): string {
  return `image/${format}`;
}

function frameQualityArgs(format: FrameFormat): string[] {
  if (format === "jpeg") return ["-q:v", "5"];
  if (format === "webp") return ["-quality", "80"];
  return [];
}

function isMissingWebpEncoderError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes("codec webp") &&
    (message.includes("encoder not found") ||
      message.includes("error selecting an encoder") ||
      message.includes("encoder for format image2") ||
      message.includes("disabled"))
  );
}

export async function extractFrames(
  videoPath: string,
  options: ExtractFramesOptions,
): Promise<Frame[]> {
  const {
    fps,
    resolution,
    outputDir,
    format = "jpeg",
    startTime,
    endTime,
    maxFrames = 100,
  } = options;
  const extension = frameFormatExtension(format);

  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  const args: string[] = [];

  if (startTime) {
    args.push("-ss", startTime);
  }

  args.push("-i", videoPath);

  if (endTime) {
    args.push("-to", endTime);
  }

  args.push(
    "-vf", `fps=${fps},scale=${resolution}:-1`,
    "-frames:v", String(maxFrames),
    ...frameQualityArgs(format),
    join(outputDir, `frame_%04d.${extension}`),
  );

  try {
    await execFileAsync("ffmpeg", args);
  } catch (error) {
    if (format === "webp" && isMissingWebpEncoderError(error)) {
      throw new Error(
        "WebP frame extraction requires an ffmpeg build with a WebP encoder (libwebp). " +
          "Use frame_format='jpeg' or frame_format='png', or install an ffmpeg build such as ffmpeg-full.",
        { cause: error },
      );
    }
    throw error;
  }

  const files = readdirSync(outputDir)
    .filter((f) => f.startsWith("frame_") && f.endsWith(`.${extension}`))
    .sort();

  const offsetSeconds = startTime ? parseHMS(startTime) : 0;

  return files.map((file, index) => {
    const filePath = join(outputDir, file);
    const imageData = readFileSync(filePath);
    const base64 = imageData.toString("base64");
    const timestamp = formatHMS(offsetSeconds + index / fps);

    return {
      timestamp,
      image: base64,
      format,
      sourcePath: filePath,
    };
  });
}

// ---------------------------------------------------------------------------
// Segment-based frame extraction
// ---------------------------------------------------------------------------

export interface SegmentFrame extends Frame {
  resolution: number;
}

/**
 * Generates HH:MM:SS timestamp strings for every sample point within a
 * segment according to the segment's fps setting.
 *
 * The range is [start, end) — the end boundary is exclusive so that a segment
 * ending exactly at the next segment's start time never overlaps.
 */
export function generateTimestampsForSegment(segment: Segment): string[] {
  const startSec = parseHMS(segment.start);
  const endSec = parseHMS(segment.end);
  const interval = 1 / segment.fps;
  const timestamps: string[] = [];

  for (let t = startSec; t < endSec; t += interval) {
    timestamps.push(formatHMS(Math.round(t)));
  }

  return timestamps;
}

/**
 * Extracts frames for an ordered list of segments, each potentially at a
 * different resolution and fps.  Frames from each segment are written into a
 * sub-directory named after their resolution so they never collide.
 */
export async function extractFramesBySegments(
  videoPath: string,
  segments: Segment[],
  baseOutputDir: string,
  format: FrameFormat = "jpeg",
): Promise<SegmentFrame[]> {
  const allFrames: SegmentFrame[] = [];

  for (const segment of segments) {
    const resolution = segment.resolution ?? 512;
    const resDir = join(baseOutputDir, String(resolution));

    if (!existsSync(resDir)) mkdirSync(resDir, { recursive: true });

    const frames = await extractFrames(videoPath, {
      fps: segment.fps,
      resolution,
      outputDir: resDir,
      format,
      startTime: segment.start,
      endTime: segment.end,
      maxFrames: 1000,
    });

    for (const frame of frames) {
      allFrames.push({ ...frame, resolution });
    }
  }

  return allFrames;
}
