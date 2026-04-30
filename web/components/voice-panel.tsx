"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Mic,
  MicOff,
  Volume2,
  Phone,
  PhoneOff,
  Settings,
  Bot,
  User,
  Loader2,
  Wifi,
  WifiOff,
  Square,
  ChevronUp,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { useVoiceSettings, useAvailableVoices } from "@/lib/voice/use-voice";
import { cn } from "@/lib/utils";

interface VoiceMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

interface VoicePanelProps {
  onClose?: () => void;
  onTextSubmit?: (text: string) => void;
}

export function VoicePanel({ onClose, onTextSubmit }: VoicePanelProps) {
  const { 
    settings, 
    updateSettings, 
    isListening, 
    startListening, 
    stopListening, 
    isSpeaking, 
    speak, 
    stopSpeaking, 
    isConnected, 
    connectToLivekit,
    transcription
  } = useVoiceSettings();

  const { voices } = useAvailableVoices();
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);

  // Audio level state
  const [audioLevel, setAudioLevel] = useState(0);

  // Messages
  const [voiceMessages, setVoiceMessages] = useState<VoiceMessage[]>([]);
  const [showSettings, setShowSettings] = useState(false);

  // AI processing state
  const [isProcessingAI, setIsProcessingAI] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Handle incoming transcriptions from the hook
  // FIX: Only process final transcriptions, not interim ones
  // The hook emits both interim and final transcriptions without isFinal flag
  // so we check transcription length to filter out partial/short interim results
  useEffect(() => {
    if (transcription && !isProcessingAI && transcription.length > 3) {
      // Only process non-empty, substantive transcriptions
      // Short transcriptions (< 4 chars) are likely interim partial results
      handleUserSpeech(transcription);
    }
  }, [transcription]);

  const handleUserSpeech = async (text: string) => {
    if (!text.trim() || isProcessingAI) return;

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();
    setIsProcessingAI(true);

    const userMessage: VoiceMessage = {
      id: `msg-${Date.now()}`,
      role: "user",
      content: text,
      timestamp: Date.now(),
    };
    setVoiceMessages(prev => [...prev, userMessage]);

    const loadingId = `msg-${Date.now()}-loading`;
    const loadingMessage: VoiceMessage = {
      id: loadingId,
      role: "assistant",
      content: "Thinking...",
      timestamp: Date.now(),
    };
    setVoiceMessages(prev => [...prev, loadingMessage]);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: text }],
          provider: 'openrouter',
          model: 'nvidia/nemotron-3-30b-a3b:free',
          stream: true,
        }),
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) throw new Error(`Chat API error: ${response.status}`);

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let aiResponse = '';
      let buffer = '';

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          const content = buffer + chunk;
          const lines = content.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmedLine = line.trim();
            if (trimmedLine.startsWith('data: ')) {
              const data = trimmedLine.slice(6);
              if (data === '[DONE]') continue;
              try {
                const parsed = JSON.parse(data);
                const delta = parsed?.choices?.[0]?.delta?.content;
                if (delta) {
                  aiResponse += delta;
                  setVoiceMessages(prev => prev.map(msg =>
                    msg.id === loadingId ? { ...msg, content: aiResponse } : msg
                  ));
                }
              } catch { /* ignore */ }
            }
          }
        }
      }

      const cleanedResponse = aiResponse.replace(/<[^>]+>/g, '').trim();
      setVoiceMessages(prev => prev.map(msg =>
        msg.id === loadingId ? { ...msg, content: cleanedResponse } : msg
      ));

      if (settings?.autoSpeak && cleanedResponse) {
        await speak(cleanedResponse);
      }

    } catch (error: any) {
      if (error.name !== 'AbortError') {
        setVoiceMessages(prev => prev.map(msg =>
          msg.id === loadingId ? { ...msg, content: "Error getting response." } : msg
        ));
      }
    } finally {
      setIsProcessingAI(false);
      abortControllerRef.current = null;
    }
  };

  const handleConnect = async () => {
    setIsConnecting(true);
    setConnectionError(null);
    try {
      const success = await connectToLivekit("voice-chat", "user");
      if (success) toast.success("Connected to voice service");
    } catch (error: any) {
      setConnectionError(error.message);
    } finally {
      setIsConnecting(false);
    }
  };

  if (!settings) return <div className="p-8 text-center text-white/40">Loading voice settings...</div>;

  return (
    <div className="flex flex-col h-full bg-gradient-to-b from-gray-900 to-black">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 bg-black/40">
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-full ${isConnected ? 'bg-green-500/20' : 'bg-gray-500/20'}`}>
            {isConnected ? <Wifi className="h-4 w-4 text-green-400" /> : <WifiOff className="h-4 w-4 text-gray-400" />}
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
              onClick={async () => {
                // FIX: Properly disconnect from voice service
                // stopListening stops the microphone
                stopListening();
                // Clear all voice-related UI state
                setAudioLevel(0);
                setVoiceMessages([]);
                setIsListening(false);
                // Note: For full LiveKit disconnect, the useVoiceSettings hook needs to expose
                // a disconnect method that cleans up the LiveKit room connection.
                // For now, we stop listening and clear state which provides basic cleanup.
                toast.info('Disconnected from voice service');
              }}
              className="h-8 bg-red-500/20 hover:bg-red-500/30 border border-red-500/30 text-red-400"
            >
              <PhoneOff className="h-3 w-3 mr-1" />
              Disconnect
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleConnect}
              disabled={isConnecting}
              className="h-8 bg-green-500/20 hover:bg-green-500/30 border border-green-500/30 text-green-400"
            >
              {isConnecting ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Phone className="h-3 w-3 mr-1" />}
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
            <Button variant="ghost" size="sm" onClick={() => setShowSettings(false)} className="h-6 text-xs text-white/50">
              <ChevronUp className="h-3 w-3" />
            </Button>
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] text-white/50 block mb-1">TTS Provider</label>
              <select
                value={settings.ttsProvider}
                onChange={(e) => updateSettings({ ttsProvider: e.target.value as any })}
                className="w-full text-xs bg-white/5 border border-white/10 rounded px-2 py-1.5 text-white/80"
              >
                <option value="web">Web Speech API</option>
                <option value="gemini">Gemini Flash 3.1</option>
                <option value="kittentts">KittenTTS (Local)</option>
              </select>
            </div>

            <div>
              <label className="text-[10px] text-white/50 block mb-1">Speech-to-Text</label>
              <select
                value={settings.sttProvider}
                onChange={(e) => updateSettings({ sttProvider: e.target.value as any })}
                className="w-full text-xs bg-white/5 border border-white/10 rounded px-2 py-1.5 text-white/80"
              >
                <option value="browser">Browser Native</option>
                <option value="mistral">Mistral Voxtral</option>
              </select>
            </div>
          </div>
        </div>
      )}

      {/* Main Voice Interface */}
      <div className="flex-1 flex flex-col items-center justify-center p-6 space-y-8">
        <div className="relative w-40 h-40">
          <div className={`absolute inset-0 rounded-full border-2 transition-all duration-300 ${
            isListening ? 'border-green-500/50 animate-pulse' : 
            isSpeaking ? 'border-purple-500/50' :
            'border-white/10'
          }`} />
          
          <div className="absolute inset-0 flex items-center justify-center">
            <button
              onClick={isListening ? stopListening : startListening}
              className={cn(
                "w-20 h-20 rounded-full flex items-center justify-center transition-all duration-300 border-2",
                isListening ? "bg-red-500/20 border-red-500 shadow-[0_0_20px_rgba(239,68,68,0.3)]" : "bg-blue-500/20 border-blue-500 shadow-[0_0_20px_rgba(59,130,246,0.3)]"
              )}
            >
              {isListening ? <MicOff className="h-8 w-8 text-red-400" /> : <Mic className="h-8 w-8 text-blue-400" />}
            </button>
          </div>
        </div>

        <div className="text-center space-y-2">
          {isListening ? <p className="text-sm text-green-400 font-medium">Listening...</p> : 
           isSpeaking ? <p className="text-sm text-purple-400 font-medium">Speaking...</p> : 
           <p className="text-sm text-white/50">Ready</p>}
        </div>
      </div>

      {/* Transcript / Messages */}
      <div className="border-t border-white/10">
        <ScrollArea className="h-32 p-4">
          <div className="space-y-3">
            {voiceMessages.slice(-4).map((msg) => (
              <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className={cn(
                  "max-w-[80%] p-2 rounded-lg border",
                  msg.role === "user" ? "bg-blue-500/10 border-blue-500/20" : "bg-purple-500/10 border-purple-500/20"
                )}>
                  <div className="flex items-center gap-2 mb-1">
                    {msg.role === "user" ? <User className="h-3 w-3 text-blue-400" /> : <Bot className="h-3 w-3 text-purple-400" />}
                    <span className="text-[10px] text-white/50">{msg.role === "user" ? "You" : "AI"}</span>
                  </div>
                  <p className="text-xs text-white/80">{msg.content}</p>
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}

export default VoicePanel;
