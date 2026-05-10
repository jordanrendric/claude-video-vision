export type Backend = "gemini-api" | "local" | "openai" | "youtube-captions" | "unconfigured" | "none";
export type WhisperEngine = "cpp" | "python";
export type WhisperModel = "tiny" | "base" | "small" | "medium" | "large-v3-turbo" | "large-v3" | "auto";
export type FrameMode = "images" | "descriptions";
export type FrameFormat = "jpeg" | "png" | "webp";
export type DescriberModel = "opus" | "sonnet" | "haiku";

export interface Config {
  backend: Backend;
  whisper_engine: WhisperEngine;
  whisper_model: WhisperModel;
  whisper_at: boolean;
  frame_mode: FrameMode;
  frame_format: FrameFormat;
  frame_resolution: number;
  default_fps: number | "auto";
  max_frames: number;
  frame_describer_model: DescriberModel;
  enable_index: boolean;
  session_max_age_days: number;
  downloads_max_age_days: number;
  audio_model: string;
  audio_max_output_tokens: number;
  audio_chunk_trigger_seconds: number;
  audio_chunk_size_seconds: number;
  audio_chunk_overlap_seconds: number; // reserved: dedup post-processor TBD; default 0 = no overlap
}

export interface VideoMetadata {
  duration: string;
  duration_seconds: number;
  resolution: string;
  width: number;
  height: number;
  codec: string;
  original_fps: number;
  file_size: string;
  has_audio: boolean;
}

export interface Frame {
  timestamp: string;
  image?: string;
  format?: FrameFormat;
  sourcePath?: string;
  description?: string;
}

export interface TranscriptionSegment {
  start: string;
  end: string;
  text: string;
}

export interface AudioTag {
  start: string;
  end: string;
  tag: string;
}

export interface AudioResult {
  backend: Backend;
  transcription: TranscriptionSegment[];
  audio_tags: AudioTag[];
  full_analysis: string | null;
  transcription_source?: "youtube_subtitles" | "youtube_auto_captions" | "gemini-api" | "local_whisper" | "openai" | "none";
  transcription_source_detail?: string;
  transcription_fallback_reason?: string;
  warnings?: ChunkWarning[];
}

export interface VideoWatchResult {
  metadata: VideoMetadata;
  frames: Frame[];
  audio: AudioResult;
}

export interface AnalysisFilters {
  scene_changes: boolean;
  black_intervals: boolean;
  silence: boolean;
  freeze: boolean;
  motion: boolean;
  blur: boolean;
  exposure: boolean;
  loudness: boolean;
  transcription: boolean;
}

export interface SceneChange {
  time: string;
  score: number;
}

export interface Interval {
  start: string;
  end: string;
  duration: number;
}

export interface FrameStats {
  timestamp: string;
  si?: number;
  ti?: number;
  blur?: number;
  brightness?: number;
  saturation?: number;
}

export interface VideoAnalysis {
  scenes: SceneChange[];
  black_intervals: Interval[];
  silence_intervals: Interval[];
  freeze_intervals: Interval[];
  frame_stats: FrameStats[];
  loudness_summary?: { mean_lufs: number; range_lu: number };
  transcription?: TranscriptionSegment[];
  audio_warnings?: ChunkWarning[];
  content_profile: string;
}

export interface SessionManifest {
  video_hash: string;
  video_path: string;
  created_at: string;
  resolutions: Record<string, {
    frames: Array<{ timestamp: string; file: string }>;
  }>;
  analysis?: VideoAnalysis;
}

export interface Segment {
  start: string;
  end: string;
  fps: number;
  resolution?: number;
}

export interface ChunkPlan {
  start: number;
  actual_start: number;
  end: number;
  index: number;
  total: number;
  clean_cut: boolean;
}

export interface ChunkWarning {
  chunk_index: number;
  chunk_total: number;
  time_range: string;
  event: "retry" | "failed" | "hard_cut" | "loose_threshold";
  detail?: string;
}
