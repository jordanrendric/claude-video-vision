import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { computeVideoHash, getSessionDir, cleanExpiredSessions } from "../../src/session/manager.js";

const TEST_DIR = join(tmpdir(), "cvv-session-test-" + Date.now());
const SESSIONS_DIR = join(TEST_DIR, "sessions");

describe("session manager", () => {
  beforeEach(() => { mkdirSync(SESSIONS_DIR, { recursive: true }); });
  afterEach(() => { rmSync(TEST_DIR, { recursive: true, force: true }); });

  describe("computeVideoHash", () => {
    it("returns a 12-char hex string", () => {
      const testFile = join(TEST_DIR, "test.mp4");
      writeFileSync(testFile, Buffer.alloc(128 * 1024, "x"));
      const hash = computeVideoHash(testFile);
      expect(hash).toMatch(/^[a-f0-9]{12}$/);
    });

    it("returns same hash for same content", () => {
      const file1 = join(TEST_DIR, "a.mp4");
      const file2 = join(TEST_DIR, "b.mp4");
      const content = Buffer.alloc(128 * 1024, "hello");
      writeFileSync(file1, content);
      writeFileSync(file2, content);
      expect(computeVideoHash(file1)).toBe(computeVideoHash(file2));
    });

    it("returns different hash for different content", () => {
      const file1 = join(TEST_DIR, "a.mp4");
      const file2 = join(TEST_DIR, "b.mp4");
      writeFileSync(file1, Buffer.alloc(128 * 1024, "aaa"));
      writeFileSync(file2, Buffer.alloc(128 * 1024, "bbb"));
      expect(computeVideoHash(file1)).not.toBe(computeVideoHash(file2));
    });
  });

  describe("getSessionDir", () => {
    it("returns path under sessions dir using video hash", () => {
      const testFile = join(TEST_DIR, "test.mp4");
      writeFileSync(testFile, Buffer.alloc(128 * 1024, "x"));
      const dir = getSessionDir(SESSIONS_DIR, testFile);
      expect(dir).toContain(SESSIONS_DIR);
      expect(dir).toMatch(/[a-f0-9]{12}$/);
    });
  });

  describe("cleanExpiredSessions", () => {
    it("removes sessions older than maxAgeDays", () => {
      const oldSession = join(SESSIONS_DIR, "old123456ab");
      mkdirSync(oldSession, { recursive: true });
      writeFileSync(join(oldSession, "manifest.json"), JSON.stringify({
        video_hash: "old123456ab", video_path: "/old.mp4",
        created_at: new Date(Date.now() - 10 * 86400_000).toISOString(), resolutions: {},
      }));
      cleanExpiredSessions(SESSIONS_DIR, 7);
      expect(existsSync(oldSession)).toBe(false);
    });

    it("keeps sessions newer than maxAgeDays", () => {
      const newSession = join(SESSIONS_DIR, "new123456ab");
      mkdirSync(newSession, { recursive: true });
      writeFileSync(join(newSession, "manifest.json"), JSON.stringify({
        video_hash: "new123456ab", video_path: "/new.mp4",
        created_at: new Date().toISOString(), resolutions: {},
      }));
      cleanExpiredSessions(SESSIONS_DIR, 7);
      expect(existsSync(newSession)).toBe(true);
    });

    it("does nothing if sessions dir does not exist", () => {
      expect(() => cleanExpiredSessions("/nonexistent/path", 7)).not.toThrow();
    });
  });
});
