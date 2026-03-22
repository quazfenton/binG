"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  Phone,
  PhoneOff,
  Settings,
  MessageSquare,
  Bot,
  User,
  Loader2,
  Wifi,
  WifiOff,
  Play,
  Pause,
  Square,
  ChevronUp,
  ChevronDown,
  RefreshCw,
  Sparkles,
  AlertCircle,
} from "lucide-react";
import { toast } from "sonner";

interface VoiceMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  audioUrl?: string;
}

interface VoiceSettings {
  ttsProvider: "kittentts" | "web" | "livekit";
  sttProvider: "livekit" | "web";
  voice: string;
  model: string;
  autoSpeak: boolean;
  echoCancellation: boolean;
  noiseSuppression: boolean;
  micGain: number;
}

interface VoicePanelProps {
  onClose?: () => void;
  onTextSubmit?: (text: string) => void;
}

export function VoicePanel({ onClose, onTextSubmit }: VoicePanelProps) {
  // Connection state
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);

  // Audio state
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [transcript, setTranscript] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");

  // Messages
  const [voiceMessages, setVoiceMessages] = useState<VoiceMessage[]>([]);

  // Settings
  const [settings, setSettings] = useState<VoiceSettings>({
    ttsProvider: "kittentts",
    sttProvider: "livekit",
    voice: "Bruno",
    model: "KittenML/kitten-tts-mini-0.8",
    autoSpeak: true,
    echoCancellation: true,
    noiseSuppression: true,
    micGain: 1.0,
  });
  const [showSettings, setShowSettings] = useState(false);

  // TTS availability
  const [ttsAvailable, setTtsAvailable] = useState(false);
  const [availableVoices, setAvailableVoices] = useState<string[]>([
    "Bella", "Jasper", "Luna", "Bruno", "Rosie", "Hugo", "Kiki", "Leo"
  ]);
  const [availableModels, setAvailableModels] = useState<{id: string; name: string}[]>([
    { id: "KittenML/kitten-tts-mini-0.8", name: "Mini (80M)" },
    { id: "KittenML/kitten-tts-micro-0.8", name: "Micro (40M)" },
    { id: "KittenML/kitten-tts-nano-0.8", name: "Nano (15M)" },
  ]);

  // Refs
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const recognitionRef = useRef<any>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationRef = useRef<number | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // AI processing state
  const [isProcessingAI, setIsProcessingAI] = useState(false);

  // Check TTS availability on mount
  useEffect(() => {
    checkTTSAvailability();
  }, []);

  // Cleanup on unmount - prevent memory leaks
  useEffect(() => {
    return () => {
      // Stop any ongoing speech
      speechSynthesis.cancel();
      
      // Stop microphone if active
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach(track => track.stop());
        mediaStreamRef.current = null;
      }
      
      // Stop speech recognition
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch (e) { /* ignore */ }
        recognitionRef.current = null;
      }
      
      // Close audio context
      if (audioContextRef.current) {
        audioContextRef.current.close();
        audioContextRef.current = null;
      }
      
      // Cancel animation frames
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }

      // Cancel any in-flight AI request
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
    };
  }, []);

  // Initialize speech recognition
  useEffect(() => {
    if (typeof window !== "undefined") {
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (SpeechRecognition) {
        const recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = "en-US";

        recognition.onresult = (event: any) => {
          let final = "";
          let interim = "";

          for (let i = event.resultIndex; i < event.results.length; i++) {
            const result = event.results[i];
            if (result.isFinal) {
              final += result[0].transcript;
            } else {
              interim += result[0].transcript;
            }
          }

          if (final) {
            setTranscript(prev => prev + " " + final);
            setInterimTranscript("");
            // Add to messages
            handleUserSpeech(final.trim());
          } else {
            setInterimTranscript(interim);
          }
        };

        recognition.onerror = (event: any) => {
          console.error("[VoicePanel] Speech recognition error:", event.error);
          if (event.error !== "no-speech") {
            setConnectionError(`Speech error: ${event.error}`);
          }
        };

        recognition.onend = () => {
          if (isListening) {
            // Restart if still supposed to be listening
            try {
              recognition.start();
            } catch (e) {
              console.error("[VoicePanel] Failed to restart recognition:", e);
            }
          }
        };

        recognitionRef.current = recognition;
      }
    }
  }, [isListening]);

  // Audio level monitoring
  useEffect(() => {
    if (isListening && mediaStreamRef.current) {
      const audioContext = new AudioContext();
      const analyser = audioContext.createAnalyser();
      const source = audioContext.createMediaStreamSource(mediaStreamRef.current);
      
      source.connect(analyser);
      analyser.fftSize = 256;
      
      audioContextRef.current = audioContext;
      analyserRef.current = analyser;

      const updateLevel = () => {
        if (!analyserRef.current) return;
        
        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(dataArray);
        
        const average = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
        setAudioLevel(Math.min(100, average * 1.5));

        if (isListening) {
          animationRef.current = requestAnimationFrame(updateLevel);
        }
      };

      updateLevel();

      return () => {
        if (animationRef.current) {
          cancelAnimationFrame(animationRef.current);
        }
        if (audioContextRef.current) {
          audioContextRef.current.close();
        }
      };
    }
  }, [isListening]);

  const checkTTSAvailability = async () => {
    try {
      const response = await fetch('/api/tts');
      const data = await response.json();
      setTtsAvailable(data.available);
      if (data.voices) setAvailableVoices(data.voices);
      if (data.models) setAvailableModels(data.models.map((m: any) => ({ id: m.id, name: m.name })));
    } catch (error) {
      console.error("[VoicePanel] TTS availability check failed:", error);
      setTtsAvailable(false);
    }
  };

  const startListening = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: settings.echoCancellation,
          noiseSuppression: settings.noiseSuppression,
          autoGainControl: true,
        } 
      });
      
      mediaStreamRef.current = stream;
      
      if (settings.sttProvider === "web" && recognitionRef.current) {
        recognitionRef.current.start();
      }
      
      setIsListening(true);
      setTranscript("");
      setInterimTranscript("");
      setConnectionError(null);
      toast.success("Microphone activated");
    } catch (error: any) {
      console.error("[VoicePanel] Failed to start listening:", error);
      setConnectionError(`Microphone error: ${error.message}`);
      toast.error("Failed to access microphone");
    }
  };

  const stopListening = useCallback(() => {
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
    }
    
    if (recognitionRef.current) {
      recognitionRef.current.stop();
    }
    
    setIsListening(false);
    setAudioLevel(0);
    toast.info("Microphone deactivated");
  }, []);

  const handleUserSpeech = async (text: string) => {
    if (!text.trim() || isProcessingAI) return;

    // Cancel any existing request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();
    setIsProcessingAI(true);

    // Add user message
    const userMessage: VoiceMessage = {
      id: `msg-${Date.now()}`,
      role: "user",
      content: text,
      timestamp: Date.now(),
    };
    setVoiceMessages(prev => [...prev, userMessage]);

    // Add loading indicator for AI response
    const loadingId = `msg-${Date.now()}-loading`;
    const loadingMessage: VoiceMessage = {
      id: loadingId,
      role: "assistant",
      content: "Thinking...",
      timestamp: Date.now(),
    };
    setVoiceMessages(prev => [...prev, loadingMessage]);

    try {
      // Call the chat API with the user's speech
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages: [
            { role: 'user', content: text }
          ],
          provider: 'openrouter',
          model: settings.model || 'nvidia/nemotron-3-30b-a3b:free',
          stream: true,
          conversationId: `voice-chat-${Date.now()}`,
        }),
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) {
        throw new Error(`Chat API error: ${response.status}`);
      }

      // Handle streaming response
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let aiResponse = '';

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split('\n');

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6);
              if (data === '[DONE]') continue;

              try {
                const parsed = JSON.parse(data);
                const content = parsed?.choices?.[0]?.delta?.content;
                if (content) {
                  aiResponse += content;
                  // Update loading message in real-time
                  setVoiceMessages(prev => prev.map(msg => 
                    msg.id === loadingId ? { ...msg, content: aiResponse } : msg
                  ));
                }
              } catch {
                // Not valid JSON, skip
              }
            }
          }
        }
      }

      // Clean up the response (remove any command artifacts)
      const cleanedResponse = aiResponse
        .replace(/===[\s\S]*?===/g, '')
        .replace(/```[\s\S]*?```/g, '')
        .replace(/<[^>]+>/g, '')
        .trim() || "I didn't get a response. Please try again.";

      // Update the final message
      setVoiceMessages(prev => prev.map(msg => 
        msg.id === loadingId ? { ...msg, content: cleanedResponse } : msg
      ));

      // If auto-speak is on, speak the response
      if (settings.autoSpeak && cleanedResponse) {
        await speakText(cleanedResponse);
      }

    } catch (error: any) {
      if (error.name === 'AbortError') {
        console.log('[VoicePanel] Request cancelled');
        return;
      }
      console.error('[VoicePanel] Chat API error:', error);
      // Update loading message with error
      setVoiceMessages(prev => prev.map(msg => 
        msg.id === loadingId ? { ...msg, content: `Error: ${error.message || 'Failed to get response'}` } : msg
      ));
      toast.error('Failed to get AI response');
    } finally {
      setIsProcessingAI(false);
      abortControllerRef.current = null;
    }
  };

  const speakText = async (text: string) => {
    if (!text) return;

    setIsSpeaking(true);

    try {
      if (settings.ttsProvider === "kittentts" && ttsAvailable) {
        // Use KittenTTS
        const response = await fetch('/api/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text,
            voice: settings.voice,
            model: settings.model,
          }),
        });

        const data = await response.json();
        
        if (data.success && data.audioData) {
          // Play the audio
          const audio = new Audio(data.audioData);
          audio.onended = () => setIsSpeaking(false);
          audio.onerror = () => {
            setIsSpeaking(false);
            toast.error("Audio playback failed");
          };
          await audio.play();
        } else {
          throw new Error(data.error || 'TTS failed');
        }
      } else {
        // Fallback to Web Speech API
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.onend = () => setIsSpeaking(false);
        utterance.onerror = () => {
          setIsSpeaking(false);
          toast.error("Speech synthesis failed");
        };
        speechSynthesis.speak(utterance);
      }
    } catch (error: any) {
      console.error("[VoicePanel] TTS error:", error);
      setIsSpeaking(false);
      toast.error(`Speech error: ${error.message}`);
    }
  };

  const stopSpeaking = () => {
    speechSynthesis.cancel();
    setIsSpeaking(false);
  };

  const connectToLiveKit = async () => {
    setIsConnecting(true);
    setConnectionError(null);

    try {
      // Get token from API
      const response = await fetch('/api/livekit/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomName: 'voice-chat-room' }),
      });

      if (!response.ok) {
        throw new Error('Failed to get LiveKit token');
      }

      const { token } = await response.json();

      // In a full implementation, we would connect to LiveKit here
      // For now, simulate connection
      setTimeout(() => {
        setIsConnected(true);
        setIsConnecting(false);
        toast.success("Connected to voice service");
      }, 1000);
    } catch (error: any) {
      console.error("[VoicePanel] LiveKit connection error:", error);
      setConnectionError(error.message);
      setIsConnecting(false);
      // Fall back to local mode
      setIsConnected(true);
      toast.info("Using local voice mode");
    }
  };

  const disconnectFromLiveKit = () => {
    stopListening();
    stopSpeaking();
    setIsConnected(false);
    toast.info("Disconnected from voice service");
  };

  return (
    <div className="flex flex-col h-full bg-gradient-to-b from-gray-900 to-black">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 bg-black/40">
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-full ${isConnected ? 'bg-green-500/20' : 'bg-gray-500/20'}`}>
            {isConnected ? (
              <Wifi className="h-4 w-4 text-green-400" />
            ) : (
              <WifiOff className="h-4 w-4 text-gray-400" />
            )}
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white/90">Voice Chat</h3>
            <p className="text-[10px] text-white/50">
              {isConnected ? "Connected" : "Disconnected"}
              {isListening && " • Listening"}
              {isSpeaking && " • Speaking"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setShowSettings(!showSettings)}
            className={`h-8 w-8 hover:bg-white/10 ${showSettings ? 'text-cyan-400' : 'text-white/60'}`}
          >
            <Settings className="h-4 w-4" />
          </Button>
          {isConnected ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={disconnectFromLiveKit}
              className="h-8 bg-red-500/20 hover:bg-red-500/30 border border-red-500/30 text-red-400"
            >
              <PhoneOff className="h-3 w-3 mr-1" />
              Disconnect
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              onClick={connectToLiveKit}
              disabled={isConnecting}
              className="h-8 bg-green-500/20 hover:bg-green-500/30 border border-green-500/30 text-green-400"
            >
              {isConnecting ? (
                <Loader2 className="h-3 w-3 mr-1 animate-spin" />
              ) : (
                <Phone className="h-3 w-3 mr-1" />
              )}
              Connect
            </Button>
          )}
        </div>
      </div>

      {/* Settings Panel */}
      {showSettings && (
        <div className="p-4 border-b border-white/10 bg-black/20 space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-medium text-white/80">Voice Settings</h4>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowSettings(false)}
              className="h-6 text-xs text-white/50"
            >
              <ChevronUp className="h-3 w-3" />
            </Button>
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            {/* TTS Provider */}
            <div>
              <label className="text-[10px] text-white/50 block mb-1">TTS Provider</label>
              <select
                value={settings.ttsProvider}
                onChange={(e) => setSettings(s => ({ ...s, ttsProvider: e.target.value as any }))}
                className="w-full text-xs bg-white/5 border border-white/10 rounded px-2 py-1.5 text-white/80"
              >
                <option value="kittentts">KittenTTS</option>
                <option value="web">Web Speech API</option>
                <option value="livekit">LiveKit TTS</option>
              </select>
            </div>

            {/* STT Provider */}
            <div>
              <label className="text-[10px] text-white/50 block mb-1">Speech-to-Text</label>
              <select
                value={settings.sttProvider}
                onChange={(e) => setSettings(s => ({ ...s, sttProvider: e.target.value as any }))}
                className="w-full text-xs bg-white/5 border border-white/10 rounded px-2 py-1.5 text-white/80"
              >
                <option value="web">Web Speech API</option>
                <option value="livekit">LiveKit Whisper</option>
              </select>
            </div>

            {/* Voice */}
            <div>
              <label className="text-[10px] text-white/50 block mb-1">Voice</label>
              <select
                value={settings.voice}
                onChange={(e) => setSettings(s => ({ ...s, voice: e.target.value }))}
                className="w-full text-xs bg-white/5 border border-white/10 rounded px-2 py-1.5 text-white/80"
              >
                {availableVoices.map(voice => (
                  <option key={voice} value={voice}>{voice}</option>
                ))}
              </select>
            </div>

            {/* Model */}
            <div>
              <label className="text-[10px] text-white/50 block mb-1">Model</label>
              <select
                value={settings.model}
                onChange={(e) => setSettings(s => ({ ...s, model: e.target.value }))}
                className="w-full text-xs bg-white/5 border border-white/10 rounded px-2 py-1.5 text-white/80"
              >
                {availableModels.map(model => (
                  <option key={model.id} value={model.id}>{model.name}</option>
                ))}
              </select>
            </div>
          </div>

          {/* TTS Available indicator */}
          <div className="flex items-center gap-2">
            <Badge variant={ttsAvailable ? "default" : "secondary"} className="text-[10px]">
              {ttsAvailable ? (
                <><Sparkles className="h-2 w-2 mr-1 text-yellow-400" /> KittenTTS Ready</>
              ) : (
                <><AlertCircle className="h-2 w-2 mr-1 text-red-400" /> KittenTTS Unavailable</>
              )}
            </Badge>
          </div>
        </div>
      )}

      {/* Main Voice Interface */}
      <div className="flex-1 flex flex-col items-center justify-center p-6 space-y-8">
        {/* Audio Visualizer */}
        <div className="relative w-40 h-40">
          {/* Outer ring */}
          <div className={`absolute inset-0 rounded-full border-2 transition-all duration-300 ${
            isListening ? 'border-green-500/50 animate-pulse' : 
            isSpeaking ? 'border-purple-500/50' :
            'border-white/10'
          }`} />
          
          {/* Middle ring */}
          <div className={`absolute inset-2 rounded-full border transition-all duration-300 ${
            isListening ? 'border-green-400/30' : 'border-white/5'
          }`}>
            {/* Audio level bars */}
            {isListening && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="flex gap-1">
                  {[...Array(12)].map((_, i) => (
                    <div
                      key={i}
                      className="w-1 bg-green-400 rounded-full transition-all duration-100"
                      style={{
                        height: `${Math.max(4, Math.min(24, (audioLevel / 100) * 24 * (Math.random() + 0.5)))}px`,
                        opacity: 0.3 + (audioLevel / 100) * 0.7,
                      }}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Center button */}
          <div className="absolute inset-0 flex items-center justify-center">
            <button
              onClick={isListening ? stopListening : startListening}
              className={`w-20 h-20 rounded-full flex items-center justify-center transition-all duration-300 ${
                isListening 
                  ? 'bg-red-500/20 border-2 border-red-500 hover:bg-red-500/30' 
                  : 'bg-blue-500/20 border-2 border-blue-500 hover:bg-blue-500/30'
              }`}
            >
              {isListening ? (
                <MicOff className="h-8 w-8 text-red-400" />
              ) : (
                <Mic className="h-8 w-8 text-blue-400" />
              )}
            </button>
          </div>
        </div>

        {/* Status Text */}
        <div className="text-center space-y-2">
          {isListening ? (
            <>
              <p className="text-sm text-white/80 font-medium">Listening...</p>
              <p className="text-xs text-white/50">
                {interimTranscript || "Speak now"}
              </p>
            </>
          ) : isSpeaking ? (
            <>
              <p className="text-sm text-purple-400 font-medium">Speaking...</p>
              <Button
                variant="ghost"
                size="sm"
                onClick={stopSpeaking}
                className="text-xs text-white/50 hover:text-white"
              >
                <Square className="h-3 w-3 mr-1" />
                Stop
              </Button>
            </>
          ) : isConnected ? (
            <p className="text-sm text-white/50">Tap microphone to speak</p>
          ) : (
            <p className="text-sm text-white/50">Connect to start voice chat</p>
          )}
        </div>

        {/* Connection Error */}
        {connectionError && (
          <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
            <p className="text-xs text-red-400">{connectionError}</p>
          </div>
        )}
      </div>

      {/* Transcript / Messages */}
      <div className="border-t border-white/10">
        <ScrollArea className="h-32 p-4">
          {voiceMessages.length === 0 ? (
            <p className="text-xs text-white/30 text-center py-4">
              Voice messages will appear here
            </p>
          ) : (
            <div className="space-y-3">
              {voiceMessages.slice(-4).map((msg) => (
                <div
                  key={msg.id}
                  className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[80%] p-2 rounded-lg ${
                      msg.role === "user"
                        ? "bg-blue-500/20 border border-blue-500/30"
                        : "bg-purple-500/20 border border-purple-500/30"
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      {msg.role === "user" ? (
                        <User className="h-3 w-3 text-blue-400" />
                      ) : (
                        <Bot className="h-3 w-3 text-purple-400" />
                      )}
                      <span className="text-[10px] text-white/50">
                        {msg.role === "user" ? "You" : "AI"}
                      </span>
                    </div>
                    <p className="text-xs text-white/80">{msg.content}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>

        {/* Quick Actions */}
        <div className="flex items-center justify-between px-4 py-2 border-t border-white/10 bg-black/20">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => speakText("Hello! I'm ready to help you with your coding tasks.")}
            disabled={isSpeaking}
            className="text-xs text-white/60 hover:text-white"
          >
            <Volume2 className="h-3 w-3 mr-1" />
            Test Voice
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setVoiceMessages([])}
            className="text-xs text-white/60 hover:text-white"
          >
            <RefreshCw className="h-3 w-3 mr-1" />
            Clear
          </Button>
        </div>
      </div>
    </div>
  );
}

export default VoicePanel;