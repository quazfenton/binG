"use client";

import {
  Room,
  RemoteParticipant,
  LocalParticipant,
  AudioTrack,
  LocalAudioTrack,
} from "livekit-client";
import { rankModels } from "@/lib/models/model-ranker";
import { providerCircuitBreakers } from "@/lib/utils/circuit-breaker";
import { resourceTelemetry } from "@/lib/management/resource-telemetry";

// LocalTrackOptions type from livekit-client
interface LocalTrackOptions {
  name?: string;
}

export interface VoiceSettings {
  enabled: boolean;
  autoSpeak: boolean;
  autoSpeakStream: boolean; // NEW: Persistent setting for stream TTS
  speechRate: number;
  speechPitch: number;
  speechVolume: number;
  voiceIndex: number;
  language: string;
  microphoneEnabled: boolean;
  transcriptionEnabled: boolean;
  useLivekitTTS: boolean;
  ttsProvider: 'cartesia' | 'elevenlabs' | 'web' | 'gemini' | 'kittentts' | 'livekit';
  sttProvider: 'browser' | 'mistral' | 'deepgram' | 'assemblyai' | 'gladia';
  selectedVoice?: string;
  selectedModel?: string;
}

export type TTSProvider = VoiceSettings['ttsProvider'];
export type STTProvider = VoiceSettings['sttProvider'];

export interface VoiceEvent {
  type: "transcription" | "synthesis" | "error" | "connected" | "disconnected" | "settings";
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
  private audioElements: Map<string, HTMLMediaElement> = new Map();
  private localAudioTrack: LocalAudioTrack | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 3;
  private vadEnabled = false;
  private vadThreshold = 0.1;

  private settings: VoiceSettings = {
    enabled: false,
    autoSpeak: false,
    autoSpeakStream: false,
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
    if (typeof window !== "undefined") {
      this.initializeBrowserVoice();
      this.loadSettings();
    }
  }

