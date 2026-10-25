import { readFileSync } from "fs";
import type { AudioResult, TranscriptionSegment } from "../types.js";
import { formatHMS } from "../utils/timestamps.js";
import { normalizeVocabulary, MAX_VOCABULARY_TERMS } from "../utils/vocabulary.js";

export const MISTRAL_BASE_URL = "https://api.mistral.ai/v1";
export const MISTRAL_DEFAULT_MODEL = "voxtral-mini-latest";
export const MISTRAL_MAX_CONTEXT_BIAS = MAX_VOCABULARY_TERMS;

/**
 * Parses a context-bias list for Mistral. The API rejects any item containing
 * whitespace or a comma (error 3051), so multi-word entries such as
 * "Costing IT" are split into single words. De-duplicated, capped at 100.
 */
export const parseContextBias = normalizeVocabulary;

export interface MistralOptions {
  /** Vocabulary hints (see config `vocabulary`). Falls back to MISTRAL_CONTEXT_BIAS. */
  vocabulary?: string[];
}

/**
 * Builds the multipart body for Mistral's `audio/transcriptions` endpoint.
 *
 * List parameters are sent as repeated plain fields (`context_bias=a`,
 * `context_bias=b`), the encoding Mistral's own SDK and curl examples use.
 * The OpenAI SDK would send `name[]` instead, which is why this backend
 * talks to Mistral with `fetch` rather than reusing that SDK.
 */
export function buildMistralForm(opts: {
  audio: Blob;
  model: string;
  contextBias: string[];
}): FormData {
  const form = new FormData();
  form.append("file", opts.audio, "audio.wav");
  form.append("model", opts.model);
  form.append("timestamp_granularities", "segment");
  for (const term of opts.contextBias) {
    form.append("context_bias", term);
  }
  return form;
}

/**
 * Transcribes audio with Mistral's Voxtral models.
 *
 * Notes on the request:
 *   - auth via MISTRAL_API_KEY
 *   - model is `voxtral-mini-latest` by default (override with
 *     MISTRAL_TRANSCRIPTION_MODEL); at the time of writing it is the only
 *     model the transcription endpoint accepts
 *   - `language` must NOT be sent alongside `timestamp_granularities`
 *     (Mistral rejects the combination), so we rely on auto-detection
 *   - `context_bias` (up to 100 single words) nudges the model toward
 *     domain vocabulary such as product or organisation names; comes from
 *     the `vocabulary` config setting, or MISTRAL_CONTEXT_BIAS as a fallback
 */
export async function transcribeWithMistral(wavPath: string, options: MistralOptions = {}): Promise<AudioResult> {
  const apiKey = process.env.MISTRAL_API_KEY;
  if (!apiKey) {
    throw new Error("MISTRAL_API_KEY environment variable is not set. Run video_setup to configure.");
  }

  const model = process.env.MISTRAL_TRANSCRIPTION_MODEL || MISTRAL_DEFAULT_MODEL;
  const contextBias = options.vocabulary && options.vocabulary.length > 0
    ? normalizeVocabulary(options.vocabulary)
    : parseContextBias(process.env.MISTRAL_CONTEXT_BIAS);

  const form = buildMistralForm({
    audio: new Blob([readFileSync(wavPath)], { type: "audio/wav" }),
    model,
    contextBias,
  });

  const res = await fetch(`${MISTRAL_BASE_URL}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Mistral transcription failed (${res.status} ${res.statusText}): ${detail.slice(0, 500)}`);
  }

  const response: any = await res.json();

  const segments: any[] = response.segments || [];
  const transcription: TranscriptionSegment[] = segments.map((seg: any) => ({
    start: formatHMS(seg.start),
    end: formatHMS(seg.end),
    text: String(seg.text ?? "").trim(),
  }));

  // Some responses may omit segments (very short clips); fall back to the
  // full text as a single segment so Claude still sees the transcript.
  if (transcription.length === 0 && typeof response.text === "string" && response.text.trim()) {
    transcription.push({
      start: formatHMS(0),
      end: formatHMS(0),
      text: response.text.trim(),
    });
  }

  return {
    backend: "mistral",
    transcription,
    audio_tags: [],
    full_analysis: null,
  };
}
