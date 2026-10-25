import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Capture the HTTP request the Mistral backend makes so we can assert the
// endpoint, auth header and multipart encoding (repeated plain fields for
// lists, no `language`, no `response_format`).
const fetchCalls: Array<{ url: string; init: RequestInit }> = [];
let fakeResponse: any = {};
let fakeStatus = 200;

vi.mock("fs", async () => {
  const actual = await vi.importActual<typeof import("fs")>("fs");
  return { ...actual, readFileSync: () => Buffer.from("RIFF") };
});

import {
  transcribeWithMistral,
  parseContextBias,
  buildMistralForm,
  MISTRAL_BASE_URL,
  MISTRAL_DEFAULT_MODEL,
} from "../../src/backends/mistral.js";

function formEntries(call: { init: RequestInit }): Array<[string, string]> {
  const form = call.init.body as FormData;
  return [...form.entries()]
    .filter(([, v]) => typeof v === "string")
    .map(([k, v]) => [k, v as string]);
}

describe("transcribeWithMistral", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    fetchCalls.length = 0;
    fakeStatus = 200;
    process.env.MISTRAL_API_KEY = "test-key";
    delete process.env.MISTRAL_TRANSCRIPTION_MODEL;
    delete process.env.MISTRAL_CONTEXT_BIAS;
    fakeResponse = {
      text: "bonjour le monde",
      segments: [
        { start: 0, end: 1.5, text: " bonjour " },
        { start: 1.5, end: 3.2, text: "le monde" },
      ],
    };
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      fetchCalls.push({ url, init });
      return {
        ok: fakeStatus >= 200 && fakeStatus < 300,
        status: fakeStatus,
        statusText: fakeStatus === 200 ? "OK" : "Unprocessable Entity",
        json: async () => fakeResponse,
        text: async () => JSON.stringify(fakeResponse),
      };
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = { ...originalEnv };
  });

  it("throws a clear error when MISTRAL_API_KEY is missing", async () => {
    delete process.env.MISTRAL_API_KEY;
    await expect(transcribeWithMistral("/tmp/x.wav")).rejects.toThrow(/MISTRAL_API_KEY/);
    expect(fetchCalls).toHaveLength(0);
  });

  it("posts to Mistral's transcription endpoint with a bearer token", async () => {
    await transcribeWithMistral("/tmp/x.wav");
    expect(fetchCalls[0].url).toBe(`${MISTRAL_BASE_URL}/audio/transcriptions`);
    expect(fetchCalls[0].init.method).toBe("POST");
    expect((fetchCalls[0].init.headers as any).Authorization).toBe("Bearer test-key");
  });

  it("uses voxtral-mini-latest by default and honours the model override", async () => {
    await transcribeWithMistral("/tmp/x.wav");
    expect(formEntries(fetchCalls[0])).toContainEqual(["model", MISTRAL_DEFAULT_MODEL]);

    process.env.MISTRAL_TRANSCRIPTION_MODEL = "voxtral-custom";
    await transcribeWithMistral("/tmp/x.wav");
    expect(formEntries(fetchCalls[1])).toContainEqual(["model", "voxtral-custom"]);
  });

  it("requests segment timestamps and omits params Mistral rejects", async () => {
    await transcribeWithMistral("/tmp/x.wav");
    const entries = formEntries(fetchCalls[0]);
    const keys = entries.map(([k]) => k);
    expect(entries).toContainEqual(["timestamp_granularities", "segment"]);
    expect(keys).not.toContain("timestamp_granularities[]");
    expect(keys).not.toContain("language");
    expect(keys).not.toContain("response_format");
    expect((fetchCalls[0].init.body as FormData).get("file")).toBeInstanceOf(Blob);
  });

  it("sends context_bias as repeated plain fields only when configured", async () => {
    await transcribeWithMistral("/tmp/x.wav");
    expect(formEntries(fetchCalls[0]).map(([k]) => k)).not.toContain("context_bias");

    process.env.MISTRAL_CONTEXT_BIAS = "Anaplan, CIGREF ,AFAI,, OCDE";
    await transcribeWithMistral("/tmp/x.wav");
    const bias = formEntries(fetchCalls[1]).filter(([k]) => k === "context_bias").map(([, v]) => v);
    expect(bias).toEqual(["Anaplan", "CIGREF", "AFAI", "OCDE"]);
    expect(formEntries(fetchCalls[1]).map(([k]) => k)).not.toContain("context_bias[]");
  });

  it("splits multi-word terms into single words (Mistral rejects whitespace) and dedupes", () => {
    expect(parseContextBias("Costing IT,SAP PCM,Shadow IT, IT ,Anaplan")).toEqual([
      "Costing", "IT", "SAP", "PCM", "Shadow", "Anaplan",
    ]);
  });

  it("prefers the vocabulary option over the environment variable", async () => {
    process.env.MISTRAL_CONTEXT_BIAS = "EnvTerm";
    await transcribeWithMistral("/tmp/x.wav", { vocabulary: ["Costing IT", "Anaplan"] });
    const bias = formEntries(fetchCalls[0]).filter(([k]) => k === "context_bias").map(([, v]) => v);
    expect(bias).toEqual(["Costing", "IT", "Anaplan"]);
  });

  it("caps context_bias at 100 terms", () => {
    const raw = Array.from({ length: 120 }, (_, i) => `t${i}`).join(",");
    expect(parseContextBias(raw)).toHaveLength(100);
    expect(parseContextBias(undefined)).toEqual([]);
    const form = buildMistralForm({ audio: new Blob(["x"]), model: "m", contextBias: parseContextBias(raw) });
    expect(form.getAll("context_bias")).toHaveLength(100);
  });

  it("maps segments to HH:MM:SS transcription entries", async () => {
    const result = await transcribeWithMistral("/tmp/x.wav");
    expect(result.backend).toBe("mistral");
    expect(result.transcription).toEqual([
      { start: "00:00:00", end: "00:00:01", text: "bonjour" },
      { start: "00:00:01", end: "00:00:03", text: "le monde" },
    ]);
    expect(result.audio_tags).toEqual([]);
    expect(result.full_analysis).toBeNull();
  });

  it("falls back to the full text when no segments are returned", async () => {
    fakeResponse = { text: "  juste du texte " };
    const result = await transcribeWithMistral("/tmp/x.wav");
    expect(result.transcription).toHaveLength(1);
    expect(result.transcription[0].text).toBe("juste du texte");
  });

  it("surfaces HTTP errors with status and body", async () => {
    fakeStatus = 422;
    fakeResponse = { detail: "invalid context_bias" };
    await expect(transcribeWithMistral("/tmp/x.wav")).rejects.toThrow(/422.*invalid context_bias/);
  });
});
