import { describe, it, expect } from "vitest";
import { buildGeminiCommand, getGeminiTmpDir, parseGeminiCliOutput } from "../../src/backends/gemini-cli.js";

describe("gemini-cli backend", () => {
  describe("buildGeminiCommand", () => {
    it("builds command with include-directories and yolo flag", () => {
      const cmd = buildGeminiCommand("/tmp/cvv");
      expect(cmd).toContain("gemini -p");
      expect(cmd).toContain("audio.wav");
      expect(cmd).toContain("--output-format json");
      expect(cmd).toContain("-y");
      expect(cmd).toContain("--include-directories");
      expect(cmd).toContain("/tmp/cvv");
    });

    it("escapes single quotes in workdir", () => {
      const cmd = buildGeminiCommand("/tmp/it's dir");
      expect(cmd).toContain("\\'");
    });
  });

  describe("getGeminiTmpDir", () => {
    it("returns a path under ~/.gemini/tmp", () => {
      const dir = getGeminiTmpDir();
      expect(dir).toContain(".gemini/tmp/claude-video-vision");
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
