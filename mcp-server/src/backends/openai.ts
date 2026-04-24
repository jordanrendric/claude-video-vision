import { readFileSync } from "fs";
import type { AudioResult, TranscriptionSegment } from "../types.js";
import { formatHMS } from "../utils/timestamps.js";

export async function transcribeWithOpenAI(wavPath: string): Promise<AudioResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY environment variable is not set. Run video_setup to configure.");
  }

  const OpenAI = (await import("openai")).default;
  const client = new OpenAI({ apiKey });

  const audioFile = new File(
    [readFileSync(wavPath)],
    "audio.wav",
    { type: "audio/wav" },
  );

  const response = await client.audio.transcriptions.create({
    model: "whisper-1",
    file: audioFile,
    response_format: "verbose_json",
    timestamp_granularities: ["segment"],
  });

  const transcription: TranscriptionSegment[] = (response.segments || []).map((seg: any) => ({
    start: formatHMS(seg.start),
    end: formatHMS(seg.end),
    text: seg.text.trim(),
  }));

  return {
    backend: "openai",
    transcription,
    audio_tags: [],
    full_analysis: null,
  };
}
