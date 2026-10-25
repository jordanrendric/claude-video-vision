import { describe, it, expect } from "vitest";
import { assertKnownBackend } from "../../src/utils/backend-guard.js";

describe("assertKnownBackend", () => {
  it("accepts implemented backends and the no-transcription sentinels", () => {
    for (const b of ["gemini-api", "local", "openai", "mistral", "unconfigured", "none", "youtube-captions"]) {
      expect(() => assertKnownBackend(b)).not.toThrow();
    }
  });

  it("refuses an unknown backend with an actionable message", () => {
    expect(() => assertKnownBackend("deepgram")).toThrow(/Unknown audio backend "deepgram".*gemini-api, local, openai, mistral/);
  });
});
