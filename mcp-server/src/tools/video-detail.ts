import { z } from "zod";
import { join } from "path";
import { homedir } from "os";
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadConfig } from "../config.js";
import { validateVideoPath } from "../utils/validation.js";
import { extractFramesBySegments } from "../extractors/frames.js";
import type { SegmentFrame } from "../extractors/frames.js";
import {
  getSessionDir,
  loadManifest,
  saveManifest,
  computeVideoHash,
} from "../session/manager.js";
import {
  createManifest,
  mergeFrames,
  sampleFrameIndices,
} from "../session/manifest.js";
import type { SessionManifest } from "../types.js";

const CONFIG_PATH = join(homedir(), ".claude-video-vision", "config.json");
const SESSIONS_DIR = join(homedir(), ".claude-video-vision", "sessions");

const HMS_REGEX = /^\d{2}:\d{2}:\d{2}$/;

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface ViewableFrame {
  timestamp: string;
  image?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Convert a HH:MM:SS timestamp to a filesystem-safe string (colons → dashes).
 */
function timestampToFilename(ts: string): string {
  return `${ts.replace(/:/g, "-")}.jpg`;
}

/**
 * Build the flat pool of frames available for viewing.
 *
 * Priority:
 * 1. Frames just extracted in this call (in-memory, no disk I/O needed).
 * 2. If nothing was extracted this call, fall back to reading all manifest
 *    frames from disk, deduplicating by timestamp and preferring the highest
 *    resolution available.
 */
function buildViewablePool(
  extractedFrames: SegmentFrame[],
  manifest: SessionManifest | null,
): ViewableFrame[] {
  if (extractedFrames.length > 0) {
    return extractedFrames.map((f) => ({
      timestamp: f.timestamp,
      image: f.image,
    }));
  }

  if (!manifest) return [];

  // Flatten all resolution buckets, deduplicate timestamps by highest res.
  const byTimestamp = new Map<string, { res: number; file: string }>();

  for (const [resStr, resData] of Object.entries(manifest.resolutions)) {
    const res = parseInt(resStr, 10);
    for (const entry of resData.frames) {
      const current = byTimestamp.get(entry.timestamp);
      if (!current || res > current.res) {
        byTimestamp.set(entry.timestamp, { res, file: entry.file });
      }
    }
  }

  return Array.from(byTimestamp.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([timestamp, { file }]) => {
      try {
        const data = readFileSync(file);
        return { timestamp, image: data.toString("base64") };
      } catch {
        // File missing from disk — still include the entry without image data.
        return { timestamp };
      }
    });
}

/**
 * Look up specific timestamps from the session manifest.
 * Prefers the highest-resolution copy available for each timestamp.
 */
function lookupTimestampsInManifest(
  manifest: SessionManifest,
  timestamps: string[],
): ViewableFrame[] {
  const result: ViewableFrame[] = [];

  for (const ts of timestamps) {
    let bestRes = -1;
    let bestFile: string | null = null;

    for (const [resStr, resData] of Object.entries(manifest.resolutions)) {
      const res = parseInt(resStr, 10);
      const entry = resData.frames.find((f) => f.timestamp === ts);
      if (entry && res > bestRes) {
        bestRes = res;
        bestFile = entry.file;
      }
    }

    if (bestFile !== null) {
      try {
        const data = readFileSync(bestFile);
        result.push({ timestamp: ts, image: data.toString("base64") });
      } catch {
        result.push({ timestamp: ts });
      }
    }
    // Timestamps not found are silently omitted — not an error.
  }

  return result;
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

export function registerVideoDetail(server: McpServer): void {
  server.tool(
    "video_detail",
    "Drill into specific segments of a video. Extracts frames at variable FPS/resolution per segment. Separates extraction from viewing: use segments to extract, view/view_sample to control which frames are returned as images. When enable_index is on, frames are cached and deduplicated across calls.",
    {
      path: z.string().describe("Absolute or relative path to the video file"),
      segments: z
        .array(
          z.object({
            start: z
              .string()
              .regex(HMS_REGEX, "Must be HH:MM:SS format"),
            end: z
              .string()
              .regex(HMS_REGEX, "Must be HH:MM:SS format"),
            fps: z.number().positive(),
            resolution: z.number().min(128).max(2048).optional(),
          }),
        )
        .optional()
        .describe("Segments to extract frames from"),
      view: z
        .array(z.string().regex(HMS_REGEX, "Must be HH:MM:SS format"))
        .optional()
        .describe(
          "Specific timestamps to return as images from the session cache",
        ),
      view_sample: z
        .number()
        .min(1)
        .optional()
        .describe("Return N evenly spaced frames from the extracted set"),
      skip_cached: z
        .boolean()
        .default(true)
        .describe(
          "Skip re-writing of frames already cached at the same resolution",
        ),
    },
    async (params) => {
      // ------------------------------------------------------------------
      // Setup
      // ------------------------------------------------------------------
      const config = loadConfig(CONFIG_PATH);
      const safePath = validateVideoPath(params.path);

      let sessionDir: string | null = null;
      let manifest: SessionManifest | null = null;
      let videoHash: string | null = null;

      if (config.enable_index) {
        videoHash = computeVideoHash(safePath);
        sessionDir = getSessionDir(SESSIONS_DIR, safePath);
        manifest = loadManifest(sessionDir) ?? createManifest(videoHash, safePath);
      }

      // ------------------------------------------------------------------
      // Phase 1: Extraction (if segments provided)
      // ------------------------------------------------------------------
      let extractedFrames: SegmentFrame[] = [];

      if (params.segments && params.segments.length > 0) {
        // Always extract to a temporary directory so ffmpeg's sequential
        // frame_XXXX.jpg naming never overwrites previously cached files.
        const tmpWorkDir = join(tmpdir(), `cvv-detail-${Date.now()}`);
        mkdirSync(tmpWorkDir, { recursive: true });

        try {
          extractedFrames = await extractFramesBySegments(
            safePath,
            params.segments,
            tmpWorkDir,
          );
        } finally {
          rmSync(tmpWorkDir, { recursive: true, force: true });
        }

        // If session indexing is enabled, persist frames to the session
        // directory with stable, timestamp-keyed filenames, then merge into
        // the manifest for deduplication.
        if (config.enable_index && manifest && sessionDir) {
          // Group frames by resolution bucket.
          const byResolution = new Map<string, SegmentFrame[]>();
          for (const frame of extractedFrames) {
            const res = String(frame.resolution);
            const bucket = byResolution.get(res) ?? [];
            bucket.push(frame);
            byResolution.set(res, bucket);
          }

          for (const [resolution, frames] of byResolution) {
            const resDir = join(sessionDir, "frames", resolution);
            mkdirSync(resDir, { recursive: true });

            const manifestEntries: { timestamp: string; file: string }[] = [];

            for (const frame of frames) {
              const filePath = join(resDir, timestampToFilename(frame.timestamp));

              // Honour skip_cached — if the file already exists on disk, skip
              // writing the JPEG again (still add to manifestEntries so that
              // mergeFrames has a chance to index it if the manifest was lost).
              if (!(params.skip_cached && existsSync(filePath))) {
                if (frame.image) {
                  writeFileSync(filePath, Buffer.from(frame.image, "base64"));
                }
              }

              manifestEntries.push({ timestamp: frame.timestamp, file: filePath });
            }

            manifest = mergeFrames(manifest!, resolution, manifestEntries);
          }

          saveManifest(sessionDir, manifest);
        }
      }

      // ------------------------------------------------------------------
      // Phase 2: Determine which frames to return as images
      // ------------------------------------------------------------------
      let framesToView: ViewableFrame[] = [];

      if (params.view && params.view.length > 0) {
        // Mode A: caller specified exact timestamps.
        if (manifest) {
          // Look them up in the session cache (highest resolution preferred).
          framesToView = lookupTimestampsInManifest(manifest, params.view);
        } else {
          // No session — filter from frames just extracted in this call.
          for (const ts of params.view) {
            const match = extractedFrames.find((f) => f.timestamp === ts);
            if (match) {
              framesToView.push({ timestamp: match.timestamp, image: match.image });
            }
          }
        }
      } else if (params.view_sample !== undefined) {
        // Mode B: return N evenly spaced frames.
        const pool = buildViewablePool(extractedFrames, manifest);
        const indices = sampleFrameIndices(pool.length, params.view_sample);
        framesToView = indices.map((i) => pool[i]);
      } else {
        // Mode C: return all available frames.
        framesToView = buildViewablePool(extractedFrames, manifest);
      }

      // ------------------------------------------------------------------
      // Build MCP response content
      // ------------------------------------------------------------------
      const content: Array<
        | { type: "text"; text: string }
        | { type: "image"; data: string; mimeType: "image/jpeg" }
      > = [];

      // 1. Manifest summary (if session is active)
      if (manifest && videoHash) {
        const summary = {
          video_hash: videoHash,
          resolutions: Object.fromEntries(
            Object.entries(manifest.resolutions).map(([res, data]) => [
              res,
              {
                frame_count: data.frames.length,
                timestamps: data.frames.map((f) => f.timestamp),
              },
            ]),
          ),
        };
        content.push({
          type: "text",
          text: `## Session Manifest\n${JSON.stringify(summary, null, 2)}`,
        });
      }

      // 2. Frame count info
      content.push({
        type: "text",
        text: `## Viewing ${framesToView.length} frame(s)`,
      });

      // 3. Frames as images
      for (const frame of framesToView) {
        content.push({
          type: "text",
          text: `### Frame at ${frame.timestamp}`,
        });
        if (frame.image) {
          content.push({
            type: "image",
            data: frame.image,
            mimeType: "image/jpeg",
          });
        }
      }

      return { content: content as any };
    },
  );
}
