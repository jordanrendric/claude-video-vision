import { z } from "zod";
import { join } from "path";
import { homedir } from "os";
import { mkdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadConfig } from "../config.js";
import { getVideoMetadata, extractFrames, calculateAutoFps, extractFramesBySegments } from "../extractors/frames.js";
import { extractAudio } from "../extractors/audio.js";
import { analyzeWithGeminiApi } from "../backends/gemini-api.js";
import { transcribeWithWhisper } from "../backends/local.js";
import { transcribeWithOpenAI } from "../backends/openai.js";
import { parseHMS, shiftAudioResult } from "../utils/timestamps.js";
import { validateVideoPath } from "../utils/validation.js";
import { getSessionDir, loadManifest, saveManifest, computeVideoHash } from "../session/manager.js";
import { createManifest, mergeFrames, sampleFrameIndices } from "../session/manifest.js";
import type { AudioResult, VideoWatchResult, Frame, Segment, SessionManifest } from "../types.js";

const CONFIG_PATH = join(homedir(), ".claude-video-vision", "config.json");

const HMS_REGEX = /^\d{2}:\d{2}:\d{2}$/;

const SESSIONS_DIR = join(homedir(), ".claude-video-vision", "sessions");

const UNCONFIGURED_MESSAGE = `## claude-video-vision is not configured yet!

Please run **/setup-video-vision** to configure the plugin before using it.

Available backends:
- **Gemini API** — Best quality. Analyzes audio natively. Free tier: 1500 req/day. Requires GEMINI_API_KEY.
- **Local (Whisper)** — Free, fully offline. Requires whisper.cpp or openai-whisper installed.
- **OpenAI Whisper API** — Good quality. Requires OPENAI_API_KEY.`;

