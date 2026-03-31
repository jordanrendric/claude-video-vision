import { z } from "zod";
import { join } from "path";
import { homedir } from "os";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadConfig, saveConfig } from "../config.js";

const CONFIG_PATH = join(homedir(), ".claude-video-vision", "config.json");

export function registerVideoConfigure(server: McpServer): void {
  server.tool(
    "video_configure",
    "Configure video perception preferences (backend, resolution, fps, whisper model, etc.)",
    {
      backend: z.enum(["gemini-api", "local", "openai"]).optional(),
      whisper_engine: z.enum(["cpp", "python"]).optional(),
      whisper_model: z.enum(["tiny", "base", "small", "medium", "large-v3-turbo", "large-v3", "auto"]).optional(),
      whisper_at: z.boolean().optional(),
      frame_mode: z.enum(["images", "descriptions"]).optional(),
      frame_resolution: z.number().min(128).max(2048).optional(),
      default_fps: z.union([z.number().positive(), z.literal("auto")]).optional(),
      max_frames: z.number().min(1).max(1000).optional(),
      frame_describer_model: z.enum(["opus", "sonnet", "haiku"]).optional(),
    },
    async (params) => {
      const current = loadConfig(CONFIG_PATH);
      const updated = { ...current };

      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) {
          (updated as any)[key] = value;
        }
      }

      saveConfig(CONFIG_PATH, updated);

      return {
        content: [{
          type: "text",
          text: `Configuration saved to ${CONFIG_PATH}:\n${JSON.stringify(updated, null, 2)}`,
        }],
      };
    },
  );
}
