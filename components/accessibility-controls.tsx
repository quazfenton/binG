"use client";

import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import type { Message } from "@/types";
import {
  X,
  Volume2,
  VolumeX,
  Type,
  MousePointer,
  Contrast,
  Mic,
  MicOff,
  Play,
  Pause,
  Square,
  Palette,
  User,
  LogIn,
  LogOut,
  Settings as SettingsIcon,
  Crown,
  Mail,
} from "lucide-react";

interface AccessibilityControlsProps {
  onClose: () => void;
  messages: Message[];
  isProcessing?: boolean;
  voiceEnabled?: boolean;
  onVoiceToggle?: (enabled: boolean) => void;
}

export default function AccessibilityControls({
  onClose,
  messages,
  isProcessing = false,
  voiceEnabled = false,
  onVoiceToggle,
}: AccessibilityControlsProps) {
  const [textSize, setTextSize] = useState(100);
  const [highContrast, setHighContrast] = useState(false);
  const [screenReader, setScreenReader] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [isReading, setIsReading] = useState(false);
  const [speechRate, setSpeechRate] = useState(1);
  const [speechVolume, setSpeechVolume] = useState(0.8);
  const [isListening, setIsListening] = useState(false);

  // New state for themes and account
  const [currentTheme, setCurrentTheme] = useState('default');
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [userEmail, setUserEmail] = useState('');
  const [promptCount, setPromptCount] = useState(0);
  const [showAdWarning, setShowAdWarning] = useState(false);

  // Theme definitions
  const themes = {
    default: {
      name: 'Dark Default',
      primary: '#8b5cf6',
      secondary: '#ec4899',
      accent: '#06b6d4',
      background: 'bg-black',
      description: 'Classic dark theme'
    },
    pink: {
      name: 'Pink Noir',
      primary: '#ec4899',
      secondary: '#f97316',
      accent: '#8b5cf6',
      background: 'bg-gray-900',
      description: 'Pink and orange accents'
    },
    blue: {
      name: 'Ocean Deep',
      primary: '#0ea5e9',
      secondary: '#06b6d4',
      accent: '#3b82f6',
      background: 'bg-slate-900',
      description: 'Deep blue tones'
    },
    green: {
      name: 'Matrix',
      primary: '#10b981',
      secondary: '#059669',
      accent: '#34d399',
      background: 'bg-gray-900',
      description: 'Green matrix style'
    },
    purple: {
      name: 'Cosmic',
      primary: '#8b5cf6',
      secondary: '#a855f7',
      accent: '#c084fc',
      background: 'bg-indigo-950',
      description: 'Purple cosmic theme'
    }
  };

  const speechSynthesis = useRef<SpeechSynthesis | null>(null);
  const recognition = useRef<SpeechRecognition | null>(null);
  const currentUtterance = useRef<SpeechSynthesisUtterance | null>(null);

  // Initialize speech synthesis and recognition
  useEffect(() => {
    if (typeof window !== 'undefined') {
      speechSynthesis.current = window.speechSynthesis;

      // Initialize speech recognition
      if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
        const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        recognition.current = new SpeechRecognition();
        recognition.current.continuous = true;
        recognition.current.interimResults = true;
        recognition.current.lang = 'en-US';

        recognition.current.onresult = (event: any) => {
          const transcript = Array.from(event.results)
            .map((result: any) => result[0])
            .map((result: any) => result.transcript)
            .join('');

          if (event.results[event.results.length - 1].isFinal) {
            console.log('Voice input:', transcript);
            // Here you would typically send the transcript to your chat handler
          }
        };

        recognition.current.onerror = (event: any) => {
          console.error('Speech recognition error:', event.error);
          setIsListening(false);
        };

        recognition.current.onend = () => {
          setIsListening(false);
        };
      }
    }

    return () => {
      if (speechSynthesis.current) {
        speechSynthesis.current.cancel();
      }
      if (recognition.current) {
        recognition.current.stop();
      }
    };
  }, []);

  // Screen reader functionality
  const speakText = (text: string) => {
    if (!speechSynthesis.current || !screenReader) return;

    // Cancel any ongoing speech
    speechSynthesis.current.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = speechRate;
    utterance.volume = speechVolume;
    utterance.onstart = () => setIsReading(true);
    utterance.onend = () => setIsReading(false);
    utterance.onerror = () => setIsReading(false);

    currentUtterance.current = utterance;
    speechSynthesis.current.speak(utterance);
  };

  const stopSpeaking = () => {
    if (speechSynthesis.current) {
      speechSynthesis.current.cancel();
      setIsReading(false);
    }
  };

  const toggleVoiceInput = () => {
    if (!recognition.current) return;

    if (isListening) {
      recognition.current.stop();
      setIsListening(false);
    } else {
      recognition.current.start();
      setIsListening(true);
    }
  };

  // Auto-read new messages when screen reader is enabled
  useEffect(() => {
    if (screenReader && messages.length > 0) {
      const lastMessage = messages[messages.length - 1];
      if (lastMessage.role === 'assistant') {
        speakText(lastMessage.content);
      }
    }
  }, [messages, screenReader, speechRate, speechVolume]);

  return (
    <div className="absolute top-0 right-0 h-full w-80 bg-black/80 backdrop-blur-md p-6 border-l border-white/10 overflow-y-auto custom-scrollbar">
      <style jsx>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 8px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: rgba(255, 255, 255, 0.1);
          border-radius: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: linear-gradient(45deg, #8b5cf6, #ec4899);
          border-radius: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: linear-gradient(45deg, #7c3aed, #db2777);
        }
        .custom-scrollbar {
          scrollbar-width: thin;
          scrollbar-color: #8b5cf6 rgba(255, 255, 255, 0.1);
        }
      `}</style>
      <div className="flex justify-between items-center mb-6">
        <div className="flex items-center gap-2">
          <SettingsIcon className="h-5 w-5" />
          <h2 className="text-xl font-bold">Settings</h2>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Custom Toggle Component */}
      <style jsx>{`
        .custom-toggle {
          width: 44px;
          height: 24px;
          background: rgba(255, 255, 255, 0.1);
          border: 1px solid rgba(255, 255, 255, 0.2);
          border-radius: 4px;
          position: relative;
          cursor: pointer;
          transition: all 0.3s ease;
        }
        .custom-toggle.active {
          background: linear-gradient(45deg, ${themes[currentTheme].primary}, ${themes[currentTheme].secondary});
          border-color: ${themes[currentTheme].primary};
          box-shadow: 0 0 8px ${themes[currentTheme].primary}40;
        }
        .custom-toggle-slider {
          width: 18px;
          height: 18px;
          background: white;
          border-radius: 2px;
          position: absolute;
          top: 2px;
          left: 2px;
          transition: all 0.3s ease;
          box-shadow: 0 2px 4px rgba(0,0,0,0.2);
        }
        .custom-toggle.active .custom-toggle-slider {
          transform: translateX(18px);
        }
      `}</style>

      <div className="space-y-6">
        {/* Account Section */}
        <div className="bg-black/30 rounded-lg p-4 border border-white/10">
          <div className="flex items-center gap-2 mb-4">
            <User className="h-4 w-4" />
            <h3 className="font-medium">Account</h3>
          </div>

          {isLoggedIn ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 bg-gradient-to-r from-purple-500 to-pink-500 rounded-full flex items-center justify-center">
                    <User className="h-4 w-4 text-white" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">{userEmail}</p>
                    <div className="flex items-center gap-1">
                      <Crown className="h-3 w-3 text-yellow-400" />
                      <span className="text-xs text-yellow-400">Premium</span>
                    </div>
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setIsLoggedIn(false)}
                  className="text-xs"
                >
                  <LogOut className="h-3 w-3 mr-1" />
                  Sign Out
                </Button>
              </div>
              <div className="text-xs text-gray-400">
                Unlimited prompts • Custom themes • Prompt history
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="text-sm text-gray-300">
                Sign up for unlimited prompts and exclusive features
              </div>
              {promptCount >= 3 && (
                <div className="bg-orange-500/20 border border-orange-500/30 rounded p-2 text-xs text-orange-300">
                  ⚠️ You've used {promptCount} prompts. Sign up to continue without ads.
                </div>
              )}
              <div className="flex gap-2">
                <Button
                  size="sm"
                  className="flex-1 bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600"
                  onClick={() => {
                    setIsLoggedIn(true);
                    setUserEmail('user@example.com');
                  }}
                >
                  <LogIn className="h-3 w-3 mr-1" />
                  Sign Up
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1"
                  onClick={() => {
                    setIsLoggedIn(true);
                    setUserEmail('user@example.com');
                  }}
                >
                  <Mail className="h-3 w-3 mr-1" />
                  Sign In
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Themes Section */}
        <div className="bg-black/30 rounded-lg p-4 border border-white/10">
          <div className="flex items-center gap-2 mb-4">
            <Palette className="h-4 w-4" />
            <h3 className="font-medium">Themes</h3>
            {!isLoggedIn && (
              <div className="ml-auto">
                <Crown className="h-3 w-3 text-yellow-400" />
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 gap-2">
            {Object.entries(themes).map(([key, theme]) => (
              <button
                key={key}
                onClick={() => isLoggedIn && setCurrentTheme(key)}
                disabled={!isLoggedIn && key !== 'default'}
                className={`flex items-center gap-3 p-3 rounded-lg border transition-all duration-200 ${currentTheme === key
                    ? 'border-white/30 bg-white/5'
                    : 'border-white/10 hover:border-white/20 hover:bg-white/5'
                  } ${!isLoggedIn && key !== 'default' ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
              >
                <div
                  className="w-6 h-6 rounded border border-white/20"
                  style={{
                    background: `linear-gradient(45deg, ${theme.primary}, ${theme.secondary})`
                  }}
                />
                <div className="flex-1 text-left">
                  <div className="text-sm font-medium">{theme.name}</div>
                  <div className="text-xs text-gray-400">{theme.description}</div>
                </div>
                {currentTheme === key && (
                  <div className="w-2 h-2 bg-white rounded-full" />
                )}
                {!isLoggedIn && key !== 'default' && (
                  <Crown className="h-3 w-3 text-yellow-400" />
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Accessibility Section */}
        <div className="bg-black/30 rounded-lg p-4 border border-white/10">
          <div className="flex items-center gap-2 mb-4">
            <Contrast className="h-4 w-4" />
            <h3 className="font-medium">Accessibility</h3>
          </div>

          <div className="space-y-4">
            <div className="space-y-2">
              <div className="flex items-center">
                <Type className="h-4 w-4 mr-2" />
                <Label htmlFor="text-size">Text Size ({textSize}%)</Label>
              </div>
              <Slider
                id="text-size"
                value={[textSize]}
                min={75}
                max={200}
                step={5}
                onValueChange={(value) => setTextSize(value[0])}
              />
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <Contrast className="h-4 w-4 mr-2" />
                <Label htmlFor="high-contrast">High Contrast</Label>
              </div>
              <div
                className={`custom-toggle ${highContrast ? 'active' : ''}`}
                onClick={() => setHighContrast(!highContrast)}
              >
                <div className="custom-toggle-slider" />
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center">
                  <Volume2 className="h-4 w-4 mr-2" />
                  <Label htmlFor="screen-reader">Screen Reader</Label>
                </div>
                <div
                  className={`custom-toggle ${screenReader ? 'active' : ''}`}
                  onClick={() => setScreenReader(!screenReader)}
                >
                  <div className="custom-toggle-slider" />
                </div>
              </div>

              {screenReader && (
                <div className="ml-6 space-y-3 p-3 bg-black/30 rounded-lg">
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => speakText("Screen reader test. This is how text will sound.")}
                      disabled={isReading}
                      className="flex-1"
                    >
                      <Play className="w-3 h-3 mr-1" />
                      Test Voice
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={stopSpeaking}
                      disabled={!isReading}
                    >
                      <Square className="w-3 h-3" />
                    </Button>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center">
                      <Label htmlFor="speech-rate" className="text-xs">Speed ({speechRate}x)</Label>
                    </div>
                    <Slider
                      id="speech-rate"
                      value={[speechRate]}
                      min={0.5}
                      max={2}
                      step={0.1}
                      onValueChange={(value) => setSpeechRate(value[0])}
                      className="w-full"
                    />
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center">
                      <Label htmlFor="speech-volume" className="text-xs">Volume ({Math.round(speechVolume * 100)}%)</Label>
                    </div>
                    <Slider
                      id="speech-volume"
                      value={[speechVolume]}
                      min={0}
                      max={1}
                      step={0.1}
                      onValueChange={(value) => setSpeechVolume(value[0])}
                      className="w-full"
                    />
                  </div>

                  {isReading && (
                    <div className="flex items-center gap-2 text-green-400 text-xs">
                      <Volume2 className="w-3 h-3 animate-pulse" />
                      <span>Reading...</span>
                    </div>
                  )}
                </div>
              )}
            </div>

            {onVoiceToggle && (
              <div className="flex items-center justify-between">
                <div className="flex items-center">
                  {voiceEnabled ? (
                    <Volume2 className="h-4 w-4 mr-2 text-green-400" />
                  ) : (
                    <VolumeX className="h-4 w-4 mr-2" />
                  )}
                  <Label htmlFor="voice-enabled">Voice Assistant</Label>
                </div>
                <div
                  className={`custom-toggle ${voiceEnabled ? 'active' : ''}`}
                  onClick={() => onVoiceToggle && onVoiceToggle(!voiceEnabled)}
                >
                  <div className="custom-toggle-slider" />
                </div>
              </div>
            )}

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center">
                  {isListening ? (
                    <Mic className="h-4 w-4 mr-2 text-red-400 animate-pulse" />
                  ) : voiceEnabled ? (
                    <Mic className="h-4 w-4 mr-2 text-blue-400" />
                  ) : (
                    <MicOff className="h-4 w-4 mr-2" />
                  )}
                  <Label htmlFor="voice-input">Voice Input</Label>
                </div>
                <div
                  className={`custom-toggle ${voiceEnabled ? 'active' : ''}`}
                  onClick={() => onVoiceToggle && onVoiceToggle(!voiceEnabled)}
                >
                  <div className="custom-toggle-slider" />
                </div>
              </div>

              {voiceEnabled && recognition.current && (
                <div className="ml-6 space-y-2 p-3 bg-black/30 rounded-lg">
                  <Button
                    size="sm"
                    variant={isListening ? "destructive" : "outline"}
                    onClick={toggleVoiceInput}
                    className="w-full"
                  >
                    {isListening ? (
                      <>
                        <Square className="w-3 h-3 mr-2" />
                        Stop Listening
                      </>
                    ) : (
                      <>
                        <Mic className="w-3 h-3 mr-2" />
                        Start Voice Input
                      </>
                    )}
                  </Button>

                  {isListening && (
                    <div className="flex items-center gap-2 text-red-400 text-xs">
                      <div className="w-2 h-2 bg-red-400 rounded-full animate-pulse" />
                      <span>Listening...</span>
                    </div>
                  )}

                  {!recognition.current && (
                    <p className="text-xs text-yellow-400">
                      Voice recognition not supported in this browser
                    </p>
                  )}
                </div>
              )}
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <MousePointer className="h-4 w-4 mr-2" />
                <Label htmlFor="reduced-motion">Reduced Motion</Label>
              </div>
              <div
                className={`custom-toggle ${reducedMotion ? 'active' : ''}`}
                onClick={() => setReducedMotion(!reducedMotion)}
              >
                <div className="custom-toggle-slider" />
              </div>
            </div>
          </div>
        </div>

        <div className="mt-8">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-medium">Text Transcript</h3>
            {voiceEnabled && (
              <div className="flex items-center gap-2 text-sm text-green-400">
                <Volume2 className="h-4 w-4" />
                <span>Voice Active</span>
              </div>
            )}
          </div>
          <div className="bg-black/40 rounded-lg p-4 max-h-96 overflow-y-auto custom-scrollbar">
            {messages.length === 0 ? (
              <p className="text-white/50 italic">No messages yet</p>
            ) : (
              messages.map((message, index) => (
                <div key={index} className="mb-4 group">
                  <div className="flex items-center justify-between">
                    <p className="font-bold">
                      {message.role === "user" ? "You" : "AI"}
                    </p>
                    {screenReader && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => speakText(message.content)}
                        className="opacity-0 group-hover:opacity-100 transition-opacity p-1 h-6 w-6"
                        title="Read this message"
                      >
                        <Volume2 className="w-3 h-3" />
                      </Button>
                    )}
                  </div>
                  <p
                    style={{ fontSize: `${textSize}%` }}
                    className={`${highContrast ? "text-white" : "text-white/80"} ${screenReader ? "cursor-pointer hover:bg-white/5 p-1 rounded" : ""}`}
                    onClick={() => screenReader && speakText(message.content)}
                    title={screenReader ? "Click to read aloud" : undefined}
                  >
                    {message.content}
                  </p>
                </div>
              ))
            )}

            {isProcessing && (
              <div className="mb-4 p-3 bg-blue-500/10 border border-blue-500/20 rounded">
                <p className="font-bold text-blue-400">AI</p>
                <p className="text-white/70 italic">Generating response...</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
