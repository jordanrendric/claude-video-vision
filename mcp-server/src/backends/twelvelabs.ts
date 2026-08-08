import { createReadStream } from "fs";
import type { AudioResult, Config } from "../types.js";

// Pegasus is a video understanding model: it watches the whole video server-side
// and returns a compact natural-language analysis. That makes it a low-token
// alternative to extracting and shipping dozens of frames for long videos —
// the model does the perception, Claude reads the summary. This backend is
// opt-in (config.backend === "twelvelabs") and never changes existing defaults.

const PEGASUS_MIN_SECONDS = 4;
const PEGASUS_MAX_SECONDS = 3600; // sync analyze caps at 1 hour

// Minimal structural view of the bits of twelvelabs-js we use, so the
// orchestrator can be unit-tested with a fake client (mirrors the gemini-api
// backend's dependency-injection style).
export interface TwelveLabsLike {
  indexes: {
    list(args: { indexName: string }): AsyncIterable<{ id?: string }> | Promise<{ data?: { id?: string }[] }>;
    create(args: {
      indexName: string;
      models: { modelName: string; modelOptions: string[] }[];
    }): Promise<{ id?: string }>;
  };
  tasks: {
    create(args: { indexId: string; videoFile?: unknown; videoUrl?: string }): Promise<{ id?: string; videoId?: string }>;
    waitForDone(taskId: string, options?: { sleepInterval?: number }): Promise<{ videoId?: string; status?: string }>;
  };
  analyze(args: {
    videoId: string;
    prompt: string;
    modelName?: string;
    maxTokens?: number;
    startTime?: number;
    endTime?: number;
  }): Promise<{ data?: string; finishReason?: string }>;
}

export const DEFAULT_PEGASUS_PROMPT =
  "Describe this video in detail as a timeline. For each distinct scene or event, " +
  "note the approximate timestamp, what is visually happening, on-screen text, and " +
  "any notable audio. Be specific and factual.";

export interface AnalyzeSlice {
  startTime?: number;
  endTime?: number;
}

/**
 * Ensure an index exists for the Pegasus model and return its id. Reuses an
 * existing index with the same name when present so repeated runs don't pile up
 * empty indexes.
 */
export async function resolvePegasusIndex(
  client: TwelveLabsLike,
  indexName: string,
  modelName: string,
): Promise<string> {
  const existing = await findIndexByName(client, indexName);
  if (existing) return existing;

  const created = await client.indexes.create({
    indexName,
    models: [{ modelName, modelOptions: ["visual", "audio"] }],
  });
  if (!created.id) {
    throw new Error("TwelveLabs index creation returned no id");
  }
  return created.id;
}

async function findIndexByName(client: TwelveLabsLike, indexName: string): Promise<string | undefined> {
  const listed = client.indexes.list({ indexName });
  // The SDK returns a paginated async-iterable; a fake may return a plain page.
  if (Symbol.asyncIterator in Object(listed)) {
    for await (const idx of listed as AsyncIterable<{ id?: string }>) {
      if (idx.id) return idx.id;
    }
    return undefined;
  }
  const page = await (listed as Promise<{ data?: { id?: string }[] }>);
  return page.data?.find((i) => i.id)?.id;
}

/**
 * Upload a video to the index (by local path or public URL), wait for indexing,
 * and return the resulting videoId Pegasus can analyze.
 */
export async function indexVideo(
  client: TwelveLabsLike,
  indexId: string,
  source: { videoUrl?: string; videoPath?: string },
  pollSleepSeconds: number,
): Promise<string> {
  const create = source.videoUrl
    ? { indexId, videoUrl: source.videoUrl }
    : { indexId, videoFile: createReadStream(source.videoPath!) };

  const task = await client.tasks.create(create);
  if (!task.id) {
    throw new Error("TwelveLabs indexing task returned no id");
  }

  const done = await client.tasks.waitForDone(task.id, { sleepInterval: pollSleepSeconds });
  if (done.status && done.status !== "ready") {
    throw new Error(`TwelveLabs indexing task ended with status "${done.status}"`);
  }
  const videoId = done.videoId ?? task.videoId;
  if (!videoId) {
    throw new Error("TwelveLabs indexing completed but no videoId was returned");
  }
  return videoId;
}

