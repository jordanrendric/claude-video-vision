---
name: video-perception
description: Use when the user mentions a video file (.mp4, .mov, .avi, .mkv, .webm), asks to watch/analyze/review a video, or references video content in conversation
---

# Video Perception

You have access to video understanding tools via the claude-video-vision MCP server.

## Available Tools

- `video_watch` — Extract frames + process audio from a video. This is the main tool.
- `video_info` — Get video metadata without processing.
- `video_configure` — Change settings (backend, resolution, fps, etc.).
- `video_setup` — Check/install dependencies.

## When to Use

Detect video references in conversation:
- User mentions a video file path (any path ending in .mp4, .mov, .avi, .mkv, .webm, .flv, .wmv)
- User asks to "watch", "analyze", "review", "look at" a video
- User references video content ("in the video", "the recording shows")

## How to Use

1. Call `video_watch` with the video path
2. Use `fps: "auto"` unless the user specifies otherwise
3. If setup fails, call `video_setup` first

## Choosing Parameters

- **Quick question** about a video → lower fps, lower resolution (256-512)
- **Detailed analysis** → default fps/resolution
- **Specific moment** → use `start_time`/`end_time` to focus on a section
- **Long video** (30+ min) → consider analyzing in sections

## Working with Results

You receive:
- **Frames** as images — look at them to understand what's happening visually
- **Audio transcription** with timestamps — read the speech content
- **Audio tags** — non-speech events (music, sounds, etc.)
- **Full analysis** (Gemini backends) — rich description from Gemini

Combine all sources to form a complete understanding. The frames and audio complement each other — visual context helps interpret speech and vice versa.
