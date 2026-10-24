import { openAsBlob } from "fs";
import { basename } from "path";
import { setTimeout as sleep } from "timers/promises";
import type { AudioResult, AudioTag, TranscriptionSegment } from "../types.js";
import { formatHMS } from "../utils/timestamps.js";

const API_URL = "https://api.elevenlabs.io/v1/speech-to-text";
const RETRY_STATUS = new Set([429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 3;
// Scribe returns word-level timestamps; group them into segments at pauses,
// sentence ends, or a maximum length so the output matches the other backends.
const SEGMENT_PAUSE_SECONDS = 0.8;
const SEGMENT_MAX_SECONDS = 15;
const SENTENCE_END = /[.!?…]["')\]]*$/;

export interface ElevenLabsToken {
  text: string;
  start?: number;
  end?: number;
  type: "word" | "spacing" | "audio_event";
}

interface OpenSegment {
  start: number;
  end: number;
  text: string;
}

export function tokensToAudioResult(tokens: ElevenLabsToken[]): AudioResult {
  const transcription: TranscriptionSegment[] = [];
  const audioTags: AudioTag[] = [];
  let current: OpenSegment | null = null;

  const flush = (segment: OpenSegment | null) => {
    if (segment && segment.text.trim()) {
      transcription.push({ start: formatHMS(segment.start), end: formatHMS(segment.end), text: segment.text.trim() });
    }
  };

  for (const token of tokens) {
    const start = token.start ?? 0;
    const end = token.end ?? start;
    if (token.type === "audio_event") {
      audioTags.push({ start: formatHMS(start), end: formatHMS(end), tag: token.text.replace(/^[([]|[)\]]$/g, "").trim() });
      continue;
    }
    if (token.type === "spacing") {
      if (current) current.text += token.text;
      continue;
    }
    if (
      current &&
      (start - current.end > SEGMENT_PAUSE_SECONDS ||
        end - current.start > SEGMENT_MAX_SECONDS ||
        SENTENCE_END.test(current.text.trim()))
    ) {
      flush(current);
      current = null;
    }
    if (current) {
      current.text += token.text;
      current.end = end;
    } else {
      current = { start, end, text: token.text };
    }
  }
  flush(current);

  return { backend: "elevenlabs", transcription, audio_tags: audioTags, full_analysis: null };
}

function retryDelayMs(retryAfter: string | null, attempt: number): number {
  const seconds = retryAfter === null ? Number.NaN : Number(retryAfter);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : 2000 * 2 ** (attempt - 1);
}

export async function transcribeWithElevenLabs(wavPath: string, model: string): Promise<AudioResult> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    throw new Error("ELEVENLABS_API_KEY environment variable is not set. Run video_setup to configure.");
  }

  const form = new FormData();
  form.append("file", await openAsBlob(wavPath), basename(wavPath));
  form.append("model_id", model);
  form.append("timestamps_granularity", "word");
  form.append("tag_audio_events", "true");

  for (let attempt = 1; ; attempt++) {
    const response = await fetch(API_URL, { method: "POST", headers: { "xi-api-key": apiKey }, body: form });
    const body = await response.text();
    if (response.ok) {
      const payload = JSON.parse(body) as { words?: ElevenLabsToken[] };
      if (!Array.isArray(payload.words)) {
        throw new Error("ElevenLabs response has no 'words' array");
      }
      return tokensToAudioResult(payload.words);
    }
    if (!RETRY_STATUS.has(response.status) || attempt === MAX_ATTEMPTS) {
      throw new Error(`ElevenLabs HTTP ${response.status}: ${body.slice(0, 500)}`);
    }
    await sleep(retryDelayMs(response.headers.get("retry-after"), attempt));
  }
}