export interface PegasusDeps {
  makeClient?: (apiKey: string) => TwelveLabsLike | Promise<TwelveLabsLike>;
}

/**
 * Analyze a video with TwelveLabs Pegasus and return the result shaped as the
 * plugin's AudioResult. Pegasus produces a holistic video understanding rather
 * than a transcript, so the text lands in `full_analysis` (transcription/tags
 * stay empty — the existing audio backends own those).
 */
export async function analyzeWithTwelveLabs(
  source: { videoUrl?: string; videoPath?: string },
  config: Config,
  slice?: AnalyzeSlice,
  deps: PegasusDeps = {},
): Promise<AudioResult> {
  const apiKey = process.env.TWELVELABS_API_KEY;
  if (!apiKey) {
    throw new Error("TWELVELABS_API_KEY environment variable is not set. Run video_setup to configure.");
  }
  if (!source.videoUrl && !source.videoPath) {
    throw new Error("analyzeWithTwelveLabs requires a videoUrl or videoPath");
  }

  const makeClient = deps.makeClient ?? defaultClientFactory;
  const client = await makeClient(apiKey);

  const model = config.twelvelabs_model;
  const indexName = config.twelvelabs_index_name;

  const indexId = await resolvePegasusIndex(client, indexName, model);
  const videoId = await indexVideo(client, indexId, source, config.twelvelabs_poll_seconds);

  // start_time/end_time analysis windows require Pegasus 1.5+; on 1.2 the API
  // rejects them, so only forward a slice when the configured model supports it.
  const window = modelSupportsWindow(model)
    ? {
        ...(slice?.startTime !== undefined ? { startTime: slice.startTime } : {}),
        ...(slice?.endTime !== undefined ? { endTime: slice.endTime } : {}),
      }
    : {};

  const response = await client.analyze({
    videoId,
    prompt: config.twelvelabs_prompt || DEFAULT_PEGASUS_PROMPT,
    modelName: model,
    maxTokens: config.twelvelabs_max_tokens,
    ...window,
  });

  const text = response.data ?? "";
  return {
    backend: "twelvelabs",
    transcription: [],
    audio_tags: [],
    full_analysis: text.length > 0 ? text : null,
  };
}

async function defaultClientFactory(apiKey: string): Promise<TwelveLabsLike> {
  // Lazy import so the optional dependency is only loaded when this backend
  // is actually selected (matches how gemini-api / openai are wired).
  const { TwelveLabs } = await import("twelvelabs-js");
  return new TwelveLabs({ apiKey }) as unknown as TwelveLabsLike;
}

/** Pegasus 1.5 and later support start_time/end_time analysis windows; 1.2 does not. */
export function modelSupportsWindow(modelName: string): boolean {
  const m = /^pegasus(\d+)\.(\d+)/.exec(modelName);
  if (!m) return false;
  const major = Number(m[1]);
  const minor = Number(m[2]);
  return major > 1 || (major === 1 && minor >= 5);
}

export function pegasusDurationGuard(durationSeconds: number): string | null {
  if (durationSeconds < PEGASUS_MIN_SECONDS) {
    return `Pegasus requires videos of at least ${PEGASUS_MIN_SECONDS}s (got ${Math.round(durationSeconds)}s).`;
  }
  if (durationSeconds > PEGASUS_MAX_SECONDS) {
    return `Pegasus synchronous analysis supports videos up to ${PEGASUS_MAX_SECONDS}s (1 hour); got ${Math.round(durationSeconds)}s.`;
  }
  return null;
}
