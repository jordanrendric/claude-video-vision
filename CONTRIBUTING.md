# Contributing to claude-video-vision

Thanks for your interest in contributing! This document explains how to get set up and submit changes.

## Development setup

```bash
# Clone and install
git clone https://github.com/jordanrendric/claude-video-vision.git
cd claude-video-vision/mcp-server
npm install

# Build
npm run build

# Watch mode
npm run dev

# Run tests
npm test
```

You'll need `ffmpeg` installed (`brew install ffmpeg` on macOS, `apt install ffmpeg` on Linux).

## Testing the plugin locally

```bash
claude --plugin-dir /path/to/claude-video-vision
```

## Making a change

1. Fork the repo and create a topic branch from `main`
2. Make your changes following existing patterns
3. Add tests if you're adding behavior
4. Run `npm test` — all tests must pass
5. Run `npm run build` — must compile without errors
6. Commit with a clear message (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`)
7. Open a pull request against `main`

## Adding a new backend

Backends live in `mcp-server/src/backends/`. To add one:

1. Create `your-backend.ts` implementing the audio processing interface
2. Export an `analyzeWithYourBackend(wavPath)` function returning `AudioResult`
3. Wire it into `mcp-server/src/tools/video-watch.ts`
4. Add the backend name to the `Backend` type in `types.ts`
5. Update `video-configure.ts` and `video-setup.ts` to support it
6. Update the setup wizard in `commands/setup-video-vision.md`

## Code style

- TypeScript strict mode — no `any` unless genuinely necessary
- Keep files focused — one responsibility per file
- Tests live next to the code in `tests/`, mirror the `src/` structure
- Follow existing naming and import patterns

## Reporting bugs

Open an issue using the bug report template. Include:
- Your OS and Node.js version
- The backend you're using
- The exact command or action that triggered the bug
- Any error output from `~/.claude-video-vision/` logs or MCP stderr

## Questions

Open a discussion or reach out to [@jordanrendric](https://github.com/jordanrendric).
