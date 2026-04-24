import type { AudioResult, AudioTag, TranscriptionSegment } from "../types.js";

interface GenAiFile {
  name?: string;
  state?: string;
  uri?: string;
  mimeType?: string;
}

interface GenAiFilesApi {
  get(args: { name: string }): Promise<GenAiFile>;
  delete(args: { name: string }): Promise<void>;
}

interface GenAiClient {
  files: GenAiFilesApi;
}

interface WaitForFileActiveOptions {
  timeoutMs?: number;
  pollIntervalMs?: number;
}

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_POLL_INTERVAL_MS = 2_000;

export async function waitForFileActive(
  ai: GenAiClient,
  file: GenAiFile,
  options: WaitForFileActiveOptions = {},
): Promise<GenAiFile> {
  if (!file.name) {
    throw new Error("Cannot poll Gemini file state: file.name is missing");
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const deadline = Date.now() + timeoutMs;

  let current = file;
  while (current.state !== "ACTIVE") {
    if (current.state === "FAILED") {
      throw new Error(
        `Gemini file ${current.name} processing failed`,
      );
    }

    if (Date.now() > deadline) {
      throw new Error(
        `Gemini file ${current.name} stuck in state ${current.state ?? "unknown"} after ${timeoutMs}ms`,
      );
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    current = await ai.files.get({ name: current.name! });
  }

  return current;
}

interface ParsedGeminiAudio {
  transcription: TranscriptionSegment[];
  audio_tags: AudioTag[];
}

export function parseGeminiAudioResponse(raw: string): ParsedGeminiAudio {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `Gemini returned non-JSON response despite structured output config: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Gemini JSON response is not an object");
  }

  const obj = parsed as Record<string, unknown>;
  const transcription = Array.isArray(obj.transcription)
    ? (obj.transcription as TranscriptionSegment[])
    : [];
  const audio_tags = Array.isArray(obj.audio_tags)
    ? (obj.audio_tags as AudioTag[])
    : [];

  return { transcription, audio_tags };
}

export async function analyzeWithGeminiApi(audioPath: string): Promise<AudioResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY environment variable is not set. Run video_setup to configure.");
  }

  const { GoogleGenAI, createPartFromUri, createUserContent, Type } = await import("@google/genai");
  const ai = new GoogleGenAI({ apiKey });

  const uploaded = await ai.files.upload({
    file: audioPath,
    config: { mimeType: getMimeType(audioPath) },
  });

  await waitForFileActive(ai as unknown as GenAiClient, uploaded);

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: createUserContent([
        createPartFromUri(uploaded.uri!, uploaded.mimeType!),
        `Analyze this audio track and return structured JSON.

Produce two arrays:
1. "transcription": one entry per contiguous speech segment, with start and end timestamps as "HH:MM:SS" strings and the spoken text verbatim.
2. "audio_tags": one entry per non-speech audio event (music, sound effects, ambient sounds) with start and end timestamps as "HH:MM:SS" strings and a short lowercase label.

Use "00:00:00" if you cannot determine a timestamp. Return empty arrays if no speech or no non-speech events are present.`,
      ]),
      config: {
        thinkingConfig: { thinkingBudget: 0 },
        responseMimeType: "application/json",
        responseJsonSchema: {
          type: Type.OBJECT,
          properties: {
            transcription: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  start: {
                    type: Type.STRING,
                    description: "HH:MM:SS start timestamp",
                  },
                  end: {
                    type: Type.STRING,
                    description: "HH:MM:SS end timestamp",
                  },
                  text: {
                    type: Type.STRING,
                    description: "Verbatim spoken text for this segment",
                  },
                },
                propertyOrdering: ["start", "end", "text"],
                required: ["start", "end", "text"],
              },
            },
            audio_tags: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  start: {
                    type: Type.STRING,
                    description: "HH:MM:SS start timestamp",
                  },
                  end: {
                    type: Type.STRING,
                    description: "HH:MM:SS end timestamp",
                  },
                  tag: {
                    type: Type.STRING,
                    description: "Short lowercase label for the audio event",
                  },
                },
                propertyOrdering: ["start", "end", "tag"],
                required: ["start", "end", "tag"],
              },
            },
          },
          propertyOrdering: ["transcription", "audio_tags"],
          required: ["transcription", "audio_tags"],
        },
      },
    });

    const parsed = parseGeminiAudioResponse(response.text ?? "");

    return {
      backend: "gemini-api",
      transcription: parsed.transcription,
      audio_tags: parsed.audio_tags,
      full_analysis: null,
    };
  } finally {
    await ai.files.delete({ name: uploaded.name! }).catch(() => {});
  }
}

function getMimeType(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase();
  const mimeTypes: Record<string, string> = {
    wav: "audio/wav",
    mp3: "audio/mp3",
    aac: "audio/aac",
    flac: "audio/flac",
    ogg: "audio/ogg",
    aiff: "audio/aiff",
  };
  return mimeTypes[ext || ""] || "audio/wav";
}
