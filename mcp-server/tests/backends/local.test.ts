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
    // The real openai-whisper CLI prints a human-readable transcript plus a
    // language-detection preamble here — never JSON. Reproduce that shape so
    // a regression back to parsing stdout cannot pass these tests.
    callback(null, {
      stdout:
        "Detecting language using up to the first 30 seconds. Use `--language` to specify the language\n" +
        "Detected language: English\n" +
        "[00:00.000 --> 00:03.320]  The quick brown fox jumps over the lazy dog.\n",
      stderr: "",
    });
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

// Stand in for the JSON file the whisper CLI writes next to the wav. Keyed by
// normalized path so tests can seed whatever whisper "produced" for that run.
const fakeFiles = new Map<string, string>();
const normalize = (p: string) => p.replace(/\\/g, "/");

const EMPTY_WHISPER_JSON = JSON.stringify({ text: "", segments: [] });

vi.mock("fs", async () => {
  const actual = await vi.importActual<typeof import("fs")>("fs");
  return {
    ...actual,
    rmSync: (path: string, _options?: unknown) => {
      rmSyncCalls.push(path);
      fakeFiles.delete(normalize(path));
    },
    existsSync: (path: string) =>
      fakeFiles.has(normalize(path)) || actual.existsSync(path),
    readFileSync: ((path: string, ...rest: unknown[]) => {
      const seeded = fakeFiles.get(normalize(String(path)));
      if (seeded !== undefined) return seeded;
      return (actual.readFileSync as (...a: unknown[]) => unknown)(
        path,
        ...rest,
      );
    }) as typeof actual.readFileSync,
  };
});

import { transcribeWithWhisper } from "../../src/backends/local.js";

describe("transcribeWithWhisperPython arg construction", () => {
  beforeEach(() => {
    execFileCalls.length = 0;
    rmSyncCalls.length = 0;
    fakeFiles.clear();
    // Every python run reads the JSON file whisper writes beside the wav.
    fakeFiles.set("/tmp/scratch/audio.json", EMPTY_WHISPER_JSON);
    fakeFiles.set("/tmp/scratch/temp_abc123.json", EMPTY_WHISPER_JSON);
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

describe("transcribeWithWhisperPython output parsing", () => {
  beforeEach(() => {
    execFileCalls.length = 0;
    rmSyncCalls.length = 0;
    fakeFiles.clear();
  });

  it("reads segments from the JSON file, not stdout", async () => {
    // Shape openai-whisper writes to <wav basename>.json: start/end in seconds.
    fakeFiles.set(
      "/tmp/scratch/audio.json",
      JSON.stringify({
        text: " The quick brown fox jumps over the lazy dog. This is a test of video vision.",
        segments: [
          { id: 0, start: 0, end: 3.32, text: " The quick brown fox jumps over the lazy dog." },
          { id: 1, start: 3.84, end: 6.14, text: " This is a test of video vision." },
          { id: 2, start: 6.66, end: 8.44, text: " The answer is 42." },
        ],
        language: "en",
      }),
    );

    const result = await transcribeWithWhisper("/tmp/scratch/audio.wav", {
      engine: "python",
      model: "small",
      whisperAt: false,
      modelDir: "",
    });

    expect(result.transcription).toEqual([
      { start: "00:00:00", end: "00:00:03", text: "The quick brown fox jumps over the lazy dog." },
      { start: "00:00:03", end: "00:00:06", text: "This is a test of video vision." },
      { start: "00:00:06", end: "00:00:08", text: "The answer is 42." },
    ]);
  });

  it("does not leak the stdout preamble into the transcript", async () => {
    fakeFiles.set(
      "/tmp/scratch/audio.json",
      JSON.stringify({
        text: " Hello.",
        segments: [{ id: 0, start: 0, end: 1, text: " Hello." }],
        language: "en",
      }),
    );

    const result = await transcribeWithWhisper("/tmp/scratch/audio.wav", {
      engine: "python",
      model: "small",
      whisperAt: false,
      modelDir: "",
    });

    const joined = result.transcription.map((s) => s.text).join(" ");
    expect(joined).not.toContain("Detecting language");
    expect(joined).not.toContain("-->");
  });

  it("throws a clear error when whisper produced no JSON file", async () => {
    await expect(
      transcribeWithWhisper("/tmp/scratch/missing.wav", {
        engine: "python",
        model: "small",
        whisperAt: false,
        modelDir: "",
      }),
    ).rejects.toThrow(/did not produce expected JSON output/);
  });
});
