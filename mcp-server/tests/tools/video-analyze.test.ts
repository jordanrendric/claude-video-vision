import { describe, it, expect } from "vitest";
import { sceneChangesSchema } from "../../src/tools/video-analyze.js";

describe("sceneChangesSchema", () => {
  it("defaults to false", () => {
    expect(sceneChangesSchema.parse(undefined)).toBe(false);
  });

  it("accepts a boolean", () => {
    expect(sceneChangesSchema.parse(true)).toBe(true);
  });

  it("accepts a threshold override", () => {
    expect(sceneChangesSchema.parse({ threshold: 12 })).toEqual({ threshold: 12 });
  });

  it("rejects thresholds outside scdet's 0-100 score range", () => {
    expect(sceneChangesSchema.safeParse({ threshold: 101 }).success).toBe(false);
    expect(sceneChangesSchema.safeParse({ threshold: -1 }).success).toBe(false);
  });
});
