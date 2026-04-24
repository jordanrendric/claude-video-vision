import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { waitForFileActive } from "../../src/backends/gemini-api.js";

interface FakeFile {
  name?: string;
  state?: string;
  uri?: string;
  mimeType?: string;
}

function fakeClient(states: string[]): {
  client: { files: { get: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> } };
  calls: { get: number };
} {
  let index = 0;
  const calls = { get: 0 };
  return {
    client: {
      files: {
        get: vi.fn(async ({ name }: { name: string }) => {
          calls.get++;
          const state = states[Math.min(index, states.length - 1)];
          index++;
          return { name, state, uri: `gs://fake/${name}`, mimeType: "video/mp4" };
        }),
        delete: vi.fn(async () => {}),
      },
    },
    calls,
  };
}

describe("waitForFileActive", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns immediately when file is already ACTIVE", async () => {
    const { client, calls } = fakeClient(["ACTIVE"]);
    const file: FakeFile = { name: "files/abc", state: "ACTIVE" };

    const result = await waitForFileActive(client, file);

    expect(result.state).toBe("ACTIVE");
    expect(calls.get).toBe(0);
  });

  it("polls while PROCESSING then returns when ACTIVE", async () => {
    const { client, calls } = fakeClient(["PROCESSING", "ACTIVE"]);
    const file: FakeFile = { name: "files/abc", state: "PROCESSING" };

    const promise = waitForFileActive(client, file, {
      pollIntervalMs: 100,
      timeoutMs: 10_000,
    });
    await vi.advanceTimersByTimeAsync(300);
    const result = await promise;

    expect(result.state).toBe("ACTIVE");
    expect(calls.get).toBe(2);
  });

  it("throws on FAILED state after upload", async () => {
    const { client } = fakeClient(["FAILED"]);
    const file: FakeFile = { name: "files/abc", state: "FAILED" };

    await expect(waitForFileActive(client, file)).rejects.toThrow(
      /processing failed/,
    );
  });

  it("throws on FAILED state detected during polling", async () => {
    const { client } = fakeClient(["PROCESSING", "FAILED"]);
    const file: FakeFile = { name: "files/abc", state: "PROCESSING" };

    const promise = waitForFileActive(client, file, {
      pollIntervalMs: 100,
      timeoutMs: 10_000,
    });
    promise.catch(() => {});
    await vi.advanceTimersByTimeAsync(300);

    await expect(promise).rejects.toThrow(/processing failed/);
  });

  it("throws after timeout when stuck in PROCESSING", async () => {
    const { client } = fakeClient(["PROCESSING"]);
    const file: FakeFile = { name: "files/abc", state: "PROCESSING" };

    const promise = waitForFileActive(client, file, {
      pollIntervalMs: 50,
      timeoutMs: 200,
    });
    promise.catch(() => {});
    await vi.advanceTimersByTimeAsync(500);

    await expect(promise).rejects.toThrow(/stuck in state PROCESSING after 200ms/);
  });

  it("handles STATE_UNSPECIFIED by polling until ACTIVE", async () => {
    const { client, calls } = fakeClient(["STATE_UNSPECIFIED", "ACTIVE"]);
    const file: FakeFile = { name: "files/abc", state: "STATE_UNSPECIFIED" };

    const promise = waitForFileActive(client, file, {
      pollIntervalMs: 100,
      timeoutMs: 10_000,
    });
    await vi.advanceTimersByTimeAsync(300);
    const result = await promise;

    expect(result.state).toBe("ACTIVE");
    expect(calls.get).toBe(2);
  });

  it("throws when file.name is missing", async () => {
    const { client } = fakeClient(["PROCESSING"]);
    const file: FakeFile = { state: "PROCESSING" };

    await expect(waitForFileActive(client, file)).rejects.toThrow(
      /file\.name is missing/,
    );
  });

  it("uses default timeout and poll interval when options omitted", async () => {
    const { client } = fakeClient(["ACTIVE"]);
    const file: FakeFile = { name: "files/abc", state: "ACTIVE" };

    const result = await waitForFileActive(client, file);
    expect(result.state).toBe("ACTIVE");
  });
});
