import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  analyzeWithTwelveLabs,
  resolvePegasusIndex,
  pegasusDurationGuard,
  modelSupportsWindow,
  DEFAULT_PEGASUS_PROMPT,
  type TwelveLabsLike,
} from "../../src/backends/twelvelabs.js";
import type { Config } from "../../src/types.js";
import { defaultConfig } from "../../src/config.js";

function makeConfig(overrides: Partial<Config> = {}): Config {
  return { ...defaultConfig, backend: "twelvelabs", ...overrides };
}

interface FakeClientOptions {
  existingIndexId?: string;
  analyzeText?: string;
  taskStatus?: string;
  taskVideoId?: string;
}

function fakeClient(opts: FakeClientOptions = {}) {
  const calls = {
    listIndexes: 0,
    createIndex: 0,
    createTask: vi.fn(),
    waitForDone: 0,
    analyze: vi.fn(),
  };

  const client: TwelveLabsLike = {
    indexes: {
      list: vi.fn(() => {
        calls.listIndexes++;
        return Promise.resolve({ data: opts.existingIndexId ? [{ id: opts.existingIndexId }] : [] });
      }) as TwelveLabsLike["indexes"]["list"],
      create: vi.fn(async () => {
        calls.createIndex++;
        return { id: "idx-created" };
      }),
    },
    tasks: {
      create: vi.fn(async (args) => {
        calls.createTask(args);
        return { id: "task-1", videoId: opts.taskVideoId };
      }),
      waitForDone: vi.fn(async () => {
        calls.waitForDone++;
        return { videoId: opts.taskVideoId ?? "vid-1", status: opts.taskStatus ?? "ready" };
      }),
    },
    analyze: vi.fn(async (args) => {
      calls.analyze(args);
      return { data: opts.analyzeText ?? "A timeline of the video.", finishReason: "stop" };
    }),
  };

  return { client, calls };
}

