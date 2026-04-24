# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-04-23

### Fixed

- **Gemini API backend:** `video_watch` no longer fails with `FAILED_PRECONDITION` on every call. The backend now polls the uploaded file's state via `ai.files.get()` until it reaches `ACTIVE` before calling `generateContent`. Thanks to [@JaredTheHammer](https://github.com/JaredTheHammer) for the precise diagnosis ([#19](https://github.com/jordanrendric/claude-video-vision/issues/19)).
- **Timestamp alignment across cropped windows:** when `video_watch` is called with `start_time`, audio backends previously returned timestamps relative to the cropped audio (starting at `00:00:00`), misaligning with the frame timestamps. All three backends and the frame extractor now emit timestamps relative to the original video timeline.

### Changed

- **Gemini backend now audio-only.** `analyzeWithGeminiApi()` accepts an audio path instead of a video path. `video_watch` extracts audio via ffmpeg (16kHz mono wav) before calling the backend, matching the pattern already used by `local` and `openai`. Cuts upload size and token cost dramatically.
- **Gemini backend returns structured JSON.** Uses `responseMimeType: "application/json"` with a `responseJsonSchema` defining `transcription` and `audio_tags` arrays with `HH:MM:SS` timestamps. `AudioResult.transcription` and `AudioResult.audio_tags` are now populated directly; `full_analysis` is `null`, matching the other backends.

### Added

- Shared `src/utils/timestamps.ts` helper with `parseHMS`, `formatHMS`, and `shiftAudioResult`. Removes duplicated `formatTime` functions from `local.ts`, `openai.ts`, and `frames.ts`.
- Integration test script `scripts/test-gemini-api.ts` for validating the Gemini backend against a real API key end-to-end. Run via `npm run test:gemini -- <video-path>`.
- Offline token measurement script `scripts/measure-tokens.ts` (standalone, no API key required). Uses `js-tiktoken` and Anthropic's `(w*h)/750` image-token formula to estimate `video_watch` token cost. Run via `npm run measure -- <video-path>` or `--matrix`.

### Tests

- 26 new unit tests (8 for Gemini file-state polling, 18 for timestamp helpers). Total suite: 41/41 passing on Ubuntu and macOS, Node 20 and 22.

## [1.0.2] - 2026-04-22

### Changed

- Switched release workflow to npm Trusted Publisher (OIDC). No long-lived `NPM_TOKEN` required.

## [1.0.1] - 2026-04-22

### Changed

- MCP server published to npm as [`claude-video-vision`](https://www.npmjs.com/package/claude-video-vision)
- Plugin `.mcp.json` now invokes the server via `npx -y claude-video-vision@latest` — no local `npm install` or `npm run build` required
- Added `Release` GitHub workflow: tagging `v*` publishes to npm automatically (with provenance)

## [1.0.0] - 2026-04-22

### Added

- MCP server with 4 tools: `video_watch`, `video_info`, `video_setup`, `video_configure`
- Frame extraction via ffmpeg with configurable fps and resolution
- Audio extraction and transcription via multiple backends:
  - Gemini API (native audio understanding)
  - Local Whisper (`whisper.cpp` + Python `openai-whisper`)
  - OpenAI Whisper API
- Interactive setup wizard: `/setup-video-vision`
- Slash command: `/watch-video`
- Skill `video-perception` that teaches Claude to detect video references automatically
- Sub-agent `frame-describer` for text-based frame descriptions
- Auto-download of Whisper models from HuggingFace on first use
- Adaptive parameter selection: fps, resolution, and time ranges adapt to the user's question
- Parallel processing of frames and audio
- Platform detection (macOS/Linux/Windows, Apple Silicon/x64/NVIDIA)
- Persistent configuration at `~/.claude-video-vision/config.json`

### Notes

- Gemini CLI was considered but not included — its Cloud Code API does not support audio/video via function calling.
