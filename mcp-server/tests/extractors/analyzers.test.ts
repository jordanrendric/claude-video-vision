import { describe, it, expect } from "vitest";
import {
  buildAnalysisCommand,
  parseScdetOutput,
  parseBlackdetectOutput,
  parseSilenceOutput,
  parseFreezeOutput,
  parseSitiOutput,
  parseEbur128Output,
  deriveContentProfile,
} from "../../src/extractors/analyzers.js";
import type { AnalysisFilters } from "../../src/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFilters(overrides: Partial<AnalysisFilters> = {}): AnalysisFilters {
  return {
    scene_changes: false,
    black_intervals: false,
    silence: false,
    freeze: false,
    motion: false,
    blur: false,
    exposure: false,
    loudness: false,
    transcription: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// buildAnalysisCommand
// ---------------------------------------------------------------------------

describe("buildAnalysisCommand", () => {
  it("returns null when no ffmpeg filters are selected", () => {
    const result = buildAnalysisCommand("/video.mp4", makeFilters({ transcription: true }), "/tmp");
    expect(result).toBeNull();
  });

  it("builds correct args for scene_changes only", () => {
    const result = buildAnalysisCommand("/video.mp4", makeFilters({ scene_changes: true }), "/tmp/work");
    expect(result).not.toBeNull();
    expect(result!.args).toContain("-vf");
    const vfIndex = result!.args.indexOf("-vf");
    expect(result!.args[vfIndex + 1]).toContain("scdet");
    // No audio filter
    expect(result!.args).not.toContain("-af");
    // Must discard output
    expect(result!.args).toContain("-f");
    expect(result!.args[result!.args.indexOf("-f") + 1]).toBe("null");
  });

  it("builds correct args for audio filters only (silence + loudness)", () => {
    const result = buildAnalysisCommand(
      "/video.mp4",
      makeFilters({ silence: true, loudness: true }),
      "/tmp/work",
    );
    expect(result).not.toBeNull();
    expect(result!.args).toContain("-af");
    const afIndex = result!.args.indexOf("-af");
    const afValue = result!.args[afIndex + 1];
    expect(afValue).toContain("silencedetect");
    expect(afValue).toContain("ebur128");
    // No video filter
    expect(result!.args).not.toContain("-vf");
  });

  it("builds combined video + audio args", () => {
    const result = buildAnalysisCommand(
      "/video.mp4",
      makeFilters({ scene_changes: true, silence: true }),
      "/tmp/work",
    );
    expect(result).not.toBeNull();
    expect(result!.args).toContain("-vf");
    expect(result!.args).toContain("-af");
  });

  it("returns videoMetaFile and audioMetaFile paths", () => {
    const result = buildAnalysisCommand(
      "/video.mp4",
      makeFilters({ scene_changes: true }),
      "/tmp/work",
    );
    expect(result!.videoMetaFile).toContain("video_meta.txt");
    expect(result!.audioMetaFile).toContain("audio_meta.txt");
  });
});

// ---------------------------------------------------------------------------
// parseScdetOutput
// ---------------------------------------------------------------------------

describe("parseScdetOutput", () => {
  it("parses two scene changes from stderr", () => {
    const stderr = `
      [Parsed_scdet_0 @ 0x...] lavfi.scd.score=45.2 lavfi.scd.time=1.234
      [Parsed_scdet_0 @ 0x...] lavfi.scd.score=78.9 lavfi.scd.time=5.678
    `;
    const result = parseScdetOutput(stderr);
    expect(result).toHaveLength(2);
    expect(result[0].score).toBeCloseTo(45.2);
    expect(result[0].time).toBe("00:00:01");
    expect(result[1].score).toBeCloseTo(78.9);
    expect(result[1].time).toBe("00:00:05");
  });

  it("returns empty array when no scene changes found", () => {
    const result = parseScdetOutput("nothing relevant here");
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// parseBlackdetectOutput
// ---------------------------------------------------------------------------

describe("parseBlackdetectOutput", () => {
  it("parses a black interval", () => {
    const stderr = `
      [blackdetect @ 0x...] black_start:0.0 black_end:2.5 black_duration:2.5
    `;
    const result = parseBlackdetectOutput(stderr);
    expect(result).toHaveLength(1);
    expect(result[0].start).toBe("00:00:00");
    expect(result[0].end).toBe("00:00:02");
    expect(result[0].duration).toBeCloseTo(2.5);
  });

  it("returns empty array for no black intervals", () => {
    expect(parseBlackdetectOutput("no black here")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// parseSilenceOutput
// ---------------------------------------------------------------------------

describe("parseSilenceOutput", () => {
  it("parses a silence start/end pair", () => {
    const stderr = `
      [silencedetect @ 0x...] silence_start: 3.5
      [silencedetect @ 0x...] silence_end: 6.0 | silence_duration: 2.5
    `;
    const result = parseSilenceOutput(stderr);
    expect(result).toHaveLength(1);
    expect(result[0].start).toBe("00:00:03");
    expect(result[0].end).toBe("00:00:06");
    expect(result[0].duration).toBeCloseTo(2.5);
  });

  it("returns empty array for no silence", () => {
    expect(parseSilenceOutput("no silence here")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// parseFreezeOutput
// ---------------------------------------------------------------------------

describe("parseFreezeOutput", () => {
  it("parses a freeze start/end/duration", () => {
    const stderr = `
      [freezedetect @ 0x...] freeze_start: 1.0
      [freezedetect @ 0x...] freeze_end: 4.5 | freeze_duration: 3.5
    `;
    const result = parseFreezeOutput(stderr);
    expect(result).toHaveLength(1);
    expect(result[0].start).toBe("00:00:01");
    expect(result[0].end).toBe("00:00:04");
    expect(result[0].duration).toBeCloseTo(3.5);
  });

  it("returns empty array for no freeze events", () => {
    expect(parseFreezeOutput("nothing here")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// parseSitiOutput
// ---------------------------------------------------------------------------

describe("parseSitiOutput", () => {
  it("parses SITI summary from ffmpeg output", () => {
    const stderr = `
[Parsed_siti_0 @ 0x1234] SITI Summary:
Total frames: 1312

Spatial Information:
Average: 42.300000
Max: 80.100000
Min: 10.200000

Temporal Information:
Average: 18.700000
Max: 55.300000
Min: 0.000000
    `;
    const result = parseSitiOutput(stderr);
    expect(result.siAvg).toBeCloseTo(42.3);
    expect(result.tiAvg).toBeCloseTo(18.7);
  });

  it("returns undefined values for no SITI data", () => {
    const result = parseSitiOutput("nothing");
    expect(result.siAvg).toBeUndefined();
    expect(result.tiAvg).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// parseEbur128Output
// ---------------------------------------------------------------------------

describe("parseEbur128Output", () => {
  it("parses integrated loudness and range", () => {
    const stderr = `
      Integrated loudness:
        I:         -23.0 LUFS
      Loudness range:
        LRA:         8.0 LU
    `;
    const result = parseEbur128Output(stderr);
    expect(result).toBeDefined();
    expect(result!.mean_lufs).toBeCloseTo(-23.0);
    expect(result!.range_lu).toBeCloseTo(8.0);
  });

  it("returns undefined when no ebur128 summary present", () => {
    expect(parseEbur128Output("nothing relevant")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// deriveContentProfile
// ---------------------------------------------------------------------------

describe("deriveContentProfile", () => {
  it("returns unknown message when both values are undefined", () => {
    expect(deriveContentProfile(undefined, undefined)).toBe("unknown (no motion analysis data)");
  });

  it("classifies high SI / low TI correctly", () => {
    const profile = deriveContentProfile(60, 5);
    expect(profile).toContain("high visual complexity");
    expect(profile).toContain("low motion");
  });

  it("classifies low SI / high TI correctly", () => {
    const profile = deriveContentProfile(10, 40);
    expect(profile).toContain("low visual complexity");
    expect(profile).toContain("high motion");
  });

  it("classifies moderate SI / moderate TI correctly", () => {
    const profile = deriveContentProfile(35, 20);
    expect(profile).toContain("moderate visual complexity");
    expect(profile).toContain("moderate motion");
  });

  it("handles only SI provided (TI undefined)", () => {
    const profile = deriveContentProfile(60, undefined);
    expect(profile).toContain("high visual complexity");
    expect(profile).toContain("unknown motion");
  });

  it("handles only TI provided (SI undefined)", () => {
    const profile = deriveContentProfile(undefined, 40);
    expect(profile).toContain("unknown visual complexity");
    expect(profile).toContain("high motion");
  });
});
