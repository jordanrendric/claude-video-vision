import { createHash } from "crypto";
import { readFileSync, existsSync, readdirSync, rmSync, statSync, openSync, readSync, closeSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import type { SessionManifest } from "../types.js";

export function computeVideoHash(videoPath: string): string {
  const fd = openSync(videoPath, "r");
  const chunkSize = 64 * 1024;
  const buffer = Buffer.alloc(chunkSize);
  const bytesRead = readSync(fd, buffer, 0, chunkSize, 0);
  closeSync(fd);

  const fileSize = statSync(videoPath).size;
  const hash = createHash("sha256");
  hash.update(buffer.subarray(0, bytesRead));
  hash.update(String(fileSize));
  return hash.digest("hex").slice(0, 12);
}

export function getSessionDir(sessionsRoot: string, videoPath: string): string {
  const hash = computeVideoHash(videoPath);
  return join(sessionsRoot, hash);
}

export function loadManifest(sessionDir: string): SessionManifest | null {
  const manifestPath = join(sessionDir, "manifest.json");
  if (!existsSync(manifestPath)) return null;
  return JSON.parse(readFileSync(manifestPath, "utf-8"));
}

export function saveManifest(sessionDir: string, manifest: SessionManifest): void {
  if (!existsSync(sessionDir)) mkdirSync(sessionDir, { recursive: true });
  writeFileSync(join(sessionDir, "manifest.json"), JSON.stringify(manifest, null, 2));
}

export function cleanExpiredSessions(sessionsRoot: string, maxAgeDays: number): void {
  if (!existsSync(sessionsRoot)) return;

  const cutoff = Date.now() - maxAgeDays * 86400_000;
  const entries = readdirSync(sessionsRoot);

  for (const entry of entries) {
    const sessionDir = join(sessionsRoot, entry);
    const manifestPath = join(sessionDir, "manifest.json");
    if (!existsSync(manifestPath)) continue;

    try {
      const manifest: SessionManifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
      const createdAt = new Date(manifest.created_at).getTime();
      if (createdAt < cutoff) {
        rmSync(sessionDir, { recursive: true, force: true });
      }
    } catch {
      rmSync(sessionDir, { recursive: true, force: true });
    }
  }
}
