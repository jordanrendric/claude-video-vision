# claude-video-vision

Give Claude the ability to **watch and understand videos**.

Extracts frames via ffmpeg and processes audio via multiple backends (Gemini CLI, Gemini API, whisper local, OpenAI API). Claude receives frames + transcription as context.

## Quick Start

```bash
# Install the plugin
claude plugin install jordanrendric/claude-video-vision

# Configure (interactive)
# Claude will run video_setup automatically on first use
```

## Usage

```
/watch-video path/to/video.mp4
/watch-video tutorial.mp4 "what language is used in this tutorial?"
```

Or just mention a video file in conversation — Claude will detect it and offer to analyze.

## Backends

| Backend | Video | Audio | Cost |
|---------|-------|-------|------|
| Gemini CLI | Native | Native | Free (dev quota) |
| Gemini API | Native | Native | Paid |
| Local | ffmpeg frames | whisper.cpp/python | Free |
| OpenAI API | ffmpeg frames | Whisper API | Partial |

## Requirements

- Node.js 20+
- ffmpeg (auto-installed via setup)

## Author

**Jordan Vasconcelos**
- GitHub: [@jordanrendric](https://github.com/jordanrendric)
- LinkedIn: [jordanvasconcelos](https://www.linkedin.com/in/jordanvasconcelos/)
- Instagram: [@jordanvasconcelos__](https://www.instagram.com/jordanvasconcelos__/)
