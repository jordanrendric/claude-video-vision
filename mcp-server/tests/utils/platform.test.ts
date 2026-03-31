import { describe, it, expect } from "vitest";
import { detectPlatform, checkCommand } from "../../src/utils/platform.js";

describe("platform detection", () => {
  it("detects current OS", () => {
    const platform = detectPlatform();
    expect(["macos", "linux", "windows"]).toContain(platform.os);
    expect(["arm64", "x64"]).toContain(platform.arch);
    expect(platform.ram_gb).toBeGreaterThan(0);
  });

  it("checkCommand finds existing commands", async () => {
    const hasNode = await checkCommand("node");
    expect(hasNode).toBe(true);
  });

  it("checkCommand returns false for missing commands", async () => {
    const hasNonexistent = await checkCommand("this-command-does-not-exist-xyz");
    expect(hasNonexistent).toBe(false);
  });
});
