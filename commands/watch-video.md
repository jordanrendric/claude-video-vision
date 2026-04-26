---
description: "Watch and analyze a video file — extracts frames and audio for understanding"
argument-hint: "path/to/video.mp4 [optional prompt or question about the video]"
---

# Watch Video

Parse the user's input to extract:
1. **Video path** — the file path (required)
2. **Prompt** — any question or instruction about the video (optional)
3. **Flags** — `--fps <number>`, `--resolution <number>` (optional)

Then follow this workflow **in order — do NOT skip step 2**:

1. Call `video_info` on the path to verify it's a valid video and get duration.

2. **REQUIRED for videos > 30s:** Call `video_analyze` BEFORE `video_watch`. This is NOT optional.
   Use filters: `scene_changes: true, silence: true, transcription: true` at minimum.
   Add other filters based on the user's question (motion, blur, exposure, loudness, etc.).
   The analysis tells you WHERE to look — use it to plan smart frame extraction.

3. Call `video_watch`:
   - **Short videos (< 2 min):** Use `fps: "auto"` without `view_sample` — full coverage to avoid missing brief moments.
   - **Long videos (> 2 min):** Use `segments` with variable FPS based on analysis data. Use `view_sample` to limit initial frames.

4. If the user asks for more detail on a specific moment, use `video_detail` to drill in with higher FPS/resolution on a 3-5 second window. Use `view_sample: 3` first, then request specific timestamps.

5. If the user provided a prompt/question, answer it based on the video content.
6. If no prompt was provided, give a comprehensive summary of what happens in the video.

If `video_watch` fails with a setup error, call `video_setup` first, then retry.
