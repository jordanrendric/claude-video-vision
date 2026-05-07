import { execFile } from "child_process";
import { createHash } from "crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "fs";
import { homedir, tmpdir } from "os";
import { resolve, join } from "path";
import { promisify } from "util";
import type { AudioResult, TranscriptionSegment } from "../types.js";
import { formatHMS, parseHMS } from "./timestamps.js";

const execFileAsync = promisify(execFile);

const DOWNLOADS_DIR = join(homedir(), ".claude-video-vision", "downloads");

const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be",
]);

const MAX_DESCRIPTION_CHARS = 4000;

function validateRegularFile(filePath: string): string {
  if (!existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }
  const stat = statSync(filePath);
  if (!stat.isFile()) {
    throw new Error(`Path is not a regular file: ${filePath}`);
  }
  return filePath;
}

export interface VideoSourceMetadata {
  type: "youtube";
  url: string;
  title?: string;
  channel?: string;
  duration?: string;
  upload_date?: string;
  view_count?: number;
  description?: string;
  caption_track?: YouTubeCaptionTrackMetadata;
}

export interface ResolvedVideoInput {
  path: string;
  source?: VideoSourceMetadata;
  captions?: YouTubeCaptionResult;
}

export interface YouTubeCaptionTrackMetadata {
  source: "subtitles" | "automatic_captions";
  language: string;
  language_name?: string;
}

export interface YouTubeCaptionResult extends YouTubeCaptionTrackMetadata {
  transcription: TranscriptionSegment[];
  coverage_seconds: number;
}

