import { z } from "zod";
import { join } from "path";
import { homedir } from "os";
import { mkdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadConfig } from "../config.js";
import { getVideoMetadata, extractFrames, calculateAutoFps } from "../extractors/frames.js";
import { extractAudio } from "../extractors/audio.js";
import { analyzeWithGeminiApi } from "../backends/gemini-api.js";
import { transcribeWithWhisper } from "../backends/local.js";
import { transcribeWithOpenAI } from "../backends/openai.js";
import type { AudioResult, VideoWatchResult } from "../types.js";

const CONFIG_PATH = join(homedir(), ".claude-video-vision", "config.json");

const UNCONFIGURED_MESSAGE = `## claude-video-vision is not configured yet!

Please run **/setup-video-vision** to configure the plugin before using it.

Available backends:
- **Gemini API** — Best quality. Analyzes audio natively. Free tier: 1500 req/day. Requires GEMINI_API_KEY.
- **Local (Whisper)** — Free, fully offline. Requires whisper.cpp or openai-whisper installed.
- **OpenAI Whisper API** — Good quality. Requires OPENAI_API_KEY.`;

export function registerVideoWatch(server: McpServer): void {
  server.tool(
    "video_watch",
    "Extract frames and process audio from a video file. Returns frames (as base64 images or text descriptions) + transcription + audio analysis for Claude to understand the video content. IMPORTANT: If not configured, tell the user to run /setup-video-vision first.",
    {
      path: z.string().describe("Path to the video file"),
      fps: z.union([z.number().positive(), z.literal("auto")]).default("auto").describe("Frames per second to extract"),
      resolution: z.number().min(128).max(2048).optional().describe("Frame width in px (maintains aspect ratio)"),
      frame_mode: z.enum(["images", "descriptions"]).optional().describe("Return frames as base64 images or text descriptions"),
      describer_model: z.enum(["opus", "sonnet", "haiku"]).optional().describe("Model for frame-describer agent"),
      start_time: z.string().optional().describe("Start time (e.g. '00:01:30')"),
      end_time: z.string().optional().describe("End time (e.g. '00:05:00')"),
    },
    async (params) => {
      const config = loadConfig(CONFIG_PATH);

      // Block if not configured
      if (config.backend === "unconfigured") {
        return { content: [{ type: "text", text: UNCONFIGURED_MESSAGE }] };
      }

      const resolution = params.resolution || config.frame_resolution;
      const frameMode = params.frame_mode || config.frame_mode;

      // 1. Get metadata
      const metadata = await getVideoMetadata(params.path);

      // 2. Calculate fps
      const fps = params.fps === "auto"
        ? calculateAutoFps(metadata.duration_seconds)
        : params.fps;

      // 3. Prepare work dir
      const workDir = join(tmpdir(), `cvv-${Date.now()}`);
      mkdirSync(workDir, { recursive: true });
      const framesDir = join(workDir, "frames");

      // 4. Run frame extraction and audio processing IN PARALLEL
      const framesPromise = extractFrames(params.path, {
        fps,
        resolution,
        outputDir: framesDir,
        startTime: params.start_time,
        endTime: params.end_time,
        maxFrames: config.max_frames,
      });

      let audioPromise: Promise<AudioResult>;

      if (config.backend === "gemini-api") {
        audioPromise = analyzeWithGeminiApi(params.path);
      } else if (config.backend === "openai") {
        const audioDir = join(workDir, "audio");
        audioPromise = extractAudio(params.path, audioDir, {
          startTime: params.start_time,
          endTime: params.end_time,
        }).then((wavPath) => transcribeWithOpenAI(wavPath));
      } else {
        // local
        const audioDir = join(workDir, "audio");
        const modelDir = join(homedir(), ".claude-video-vision", "models");
        audioPromise = extractAudio(params.path, audioDir, {
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

      const [frames, audio] = await Promise.all([framesPromise, audioPromise]);

      // 5. Build result
      const result: VideoWatchResult = { metadata, frames, audio };

      // 6. Cleanup temp dir
      rmSync(workDir, { recursive: true, force: true });

      // 7. Return as MCP content
      const content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }> = [];

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
