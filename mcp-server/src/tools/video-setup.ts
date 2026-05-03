import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { checkDependencies } from "../utils/installer.js";
import { checkCommand, detectPlatform, recommendWhisperModel } from "../utils/platform.js";

export function registerVideoSetup(server: McpServer): void {
  server.tool(
    "video_setup",
    "Check dependencies for video perception (ffmpeg, whisper, gemini api, optional yt-dlp for YouTube URLs).",
    {
      backend: z.enum(["gemini-api", "local", "openai"]).describe("Audio processing backend"),
      whisper_engine: z.enum(["cpp", "python"]).default("cpp"),
      whisper_model: z.enum(["tiny", "base", "small", "medium", "large-v3-turbo", "large-v3", "auto"]).default("auto"),
    },
    async ({ backend, whisper_engine, whisper_model }) => {
      const platform = detectPlatform();
      const result = await checkDependencies(backend, whisper_engine);
      const hasYtDlp = await checkCommand("yt-dlp");

      const resolvedModel = whisper_model === "auto"
        ? recommendWhisperModel(platform.ram_gb)
        : whisper_model;

      let report = `## Platform Detected\n`;
      report += `- OS: ${platform.os}\n`;
      report += `- Architecture: ${platform.arch}\n`;
      report += `- GPU: ${platform.gpu}\n`;
      report += `- RAM: ${platform.ram_gb}GB (${platform.free_ram_gb}GB free)\n\n`;
      report += `## Backend: ${backend}\n\n`;

      if (backend === "local") {
        report += `- Whisper engine: ${whisper_engine}\n`;
        report += `- Recommended model: ${resolvedModel}\n\n`;
      }

      report += `## YouTube URL Support\n`;
      if (hasYtDlp) {
        report += `- Status: Ready (\`yt-dlp\` found)\n\n`;
      } else {
        const install = platform.os === "macos" ? "brew install yt-dlp" : "pipx install yt-dlp";
        report += `- Status: Missing optional dependency\n`;
        report += `- Install: \`${install}\`\n\n`;
      }

      if (result.status === "ready") {
        report += `## Status: Ready\nAll dependencies are installed.`;
      } else {
        report += `## Status: Missing Dependencies\n\n`;
        for (let i = 0; i < result.instructions.length; i++) {
          report += `${i + 1}. \`${result.instructions[i]}\`\n`;
        }
        report += `\n**Please install the missing dependencies and run video_setup again.**`;
      }

      return { content: [{ type: "text", text: report }] };
    },
  );
}
