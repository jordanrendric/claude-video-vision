import { describe, it, expect, vi, beforeEach } from "vitest";

// Capture invocations of execFile so we can inspect the args the python
// branch passes to the openai-whisper CLI. We mock child_process at the
// module level so that promisify(execFile) inside src/backends/local.ts
// resolves to our fake.
const execFileCalls: Array<{ command: string; args: string[] }> = [];

vi.mock("child_process", () => ({
  execFile: (
    command: string,
    args: string[],
    _options: unknown,
    callback: (
      err: Error | null,
      result: { stdout: string; stderr: string },
    ) => void,
  ) => {
    execFileCalls.push({ command, args });
    // Empty-but-valid whisper JSON on stdout; parseWhisperOutput tolerates it.
    callback(null, { stdout: "{}", stderr: "" });
  },
  exec: (
    _cmd: string,
    _options: unknown,
    callback: (
      err: Error | null,
      result: { stdout: string; stderr: string },
    ) => void,
  ) => {
    callback(null, { stdout: "", stderr: "" });
  },
}));

// Track rmSync calls so we can assert the cleanup path is derived from
// the input wav rather than hardcoded to "audio.json".
const rmSyncCalls: string[] = [];

vi.mock("fs", async () => {
  const actual = await vi.importActual<typeof import("fs")>("fs");
  return {
    ...actual,
    rmSync: (path: string, _options?: unknown) => {
      rmSyncCalls.push(path);
    },
  };
});

import { transcribeWithWhisper } from "../../src/backends/local.js";

describe("transcribeWithWhisperPython arg construction", () => {
  beforeEach(() => {
    execFileCalls.length = 0;
    rmSyncCalls.length = 0;
  });

  it("does NOT pass --language (openai-whisper rejects 'auto')", async () => {
    await transcribeWithWhisper("/tmp/scratch/audio.wav", {
      engine: "python",
      model: "small",
      whisperAt: false,
      modelDir: "",
    });

    expect(execFileCalls).toHaveLength(1);
    const { command, args } = execFileCalls[0];
    expect(command).toBe("whisper");
    expect(args).not.toContain("--language");
    expect(args).not.toContain("auto");
  });

  it("passes --output_dir set to dirname(wavPath)", async () => {
    await transcribeWithWhisper("/tmp/scratch/audio.wav", {
      engine: "python",
      model: "small",
      whisperAt: false,
      modelDir: "",
    });

    const { args } = execFileCalls[0];
    const idx = args.indexOf("--output_dir");
    expect(idx).toBeGreaterThanOrEqual(0);
    // Path separator differs by platform; compare with .endsWith for portability.
    expect(args[idx + 1].replace(/\\/g, "/")).toBe("/tmp/scratch");
  });

  it("uses 'whisper-at' command when whisperAt option is true", async () => {
    await transcribeWithWhisper("/tmp/scratch/audio.wav", {
      engine: "python",
      model: "small",
      whisperAt: true,
      modelDir: "",
    });

    expect(execFileCalls[0].command).toBe("whisper-at");
  });

  it("derives cleanup filename from wavPath, not hardcoded 'audio.json'", async () => {
    await transcribeWithWhisper("/tmp/scratch/temp_abc123.wav", {
      engine: "python",
      model: "small",
      whisperAt: false,
      modelDir: "",
    });

    expect(rmSyncCalls).toHaveLength(1);
    expect(rmSyncCalls[0].replace(/\\/g, "/")).toBe(
      "/tmp/scratch/temp_abc123.json",
    );
  });
});
