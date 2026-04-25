export type Backend = "gemini-api" | "local" | "openai" | "unconfigured" | "none";
export type WhisperEngine = "cpp" | "python";
export type WhisperModel = "tiny" | "base" | "small" | "medium" | "large-v3-turbo" | "large-v3" | "auto";
export type FrameMode = "images" | "descriptions";
export type DescriberModel = "opus" | "sonnet" | "haiku";

export interface Config {
  backend: Backend;
  whisper_engine: WhisperEngine;
  whisper_model: WhisperModel;
  whisper_at: boolean;
  frame_mode: FrameMode;
  frame_resolution: number;
  default_fps: number | "auto";
  max_frames: number;
  frame_describer_model: DescriberModel;
  enable_index: boolean;
  session_max_age_days: number;
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
