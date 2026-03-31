import { describe, it, expect } from "vitest";
import { buildGeminiCliArgs, parseGeminiCliOutput } from "../../src/backends/gemini-cli.js";

describe("gemini-cli backend", () => {
  describe("buildGeminiCliArgs", () => {
    it("builds correct args for video analysis", () => {
      const args = buildGeminiCliArgs("/path/to/video.mp4");
      expect(args).toContain("-p");
      expect(args).toContain("--output-format");
      expect(args).toContain("json");
      expect(args.some((a) => a.includes("video.mp4"))).toBe(true);
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

    it("handles error output gracefully", () => {
      const result = parseGeminiCliOutput("not valid json");
      expect(result.full_analysis).toBe("not valid json");
      expect(result.transcription).toEqual([]);
    });
  });
});
