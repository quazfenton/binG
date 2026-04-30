"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { voiceService, type VoiceSettings, type VoiceEvent } from "./voice-service";

/**
 * Hook for managing voice service settings and state
 * 
 * IMPROVEMENT: Centralizes voice settings management for better synchronization
 * across the UI and prevents direct localStorage access in the service
 */
export function useVoiceSettings() {
  const [settings, setSettings] = useState<VoiceSettings | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transcription, setTranscription] = useState<string>("");
  const eventHandlerRef = useRef<((event: VoiceEvent) => void) | null>(null);

  // Initialize settings and event listeners
  useEffect(() => {
    const currentSettings = voiceService.getSettings();
    setSettings(currentSettings);
    setIsConnected(voiceService.isLivekitConnected());

    // Create event handler
    const handleVoiceEvent = (event: VoiceEvent) => {
      switch (event.type) {
        case "transcription":
          setTranscription(event.data.text || "");
          if (event.data.vadDetected) {
            setIsListening(false);
          }
          break;
        case "synthesis":
          setIsSpeaking(event.data.started || false);
          break;
        case "error":
          setError(event.data.message || "Unknown error");
          break;
        case "connected":
          setIsConnected(true);
          setError(null);
          break;
        case "disconnected":
          setIsConnected(false);
          break;
      }
    };

    eventHandlerRef.current = handleVoiceEvent;
    voiceService.addEventListener(handleVoiceEvent);

    // Cleanup
    return () => {
      if (eventHandlerRef.current) {
        voiceService.removeEventListener(eventHandlerRef.current);
      }
    };
  }, []);

  const updateSettings = useCallback((newSettings: Partial<VoiceSettings>) => {
    voiceService.updateSettings(newSettings);
    const updated = voiceService.getSettings();
    setSettings(updated);
  }, []);

  const startListening = useCallback(async () => {
    try {
      const started = await voiceService.startListening();
      if (started) {
        setIsListening(true);
        setError(null);
        setTranscription("");
      } else {
        setError("Failed to start listening");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start listening");
    }
  }, []);

  const stopListening = useCallback(() => {
    voiceService.stopListening();
    setIsListening(false);
  }, []);

  const speak = useCallback(async (text: string) => {
    try {
      setIsSpeaking(true);
      await voiceService.speak(text);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to speak");
    } finally {
      setIsSpeaking(false);
    }
  }, []);

  const stopSpeaking = useCallback(() => {
    voiceService.stopSpeaking();
    setIsSpeaking(false);
  }, []);

  const connectToLivekit = useCallback(
    async (roomName: string, participantName: string) => {
      try {
        const connected = await voiceService.connectToLivekit(roomName, participantName);
        setIsConnected(connected);
        if (!connected) {
          setError("Failed to connect to LiveKit");
        } else {
          setError(null);
        }
        return connected;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to connect");
        return false;
      }
    },
    []
  );

  const configureVAD = useCallback((silenceDuration: number, threshold: number) => {
    voiceService.configureVAD(silenceDuration, threshold);
  }, []);

  const setVADEnabled = useCallback((enabled: boolean) => {
    voiceService.setVADEnabled(enabled);
  }, []);

  return {
    // Settings
    settings,
    updateSettings,
    
    // State
    isListening,
    isSpeaking,
    isConnected,
    error,
    transcription,
    
    // Controls
    startListening,
    stopListening,
    speak,
    stopSpeaking,
    connectToLivekit,
    
    // VAD
    configureVAD,
    setVADEnabled,
    
    // Service reference for advanced usage
    voiceService,
  };
}

/**
 * Hook for monitoring voice service events
 * 
 * Useful for components that need to react to specific voice events
 */
export function useVoiceEvents(callback: (event: VoiceEvent) => void) {
  useEffect(() => {
    voiceService.addEventListener(callback);
    return () => {
      voiceService.removeEventListener(callback);
    };
  }, [callback]);
}

/**
 * Hook for voice feature availability detection
 */
export function useVoiceCapabilities() {
  const [capabilities, setCapabilities] = useState({
    voiceSupported: false,
    speechSynthesisSupported: false,
    speechRecognitionSupported: false,
  });

  useEffect(() => {
    setCapabilities({
      voiceSupported: voiceService.isVoiceSupported(),
      speechSynthesisSupported: voiceService.isSpeechSynthesisSupported(),
      speechRecognitionSupported: voiceService.isSpeechRecognitionSupported(),
    });
  }, []);

  return capabilities;
}

/**
 * Hook for available voices
 * 
 * IMPROVEMENT: Enables voice preview UI implementation
 */
export function useAvailableVoices() {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedVoiceIndex, setSelectedVoiceIndex] = useState(0);

  useEffect(() => {
    const availableVoices = voiceService.getAvailableVoices();
    setVoices(availableVoices);
  }, []);

  const previewVoice = useCallback(async (voiceIndex: number, text: string = "This is a voice preview") => {
    if (voiceIndex >= 0 && voiceIndex < voices.length) {
      setSelectedVoiceIndex(voiceIndex);
      try {
        await voiceService.speak(text, { voiceIndex });
      } catch (error) {
        console.error("Failed to preview voice:", error);
      }
    }
  }, [voices]);

  const getVoiceInfo = useCallback((voiceIndex: number) => {
    if (voiceIndex >= 0 && voiceIndex < voices.length) {
      const voice = voices[voiceIndex];
      return {
        name: voice.name,
        lang: voice.lang,
        default: voice.default,
        localService: voice.localService,
      };
    }
    return null;
  }, [voices]);

  return {
    voices,
    selectedVoiceIndex,
    previewVoice,
    getVoiceInfo,
    setSelectedVoiceIndex,
  };
}