describe("analyzeWithTwelveLabs", () => {
  let original: string | undefined;

  beforeEach(() => {
    original = process.env.TWELVELABS_API_KEY;
    process.env.TWELVELABS_API_KEY = "test-key";
  });

  afterEach(() => {
    if (original === undefined) delete process.env.TWELVELABS_API_KEY;
    else process.env.TWELVELABS_API_KEY = original;
    vi.restoreAllMocks();
  });

  it("returns Pegasus analysis in full_analysis with empty transcription/tags", async () => {
    const { client, calls } = fakeClient({ analyzeText: "Scene 1 ..." });
    const result = await analyzeWithTwelveLabs(
      { videoUrl: "https://example.com/v.mp4" },
      makeConfig(),
      undefined,
      { makeClient: () => client },
    );

    expect(result.backend).toBe("twelvelabs");
    expect(result.full_analysis).toBe("Scene 1 ...");
    expect(result.transcription).toEqual([]);
    expect(result.audio_tags).toEqual([]);
    expect(calls.analyze).toHaveBeenCalledTimes(1);
  });

  it("passes the configured model, prompt, and max_tokens to analyze", async () => {
    const { client, calls } = fakeClient();
    await analyzeWithTwelveLabs(
      { videoUrl: "https://example.com/v.mp4" },
      makeConfig({ twelvelabs_model: "pegasus1.5", twelvelabs_prompt: "Summarize.", twelvelabs_max_tokens: 1024 }),
      undefined,
      { makeClient: () => client },
    );
    const arg = calls.analyze.mock.calls[0][0];
    expect(arg.modelName).toBe("pegasus1.5");
    expect(arg.prompt).toBe("Summarize.");
    expect(arg.maxTokens).toBe(1024);
    expect(arg.videoId).toBe("vid-1");
  });

  it("falls back to the built-in prompt when config prompt is empty", async () => {
    const { client, calls } = fakeClient();
    await analyzeWithTwelveLabs(
      { videoUrl: "https://example.com/v.mp4" },
      makeConfig({ twelvelabs_prompt: "" }),
      undefined,
      { makeClient: () => client },
    );
    expect(calls.analyze.mock.calls[0][0].prompt).toBe(DEFAULT_PEGASUS_PROMPT);
  });

  it("forwards a start/end slice to analyze for Pegasus 1.5+", async () => {
    const { client, calls } = fakeClient();
    await analyzeWithTwelveLabs(
      { videoUrl: "https://example.com/v.mp4" },
      makeConfig({ twelvelabs_model: "pegasus1.5" }),
      { startTime: 60, endTime: 120 },
      { makeClient: () => client },
    );
    const arg = calls.analyze.mock.calls[0][0];
    expect(arg.startTime).toBe(60);
    expect(arg.endTime).toBe(120);
  });

  it("omits the slice window on Pegasus 1.2 (API rejects it)", async () => {
    const { client, calls } = fakeClient();
    await analyzeWithTwelveLabs(
      { videoUrl: "https://example.com/v.mp4" },
      makeConfig({ twelvelabs_model: "pegasus1.2" }),
      { startTime: 60, endTime: 120 },
      { makeClient: () => client },
    );
    const arg = calls.analyze.mock.calls[0][0];
    expect(arg.startTime).toBeUndefined();
    expect(arg.endTime).toBeUndefined();
  });

  it("uploads a public URL via videoUrl", async () => {
    const { client, calls } = fakeClient();
    await analyzeWithTwelveLabs(
      { videoUrl: "https://example.com/v.mp4" },
      makeConfig(),
      undefined,
      { makeClient: () => client },
    );
    expect(calls.createTask).toHaveBeenCalledWith(
      expect.objectContaining({ videoUrl: "https://example.com/v.mp4" }),
    );
  });

  it("returns null full_analysis when the model returns empty text", async () => {
    const { client } = fakeClient({ analyzeText: "" });
    const result = await analyzeWithTwelveLabs(
      { videoUrl: "https://example.com/v.mp4" },
      makeConfig(),
      undefined,
      { makeClient: () => client },
    );
    expect(result.full_analysis).toBeNull();
  });

  it("throws when TWELVELABS_API_KEY is missing", async () => {
    delete process.env.TWELVELABS_API_KEY;
    const { client } = fakeClient();
    await expect(
      analyzeWithTwelveLabs({ videoUrl: "https://x/v.mp4" }, makeConfig(), undefined, { makeClient: () => client }),
    ).rejects.toThrow(/TWELVELABS_API_KEY/);
  });

  it("throws when neither videoUrl nor videoPath is provided", async () => {
    const { client } = fakeClient();
    await expect(
      analyzeWithTwelveLabs({}, makeConfig(), undefined, { makeClient: () => client }),
    ).rejects.toThrow(/videoUrl or videoPath/);
  });

  it("throws when indexing ends in a non-ready status", async () => {
    const { client } = fakeClient({ taskStatus: "failed" });
    await expect(
      analyzeWithTwelveLabs({ videoUrl: "https://x/v.mp4" }, makeConfig(), undefined, { makeClient: () => client }),
    ).rejects.toThrow(/status "failed"/);
  });
});

describe("resolvePegasusIndex", () => {
  it("reuses an existing index with the same name", async () => {
    const { client, calls } = fakeClient({ existingIndexId: "idx-existing" });
    const id = await resolvePegasusIndex(client, "claude-video-vision", "pegasus1.5");
    expect(id).toBe("idx-existing");
    expect(calls.createIndex).toBe(0);
  });

  it("creates a new index when none match", async () => {
    const { client, calls } = fakeClient();
    const id = await resolvePegasusIndex(client, "claude-video-vision", "pegasus1.5");
    expect(id).toBe("idx-created");
    expect(calls.createIndex).toBe(1);
  });
});

describe("modelSupportsWindow", () => {
  it("is false for pegasus1.2 and true for 1.5+", () => {
    expect(modelSupportsWindow("pegasus1.2")).toBe(false);
    expect(modelSupportsWindow("pegasus1.5")).toBe(true);
    expect(modelSupportsWindow("pegasus2.0")).toBe(true);
    expect(modelSupportsWindow("marengo3.0")).toBe(false);
  });
});

describe("pegasusDurationGuard", () => {
  it("rejects clips shorter than the 4s minimum", () => {
    expect(pegasusDurationGuard(2)).toMatch(/at least 4s/);
  });

  it("rejects videos longer than the 1-hour sync limit", () => {
    expect(pegasusDurationGuard(3601)).toMatch(/up to 3600s/);
  });

  it("accepts a valid duration", () => {
    expect(pegasusDurationGuard(300)).toBeNull();
  });
});
