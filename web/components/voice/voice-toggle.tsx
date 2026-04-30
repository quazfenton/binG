"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Mic, MicOff, Volume2, Settings, Sliders, Cpu, Activity, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useVoiceSettings, useVoiceCapabilities } from "@/lib/voice/use-voice";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * Reactive Voice Toggle Button
 * Circular button that expands on hold and toggles on click
 */
export function VoiceToggleButton({ className }: { className?: string }) {
  const { settings, updateSettings, isListening, startListening, stopListening, isSpeaking } = useVoiceSettings();
  const { voiceSupported } = useVoiceCapabilities();
  const [showMenu, setShowMenu] = useState(false);
  const [isPressing, setIsPressing] = useState(false);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleToggle = useCallback(() => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        navigator.vibrate(50);
      }
    }
  }, [isListening, startListening, stopListening]);

  const startPress = useCallback(() => {
    setIsPressing(true);
    holdTimerRef.current = setTimeout(() => {
      setShowMenu(true);
      setIsPressing(false);
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        navigator.vibrate([30, 50]);
      }
    }, 600);
  }, []);

  const endPress = useCallback(() => {
    setIsPressing(false);
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  }, []);

  if (!settings || !voiceSupported) return null;

  return (
    <TooltipProvider>
      <div className={cn("relative flex items-center gap-2", className)}>
        <DropdownMenu open={showMenu} onOpenChange={setShowMenu}>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <motion.div
                  onMouseDown={startPress}
                  onMouseUp={endPress}
                  onMouseLeave={endPress}
                  onTouchStart={startPress}
                  onTouchEnd={isPressing ? () => { endPress(); handleToggle(); } : endPress}
                  whileTap={{ scale: 0.9 }}
                  className="relative"
                >
                  <Button
                    size="icon"
                    variant={isListening ? "default" : "outline"}
                    onClick={(e) => {
                      if (!showMenu) handleToggle();
                      e.preventDefault();
                    }}
                    className={cn(
                      "rounded-full w-9 h-9 transition-all duration-300 border-white/10 shadow-lg",
                      isListening ? "bg-red-500 hover:bg-red-600 border-red-400" : "bg-white/5 hover:bg-white/15",
                      isSpeaking && "ring-2 ring-purple-500 ring-offset-1 ring-offset-black"
                    )}
                  >
                    <AnimatePresence mode="wait">
                      {isSpeaking ? (
                        <motion.div
                          key="speaking"
                          initial={{ scale: 0.5, opacity: 0 }}
                          animate={{ scale: 1, opacity: 1 }}
                          exit={{ scale: 0.5, opacity: 0 }}
                        >
                          <Activity className="h-4 w-4 text-purple-400" />
                        </motion.div>
                      ) : isListening ? (
                        <motion.div
                          key="listening"
                          initial={{ scale: 0.5, opacity: 0 }}
                          animate={{ scale: 1, opacity: 1 }}
                          exit={{ scale: 0.5, opacity: 0 }}
                        >
                          <MicOff className="h-4 w-4 text-white" />
                        </motion.div>
                      ) : (
                        <motion.div
                          key="idle"
                          initial={{ scale: 0.5, opacity: 0 }}
                          animate={{ scale: 1, opacity: 1 }}
                          exit={{ scale: 0.5, opacity: 0 }}
                        >
                          <Mic className="h-4 w-4 text-white/70" />
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </Button>
                  
                  {isPressing && (
                    <svg className="absolute inset-0 w-full h-full -rotate-90 pointer-events-none">
                      <motion.circle
                        cx="18"
                        cy="18"
                        r="16"
                        stroke="white"
                        strokeWidth="2"
                        fill="transparent"
                        strokeDasharray="100"
                        initial={{ strokeDashoffset: 100 }}
                        animate={{ strokeDashoffset: 0 }}
                        transition={{ duration: 0.6 }}
                      />
                    </svg>
                  )}
                  
                  <AnimatePresence>
                    {isListening && (
                      <motion.div
                        initial={{ scale: 0.8, opacity: 0 }}
                        animate={{ scale: 1.4, opacity: 0 }}
                        exit={{ opacity: 0 }}
                        transition={{ repeat: Infinity, duration: 1.5 }}
                        className="absolute inset-0 bg-red-500 rounded-full z-[-1]"
                      />
                    )}
                  </AnimatePresence>
                </motion.div>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent side="top" className="bg-black border-white/20 text-[10px]">
              {isListening ? "Stop listening" : "Start voice input (Hold for settings)"}
            </TooltipContent>
          </Tooltip>

          <DropdownMenuContent align="end" className="w-72 bg-gray-950/95 backdrop-blur-xl border-white/10 text-white shadow-2xl z-[1000]">
            <DropdownMenuLabel className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sliders className="h-4 w-4 text-cyan-400" />
                <span>Voice Intelligence</span>
              </div>
              <Badge variant="outline" className="text-[8px] uppercase tracking-widest border-white/20 text-white/40">v3.2</Badge>
            </DropdownMenuLabel>
            <DropdownMenuSeparator className="bg-white/10" />
            
            <div className="px-2 py-1.5">
              <DropdownMenuLabel className="text-[10px] uppercase text-white/40 px-0 pb-2">TTS Engine</DropdownMenuLabel>
              <DropdownMenuRadioGroup 
                value={settings.ttsProvider} 
                onValueChange={(val) => updateSettings({ ttsProvider: val as any })}
                className="grid grid-cols-1 gap-0.5"
              >
                {[
                  { id: 'gemini', name: 'Gemini Flash 3.1', sub: 'Fast neural synthesis', badge: 'Free' },
                  { id: 'kittentts', name: 'KittenTTS', sub: 'Local privacy, zero latency', badge: 'Local' },
                  { id: 'web', name: 'Web Speech API', sub: 'Standard browser voice' }
                ].map(p => (
                  <DropdownMenuRadioItem key={p.id} value={p.id} className="text-xs focus:bg-white/10 focus:text-white rounded-md cursor-pointer transition-colors py-2">
                    <div className="flex flex-col">
                      <span className="flex items-center gap-2 font-medium">
                        {p.name}
                        {p.badge && <Badge className={cn("h-4 px-1 text-[8px]", p.badge === 'Free' ? "bg-cyan-500/20 text-cyan-400 border-cyan-500/30" : "bg-green-500/20 text-green-400 border-green-500/30")}>{p.badge}</Badge>}
                      </span>
                      <span className="text-[9px] text-white/40 font-normal">{p.sub}</span>
                    </div>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </div>

            <DropdownMenuSeparator className="bg-white/10" />
            
            <div className="px-2 py-1.5">
              <DropdownMenuLabel className="text-[10px] uppercase text-white/40 px-0 pb-2">Transcription (STT)</DropdownMenuLabel>
              <DropdownMenuRadioGroup 
                value={settings.sttProvider} 
                onValueChange={(val) => updateSettings({ sttProvider: val as any })}
                className="grid grid-cols-1 gap-0.5"
              >
                {[
                  { id: 'deepgram', name: 'Deepgram Nova-2', sub: 'Lowest latency STT', badge: 'Fast' },
                  { id: 'mistral', name: 'Mistral Voxtral', sub: 'Accurate multi-lang', badge: 'Pro' },
                  { id: 'browser', name: 'Standard Browser', sub: 'Local recognition' }
                ].map(p => (
                  <DropdownMenuRadioItem key={p.id} value={p.id} className="text-xs focus:bg-white/10 focus:text-white rounded-md cursor-pointer transition-colors py-2">
                    <div className="flex flex-col">
                      <span className="flex items-center gap-2 font-medium">
                        {p.name}
                        {p.badge && <Badge className={cn("h-4 px-1 text-[8px]", p.badge === 'Fast' ? "bg-green-500/20 text-green-400 border-green-500/30" : "bg-purple-500/20 text-purple-400 border-purple-500/30")}>{p.badge}</Badge>}
                      </span>
                      <span className="text-[9px] text-white/40 font-normal">{p.sub}</span>
                    </div>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </div>

            <DropdownMenuSeparator className="bg-white/10" />
            
            <div className="px-1 space-y-0.5">
              <DropdownMenuItem 
                className="text-xs focus:bg-white/10 focus:text-white flex items-center gap-2 rounded-md transition-colors py-2"
                onClick={() => updateSettings({ autoSpeak: !settings.autoSpeak })}
              >
                <Volume2 className={cn("h-4 w-4 transition-colors", settings.autoSpeak ? "text-cyan-400" : "text-white/40")} />
                <div className="flex flex-col">
                  <span className="font-medium">Auto-Speak (Full)</span>
                  <span className="text-[9px] text-white/40 font-normal">{settings.autoSpeak ? "Read complete reply" : "Disabled"}</span>
                </div>
              </DropdownMenuItem>

              <DropdownMenuItem 
                className="text-xs focus:bg-white/10 focus:text-white flex items-center gap-2 rounded-md transition-colors py-2"
                onClick={() => updateSettings({ autoSpeakStream: !settings.autoSpeakStream })}
              >
                <Zap className={cn("h-4 w-4 transition-colors", settings.autoSpeakStream ? "text-yellow-400" : "text-white/40")} />
                <div className="flex flex-col">
                  <span className="font-medium">Live Narrator</span>
                  <span className="text-[9px] text-white/40 font-normal">{settings.autoSpeakStream ? "Incremental speech" : "Disabled"}</span>
                </div>
              </DropdownMenuItem>
            </div>
            
            <DropdownMenuSeparator className="bg-white/10" />
            
            <DropdownMenuItem className="text-xs focus:bg-white/10 focus:text-white text-cyan-400 font-medium rounded-md mx-1 mb-1">
              <Settings className="h-3 w-3 mr-2" />
              Voice Control Panel
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        
        <AnimatePresence>
          {isListening && (
            <motion.div
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 40, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              className="flex items-center gap-0.5 h-3 overflow-hidden"
            >
              {[...Array(4)].map((_, i) => (
                <motion.div
                  key={i}
                  animate={{ 
                    height: [3, 10, 5, 12, 3],
                    transition: { repeat: Infinity, duration: 0.8, delay: i * 0.1 }
                  }}
                  className="w-1 bg-red-500 rounded-full"
                />
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </TooltipProvider>
  );
}
