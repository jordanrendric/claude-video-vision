export type Backend = "gemini-api" | "local" | "openai" | "unconfigured";
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
