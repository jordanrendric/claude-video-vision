import { execFile } from "child_process";
import { promisify } from "util";
import { mkdirSync, existsSync } from "fs";
import { join } from "path";

const execFileAsync = promisify(execFile);

export interface ExtractAudioOptions {
  startTime?: string;
  endTime?: string;
}

export async function extractAudio(
  videoPath: string,
  outputDir: string,
  options: ExtractAudioOptions = {},
): Promise<string> {
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  const outputPath = join(outputDir, "audio.wav");
  const args: string[] = [];

  if (options.startTime) {
    args.push("-ss", options.startTime);
  }

  args.push("-i", videoPath);

  if (options.endTime) {
    args.push("-to", options.endTime);
  }

  args.push(
    "-vn",
    "-acodec", "pcm_s16le",
    "-ar", "16000",
    "-ac", "1",
    "-y",
    outputPath,
  );

  await execFileAsync("ffmpeg", args);
  return outputPath;
}
