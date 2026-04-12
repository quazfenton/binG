/**
 * Transcription Types
 */

export interface TranscriptionOptions {
  model?: string;
  language?: string;
  apiKey?: string;
  baseUrl?: string;
  temperature?: number;
}

export interface TranscriptionResult {
  text: string;
  duration?: number;
  segments?: TranscriptionSegment[];
}

export interface TranscriptionSegment {
  text: string;
  start: number;
  end: number;
  confidence?: number;
}