import { describe, it, expect, afterEach } from "vitest";
import { normalizeVocabulary, resolveVocabulary } from "../../src/utils/vocabulary.js";

describe("normalizeVocabulary", () => {
  it("accepts arrays and strings, splits on commas and whitespace, dedupes", () => {
    expect(normalizeVocabulary("Costing IT, SAP PCM,Shadow IT, IT ,Anaplan")).toEqual([
      "Costing", "IT", "SAP", "PCM", "Shadow", "Anaplan",
    ]);
    expect(normalizeVocabulary(["CIGREF", "AFAI IGSI", "CIGREF"])).toEqual(["CIGREF", "AFAI", "IGSI"]);
    expect(normalizeVocabulary(undefined)).toEqual([]);
    expect(normalizeVocabulary("")).toEqual([]);
  });

  it("caps at 100 terms", () => {
    const raw = Array.from({ length: 150 }, (_, i) => `t${i}`);
    expect(normalizeVocabulary(raw)).toHaveLength(100);
  });
});

describe("resolveVocabulary", () => {
  const original = process.env.CVV_VOCABULARY;
  afterEach(() => {
    if (original === undefined) delete process.env.CVV_VOCABULARY;
    else process.env.CVV_VOCABULARY = original;
  });

  it("uses the config value by default", () => {
    delete process.env.CVV_VOCABULARY;
    expect(resolveVocabulary(["A", "B"])).toEqual(["A", "B"]);
    expect(resolveVocabulary(undefined)).toEqual([]);
  });

  it("lets CVV_VOCABULARY override the config for one-off runs", () => {
    expect(resolveVocabulary(["A"], "X,Y")).toEqual(["X", "Y"]);
    expect(resolveVocabulary(["A"], "   ")).toEqual(["A"]);
  });
});
