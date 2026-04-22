<p align="center">
  <img src="./assets/hero.avif" alt="claude-video-vision" width="100%" />
</p>

# Claude Code Video Vision

Give Claude the ability to **watch and understand videos**.

A Claude Code plugin that extracts frames via ffmpeg and processes audio via multiple backends (Gemini API, local Whisper, or OpenAI API). Claude receives frames as images and audio transcription with timestamps — the plugin is a **perception layer**, not an interpretation layer.

## Features

- **Multimodal perception** — Claude sees video frames directly and reads audio transcriptions with timestamps
- **Flexible backends** — Choose between cloud APIs or fully local processing
- **Adaptive extraction** — Claude adjusts fps, time range, and resolution based on your question
- **Auto-installation** — Whisper models download automatically on first use
- **Interactive setup wizard** — `/setup-video-vision` walks you through configuration

## Quick Start

### 1. Install the plugin

Inside Claude Code, run these commands **one at a time**:

```
/plugin marketplace add https://github.com/jordanrendric/claude-video-vision
```

Then:

```
/plugin install claude-video-vision
```

The MCP server will auto-install via `npx` from [npm](https://www.npmjs.com/package/claude-video-vision) on first use — no build step required.

Alternative: local development

```bash
git clone https://github.com/jordanrendric/claude-video-vision.git
claude --plugin-dir /path/to/claude-video-vision
```

### 2. Configure

Inside Claude Code, run the interactive wizard:

```
/setup-video-vision
```

It will walk you through backend selection, whisper configuration (if local), frame options, and dependency verification.

## Usage

### Slash command

```
/watch-video path/to/video.mp4
/watch-video tutorial.mp4 "what language is used in this tutorial?"
```

### Conversational

Just mention a video file — Claude will detect it:

> "analisa esse vídeo pra mim: ~/Downloads/demo.mp4"
>
> "dá uma olhada no primeiro segundo de ~/videos/bug-report.mov"

Claude adapts parameters automatically:
- "the first second" → extracts at original fps from `00:00:00` to `00:00:01`
- "summarize this 1h lecture" → low fps, full duration
- "what text is on screen at 1:30?" → high resolution, narrow time window

## Backends

| Backend | Audio processing | Cost | Setup |
|---------|------------------|------|-------|
| **Gemini API** | Native (speech + non-speech events) | Free tier: 1500 req/day | `GEMINI_API_KEY` env var |
| **Local (Whisper)** | `whisper.cpp` or Python `openai-whisper` | Free, fully offline | `brew install whisper-cpp` + auto model download |
| **OpenAI API** | OpenAI Whisper API | Paid per usage | `OPENAI_API_KEY` env var |

**All backends** extract video frames via ffmpeg — Claude always has direct visual access.

## Architecture

```
┌───────────────────────────────────────────────────────┐
│ Claude Code (your session)                            │
│                                                       │
│  /watch-video  ──→  Skill: video-perception          │
│                        │                              │
│                        ▼                              │
│                  MCP tool: video_watch                │
│                        │                              │
└────────────────────────┼──────────────────────────────┘
                         │
                         ▼
      ┌────────────────────────────────────┐
      │ MCP Server (Node.js)               │
      │                                    │
      │  ┌──────────┐    ┌──────────────┐  │
      │  │ ffmpeg   │    │ Audio backend│  │
      │  │ frames   │ ║  │ (parallel)   │  │
      │  └──────────┘    └──────────────┘  │
      │       │                 │          │
      └───────┼─────────────────┼──────────┘
              ▼                 ▼
        base64 images     transcription
        + timestamps      + audio events
              │                 │
              └────────┬────────┘
                       ▼
              Claude receives both
```

## Requirements

- **Node.js 20+** (for the MCP server)
- **ffmpeg** (auto-detected, install instructions provided by setup wizard)
- **Backend-specific**:
  - Gemini API: free API key from [ai.google.dev](https://ai.google.dev/gemini-api/docs/api-key)
  - Local: `brew install whisper-cpp` (macOS) or equivalent
  - OpenAI: API key from OpenAI

## MCP Tools

The plugin exposes 4 MCP tools:

- `video_watch` — Extract frames + process audio (main tool)
- `video_info` — Get video metadata without processing
- `video_configure` — Change settings
- `video_setup` — Check and guide dependency installation

## Slash Commands

- `/watch-video <path> [question]` — Analyze a video
- `/setup-video-vision` — Interactive configuration wizard

## Configuration

Settings are stored in `~/.claude-video-vision/config.json`:

```json
{
  "backend": "local",
  "whisper_engine": "cpp",
  "whisper_model": "auto",
  "whisper_at": false,
  "frame_mode": "images",
  "frame_resolution": 512,
  "default_fps": "auto",
  "max_frames": 100,
  "frame_describer_model": "sonnet"
}
```

**Whisper models** auto-download to `~/.claude-video-vision/models/` on first use. Available: `tiny`, `base`, `small`, `medium`, `large-v3-turbo`, `large-v3`, `auto` (picks best for your RAM).

## Status

**v1.0.0** — Initial release. Tested on macOS (Apple Silicon) with Local backend (whisper.cpp).

## License

MIT — see [LICENSE](./LICENSE).

## Author

**Jordan Vasconcelos**

- GitHub: [@jordanrendric](https://github.com/jordanrendric)
- LinkedIn: [jordanvasconcelos](https://www.linkedin.com/in/jordanvasconcelos/)
- Instagram: [@jordanvasconcelos__](https://www.instagram.com/jordanvasconcelos__/)
