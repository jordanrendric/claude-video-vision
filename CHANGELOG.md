# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.4.0] - 2026-10-05

### Changed

- **Node.js 24 LTS is now the minimum** (`engines.node: >=24`). Node 20 reached end-of-life on 2026-04-30. CI runs on Node 24 and 26. Users on Node 22 will see an `EBADENGINE` warning from `npx`.
- **`video_analyze` scene detection defaults to a scdet score of 8 (was 2).** Scores below 8 are mostly handheld motion and fast pans, not cuts, so `scene_changes: true` now returns far fewer and more accurate scenes. Pass `scene_changes: { threshold: 2 }` to get the old behavior back (#45).
- **Dependencies:** `openai` 4 → 7, `@google/genai` 1 → 2, `zod` 3 → 4, `@modelcontextprotocol/sdk` 1.29 → 1.32, TypeScript 5 → 7. No changes to tool schemas or backend behavior.
- Tool descriptions now state that `start_time` / `end_time` and segment `start` / `end` are absolute timestamps, not durations (#35).

### Added

- **`scene_changes: { threshold: N }`** on `video_analyze` (0–100) to tune scene detection per call (#45).
- **`analysis.incomplete`** on `video_analyze`: when the ffmpeg pass stops early, the result says how far the analysis got (`analyzed_until`) instead of silently returning partial data (#47).
- README troubleshooting section for the Windows `Unknown command: "claude-video-vision@latest"` MCP startup failure.

### Fixed

- **`video_watch` / `video_detail` time ranges:** `end_time` and segment `end` were read by ffmpeg as a *duration* from the start time, so a `01:29 → 01:30` segment extracted 90 seconds of frames. Segments also shared one output directory, mixing frames between segments and with stale files. Each segment now returns exactly its own frames (#46).
- **`video_analyze` truncated long videos:** the single ffmpeg pass had a flat 10-minute timeout, so on long or 4K sources it was killed mid-file and the partial result was returned as if complete (e.g. no scenes after 01:09 in a 2.5h film). The timeout now scales with the video length, and an early stop is reported via `analysis.incomplete` (#47).
- **`video_analyze` stderr fallback** never matched the `score: X, time: Y` log format of current ffmpeg builds; it now parses both formats, and the scdet filter and both parsers use the same threshold (#45).
- **Session cache:** with `enable_index`, `video_watch` segments stored raw `frame_XXXX` paths in the manifest, which later runs overwrote. Frames are now cached under timestamp-named files (#46).
- `video_watch` now always removes its temporary `/tmp/cvv-*` work dir, including when session indexing is on and when extraction fails.
- Security: transitive dependency updates clear all runtime `npm audit` findings (1 critical, 4 high).

### Upgrade notes

- If you used `video_watch` with `segments` and `enable_index: true` before this release, your session cache may point to wrong frames. Clear it with `video_configure` → `clear_sessions`, or delete `~/.claude-video-vision/sessions/`.

## [1.3.2] - 2026-05-18

### Fixed

- **whisper.cpp backend:** transcripts were parsed from stdout instead of the JSON file `--output-json` writes, so every transcription collapsed into a single segment at `00:00:00`. Voice activity detection is now enabled to stop hallucinated dialogue on silent or music-only audio (#40, #42).
- **Windows:** `video_analyze` returned empty `scenes` / `frame_stats` because the drive-letter path in the lavfi metadata filter wasn't escaped (#43, #44).

## [1.3.1] - 2026-05-11

### Added

- **`frame_format`** config and per-call option (`jpeg` | `png` | `webp`) on `video_watch` and `video_detail`. JPEG stays the default; PNG keeps screen recordings lossless. The session cache is keyed by format (#34).

## [1.3.0] - 2026-05-08

### Added

- **YouTube URLs** are accepted anywhere a video `path` is. Videos are downloaded and cached with `yt-dlp`. Transcripts come from manual subtitles, then auto-captions, then the configured backend, labeled with `transcription_source` (#26).
- **Gemini audio chunking:** long audio is split at silence-aware boundaries and transcribed in parallel with retries. Chunk decisions and failures are reported in `audio.warnings` / `analysis.audio_warnings`.
- New config fields: `audio_model`, `max_output_tokens`, `audio_chunk_trigger_seconds`, `audio_chunk_size_seconds`, `audio_chunk_overlap_seconds`.

### Fixed

- `video_analyze` returned no `silence_intervals` because an `ametadata` sink in the audio chain swallowed silencedetect's events (#27).
- `video_watch` with `view_sample` on long videos only covered the first ~25% of the video; fps is now derived from `view_sample` to span the full duration (#28).
- Audio extraction with a non-zero start time no longer includes pre-roll from before the requested start.

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
