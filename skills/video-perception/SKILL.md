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

1. First call `video_info` to get metadata (duration, fps, resolution)
2. Then call `video_watch` with parameters adapted to the user's request
3. If setup fails, call `video_setup` first

## Choosing Parameters — IMPORTANT

You MUST adapt `fps`, `start_time`, `end_time`, and `resolution` based on what the user asks. Don't always use defaults.

**fps (frames per second):**
- `"auto"` — good for general overview (adapts to video duration)
- Use the video's **original fps** (from `video_info`) when the user wants frame-by-frame detail
- Use high fps (5-10) when analyzing specific short moments
- Use low fps (0.1-0.5) for long videos or general summaries

**start_time / end_time:**
- Use these whenever the user refers to a specific part of the video
- "the first second" → `start_time: "00:00:00"`, `end_time: "00:00:01"`, `fps: 30` (or original fps)
- "around the 2 minute mark" → `start_time: "00:01:50"`, `end_time: "00:02:10"`
- "the ending" → calculate from video duration

**resolution:**
- 256-512 for quick scans
- 512-768 for normal analysis
- 1024 when the user needs to read text on screen or see fine details

**Examples of parameter adaptation:**

| User says | fps | start/end | resolution |
|-----------|-----|-----------|------------|
| "what's in this video?" | auto | - | 512 |
| "focus on the first second" | original (e.g. 30) | 00:00:00 - 00:00:01 | 512 |
| "extract the first 30 frames" | original | 00:00:00 - 00:00:01 | 512 |
| "what text is on screen at 1:30?" | 2 | 00:01:28 - 00:01:32 | 1024 |
| "summarize this 1 hour lecture" | 0.1 | - | 256 |
| "what happens right before the end?" | 2 | (duration-10s) - (duration) | 512 |

## Working with Results

You receive:
- **Frames** as images — look at them to understand what's happening visually
- **Audio transcription** with timestamps — read the speech content
- **Audio tags** — non-speech events (music, sounds, etc.)

Combine all sources to form a complete understanding. The frames and audio complement each other — visual context helps interpret speech and vice versa.

**Iterative analysis:** If the first pass didn't capture enough detail, call `video_watch` again with adjusted parameters (higher fps, different time range, higher resolution). You can zoom into specific sections.
