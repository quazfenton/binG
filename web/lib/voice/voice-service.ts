"use client";

import {
  Room,
  RemoteParticipant,
  LocalParticipant,
  AudioTrack,
  LocalAudioTrack,
} from "livekit-client";

// LocalTrackOptions type from livekit-client
interface LocalTrackOptions {
  name?: string;
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
  useLivekitTTS: boolean;
  ttsProvider: 'cartesia' | 'elevenlabs' | 'web';
  sttProvider: 'browser' | 'mistral'; // NEW: STT provider selection
}

export interface VoiceEvent {
  type: "transcription" | "synthesis" | "error" | "connected" | "disconnected";
  data: any;
  timestamp: number;
}

export type VoiceEventHandler = (event: VoiceEvent) => void;

class VoiceService {
  private room: Room | null = null;
  private isConnected = false;
  private eventHandlers: VoiceEventHandler[] = [];
  private recognition: any | null = null;
  private synthesis: SpeechSynthesis | null = null;
  private voices: SpeechSynthesisVoice[] = [];
  private isListening = false;
  private currentUtterance: SpeechSynthesisUtterance | null = null;
  private audioElements: Map<string, HTMLMediaElement> = new Map(); // Fix: Track audio elements
  private localAudioTrack: LocalAudioTrack | null = null; // Fix: Track local TTS track
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 3;

  private settings: VoiceSettings = {
    enabled: false,
    autoSpeak: false,
    speechRate: 0.9,
    speechPitch: 1.0,
    speechVolume: 0.8,
    voiceIndex: 0,
    language: "en-US",
    microphoneEnabled: false,
    transcriptionEnabled: false,
    useLivekitTTS: false,
    ttsProvider: 'web',
    sttProvider: 'browser',
  };

  constructor() {
    // Only initialize browser features on the client side
    if (typeof window !== "undefined") {
      this.initializeBrowserVoice();
      this.loadSettings();
    }
  }