  private initializeBrowserVoice() {
    if (typeof window === "undefined") return;

    if ("speechSynthesis" in window) {
      this.synthesis = window.speechSynthesis;
      this.loadVoices();
      if (this.synthesis.onvoiceschanged !== undefined) {
        this.synthesis.onvoiceschanged = () => this.loadVoices();
      }
    }

    if ("webkitSpeechRecognition" in window || "SpeechRecognition" in window) {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      this.recognition = new SpeechRecognition();
      this.recognition.continuous = true;
      this.recognition.interimResults = true;
      this.recognition.lang = this.settings.language;

      this.recognition.onresult = (event: any) => {
        let finalTranscript = "";
        let interimTranscript = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          if (event.results[i].isFinal) finalTranscript += event.results[i][0].transcript;
          else interimTranscript += event.results[i][0].transcript;
        }
        if (finalTranscript) this.emitEvent({ type: "transcription", data: { text: finalTranscript, isFinal: true }, timestamp: Date.now() });
        if (interimTranscript) this.emitEvent({ type: "transcription", data: { text: interimTranscript, isFinal: false }, timestamp: Date.now() });
      };

      this.recognition.onerror = (event: any) => {
        if (event.error === 'not-allowed') { this.stopListening(); return; }
        console.error("Speech recognition error:", event.error);
        this.emitEvent({ type: "error", data: { error: event.error, message: "Speech recognition failed" }, timestamp: Date.now() });
      };

      this.recognition.onend = () => {
        this.isListening = false;
        if (this.settings.microphoneEnabled && this.settings.transcriptionEnabled) {
          setTimeout(() => this.startListening().catch(console.error), 100);
        }
      };
    }
  }

  private loadVoices() {
    if (this.synthesis) {
      this.voices = this.synthesis.getVoices();
      const preferredVoice = this.voices.find(v => v.lang.startsWith(this.settings.language) && !v.localService) || 
                             this.voices.find(v => v.lang.startsWith(this.settings.language)) || 
                             this.voices[0];
      if (preferredVoice) this.settings.voiceIndex = this.voices.indexOf(preferredVoice);
    }
  }

  private loadSettings() {
    if (typeof window === "undefined") return;
    try {
      const saved = localStorage.getItem("voice-settings");
      if (saved) this.settings = { ...this.settings, ...JSON.parse(saved) };
    } catch (e) { console.warn("Failed to load voice settings:", e); }
  }

  private saveSettings() {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem("voice-settings", JSON.stringify(this.settings));
    } catch (e) { console.warn("Failed to save voice settings:", e); }
  }

  private emitEvent(event: VoiceEvent) {
    this.eventHandlers.forEach(handler => { try { handler(event); } catch (e) { console.error(e); } });
  }

  addEventListener(handler: VoiceEventHandler) { this.eventHandlers.push(handler); }
  removeEventListener(handler: VoiceEventHandler) {
    const index = this.eventHandlers.indexOf(handler);
    if (index > -1) this.eventHandlers.splice(index, 1);
  }

  async connectToLivekit(roomName: string, participantName: string): Promise<boolean> {
    try {
      if (!process.env.NEXT_PUBLIC_LIVEKIT_URL) {
        this.isConnected = true;
        this.emitEvent({ type: "connected", data: { roomName, participantName, mode: "local" }, timestamp: Date.now() });
        return true;
      }
      const res = await fetch("/api/livekit/token", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ roomName, participantName }) });
      if (!res.ok) { this.isConnected = true; this.emitEvent({ type: "connected", data: { roomName, participantName, mode: "local" }, timestamp: Date.now() }); return true; }
      const { token } = await res.json();
      this.room = new Room({ adaptiveStream: true, dynacast: true });
      this.room.on("connected", () => { this.isConnected = true; this.emitEvent({ type: "connected", data: { roomName, participantName, mode: "livekit" }, timestamp: Date.now() }); });
      this.room.on("disconnected", () => { this.isConnected = false; this.emitEvent({ type: "disconnected", data: {}, timestamp: Date.now() }); });
      this.room.on("trackSubscribed", (track) => {
        if (track.kind === "audio") {
          const el = track.attach();
          el.id = `lk-audio-${track.sid}`;
          document.body.appendChild(el);
          this.audioElements.set(track.sid, el);
        }
      });
      this.room.on("trackUnsubscribed", (track) => {
        if (track.kind === "audio") {
          const el = this.audioElements.get(track.sid);
          if (el) { el.remove(); this.audioElements.delete(track.sid); }
        }
      });
      await this.room.connect(process.env.NEXT_PUBLIC_LIVEKIT_URL, token);
      return true;
    } catch (e) { this.isConnected = true; this.emitEvent({ type: "connected", data: { roomName, participantName, mode: "local" }, timestamp: Date.now() }); return true; }
  }

  async disconnectFromLivekit() { if (this.room) { await this.room.disconnect(); this.room = null; this.isConnected = false; } }

  private async speakWithProvider(text: string, provider: TTSProvider, options: VoiceSettings): Promise<void> {
    switch (provider) {
      case 'web': return this.speakWeb(text, options);
      case 'kittentts': return this.speakKitten(text, options);
      case 'gemini': return this.speakGemini(text, options);
      case 'livekit': return this.speakLivekit(text, options);
      default: throw new Error(`Unsupported TTS provider: ${provider}`);
    }
  }

  private async speakWeb(text: string, options: VoiceSettings): Promise<void> {
    return new Promise((resolve, reject) => {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = options.speechRate;
      utterance.pitch = options.speechPitch;
      utterance.volume = options.speechVolume;
      utterance.lang = options.language;
      if (this.voices[options.voiceIndex]) utterance.voice = this.voices[options.voiceIndex];
      utterance.onend = () => resolve();
      utterance.onerror = (e) => reject(new Error(`Web Speech error: ${e.error}`));
      this.synthesis?.speak(utterance);
    });
  }

  private async speakKitten(text: string, options: VoiceSettings): Promise<void> {
    const res = await fetch('/api/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, voice: options.selectedVoice || 'Bruno', model: options.selectedModel || 'KittenML/kitten-tts-mini-0.8' }) });
    if (!res.ok) throw new Error(`KittenTTS error: ${res.status}`);
    const data = await res.json();
    if (!data.success || !data.audioData) throw new Error(data.error || 'KittenTTS failed');
    return this.playAudioData(data.audioData);
  }

  private async speakGemini(text: string, options: VoiceSettings): Promise<void> {
    const res = await fetch('/api/tts/gemini', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, model: options.selectedModel || 'gemini-3.1-flash-tts-preview' }) });
    if (!res.ok) throw new Error(`Gemini TTS error: ${res.status}`);
    const data = await res.json();
    if (!data.success || !data.audioData) throw new Error(data.error || 'Gemini TTS failed');
    return this.playAudioData(data.audioData);
  }

  private async speakLivekit(text: string, _options: VoiceSettings): Promise<void> {
    if (!this.room || !this.isConnected) throw new Error('LiveKit not connected');
    console.log('LiveKit TTS requested:', text);
  }

  private async playAudioData(audioData: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const audio = new Audio(audioData);
      audio.onended = () => resolve();
      audio.onerror = () => reject(new Error('Audio playback failed'));
      audio.play().catch(reject);
    });
  }

  async speak(text: string, options?: Partial<VoiceSettings>): Promise<void> {
    if (typeof window === "undefined" || !this.synthesis) throw new Error("Speech synthesis not available");
    const settings = { ...this.settings, ...options };
    this.stopSpeaking();
    this.emitEvent({ type: "synthesis", data: { text, started: true }, timestamp: Date.now() });
    const candidates: TTSProvider[] = [settings.ttsProvider, 'livekit', 'web', 'kittentts', 'gemini'];
    const uniqueCandidates = Array.from(new Set(candidates));
    const available = uniqueCandidates.filter(p => providerCircuitBreakers.isAvailable(`tts:${p}` as any));
    const providersToTry = available.length > 0 ? available : ['web'];
    let lastError = null;
    for (const provider of providersToTry) {
      const breaker = providerCircuitBreakers.get(`tts:${provider}` as any);
      const startTime = Date.now();
      try {
        await breaker.execute(async () => { await this.speakWithProvider(text, provider, settings); });
        resourceTelemetry.recordProviderCall(`tts:${provider}`, Date.now() - startTime, true);
        this.emitEvent({ type: "synthesis", data: { text, completed: true, provider }, timestamp: Date.now() }); return;
      } catch (e) {
        resourceTelemetry.recordProviderCall(`tts:${provider}`, Date.now() - startTime, false);
        console.warn(`TTS provider ${provider} failed, trying next...`, e); lastError = e;
      }
    }
    this.emitEvent({ type: "error", data: { message: "All TTS providers failed", error: lastError }, timestamp: Date.now() });
    throw lastError || new Error("All TTS providers failed");
  }

  stopSpeaking() { if (this.synthesis) this.synthesis.cancel(); this.currentUtterance = null; }
  isSpeaking(): boolean { return this.synthesis?.speaking || false; }

  private mediaRecorder: MediaRecorder | null = null;
  private audioChunks: Blob[] = [];
  private transcribeInterval: ReturnType<typeof setInterval> | null = null;
  private lastSpeechTime = 0;
  private silenceDuration = 1500;
  private vadCheckInterval: ReturnType<typeof setInterval> | null = null;

  async startListening(): Promise<boolean> {
    if (typeof window === "undefined") return false;
    if (this.isListening) return true;
    const candidates: STTProvider[] = [this.settings.sttProvider, 'deepgram', 'gladia', 'mistral', 'browser', 'assemblyai'];
    const unique = Array.from(new Set(candidates));
    for (const provider of unique) {
      const startTime = Date.now();
      try {
        if (provider === 'browser' && !this.recognition) continue;
        const breaker = providerCircuitBreakers.get(`stt:${provider}` as any);
        if (!breaker.canExecute()) continue;
        let started = false;
        await breaker.execute(async () => {
          if (provider === 'browser') { this.recognition.start(); this.isListening = true; started = true; }
          else started = await this.startChunkedListening(provider);
        });
        if (started) {
          resourceTelemetry.recordProviderCall(`stt:${provider}`, Date.now() - startTime, true);
          return true;
        }
      } catch (e) {
        resourceTelemetry.recordProviderCall(`stt:${provider}`, Date.now() - startTime, false);
        console.warn(`STT provider ${provider} failed:`, e);
      }
    }
    return false;
  }

  private async startChunkedListening(provider: STTProvider): Promise<boolean> {
    if (!navigator.mediaDevices?.getUserMedia) return false;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { sampleRate: 16000, echoCancellation: true, noiseSuppression: true } });
      this.mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      this.audioChunks = []; this.lastSpeechTime = Date.now();
      this.mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) this.audioChunks.push(e.data); };
      this.mediaRecorder.start(); this.isListening = true;
      this.startVADChecking();
      this.transcribeInterval = setInterval(async () => {
        if (this.audioChunks.length === 0) return;
        const blob = new Blob(this.audioChunks, { type: 'audio/webm' });
        this.audioChunks = [];
        try {
          const text = await this.transcribeWithProvider(blob, provider);
          if (text) { this.lastSpeechTime = Date.now(); this.emitEvent({ type: 'transcription', data: { text, isFinal: true }, timestamp: Date.now() }); }
        } catch (e) { console.warn(`${provider} transcription failed:`, e); }
      }, 2000);
      return true;
    } catch (e) { return false; }
  }

  private async transcribeWithProvider(audioBlob: Blob, provider: STTProvider): Promise<string> {
    const arrayBuffer = await audioBlob.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString('base64');
    const res = await fetch('/api/speech-to-text', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ audioData: base64, provider }) });
    if (!res.ok) throw new Error(`${provider} error: ${res.status}`);
    const data = await res.json(); return data.text || '';
  }

  private startVADChecking() {
    if (this.vadCheckInterval) return;
    this.vadCheckInterval = setInterval(() => {
      if (Date.now() - this.lastSpeechTime > this.silenceDuration && this.isListening) {
        this.emitEvent({ type: 'transcription', data: { text: '', isFinal: true, vadDetected: true }, timestamp: Date.now() });
        this.stopListening();
      }
    }, 500);
  }

  stopListening() {
    if (this.transcribeInterval) { clearInterval(this.transcribeInterval); this.transcribeInterval = null; }
    if (this.vadCheckInterval) { clearInterval(this.vadCheckInterval); this.vadCheckInterval = null; }
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') { this.mediaRecorder.stop(); this.mediaRecorder.stream.getTracks().forEach(t => t.stop()); this.mediaRecorder = null; }
    if (this.recognition && this.isListening) { this.recognition.stop(); }
    this.isListening = false;
  }

  updateSettings(newSettings: Partial<VoiceSettings>) {
    this.settings = { ...this.settings, ...newSettings }; this.saveSettings();
    if (this.recognition && newSettings.language) this.recognition.lang = newSettings.language;
    this.emitEvent({ type: "settings", data: { settings: this.settings }, timestamp: Date.now() });
    if (newSettings.enabled !== undefined) {
      if (newSettings.enabled && !this.isConnected) this.connectToLivekit("voice-chat", "user").catch(console.error);
      else if (!newSettings.enabled && this.isConnected) this.disconnectFromLivekit();
    }
  }

  getSettings(): VoiceSettings { return { ...this.settings }; }
  getAvailableVoices(): SpeechSynthesisVoice[] { return [...this.voices]; }
  isLivekitConnected(): boolean { return this.isConnected; }
  isSpeechSynthesisSupported(): boolean { return typeof window !== "undefined" && !!this.synthesis; }
  
  configureVAD(silenceDuration: number, threshold: number): void {
    // VAD will use these thresholds when checking audio levels
    this.silenceDuration = silenceDuration;
    this.vadThreshold = threshold;
  }
  
  setVADEnabled(enabled: boolean): void {
    this.vadEnabled = enabled;
  }
  
  isVoiceSupported(): boolean {
    return typeof window !== "undefined" && (!!this.synthesis || !!this.recognition);
  }
  
  isSpeechRecognitionSupported(): boolean {
    return typeof window !== "undefined" && !!this.recognition;
  }
}

export const voiceService = new VoiceService();
export type { VoiceService };
declare global { interface Window { SpeechRecognition: any; webkitSpeechRecognition: any; } }
