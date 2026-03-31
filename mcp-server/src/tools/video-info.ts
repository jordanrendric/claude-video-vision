import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getVideoMetadata } from "../extractors/frames.js";

export function registerVideoInfo(server: McpServer): void {
  server.tool(
    "video_info",
    "Get metadata about a video file without processing it (duration, resolution, codec, etc.)",
    { path: z.string().describe("Path to the video file") },
    async ({ path }) => {
      const metadata = await getVideoMetadata(path);
      return {
        content: [{ type: "text", text: JSON.stringify(metadata, null, 2) }],
      };
    },
  );
}