  private initializeBrowserVoice() {
    // Only initialize if we're on the client side
    if (typeof window === "undefined") {
      return;
    }

    // Initialize Web Speech API
    if ("speechSynthesis" in window) {
      this.synthesis = window.speechSynthesis;
      this.loadVoices();

      // Some browsers load voices asynchronously
      if (this.synthesis.onvoiceschanged !== undefined) {
        this.synthesis.onvoiceschanged = () => this.loadVoices();
      }
    }

    // Initialize Speech Recognition
    if ("webkitSpeechRecognition" in window || "SpeechRecognition" in window) {
      const SpeechRecognition =
        window.SpeechRecognition || window.webkitSpeechRecognition;
      this.recognition = new SpeechRecognition();

      this.recognition.continuous = true;
      this.recognition.interimResults = true;
      this.recognition.lang = this.settings.language;

      this.recognition.onresult = (event) => {
        let finalTranscript = "";
        let interimTranscript = "";

        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript;

          if (event.results[i].isFinal) {
            finalTranscript += transcript;
          } else {
            interimTranscript += transcript;
          }
        }

        if (finalTranscript) {
          this.emitEvent({
            type: "transcription",
            data: {
              text: finalTranscript,
              isFinal: true,
              confidence: event.results[event.results.length - 1][0].confidence,
            },
            timestamp: Date.now(),
          });
        }

        if (interimTranscript) {
          this.emitEvent({
            type: "transcription",
            data: {
              text: interimTranscript,
              isFinal: false,
              confidence: 0,
            },
            timestamp: Date.now(),
          });
        }
      };

      this.recognition.onerror = (event) => {
        // Don't log "not-allowed" on every interaction — it's a permission issue, not a runtime error
        const isFatalError = event.error === 'not-allowed' || event.error === 'not-allowed-on-insecure-origin';
        if (isFatalError) {
          // Stop recognition permanently — user denied mic permission or page is not HTTPS
          this.stopListening();
          return;
        }
        // Other errors (no-speech, aborted, network) are transient — just log
        console.error("Speech recognition error:", event.error);
        this.emitEvent({
          type: "error",
          data: { error: event.error, message: "Speech recognition failed" },
          timestamp: Date.now(),
        });
      };

      this.recognition.onend = () => {
        this.isListening = false;
        if (
          this.settings.microphoneEnabled &&
          this.settings.transcriptionEnabled
        ) {
          // Restart recognition if it should be continuous
          setTimeout(() => this.startListening(), 100);
        }
      };
    }
  }

  private loadVoices() {
    if (this.synthesis) {
      this.voices = this.synthesis.getVoices();

      // Find a good default voice
      const preferredVoice =
        this.voices.find(
          (voice) =>
            voice.lang.startsWith(this.settings.language) &&
            !voice.localService,
        ) ||
        this.voices.find((voice) =>
          voice.lang.startsWith(this.settings.language),
        ) ||
        this.voices[0];

      if (preferredVoice) {
        this.settings.voiceIndex = this.voices.indexOf(preferredVoice);
      }
    }
  }

  private loadSettings() {
    // Only access localStorage on the client side
    if (typeof window === "undefined") {
      return;
    }

    try {
      const saved = localStorage.getItem("voice-settings");
      if (saved) {
        this.settings = { ...this.settings, ...JSON.parse(saved) };
      }
    } catch (error) {
      console.warn("Failed to load voice settings:", error);
    }
  }

  private saveSettings() {
    // Only access localStorage on the client side
    if (typeof window === "undefined") {
      return;
    }

    try {
      localStorage.setItem("voice-settings", JSON.stringify(this.settings));
    } catch (error) {
      console.warn("Failed to save voice settings:", error);
    }
  }

  private emitEvent(event: VoiceEvent) {
    this.eventHandlers.forEach((handler) => {
      try {
        handler(event);
      } catch (error) {
        console.error("Error in voice event handler:", error);
      }
    });
  }

  // Event handling
  addEventListener(handler: VoiceEventHandler) {
    this.eventHandlers.push(handler);
  }

  removeEventListener(handler: VoiceEventHandler) {
    const index = this.eventHandlers.indexOf(handler);
    if (index > -1) {
      this.eventHandlers.splice(index, 1);
    }
  }

  // Livekit integration
  async connectToLivekit(
    roomName: string,
    participantName: string,
  ): Promise<boolean> {
    try {
      // Check if LiveKit is configured
      if (!process.env.NEXT_PUBLIC_LIVEKIT_URL) {
        console.warn("LiveKit URL not configured, using local voice features only");
        // Simulate connection for local features
        this.isConnected = true;
        this.emitEvent({
          type: "connected",
          data: { roomName, participantName, mode: "local" },
          timestamp: Date.now(),
        });
        return true;
      }

      // Get access token from API route
      const tokenResponse = await fetch("/api/livekit/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          roomName,
          participantName,
        }),
      });

      if (!tokenResponse.ok) {
        const errorData = await tokenResponse.json();
        console.warn("LiveKit token failed, falling back to local voice features:", errorData.error);
        // Fallback to local features
        this.isConnected = true;
        this.emitEvent({
          type: "connected",
          data: { roomName, participantName, mode: "local" },
          timestamp: Date.now(),
        });
        return true;
      }

      const { token: jwt } = await tokenResponse.json();

      // Connect to room
      this.room = new Room({
        adaptiveStream: true,
        dynacast: true,
      });

      this.room.on("connected", () => {
        this.isConnected = true;
        this.emitEvent({
          type: "connected",
          data: { roomName, participantName, mode: "livekit" },
          timestamp: Date.now(),
        });
      });

      this.room.on("disconnected", () => {
        this.isConnected = false;
        this.emitEvent({
          type: "disconnected",
          data: {},
          timestamp: Date.now(),
        });
      });

      this.room.on("trackSubscribed", (track, publication, participant) => {
        if (track.kind === "audio") {
          const audioElement = track.attach();
          audioElement.id = `lk-audio-${track.sid}`;
          document.body.appendChild(audioElement);
          this.audioElements.set(track.sid, audioElement);
        }
      });

      this.room.on("trackUnsubscribed", (track, publication, participant) => {
        if (track.kind === "audio") {
          const audioElement = this.audioElements.get(track.sid);
          if (audioElement) {
            audioElement.remove();
            this.audioElements.delete(track.sid);
          }
        }
      });

      this.room.on("reconnecting", () => {
        this.emitEvent({
          type: "disconnected",
          data: { reason: "reconnecting" },
          timestamp: Date.now(),
        });
      });

      this.room.on("reconnected", () => {
        this.isConnected = true;
        this.reconnectAttempts = 0;
        this.emitEvent({
          type: "connected",
          data: { reconnected: true },
          timestamp: Date.now(),
        });
      });

      await this.room.connect(process.env.NEXT_PUBLIC_LIVEKIT_URL, jwt);
      return true;
    } catch (error) {
      console.warn("Failed to connect to Livekit, using local voice features:", error);
      // Fallback to local features
      this.isConnected = true;
      this.emitEvent({
        type: "connected",
        data: { roomName: roomName || "local", participantName: participantName || "user", mode: "local" },
        timestamp: Date.now(),
      });
      return true;
    }
  }

  async disconnectFromLivekit() {
    if (this.room) {
      await this.room.disconnect();
      this.room = null;
      this.isConnected = false;
    }
  }

  // Text-to-speech functionality
  async speak(text: string, options?: Partial<VoiceSettings>): Promise<void> {
    return new Promise((resolve, reject) => {
      if (typeof window === "undefined") {
        reject(new Error("Speech synthesis not available on server"));
        return;
      }

      if (!this.synthesis) {
        reject(new Error("Speech synthesis not supported"));
        return;
      }

      // Stop any current speech
      this.stopSpeaking();

      const utterance = new SpeechSynthesisUtterance(text);
      const settings = { ...this.settings, ...options };

      // Configure utterance
      utterance.rate = settings.speechRate;
      utterance.pitch = settings.speechPitch;
      utterance.volume = settings.speechVolume;
      utterance.lang = settings.language;

      if (this.voices[settings.voiceIndex]) {
        utterance.voice = this.voices[settings.voiceIndex];
      }

      utterance.onend = () => {
        this.currentUtterance = null;
        this.emitEvent({
          type: "synthesis",
          data: { text, completed: true },
          timestamp: Date.now(),
        });
        resolve();
      };

      utterance.onerror = (event) => {
        this.currentUtterance = null;
        this.emitEvent({
          type: "error",
          data: { error: event.error, message: "Speech synthesis failed" },
          timestamp: Date.now(),
        });
        reject(new Error(`Speech synthesis error: ${event.error}`));
      };

      utterance.onstart = () => {
        this.emitEvent({
          type: "synthesis",
          data: { text, started: true },
          timestamp: Date.now(),
        });
      };

      this.currentUtterance = utterance;
      this.synthesis.speak(utterance);
    });
  }

  stopSpeaking() {
    if (this.synthesis) {
      this.synthesis.cancel();
    }
    this.currentUtterance = null;
  }

  isSpeaking(): boolean {
    return this.synthesis?.speaking || false;
  }

  // Speech-to-text functionality
  startListening(): boolean {
    if (typeof window === "undefined") {
      console.warn("Speech recognition not available on server");
      return false;
    }

    if (!this.recognition) {
      console.warn("Speech recognition not supported");
      return false;
    }

    if (this.isListening) {
      return true;
    }

    try {
      this.recognition.start();
      this.isListening = true;
      return true;
    } catch (error) {
      console.error("Failed to start speech recognition:", error);
      return false;
    }
  }

  stopListening() {
    if (this.recognition && this.isListening) {
      this.recognition.stop();
      this.isListening = false;
    }
  }

  isListeningToSpeech(): boolean {
    return this.isListening;
  }

  // Settings management
  updateSettings(newSettings: Partial<VoiceSettings>) {
    this.settings = { ...this.settings, ...newSettings };
    this.saveSettings();

    // Update speech recognition language if changed
    if (this.recognition && newSettings.language) {
      this.recognition.lang = newSettings.language;
    }

    // Handle voice service activation
    if (newSettings.enabled !== undefined) {
      if (newSettings.enabled && !this.isConnected) {
        // Auto-connect when voice is enabled
        this.connectToLivekit("voice-chat", "user").catch(console.error);
      } else if (!newSettings.enabled && this.isConnected) {
        this.disconnectFromLivekit();
      }
    }

    // Handle microphone and transcription changes
    if (
      newSettings.microphoneEnabled !== undefined ||
      newSettings.transcriptionEnabled !== undefined
    ) {
      if (
        this.settings.microphoneEnabled &&
        this.settings.transcriptionEnabled
      ) {
        this.startListening();
      } else {
        this.stopListening();
      }
    }
  }

  getSettings(): VoiceSettings {
    return { ...this.settings };
  }

  getAvailableVoices(): SpeechSynthesisVoice[] {
    return [...this.voices];
  }

  // Utility methods
  isVoiceSupported(): boolean {
    if (typeof window === "undefined") {
      return false;
    }
    return !!(this.synthesis && this.recognition);
  }

  isSpeechSynthesisSupported(): boolean {
    if (typeof window === "undefined") {
      return false;
    }
    return !!this.synthesis;
  }

  isSpeechRecognitionSupported(): boolean {
    if (typeof window === "undefined") {
      return false;
    }
    return !!this.recognition;
  }

  isLivekitConnected(): boolean {
    return this.isConnected;
  }

  // Auto-speak functionality for chat responses
  async speakIfEnabled(text: string): Promise<void> {
    if (
      this.settings.enabled &&
      this.settings.autoSpeak &&
      this.isSpeechSynthesisSupported()
    ) {
      try {
        await this.speak(text);
      } catch (error) {
        console.warn("Auto-speak failed:", error);
      }
    }
  }

  // Clean up
  destroy() {
    this.stopSpeaking();
    this.stopListening();
    this.disconnectFromLivekit();
    this.eventHandlers = [];
  }

  // Transcribe audio using Mistral API (when sttProvider is 'mistral')
  async transcribeWithMistral(audioBlob: Blob): Promise<string> {
    try {
      const arrayBuffer = await audioBlob.arrayBuffer();
      const base64 = Buffer.from(arrayBuffer).toString('base64');

      const response = await fetch('/api/speech-to-text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audioData: base64, provider: 'mistral' }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Transcription failed');
      }

      const result = await response.json();
      return result.text || '';
    } catch (error: any) {
      console.error('Mistral transcription error:', error);
      this.emitEvent({
        type: 'error',
        data: { error: error.message, message: 'Mistral transcription failed' },
        timestamp: Date.now(),
      });
      throw error;
    }
  }
}

// Singleton instance
export const voiceService = new VoiceService();

// Export types for TypeScript support
export type { VoiceService };

// Add global type declarations for Web Speech API
// Note: These are ambient declarations that augment the global scope
declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
}
