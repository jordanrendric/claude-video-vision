import { execFile } from "child_process";
import { promisify } from "util";
import { platform, arch, totalmem, freemem } from "os";

const execFileAsync = promisify(execFile);

export interface PlatformInfo {
  os: "macos" | "linux" | "windows";
  arch: "arm64" | "x64";
  gpu: "apple-silicon" | "nvidia" | "none";
  ram_gb: number;
  free_ram_gb: number;
}

export function detectPlatform(): PlatformInfo {
  const os = platform() === "darwin" ? "macos" : platform() === "win32" ? "windows" : "linux";
  const cpuArch = arch() === "arm64" ? "arm64" : "x64";
  const ram_gb = Math.round(totalmem() / (1024 ** 3));
  const free_ram_gb = Math.round(freemem() / (1024 ** 3));

  let gpu: PlatformInfo["gpu"] = "none";
  if (os === "macos" && cpuArch === "arm64") {
    gpu = "apple-silicon";
  }
  // NVIDIA detection is done async via detectGpu()

  return { os, arch: cpuArch, gpu, ram_gb, free_ram_gb };
}

export async function detectGpu(): Promise<PlatformInfo["gpu"]> {
  const info = detectPlatform();
  if (info.gpu === "apple-silicon") return "apple-silicon";

  try {
    await execFileAsync("nvidia-smi", ["--query-gpu=name", "--format=csv,noheader"]);
    return "nvidia";
  } catch {
    return "none";
  }
}

export async function checkCommand(command: string): Promise<boolean> {
  const which = process.platform === "win32" ? "where" : "which";
  try {
    await execFileAsync(which, [command]);
    return true;
  } catch {
    return false;
  }
}

export function recommendWhisperModel(ram_gb: number): string {
  if (ram_gb < 4) return "tiny";
  if (ram_gb < 8) return "small";
  if (ram_gb < 16) return "large-v3-turbo";
  return "large-v3";
}
