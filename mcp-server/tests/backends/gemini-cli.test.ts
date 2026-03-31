import { describe, it, expect } from "vitest";
import { buildGeminiArgs, buildStdinContent, parseGeminiCliOutput } from "../../src/backends/gemini-cli.js";

describe("gemini-cli backend", () => {
  describe("buildGeminiArgs", () => {
    it("builds correct args for video analysis", () => {
      const args = buildGeminiArgs();
      expect(args).toContain("-p");
      expect(args).toContain("--output-format");
      expect(args).toContain("json");
    });
  });

  describe("buildStdinContent", () => {
    it("creates @ file reference", () => {
      const stdin = buildStdinContent("/path/to/video.mp4");
      expect(stdin).toBe("@/path/to/video.mp4");
    });

    it("handles paths with spaces", () => {
      const stdin = buildStdinContent("/path/to/my video.mp4");
      expect(stdin).toBe("@/path/to/my video.mp4");
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