export function registerVideoWatch(server: McpServer): void {
  server.tool(
    "video_watch",
    "Extract frames and process audio from a video file. Returns frames (as base64 images or text descriptions) + transcription + audio analysis for Claude to understand the video content. IMPORTANT: For videos longer than 30 seconds, call video_analyze FIRST to get structural data (scene changes, silence, transcription) before calling this tool — use that data to set smart segments with variable FPS. If not configured, tell the user to run /setup-video-vision first.",
    {
      path: z.string().describe("Absolute or relative path to the video file"),
      fps: z.union([z.coerce.number().positive(), z.literal("auto")]).default("auto").describe("Frames per second to extract"),
      resolution: z.coerce.number().min(128).max(2048).optional().describe("Frame width in px (maintains aspect ratio)"),
      frame_mode: z.enum(["images", "descriptions"]).optional().describe("Return frames as base64 images or text descriptions"),
      describer_model: z.enum(["opus", "sonnet", "haiku"]).optional().describe("Model for frame-describer agent"),
      start_time: z.string().regex(HMS_REGEX, "Must be HH:MM:SS format").optional().describe("Start time (e.g. '00:01:30')"),
      end_time: z.string().regex(HMS_REGEX, "Must be HH:MM:SS format").optional().describe("End time (e.g. '00:05:00')"),
      skip_audio: z.boolean().default(false).describe("Skip audio extraction and transcription — frames only"),
      segments: z.array(z.object({
        start: z.string().regex(HMS_REGEX, "Must be HH:MM:SS format"),
        end: z.string().regex(HMS_REGEX, "Must be HH:MM:SS format"),
        fps: z.number().positive(),
        resolution: z.number().min(128).max(2048).optional(),
      })).optional().describe("Variable FPS/resolution segments — overrides global fps/start_time/end_time"),
      view_sample: z.number().min(1).optional().describe("Return only N evenly spaced frames"),
    },
    async (params) => {
      const config = loadConfig(CONFIG_PATH);

      if (config.backend === "unconfigured" && !params.skip_audio) {
        return { content: [{ type: "text", text: UNCONFIGURED_MESSAGE }] };
      }

      const resolution = params.resolution || config.frame_resolution;
      const frameMode = params.frame_mode || config.frame_mode;
      const safePath = validateVideoPath(params.path);

      // Session support
      const useSession = config.enable_index;
      let sessionDir: string | null = null;
      let manifest: SessionManifest | null = null;

      if (useSession) {
        sessionDir = getSessionDir(SESSIONS_DIR, safePath);
        manifest = loadManifest(sessionDir) ?? createManifest(computeVideoHash(safePath), safePath);
      }

      // 1. Get metadata
      const metadata = await getVideoMetadata(safePath);

      // 2. Calculate fps
      const fps = params.fps === "auto"
        ? calculateAutoFps(metadata.duration_seconds)
        : params.fps;

      // 3. Prepare work dir
      const workDir = join(tmpdir(), `cvv-${Date.now()}`);
      mkdirSync(workDir, { recursive: true });
      const framesDir = join(workDir, "frames");

      // 4. Run frame extraction and audio processing
      //    When segments are provided, frame extraction is sequential (per segment);
      //    audio can still run in parallel with the entire segment batch.

      let framesPromise: Promise<Frame[]>;

      if (params.segments && params.segments.length > 0) {
        const extractDir = useSession ? sessionDir! : join(workDir, "frames");
        framesPromise = extractFramesBySegments(safePath, params.segments as Segment[], extractDir).then((segmentFrames) => {
          if (useSession && manifest) {
            for (const frame of segmentFrames) {
              const res = String(frame.resolution);
              const tsForFile = frame.timestamp.replace(/:/g, "_");
              manifest = mergeFrames(manifest!, res, [
                { timestamp: frame.timestamp, file: `${res}/frame_${tsForFile}.jpg` },
              ]);
            }
          }
          return segmentFrames;
        });
      } else {
        framesPromise = extractFrames(safePath, {
          fps,
          resolution,
          outputDir: framesDir,
          startTime: params.start_time,
          endTime: params.end_time,
          maxFrames: config.max_frames,
        });
      }

      let audioPromise: Promise<AudioResult>;

      if (params.skip_audio || !metadata.has_audio) {
        audioPromise = Promise.resolve({ backend: "none" as const, transcription: [], audio_tags: [], full_analysis: null });
      } else if (config.backend === "gemini-api") {
        const audioDir = join(workDir, "audio");
        audioPromise = extractAudio(safePath, audioDir, {
          startTime: params.start_time,
          endTime: params.end_time,
        }).then((wavPath) => analyzeWithGeminiApi(wavPath));
      } else if (config.backend === "openai") {
        const audioDir = join(workDir, "audio");
        audioPromise = extractAudio(safePath, audioDir, {
          startTime: params.start_time,
          endTime: params.end_time,
        }).then((wavPath) => transcribeWithOpenAI(wavPath));
      } else {
        // local
        const audioDir = join(workDir, "audio");
        const modelDir = join(homedir(), ".claude-video-vision", "models");
        audioPromise = extractAudio(safePath, audioDir, {
          startTime: params.start_time,
          endTime: params.end_time,
        }).then((wavPath) =>
          transcribeWithWhisper(wavPath, {
            engine: config.whisper_engine,
            model: config.whisper_model,
            whisperAt: config.whisper_at,
            modelDir,
          }),
        );
      }

      let [frames, rawAudio] = await Promise.all([framesPromise, audioPromise]);

      // 5. Align audio timestamps with the original video timeline.
      //    Backends return timestamps relative to the cropped audio, but frames
      //    already carry original-video timestamps via extractFrames. Shift the
      //    audio result so both timelines match.
      const offsetSeconds = params.start_time ? parseHMS(params.start_time) : 0;
      const audio = shiftAudioResult(rawAudio, offsetSeconds);

      // 6. Apply view_sample filtering — return only N evenly spaced frames
      if (params.view_sample && frames.length > params.view_sample) {
        const indices = sampleFrameIndices(frames.length, params.view_sample);
        frames = indices.map((i) => frames[i]);
      }

      // 7. Persist session manifest
      if (useSession && manifest && sessionDir) {
        saveManifest(sessionDir, manifest);
      }

      // 8. Build result
      const result: VideoWatchResult = { metadata, frames, audio };

      // 9. Cleanup temp dir (only when not using session — session dir is persistent)
      if (!useSession) {
        rmSync(workDir, { recursive: true, force: true });
      }

      // 10. Return as MCP content
      const content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }> = [];

      // Manifest summary (only when session is active)
      if (manifest) {
        const manifestSummary = {
          video_hash: manifest.video_hash,
          resolutions: Object.fromEntries(
            Object.entries(manifest.resolutions).map(([res, data]) => [
              res, { frame_count: data.frames.length, timestamps: data.frames.map((f) => f.timestamp) },
            ]),
          ),
        };
        content.push({ type: "text", text: `## Session Manifest\n${JSON.stringify(manifestSummary, null, 2)}` });
      }

      // Metadata + audio as text
      content.push({
        type: "text",
        text: `## Video Metadata\n${JSON.stringify(metadata, null, 2)}\n\n## Audio Analysis\n${JSON.stringify(audio, null, 2)}`,
      });

      // Frames
      if (frameMode === "images") {
        for (const frame of frames) {
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
      } else {
        // descriptions mode — return frame data for the frame-describer agent to process
        content.push({
          type: "text",
          text: `## Frames (${frames.length} extracted at ${fps} fps)\nFrame mode is "descriptions" — use the frame-describer agent to generate text descriptions of these frames.\n\n${frames.map((f) => `- ${f.timestamp}`).join("\n")}`,
        });
        // Still include images so the agent can describe them
        for (const frame of frames) {
          if (frame.image) {
            content.push({
              type: "image",
              data: frame.image,
              mimeType: "image/jpeg",
            });
          }
        }
      }

      return { content: content as any };
    },
  );
}
