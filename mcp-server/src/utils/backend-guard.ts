import type { Backend } from "../types.js";

export const KNOWN_BACKENDS: readonly Backend[] = ["gemini-api", "local", "openai", "mistral"];
const SILENT_BACKENDS: readonly string[] = ["unconfigured", "none", "youtube-captions"];

/**
 * A config.json written by a newer plugin version (or by hand) may name a
 * backend this build does not implement. Falling through to a default branch
 * would transcribe with the wrong engine while reporting nothing, so refuse
 * loudly instead. Values that legitimately mean "no transcription" pass.
 */
export function assertKnownBackend(backend: string): void {
  if ((KNOWN_BACKENDS as readonly string[]).includes(backend) || SILENT_BACKENDS.includes(backend)) return;
  throw new Error(
    `Unknown audio backend "${backend}" in ~/.claude-video-vision/config.json. ` +
    `This plugin version supports: ${KNOWN_BACKENDS.join(", ")}. ` +
    `Run /setup-video-vision or video_configure to pick one, or update the plugin.`,
  );
}
