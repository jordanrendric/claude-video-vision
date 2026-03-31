---
description: "Watch and analyze a video file — extracts frames and audio for understanding"
argument-hint: "path/to/video.mp4 [optional prompt or question about the video]"
---

# Watch Video

Parse the user's input to extract:
1. **Video path** — the file path (required)
2. **Prompt** — any question or instruction about the video (optional)
3. **Flags** — `--fps <number>`, `--resolution <number>` (optional)

Then:

1. Call `video_info` on the path to verify it's a valid video
2. Call `video_watch` with the extracted parameters
3. If the user provided a prompt/question, answer it based on the video content
4. If no prompt was provided, give a comprehensive summary of what happens in the video

If `video_watch` fails with a setup error, call `video_setup` first, then retry.
