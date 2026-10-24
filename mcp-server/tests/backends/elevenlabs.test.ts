import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { tokensToAudioResult, transcribeWithElevenLabs, type ElevenLabsToken } from "../../src/backends/elevenlabs.js";

function word(text: string, start: number, end: number): ElevenLabsToken {
  return { text, start, end, type: "word" };
}

function space(at: number): ElevenLabsToken {
  return { text: " ", start: at, end: at, type: "spacing" };
}

describe("tokensToAudioResult", () => {
  it("joins words with their spacing into one segment", () => {
    const result = tokensToAudioResult([word("Hello", 0.1, 0.4), space(0.4), word("there", 0.45, 0.9)]);
    expect(result.backend).toBe("elevenlabs");
    expect(result.transcription).toEqual([{ start: "00:00:00", end: "00:00:00", text: "Hello there" }]);
  });

  it("starts a new segment after a pause", () => {
    const result = tokensToAudioResult([word("one", 0, 0.5), space(0.5), word("two", 2.0, 2.4)]);
    expect(result.transcription.map((s) => s.text)).toEqual(["one", "two"]);
    expect(result.transcription[1].start).toBe("00:00:02");
  });

  it("starts a new segment after a sentence end", () => {
    const result = tokensToAudioResult([word("Done.", 0, 0.5), space(0.5), word("Next", 0.6, 1.0)]);
    expect(result.transcription.map((s) => s.text)).toEqual(["Done.", "Next"]);
  });

  it("caps segment length", () => {
    const tokens: ElevenLabsToken[] = [];
    for (let i = 0; i < 40; i++) {
      tokens.push(word("la", i * 0.5, i * 0.5 + 0.4), space(i * 0.5 + 0.4));
    }
    const result = tokensToAudioResult(tokens);
    expect(result.transcription.length).toBeGreaterThan(1);
    expect(result.transcription[0].end).toBe("00:00:14");
  });

  it("returns audio events as tags, not transcript text", () => {
    const result = tokensToAudioResult([
      word("Funny", 0, 0.4),
      { text: "(laughter)", start: 0.5, end: 1.5, type: "audio_event" },
    ]);
    expect(result.transcription.map((s) => s.text)).toEqual(["Funny"]);
    expect(result.audio_tags).toEqual([{ start: "00:00:00", end: "00:00:01", tag: "laughter" }]);
  });

  it("returns empty results for silence", () => {
    const result = tokensToAudioResult([]);
    expect(result.transcription).toEqual([]);
    expect(result.audio_tags).toEqual([]);
  });
});

describe("transcribeWithElevenLabs", () => {
  let dir: string;
  let wavPath: string;
  let originalKey: string | undefined;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "cvv-elevenlabs-"));
    wavPath = join(dir, "audio.wav");
    writeFileSync(wavPath, Buffer.alloc(44));
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  beforeEach(() => {
    originalKey = process.env.ELEVENLABS_API_KEY;
    process.env.ELEVENLABS_API_KEY = "test-key";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalKey === undefined) delete process.env.ELEVENLABS_API_KEY;
    else process.env.ELEVENLABS_API_KEY = originalKey;
  });

  it("throws when ELEVENLABS_API_KEY is missing", async () => {
    delete process.env.ELEVENLABS_API_KEY;
    await expect(transcribeWithElevenLabs(wavPath, "scribe_v2")).rejects.toThrow("ELEVENLABS_API_KEY");
  });

  it("sends the model with word timestamps and parses the words", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      new Response(JSON.stringify({ words: [word("Cześć", 0.2, 0.6)] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await transcribeWithElevenLabs(wavPath, "scribe_v2");

    expect(result.transcription).toEqual([{ start: "00:00:00", end: "00:00:00", text: "Cześć" }]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.elevenlabs.io/v1/speech-to-text");
    expect((init.headers as Record<string, string>)["xi-api-key"]).toBe("test-key");
    const form = init.body as FormData;
    expect(form.get("model_id")).toBe("scribe_v2");
    expect(form.get("timestamps_granularity")).toBe("word");
  });

  it("retries on 429 and then succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("busy", { status: 429, headers: { "retry-after": "0" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ words: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await transcribeWithElevenLabs(wavPath, "scribe_v2");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.transcription).toEqual([]);
  });

  it("fails fast on a non-retryable status", async () => {
    const fetchMock = vi.fn(async () => new Response("invalid key", { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(transcribeWithElevenLabs(wavPath, "scribe_v2")).rejects.toThrow("ElevenLabs HTTP 401: invalid key");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
