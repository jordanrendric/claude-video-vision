# Privacy Policy

**Last updated:** 2026-04-22

This document describes how `claude-video-vision` handles your data.

## Summary

- **No telemetry**, no analytics, no account required.
- **No data is collected** by the maintainer of this plugin.
- Data is processed on your machine and optionally sent to a third-party API **that you explicitly configure**.

## Data the plugin processes

When you ask Claude to analyze a video:

1. **The video file you provide** is read from your local filesystem.
2. **Frames are extracted** using `ffmpeg` into a temporary directory, then deleted after the response.
3. **Audio is extracted** (when using a local or OpenAI backend) into a temporary `.wav` file, then deleted after the response.
4. **The video or audio is sent to the backend you configured** (see below).

## Backends and data flow

You choose one of three backends during `/setup-video-vision`. Each has different privacy implications:

### Local (Whisper)

- **Runs 100% offline.** Nothing leaves your machine.
- On first use, the plugin downloads a Whisper model file from HuggingFace (`huggingface.co/ggerganov/whisper.cpp`). This is a one-time download of public model weights.
- No API key required.

### Gemini API

- **Audio is sent to Google's Gemini API** via the endpoint `https://generativelanguage.googleapis.com`.
- Uses your `GEMINI_API_KEY` environment variable.
- Data handling is governed by Google's [Gemini API privacy policy](https://ai.google.dev/gemini-api/terms).
- The plugin does not log, store, or transmit your API key anywhere other than the Google API itself.

### OpenAI Whisper API

- **Audio is sent to OpenAI's Whisper API** via the endpoint `https://api.openai.com`.
- Uses your `OPENAI_API_KEY` environment variable.
- Data handling is governed by [OpenAI's privacy policy](https://openai.com/policies/privacy-policy).
- The plugin does not log, store, or transmit your API key anywhere other than the OpenAI API itself.

## Local files

The plugin writes and reads from these locations on your machine:

- `~/.claude-video-vision/config.json` — your chosen backend and extraction preferences
- `~/.claude-video-vision/models/` — downloaded Whisper models (Local backend only)
- `~/.gemini/tmp/claude-video-vision/` — temporary audio files for the Gemini CLI (deleted after each call)
- OS temporary directory — frames and audio extracted during a single video analysis (deleted after each call)

None of these files leave your machine automatically.

## What the maintainer can see

**Nothing.** The plugin does not phone home. There is no telemetry endpoint, no analytics, no crash reporting, no usage tracking. The only network activity initiated by the plugin itself is:

- `npm` registry requests (when `npx` fetches the MCP server binary)
- HuggingFace model download (Local backend, first use only)
- The third-party API you configured (Gemini or OpenAI)

## Your responsibilities

- You are responsible for not providing videos containing sensitive or regulated data (HIPAA, PII, confidential material) to third-party APIs without ensuring those APIs are compliant with your requirements. Use the Local backend for sensitive content.
- You are responsible for securing your API keys. The plugin reads them from environment variables only — never commits them anywhere.

## Changes to this policy

Changes will be committed to this file in the public GitHub repository. The git history provides a full audit trail.

## Contact

Questions about this policy: open an issue at https://github.com/jordanrendric/claude-video-vision/issues or reach out to the maintainer at [@jordanrendric](https://github.com/jordanrendric).
