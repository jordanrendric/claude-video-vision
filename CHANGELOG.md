# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.1] - 2026-04-26

### Fixed

- **openai-whisper Python backend:** `video_watch` no longer crashes with `argument --language: invalid choice: 'auto'` on every call. The openai-whisper CLI accepts only explicit ISO codes for `--language` (or omission for the built-in 30-second auto-detection). The `--language auto` argument has been removed from the Python branch; the `whisper.cpp` branch is unchanged because cpp does accept `auto`.
- **Stray `audio.json` in user CWD:** the openai-whisper CLI writes its JSON output to the working directory by default. The Python backend now passes `--output_dir` pointing at the same scratch directory as the input wav, and best-effort removes the file after parsing stdout, so users no longer find an orphan `audio.json` next to their project files after every `video_watch` call.

## [1.2.0] - 2026-04-25

### Added

- **New tool: `video_analyze`** — Runs ffmpeg analytical filters (scdet, blackdetect, silencedetect, freezedetect, siti, blurdetect, signalstats, ebur128) in a single pass. Claude selects which filters to use based on the user's question. Optional audio transcription via configured backend. Returns structured JSON with scene changes, silence intervals, motion profile, and content classification.
- **New tool: `video_detail`** — Drill-down into specific video segments with variable FPS/resolution. Separates extraction from viewing: extract many frames to disk, view only a subset. Supports `view_sample` for evenly spaced frames and `view` for specific timestamps.
- **Session system** (`enable_index` config) — Persistent sessions at `~/.claude-video-vision/sessions/{video-hash}/`. Manifest tracks frames by resolution, deduplicates across calls. Auto-cleanup of expired sessions on server startup via `session_max_age_days`.
- **Segment-based extraction** — `video_watch` and `video_detail` now accept a `segments` param for variable FPS/resolution per time range, enabling smart extraction driven by analysis data.
- **`view_sample` param** on `video_watch` — Returns N evenly spaced frames instead of all, reducing context usage.
- **`clear_sessions` action** on `video_configure` — Deletes all cached sessions.

### Changed

- **Skill rewrite (video-perception + watch-video):** New analyze-first workflow. For videos > 30s, Claude calls `video_analyze` to get structural data + transcription before extracting frames. Short videos (< 2min) use full auto FPS for complete coverage.
- **`video_configure`** now accepts `enable_index` and `session_max_age_days` params.

### Fixed

- **Command injection in whisper model download:** Replaced shell-interpolated curl invocation with `execFile` array arguments, preventing injection via crafted model paths.
- **Model integrity verification:** Added streaming SHA-256 checksum verification for all 12 whisper model downloads (verified against HuggingFace Git LFS pointers, including `large-v3-turbo`). Uses `createReadStream` + `pipeline` to avoid OOM on large models.
- **Input validation:** Added `validateVideoPath()` (shared module) for path resolution and file type checks. Added `HMS_REGEX` validation on `start_time`/`end_time` params to prevent ffmpeg argument injection.
- **`skip_audio` flag and `has_audio` detection:** `video_watch` now gracefully skips audio extraction when the video has no audio stream or `skip_audio: true`.
- **ffmpeg filter output parsing:** Fixed `ametadata` vs `metadata` filter mismatch in audio chain. Fixed `parseSitiOutput` regex to match actual ffmpeg SITI Summary format. Always appends metadata sink to video filter chain for scdet capture.

### Security

- Inspired by [@urielka](https://github.com/urielka)'s [fork](https://github.com/urielka/claude-video-vision), which identified the shell injection fix and proposed model checksum verification. Our implementation corrects the checksum values for `base.en` and `large-v3`, uses streaming hashing to avoid OOM, and adds `large-v3-turbo` coverage. Thanks for the contribution!

### Tests

- 50 new unit tests (types, config, session manager, session manifest, analyzers, segment extraction). Total suite: 91/91 passing.

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
