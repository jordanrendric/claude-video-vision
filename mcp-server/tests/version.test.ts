import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

// Every place that declares the release version must agree with
// mcp-server/package.json, which is what npm publishes.
const ROOT = join(import.meta.dirname, "../..");
const readJson = (path: string) => JSON.parse(readFileSync(join(ROOT, path), "utf8"));

const version: string = readJson("mcp-server/package.json").version;

describe("release version", () => {
  it("matches in package-lock.json", () => {
    const lock = readJson("mcp-server/package-lock.json");
    expect(lock.version).toBe(version);
    expect(lock.packages[""].version).toBe(version);
  });

  it("matches in the plugin manifest", () => {
    expect(readJson(".claude-plugin/plugin.json").version).toBe(version);
  });

  it("matches in the marketplace manifest", () => {
    const marketplace = readJson(".claude-plugin/marketplace.json");
    expect(marketplace.version).toBe(version);
    expect(marketplace.plugins.map((p: { version: string }) => p.version)).toEqual([version]);
  });

  it("matches the version the MCP server advertises", () => {
    const index = readFileSync(join(ROOT, "mcp-server/src/index.ts"), "utf8");
    expect(index).toContain(`version: "${version}"`);
  });

  it("matches the README status section", () => {
    const readme = readFileSync(join(ROOT, "README.md"), "utf8");
    expect(readme).toContain(`**v${version}**`);
  });

  it("has a CHANGELOG entry", () => {
    const changelog = readFileSync(join(ROOT, "CHANGELOG.md"), "utf8");
    expect(changelog).toContain(`## [${version}]`);
  });
});
