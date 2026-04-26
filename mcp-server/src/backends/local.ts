import { execFile } from "child_process";
import { promisify } from "util";
import { existsSync, mkdirSync, rmSync, createReadStream } from "fs";
import { createHash } from "crypto";
import { basename, dirname, join } from "path";
import { pipeline } from "stream/promises";
import { detectPlatform, recommendWhisperModel } from "../utils/platform.js";
import { formatHMS } from "../utils/timestamps.js";
import type { AudioResult, TranscriptionSegment, AudioTag } from "../types.js";
import type { WhisperEngine, WhisperModel } from "../types.js";

const execFileAsync = promisify(execFile);

function resolveModel(model: WhisperModel): string {
  if (model === "auto") {
    return recommendWhisperModel(detectPlatform().ram_gb);
  }
  return model;
}

export interface WhisperOptions {
  engine: WhisperEngine;
  model: WhisperModel;
  whisperAt: boolean;
  modelDir: string;
}

export async function transcribeWithWhisper(
  wavPath: string,
  options: WhisperOptions,
): Promise<AudioResult> {
  const { engine, model, whisperAt, modelDir } = options;

  if (engine === "cpp") {
    return transcribeWithWhisperCpp(wavPath, model, modelDir);
  }
  return transcribeWithWhisperPython(wavPath, model, whisperAt);
}

async function transcribeWithWhisperCpp(
  wavPath: string,
  model: string,
  modelDir: string,
): Promise<AudioResult> {
  const resolved = resolveModel(model as WhisperModel);
  const modelPath = `${modelDir}/ggml-${resolved}.bin`;

  // SHA-256 checksums verified against HuggingFace Git LFS pointers
  const KNOWN_CHECKSUMS: Record<string, string> = {
    "tiny":            "be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21",
    "tiny.en":         "921e4cf8686fdd993dcd081a5da5b6c365bfde1162e72b08d75ac75289920b1f",
    "base":            "60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe",
    "base.en":         "a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002",
    "small":           "1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b",
    "small.en":        "c6138d6d58ecc8322097e0f987c32f1be8bb0a18532a3f88f734d1bbf9c41e5d",
    "medium":          "6c14d5adee5f86394037b4e4e8b59f1673b6cee10e3cf0b11bbdbee79c156208",
    "medium.en":       "cc37e93478338ec7700281a7ac30a10128929eb8f427dda2e865faa8f6da4356",
    "large-v1":        "7d99f41a10525d0206bddadd86760181fa920438b6b33237e3118ff6c83bb53d",
    "large-v2":        "9a423fe4d40c82774b6af34115b8b935f34152246eb19e80e376071d3f999487",
    "large-v3":        "64d182b440b98d5203c4f9bd541544d84c605196c4f7b845dfa11fb23594d1e2",
    "large-v3-turbo":  "1fc70f774d38eb169993ac391eea357ef47c88757ef72ee5943879b7e8e2bc69",
  };

  if (!existsSync(modelPath)) {
    const dir = dirname(modelPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    const downloadUrl = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${resolved}.bin`;
    console.error(`[cvv] Downloading whisper model ggml-${resolved}.bin...`);
    await execFileAsync("curl", ["-L", "-o", modelPath, downloadUrl], {
      timeout: 600_000,
    });
    console.error(`[cvv] Model downloaded to ${modelPath}`);

    if (!existsSync(modelPath)) {
      throw new Error(`Failed to download model from ${downloadUrl}`);
    }

    const expectedSha = KNOWN_CHECKSUMS[resolved];
    if (expectedSha) {
      const hash = createHash("sha256");
      await pipeline(createReadStream(modelPath), hash);
      const actual = hash.digest("hex");
      if (actual !== expectedSha) {
        throw new Error(
          `Model checksum mismatch for ggml-${resolved}.bin — expected ${expectedSha}, got ${actual}. ` +
          `The downloaded file may be corrupt or tampered with.`,
        );
      }
      console.error(`[cvv] Checksum verified for ggml-${resolved}.bin`);
    } else {
      console.error(`[cvv] Warning: no known checksum for model "${resolved}" — skipping verification`);
    }
  }

  const { stdout } = await execFileAsync("whisper-cli", [
    "--model", modelPath,
    "--file", wavPath,
    "--output-json",
    "--language", "auto",
  ], { timeout: 600_000, maxBuffer: 50 * 1024 * 1024 });

  return parseWhisperOutput(stdout);
}

async function transcribeWithWhisperPython(
  wavPath: string,
  model: string,
  whisperAt: boolean,
): Promise<AudioResult> {
  const command = whisperAt ? "whisper-at" : "whisper";

  // openai-whisper Python CLI does not accept "auto" for --language;
  // omitting the flag triggers the built-in language auto-detection from
  // the first 30 seconds of audio, which is the behavior we want.
  //
  // We also pin --output_dir to the same scratch directory as the wav
  // input so whisper's side-effect JSON file lands in our temp dir and
  // gets reaped with it, instead of polluting the user's CWD.
  const outputDir = dirname(wavPath);

  const { stdout } = await execFileAsync(command, [
    wavPath,
    "--model", model,
    "--output_format", "json",
    "--output_dir", outputDir,
  ], { timeout: 600_000, maxBuffer: 50 * 1024 * 1024 });

  // Best-effort cleanup of the on-disk JSON; we already have what we
  // need on stdout via parseWhisperOutput. The CLI derives the output
  // filename from the input wav, so derive it the same way.
  try {
    const jsonName = basename(wavPath, ".wav") + ".json";
    rmSync(join(outputDir, jsonName), { force: true });
  } catch { /* ignore */ }

  return parseWhisperOutput(stdout);
}

function parseWhisperOutput(output: string): AudioResult {
  const transcription: TranscriptionSegment[] = [];
  const audioTags: AudioTag[] = [];

  try {
    const parsed = JSON.parse(output);
    const segments = parsed.segments || parsed.transcription || [];

    for (const seg of segments) {
      transcription.push({
        start: formatHMS(seg.start ?? seg.from ?? 0),
        end: formatHMS(seg.end ?? seg.to ?? 0),
        text: (seg.text || "").trim(),
      });
    }

    if (parsed.audio_tags || parsed.labels) {
      const tags = parsed.audio_tags || parsed.labels || [];
      for (const tag of tags) {
        audioTags.push({
          start: formatHMS(tag.start ?? 0),
          end: formatHMS(tag.end ?? 0),
          tag: tag.tag || tag.label || tag.name || "unknown",
        });
      }
    }
  } catch {
    if (output.trim()) {
      transcription.push({ start: "00:00:00", end: "00:00:00", text: output.trim() });
    }
  }

  return {
    backend: "local",
    transcription,
    audio_tags: audioTags,
    full_analysis: null,
  };
}
