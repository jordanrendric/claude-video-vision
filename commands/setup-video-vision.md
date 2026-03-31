---
description: "Interactive setup wizard for claude-video-vision — configure backend, whisper, frames, and verify dependencies"
---

# Setup Video Vision

Guide the user through configuring claude-video-vision step by step. Ask one question at a time using multiple choice. After each answer, proceed to the next step.

## Step 1: Backend Selection

Ask the user:

> Which backend do you want to use for audio analysis?
>
> **a) Gemini API** (recommended) — Best quality. Analyzes audio natively with Gemini Flash. Free tier: 1500 requests/day. Requires a GEMINI_API_KEY (free at ai.google.dev).
>
> **b) Local (Whisper)** — Free, fully offline. Uses whisper.cpp or openai-whisper for audio transcription. No cloud dependency.
>
> **c) OpenAI Whisper API** — Good quality. Requires OPENAI_API_KEY. Paid per usage.
>
> All backends use ffmpeg to extract video frames — Claude sees the frames directly.

After the user answers, call `video_configure` with the chosen `backend`.

## Step 2: Whisper Configuration (only if backend is "local")

If the user chose Local, ask these questions one at a time:

### Engine
> Which whisper engine?
>
> **a) whisper.cpp** (recommended) — Faster, less RAM, optimized for Mac/Linux
>
> **b) Python (openai-whisper)** — More flexible, easier to extend

Call `video_configure` with `whisper_engine`.

### Model
> Which whisper model? Your system has **[detect RAM with video_setup]** of RAM.
>
> **a) tiny** (75MB) — Very fast, basic quality
>
> **b) small** (500MB) — Good balance of speed and quality
>
> **c) large-v3-turbo** (1.5GB) — Best cost-benefit, recommended for 8GB+ RAM
>
> **d) large-v3** (2.9GB) — Maximum quality, recommended for 16GB+ RAM
>
> **e) auto** — Let the plugin choose based on your hardware

Call `video_configure` with `whisper_model`.

### Audio Tags
> Enable Whisper-AT for non-speech audio detection? (coughs, music, animal sounds, etc.)
>
> **a) Yes** — Detects non-speech events (requires Whisper-AT installed)
>
> **b) No** — Speech transcription only

Call `video_configure` with `whisper_at`.

## Step 3: Frame Configuration

Ask these one at a time:

### Resolution
> Frame extraction resolution (width in pixels, height auto-scales)?
>
> **a) 256px** — Low res, fast, fewer tokens
>
> **b) 512px** (default) — Good balance
>
> **c) 768px** — Higher detail
>
> **d) 1024px** — Maximum detail, more tokens

Call `video_configure` with `frame_resolution`.

### FPS
> Default frames per second extraction rate?
>
> **a) auto** (recommended) — Adapts based on video duration (shorter = more frames, longer = fewer)
>
> **b) Custom value** — Ask user for a number

Call `video_configure` with `default_fps`.

### Frame Mode
> How should Claude receive the frames?
>
> **a) Images** (default) — Claude sees the actual frames (better perception, more tokens)
>
> **b) Descriptions** — A sub-agent describes each frame as text (fewer tokens, loses visual nuance)

Call `video_configure` with `frame_mode`.

If descriptions mode:
> Which model for the frame describer agent?
>
> **a) Sonnet** (default) — Good balance
>
> **b) Opus** — Most detailed descriptions
>
> **c) Haiku** — Fastest, most concise

Call `video_configure` with `frame_describer_model`.

## Step 4: Dependency Check

Tell the user:
> Let me verify your setup...

Call `video_setup` with the configured backend and options. Show the results.

If dependencies are missing, show the installation commands and ask:
> Want me to install these for you?

## Step 5: Test (Optional)

After setup is complete, ask:
> Setup complete! Want to test with a quick video? If so, provide a path to any video file.

If the user provides a video, call `video_watch` on it and show a brief summary of the results.

## Important

- Ask ONE question at a time — never combine multiple questions
- Use the multiple choice format consistently
- Call `video_configure` after EACH answer to save incrementally
- If the user says "default" or "just use defaults", set all defaults and skip to Step 4
- If the user seems experienced, keep it concise — don't over-explain
