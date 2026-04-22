# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
