import { describe, it, expect } from "vitest";
import { buildGeminiCommand, parseGeminiCliOutput } from "../../src/backends/gemini-cli.js";

describe("gemini-cli backend", () => {
  describe("buildGeminiCommand", () => {
    it("builds correct piped command", () => {
      const cmd = buildGeminiCommand("/path/to/video.mp4");
      expect(cmd).toContain("echo '@/path/to/video.mp4'");
      expect(cmd).toContain("gemini -p");
      expect(cmd).toContain("--output-format json");
    });

    it("handles paths with spaces", () => {
      const cmd = buildGeminiCommand("/path/to/my video.mp4");
      expect(cmd).toContain("@/path/to/my video.mp4");
    });

    it("escapes single quotes in path", () => {
      const cmd = buildGeminiCommand("/path/it's a video.mp4");
      expect(cmd).toContain("\\'");
    });
  });

  describe("parseGeminiCliOutput", () => {
    it("parses JSON response from gemini cli", () => {
      const mockOutput = JSON.stringify({
        response: "The video shows a person coding. Transcription: 'Hello world'. Background music plays throughout.",
      });
      const result = parseGeminiCliOutput(mockOutput);
      expect(result.full_analysis).toContain("person coding");
      expect(result.backend).toBe("gemini-cli");
    });

    it("extracts JSON from output with debug lines", () => {
      const mockOutput = `Loading extension: context7
Loading extension: nanobanana
{"session_id":"abc","response":"A blue screen video","stats":{}}`;
      const result = parseGeminiCliOutput(mockOutput);
      expect(result.full_analysis).toBe("A blue screen video");
    });

    it("handles error output gracefully", () => {
      const result = parseGeminiCliOutput("not valid json");
      expect(result.full_analysis).toBe("not valid json");
      expect(result.transcription).toEqual([]);
    });
  });
});
