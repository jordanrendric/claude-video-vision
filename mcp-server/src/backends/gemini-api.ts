import type { AudioResult } from "../types.js";

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

export async function analyzeWithGeminiApi(videoPath: string): Promise<AudioResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY environment variable is not set. Run video_setup to configure.");
  }

  const { GoogleGenAI, createPartFromUri, createUserContent } = await import("@google/genai");
  const ai = new GoogleGenAI({ apiKey });

  const uploaded = await ai.files.upload({
    file: videoPath,
    config: { mimeType: getMimeType(videoPath) },
  });

  await waitForFileActive(ai as unknown as GenAiClient, uploaded);

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: createUserContent([
        createPartFromUri(uploaded.uri!, uploaded.mimeType!),
        `Analyze this video in detail. Provide:
1. A complete transcription of all speech with timestamps
2. Description of non-speech audio events (music, sound effects, ambient sounds) with timestamps
3. A detailed visual description of what happens

Format with clear sections: TRANSCRIPTION, AUDIO_EVENTS, VISUAL_DESCRIPTION.`,
      ]),
      config: {
        thinkingConfig: { thinkingBudget: 0 },
      },
    });

    return {
      backend: "gemini-api",
      transcription: [],
      audio_tags: [],
      full_analysis: response.text || "",
    };
  } finally {
    await ai.files.delete({ name: uploaded.name! }).catch(() => {});
  }
}

function getMimeType(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase();
  const mimeTypes: Record<string, string> = {
    mp4: "video/mp4",
    mov: "video/quicktime",
    avi: "video/x-msvideo",
    mkv: "video/x-matroska",
    webm: "video/webm",
    flv: "video/x-flv",
    wmv: "video/x-ms-wmv",
  };
  return mimeTypes[ext || ""] || "video/mp4";
}
