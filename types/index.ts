export interface Message {
  id: string;
  role: "user" | "assistant" | "system" | "data";
  content: string;
  isError?: boolean;
  timestamp?: string; // ISO format date string
  isComplete?: boolean; // For streaming messages
  isStreaming?: boolean; // Currently streaming content
}

export interface ConversationContext {
  creativity: number;
  depth: number;
  mood: string;
  topics: string[];
}

export interface ConversationMood {
  color: string;
  energy: number;
  tempo: number;
}

export interface ChatHistory {
  id: string;
  title: string;
  messages: Message[];
  timestamp: number;
}

export interface StreamingMessage extends Message {
  isStreaming?: boolean;
  isComplete?: boolean;
}

export interface VoiceSettings {
  enabled: boolean;
  autoSpeak: boolean;
  speechRate: number;
  speechPitch: number;
  speechVolume: number;
  voiceIndex: number;
  language: string;
  microphoneEnabled: boolean;
  transcriptionEnabled: boolean;
}

export interface VoiceEvent {
  type: "transcription" | "synthesis" | "error" | "connected" | "disconnected";
  data: any;
  timestamp: number;
}

export interface LLMProvider {
  id: string;
  name: string;
  models: string[];
  supportsStreaming: boolean;
  maxTokens: number;
  description: string;
}

export interface ConversationSettings {
  provider: string;
  model: string;
  temperature: number;
  maxTokens: number;
  streamingEnabled: boolean;
  voiceEnabled: boolean;
}

export interface APIResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  timestamp?: string;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface LLMResponse {
  content: string;
  usage?: TokenUsage;
  model: string;
  provider: string;
}

export interface StreamingChunk {
  content: string;
  isComplete: boolean;
  usage?: TokenUsage;
}