export function isYouTubeUrl(input: string): boolean {
  try {
    const url = new URL(input);
    return (url.protocol === "http:" || url.protocol === "https:") && YOUTUBE_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

export function validateVideoPath(inputPath: string): string {
  return validateRegularFile(resolve(inputPath));
}

function cachePrefixForUrl(url: string): string {
  return createHash("sha256").update(url).digest("hex").slice(0, 12);
}

function truncateDescription(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  if (value.length <= MAX_DESCRIPTION_CHARS) return value;
  return `${value.slice(0, MAX_DESCRIPTION_CHARS)}\n\n[description truncated]`;
}

function parseSubtitleTimestamp(raw: string): number {
  const match = raw.trim().match(/(?:(\d+):)?(\d{2}):(\d{2})[,.](\d{3})/);
  if (!match) return 0;
  const hours = Number(match[1] ?? 0);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const millis = Number(match[4]);
  return hours * 3600 + minutes * 60 + seconds + millis / 1000;
}

function decodeSubtitleText(text: string): string {
  return text
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseSubtitleContent(raw: string): TranscriptionSegment[] {
  const normalized = raw.replace(/\r/g, "");
  const blocks = normalized.split(/\n{2,}/);
  const transcription: TranscriptionSegment[] = [];

  for (const block of blocks) {
    const lines = block
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    const timingIndex = lines.findIndex((line) => line.includes("-->"));
    if (timingIndex === -1) continue;

    const [startRaw, endRaw] = lines[timingIndex].split("-->").map((part) => part.trim());
    if (!startRaw || !endRaw) continue;

    const text = decodeSubtitleText(lines.slice(timingIndex + 1).join(" "));
    if (!text) continue;

    transcription.push({
      start: formatHMS(parseSubtitleTimestamp(startRaw)),
      end: formatHMS(parseSubtitleTimestamp(endRaw)),
      text,
    });
  }

  return transcription;
}

export function cleanExpiredDownloads(downloadsDir: string, maxAgeDays: number): void {
  if (!existsSync(downloadsDir)) return;

  const cutoff = Date.now() - maxAgeDays * 86400_000;
  for (const entry of readdirSync(downloadsDir)) {
    const filePath = join(downloadsDir, entry);
    try {
      const stat = statSync(filePath);
      if (!stat.isFile()) continue;
      if (stat.mtimeMs < cutoff) {
        rmSync(filePath, { force: true });
      }
    } catch {
      rmSync(filePath, { force: true });
    }
  }
}

function findDownloadedPath(stdout: string): string | null {
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (existsSync(line) && statSync(line).isFile()) {
      return line;
    }
  }

  return null;
}

async function downloadYouTubeVideo(url: string): Promise<string> {
  mkdirSync(DOWNLOADS_DIR, { recursive: true });

  const prefix = cachePrefixForUrl(url);
  const outputTemplate = `${prefix}-%(id)s.%(ext)s`;

  try {
    const { stdout } = await execFileAsync(
      "yt-dlp",
      [
        "--no-playlist",
        "--no-warnings",
        "--restrict-filenames",
        "--merge-output-format",
        "mp4",
        "-f",
        "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/bv*+ba/b",
        "--paths",
        DOWNLOADS_DIR,
        "-o",
        outputTemplate,
        "--print",
        "after_move:filepath",
        url,
      ],
      {
        timeout: 20 * 60 * 1000,
        maxBuffer: 10 * 1024 * 1024,
        encoding: "utf-8",
      },
    );

    const downloadedPath = findDownloadedPath(stdout);
    if (!downloadedPath) {
      throw new Error("yt-dlp completed but did not report a downloaded file path");
    }

    return validateRegularFile(downloadedPath);
  } catch (err: any) {
    if (err?.code === "ENOENT") {
      throw new Error("yt-dlp is required for YouTube URLs but was not found. Run /setup-video-vision for installation instructions.");
    }
    const detail = err?.stderr || err?.message || String(err);
    throw new Error(`Failed to download YouTube video with yt-dlp: ${detail}`);
  }
}

function chooseCaptionTrack(data: Record<string, unknown>): YouTubeCaptionTrackMetadata | null {
  const subtitles = data.subtitles as Record<string, unknown> | undefined;
  const automaticCaptions = data.automatic_captions as Record<string, unknown> | undefined;

  const preferredLanguages = ["en", "en-orig", "en-US", "en-GB"];

  for (const language of preferredLanguages) {
    if (subtitles?.[language]) {
      return { source: "subtitles", language };
    }
  }

  for (const language of Object.keys(subtitles ?? {})) {
    if (language.startsWith("en")) {
      return { source: "subtitles", language };
    }
  }

  for (const language of preferredLanguages) {
    if (automaticCaptions?.[language]) {
      return { source: "automatic_captions", language };
    }
  }

  for (const language of Object.keys(automaticCaptions ?? {})) {
    if (language.startsWith("en")) {
      return { source: "automatic_captions", language };
    }
  }

  return null;
}

async function fetchYouTubeInfo(url: string): Promise<{
  source: VideoSourceMetadata;
  captionTrack: YouTubeCaptionTrackMetadata | null;
}> {
  try {
    const { stdout } = await execFileAsync(
      "yt-dlp",
      ["--skip-download", "--no-playlist", "--dump-single-json", url],
      {
        timeout: 30_000,
        maxBuffer: 25 * 1024 * 1024,
        encoding: "utf-8",
      },
    );
    const data = JSON.parse(stdout) as Record<string, unknown>;
    const captionTrack = chooseCaptionTrack(data);
    return {
      source: {
        type: "youtube",
        url,
        title: typeof data.title === "string" ? data.title : undefined,
        channel: typeof data.channel === "string" ? data.channel : undefined,
        duration: typeof data.duration_string === "string" ? data.duration_string : undefined,
        upload_date: typeof data.upload_date === "string" ? data.upload_date : undefined,
        view_count: typeof data.view_count === "number" ? data.view_count : undefined,
        description: truncateDescription(data.description),
        caption_track: captionTrack ?? undefined,
      },
      captionTrack,
    };
  } catch {
    return { source: { type: "youtube", url }, captionTrack: null };
  }
}

async function fetchYouTubeCaptions(
  url: string,
  captionTrack: YouTubeCaptionTrackMetadata | null,
): Promise<YouTubeCaptionResult | null> {
  if (!captionTrack) return null;

  const workDir = join(tmpdir(), `cvv-youtube-captions-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(workDir, { recursive: true });

  try {
    const args = [
      "--skip-download",
      "--no-playlist",
      "--sub-langs",
      captionTrack.language,
      "--sub-format",
      "srt/vtt/best",
      "-o",
      join(workDir, "%(id)s.%(ext)s"),
    ];

    if (captionTrack.source === "subtitles") {
      args.push("--write-subs");
    } else {
      args.push("--write-auto-subs");
    }
    args.push(url);

    await execFileAsync("yt-dlp", args, {
      timeout: 60_000,
      maxBuffer: 10 * 1024 * 1024,
      encoding: "utf-8",
    });

    // yt-dlp names files with the video id, which is not known here for all URL
    // forms. Scan the temporary directory as a fallback.
    const candidateExtensions = ["srt", "vtt"];
    for (const file of readdirSync(workDir)) {
      if (candidateExtensions.some((ext) => file.endsWith(`.${ext}`))) {
        const transcription = parseSubtitleContent(readFileSync(join(workDir, file), "utf-8"));
        return {
          ...captionTrack,
          transcription,
          coverage_seconds: getTranscriptCoverageSeconds(transcription),
        };
      }
    }

    return null;
  } catch {
    return null;
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

export function getTranscriptCoverageSeconds(transcription: TranscriptionSegment[]): number {
  let maxEnd = 0;
  for (const segment of transcription) {
    try {
      maxEnd = Math.max(maxEnd, parseHMS(segment.end));
    } catch {
      // Ignore malformed timestamps from external captions.
    }
  }
  return maxEnd;
}

export function getCaptionFallbackReason(
  captions: YouTubeCaptionResult | undefined,
  durationSeconds: number,
): string | null {
  if (!captions) return "no YouTube caption track found";
  if (captions.transcription.length === 0) return "YouTube caption track was empty";
  const coverageRatio = durationSeconds > 0 ? captions.coverage_seconds / durationSeconds : 1;
  if (durationSeconds >= 30 && coverageRatio < 0.5) {
    return `YouTube captions cover only ${Math.round(coverageRatio * 100)}% of the video`;
  }
  return null;
}

export function buildCaptionAudioResult(
  captions: YouTubeCaptionResult,
  range?: { startTime?: string; endTime?: string },
): AudioResult {
  const startSeconds = range?.startTime ? parseHMS(range.startTime) : 0;
  const endSeconds = range?.endTime ? parseHMS(range.endTime) : Number.POSITIVE_INFINITY;

  const transcription = captions.transcription
    .map((segment) => {
      const segmentStart = parseHMS(segment.start);
      const segmentEnd = parseHMS(segment.end);
      if (segmentEnd < startSeconds || segmentStart > endSeconds) return null;
      return {
        ...segment,
        start: formatHMS(Math.max(0, segmentStart - startSeconds)),
        end: formatHMS(Math.max(0, segmentEnd - startSeconds)),
      };
    })
    .filter((segment): segment is TranscriptionSegment => segment !== null);

  return {
    backend: "youtube-captions",
    transcription,
    audio_tags: [],
    full_analysis: null,
    transcription_source: captions.source === "subtitles" ? "youtube_subtitles" : "youtube_auto_captions",
    transcription_source_detail: `${captions.language} (${captions.source})`,
  };
}

export async function resolveVideoInputDetailed(input: string): Promise<ResolvedVideoInput> {
  if (isYouTubeUrl(input)) {
    const info = await fetchYouTubeInfo(input);
    const [path, captions] = await Promise.all([
      downloadYouTubeVideo(input),
      fetchYouTubeCaptions(input, info.captionTrack),
    ]);
    return { path, source: info.source, captions: captions ?? undefined };
  }

  if (/^https?:\/\//i.test(input)) {
    throw new Error("URL input currently supports YouTube URLs only. Download other videos locally first.");
  }

  return { path: validateVideoPath(input) };
}

export async function resolveVideoInput(input: string): Promise<string> {
  const resolvedInput = await resolveVideoInputDetailed(input);
  return resolvedInput.path;
}

export function getDownloadsDir(): string {
  return DOWNLOADS_DIR;
}
