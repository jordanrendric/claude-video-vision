import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { join } from "path";
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "fs";

// Redirect both the home dir (config + session cache) and the temp dir
// (video_watch's work dir) into an isolated root for this test file.
const { root } = vi.hoisted(() => ({
  root: `${process.env.TMPDIR ?? "/tmp"}/cvv-watch-cleanup-test-${process.pid}-${Date.now()}`,
}));

vi.mock("os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("os")>();
  return {
    ...actual,
    homedir: () => `${root}/home`,
    tmpdir: () => `${root}/tmp`,
  };
});

import { registerVideoWatch } from "../../src/tools/video-watch.js";

const FIXTURE = join(import.meta.dirname, "../fixtures/test-3s.mp4");
const TMP = join(root, "tmp");

function captureHandler(): (params: Record<string, unknown>) => Promise<unknown> {
  let handler: ((params: Record<string, unknown>) => Promise<unknown>) | undefined;
  const server = {
    tool: (_name: string, _desc: string, _schema: unknown, fn: typeof handler) => {
      handler = fn;
    },
  };
  registerVideoWatch(server as never);
  return handler!;
}

function workDirs(): string[] {
  return readdirSync(TMP).filter((entry) => entry.startsWith("cvv-"));
}

describe("video_watch work dir cleanup", () => {
  beforeEach(() => {
    rmSync(root, { recursive: true, force: true });
    mkdirSync(TMP, { recursive: true });
    mkdirSync(join(root, "home", ".claude-video-vision"), { recursive: true });
    writeFileSync(
      join(root, "home", ".claude-video-vision", "config.json"),
      JSON.stringify({ enable_index: true }),
    );
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("removes the work dir when session indexing is enabled", async () => {
    const handler = captureHandler();
    await handler({
      path: FIXTURE,
      fps: 1,
      skip_audio: true,
      segments: [{ start: "00:00:00", end: "00:00:01", fps: 1, resolution: 256 }],
    });

    expect(workDirs()).toEqual([]);
  });

  it("removes the work dir when frame extraction fails", async () => {
    const handler = captureHandler();
    // fps 0 makes ffmpeg exit with an error (the schema rejects it; the
    // handler is called directly here to simulate a failed extraction).
    await expect(
      handler({
        path: FIXTURE,
        fps: 1,
        skip_audio: true,
        segments: [{ start: "00:00:00", end: "00:00:01", fps: 0, resolution: 256 }],
      }),
    ).rejects.toThrow();

    expect(workDirs()).toEqual([]);
  });
});
