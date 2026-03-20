"use client";

import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  Mail,
  Trophy,
  Check,
  Server,
} from "lucide-react";
import ModalLoginForm from "@/components/auth/modal-login-form";
import ModalSignupForm from "@/components/auth/modal-signup-form";
import { useAuth } from "@/contexts/auth-context";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import Image from "next/image";

interface SettingsProps {
  onClose: () => void;
  messages: Message[];
  isProcessing?: boolean;
  voiceEnabled?: boolean;
  onVoiceToggle?: (enabled: boolean) => void;
  livekitEnabled?: boolean;
  onLivekitToggle?: (enabled: boolean) => void;
}

const CUSTOM_BG_MEDIA_KEY = "custom_bg_media_url";
const USER_BUBBLE_BG_KEY = "user_bubble_bg";
const USER_BUBBLE_TEXT_KEY = "user_bubble_text";
const ASSISTANT_BUBBLE_BG_KEY = "assistant_bubble_bg";
const ASSISTANT_BUBBLE_TEXT_KEY = "assistant_bubble_text";
const ASSISTANT_BUBBLE_BORDER_KEY = "assistant_bubble_border";

const applyCustomBackgroundMedia = async (value: string) => {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (!value) {
    root.style.setProperty("--app-bg-media", "none");
    root.style.setProperty("--app-bg-media-opacity", "0");
    return;
  }

  // SECURITY: Validate URL before applying (client-side check)
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') {
      console.warn('[Settings] Blocked non-HTTPS background URL:', value);
      return;
    }
    
    // Block obvious SSRF attempts
    const hostname = url.hostname.toLowerCase();
    const blockedPatterns = [
      'localhost', '127.', '10.', '192.168.', '172.16.', '172.17.', '172.18.',
      '172.19.', '172.20.', '172.21.', '172.22.', '172.23.', '172.24.', '172.25.',
      '172.26.', '172.27.', '172.28.', '172.29.', '172.30.', '172.31.',
      '169.254.', '0.0.0.0', '.local', '.internal', 'metadata'
    ];
    
    if (blockedPatterns.some(pattern => hostname.includes(pattern))) {
      console.warn('[Settings] Blocked unsafe background URL:', value);
      return;
    }
  } catch (e) {
    console.warn('[Settings] Invalid background URL:', value);
    return;
  }

  // Use image proxy for external URLs to bypass CORS/hotlinking restrictions
  // The proxy will perform additional server-side SSRF validation
  const proxiedUrl = `/api/image-proxy?url=${encodeURIComponent(value)}`;
  root.style.setProperty("--app-bg-media", `url("${proxiedUrl}")`);
  root.style.setProperty("--app-bg-media-opacity", "0.12");
};

const applyBubbleColors = (colors: {
  userBg?: string;
  userText?: string;
  assistantBg?: string;
  assistantText?: string;
  assistantBorder?: string;
}) => {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (colors.userBg) root.style.setProperty("--user-bubble-bg", colors.userBg);
  if (colors.userText) root.style.setProperty("--user-bubble-text", colors.userText);
  if (colors.assistantBg) root.style.setProperty("--assistant-bubble-bg", colors.assistantBg);
  if (colors.assistantText) root.style.setProperty("--assistant-bubble-text", colors.assistantText);
  if (colors.assistantBorder) root.style.setProperty("--assistant-bubble-border", colors.assistantBorder);
};

const THEME_OPTIONS = [
  { id: "dark", label: "Dark", swatch: "bg-neutral-900" },
  { id: "light", label: "Light", swatch: "bg-white border border-black/10" },
  { id: "ocean", label: "Ocean", swatch: "bg-sky-500" },
  { id: "forest", label: "Forest", swatch: "bg-emerald-600" },
  { id: "sepia", label: "Sepia", swatch: "bg-amber-700" },
  { id: "midnight", label: "Midnight", swatch: "bg-indigo-800" },
  { id: "rose", label: "Rose", swatch: "bg-rose-500" },
  { id: "desert", label: "Desert", swatch: "bg-orange-600" },
  { id: "lavender", label: "Lavender", swatch: "bg-violet-500" },
  { id: "slate", label: "Slate", swatch: "bg-slate-600" },
] as const;

export default function Settings({
  onClose,
  messages,
  isProcessing = false,
  voiceEnabled = false,
  onVoiceToggle,
  livekitEnabled = false,
  onLivekitToggle,
}: SettingsProps) {
  const { isAuthenticated, user, login, logout, register, getApiKeys, setApiKeys, isLoading } = useAuth();
  const [textSize, setTextSize] = useState(100);
  const [highContrast, setHighContrast] = useState(false);
  const [screenReader, setScreenReader] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [isReading, setIsReading] = useState(false);
  const [speechRate, setSpeechRate] = useState(1);
  const [speechVolume, setSpeechVolume] = useState(0.8);
  const [isListening, setIsListening] = useState(false);
  const [customBgUrl, setCustomBgUrl] = useState("");
  const [userBubbleBg, setUserBubbleBg] = useState("rgba(0, 0, 0, 0.85)");
  const [userBubbleText, setUserBubbleText] = useState("#ffffff");
  const [assistantBubbleBg, setAssistantBubbleBg] = useState("#000000");
  const [assistantBubbleText, setAssistantBubbleText] = useState("#ffffff");
  const [assistantBubbleBorder, setAssistantBubbleBorder] = useState("#ffffff");

  // Environment variable toggles state (user-specific overrides)
  const [envVars, setEnvVars] = useState<Record<string, boolean>>({
    OPENCODE_ENABLED: false,
    NULLCLAW_ENABLED: false,
  });

  // Oracle VM configuration state
  const [oracleVmConfig, setOracleVmConfig] = useState({
    host: '',
    port: 22,
    username: 'opc',
    privateKeyPath: '~/.ssh/id_rsa',
    workspace: '/home/opc/workspace',
  });

  // Load Oracle VM config from localStorage
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const saved = localStorage.getItem('oracle_vm_config');
    if (saved) {
      try {
        setOracleVmConfig(JSON.parse(saved));
      } catch (e) {
        console.error('Failed to load Oracle VM config:', e);
      }
    }
  }, []);

  // Save Oracle VM config to localStorage
  const handleSaveOracleVmConfig = () => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('oracle_vm_config', JSON.stringify(oracleVmConfig));
      toast.success('Oracle VM configuration saved');
    }
  };

  // Load env var toggles from localStorage and server on mount
  useEffect(() => {
    if (typeof window === 'undefined') return;
    
    const loadPreferences = async () => {
      // Start with localStorage (for offline/immediate feedback)
      const saved = localStorage.getItem('user_env_overrides');
      let localPrefs: Record<string, boolean> = {};
      if (saved) {
        try {
          localPrefs = JSON.parse(saved);
        } catch (e) {
          console.error('Failed to parse localStorage prefs:', e);
        }
      }
      
      // If authenticated, fetch from server (overrides localStorage)
      if (isAuthenticated) {
        try {
          const response = await fetch('/api/user/preferences');
          if (response.ok) {
            const data = await response.json();
            if (data.success && data.preferences) {
              // Merge server prefs with local
              const merged = { ...localPrefs, ...data.preferences };
              setEnvVars(merged);
              
              // Update localStorage with server data
              localStorage.setItem('user_env_overrides', JSON.stringify(merged));
              
              // Apply to document for CSS-based feature flags
              Object.entries(merged).forEach(([key, value]) => {
                if (value === true) {
                  document.documentElement.setAttribute(`data-${key.toLowerCase()}`, 'true');
                } else {
                  document.documentElement.removeAttribute(`data-${key.toLowerCase()}`);
                }
              });
              
              return; // Done
            }
          }
        } catch (e) {
          console.error('Failed to load server preferences:', e);
          // Fall back to localStorage
        }
      }
      
      // Use localStorage if not authenticated or server fetch failed
      if (Object.keys(localPrefs).length > 0) {
        setEnvVars(localPrefs);
        Object.entries(localPrefs).forEach(([key, value]) => {
          if (value === true) {
            document.documentElement.setAttribute(`data-${key.toLowerCase()}`, 'true');
          } else {
            document.documentElement.removeAttribute(`data-${key.toLowerCase()}`);
          }
        });
      }
    };
    
    loadPreferences();
  }, [isAuthenticated]);

  // Save env var toggles to localStorage and sync to server
  const toggleEnvVar = async (key: string) => {
    setEnvVars((prev) => {
      const updated = { ...prev, [key]: !prev[key] };
      if (typeof window !== 'undefined') {
        // Save to localStorage
        localStorage.setItem('user_env_overrides', JSON.stringify(updated));
        
        // Apply to document for CSS-based feature flags
        if (updated[key]) {
          document.documentElement.setAttribute(`data-${key.toLowerCase()}`, 'true');
        } else {
          document.documentElement.removeAttribute(`data-${key.toLowerCase()}`);
        }
        
        // Sync to server (if authenticated)
        fetch('/api/user/preferences', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ [key]: updated[key] }),
        }).catch(err => console.warn('Failed to sync preference to server:', err));
        
        toast.success(`${key} ${updated[key] ? 'enabled' : 'disabled'}`);
      }
      return updated;
    });
  };
  
  // Color picker state
  const [openColorPicker, setOpenColorPicker] = useState<string | null>(null);
  const [selectedColorType, setSelectedColorType] = useState<'bg' | 'text' | 'border'>('bg');
  
  // Background URL selector state
  const [showBgSelector, setShowBgSelector] = useState(true);
  const [bgUrlName, setBgUrlName] = useState("");
  
  // Preset background URLs
  const PRESET_BACKGROUNDS = [
    { id: 'default', name: 'Default', url: process.env.NEXT_PUBLIC_BG_MEDIA_URL || '' },
    { id: 'sky', name: 'Sky', url: 'https://media.tenor.com/CWaT-F5vNb8AAAAM/sky-gif.gif' },
    { id: 'aurora', name: 'Aurora', url: 'https://i.pinimg.com/originals/64/ce/9f/64ce9f3c2463b528dfba90720fed9ea5.gif' },
    { id: 'stars', name: 'Stars', url: 'https://i.imgur.com/DtHvUjb.gif' },
    { id: 'neon', name: 'Neon', url: 'https://64.media.tumblr.com/5d0e893e84a5116a7f9e424fc2f378ef/tumblr_n4suq4tHbE1tq9q5vo1_r1_500.gif' },
    { id: 'fire', name: 'Fire', url: 'https://i.imgur.com/9uxEl57.gif' },
    { id: 'energy', name: 'Energy', url: 'https://media0.giphy.com/media/v1.Y2lkPTZjMDliOTUyenh5Nmx4NzV4djJuYWF0am93MGRycGE2cDJiOW5wZmpibzV0c2M0NiZlcD12MV9naWZzX3NlYXJjaCZjdD1n/nk0a5GWGrnAx55339K/200w.gif' },
    { id: 'cosmic', name: 'Cosmic', url: 'https://64.media.tumblr.com/0411acaf933ca0d247a7e115cd761608/e85d08b8418d3bbd-0f/s500x750/cebc4e249625c0222eeb5d9e2cc703fcb9283ef5.gif' },
    { id: 'natura', name: 'Natura', url: 'https://64.media.tumblr.com/54f8f2ac56a71691c4d6e5c7fe290e68/tumblr_pgrkl8nswk1r7rste_500.gif' },
    { id: 'none', name: 'None', url: '' },
  ];

  // Warm cache for preset backgrounds on mount (preload images)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    
    // Preload preset backgrounds with valid URLs
    const validPresets = PRESET_BACKGROUNDS.filter(p => p.url && p.url.trim());
    
    validPresets.forEach((preset) => {
      // Create image proxy URL for caching
      const proxiedUrl = `/api/image-proxy?url=${encodeURIComponent(preset.url)}`;
      
      // Preload image to warm the server-side cache
      const img = new Image();
      img.src = proxiedUrl;
      img.loading = 'lazy'; // Don't block page load
      console.log(`[Settings] Preloading background: ${preset.name}`);
    });
  }, []);
  
  // Get saved backgrounds from localStorage
  const getSavedBackgrounds = (): Array<{ name: string; url: string }> => {
    if (typeof window === 'undefined') return [];
    try {
      const saved = localStorage.getItem('custom_bg_history');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  };
  
  const [savedBackgrounds, setSavedBackgrounds] = useState<Array<{ name: string; url: string }>>([]);

  useEffect(() => {
    const backgrounds = getSavedBackgrounds();
    setSavedBackgrounds(backgrounds);
    
    // Warm cache for saved backgrounds
    if (typeof window !== 'undefined' && backgrounds.length > 0) {
      backgrounds.forEach((bg) => {
        if (bg.url && bg.url.trim()) {
          const proxiedUrl = `/api/image-proxy?url=${encodeURIComponent(bg.url)}`;
          const img = new Image();
          img.src = proxiedUrl;
          img.loading = 'lazy';
          console.log(`[Settings] Preloading saved background: ${bg.name}`);
        }
      });
    }
  }, []);
  
  const saveToBackgroundHistory = (url: string, name?: string) => {
    if (!url) return;
    const extractedName = name || extractUrlTitle(url);
    const newEntry = { name: extractedName, url };
    
    const existing = getSavedBackgrounds();
    const filtered = existing.filter(bg => bg.url !== url);
    const updated = [newEntry, ...filtered].slice(0, 10); // Keep last 10
    
    localStorage.setItem('custom_bg_history', JSON.stringify(updated));
    setSavedBackgrounds(updated);
  };
  
  const extractUrlTitle = (url: string): string => {
    try {
      const urlObj = new URL(url);
      const pathname = urlObj.pathname;
      const lastSegment = pathname.split('/').pop() || '';
      const name = lastSegment
        .replace(/\.[^/.]+$/, '') // Remove extension
        .replace(/[-_]/g, ' ') // Replace dashes/underscores with spaces
        .replace(/\b\w/g, l => l.toUpperCase()); // Title case
      return name || urlObj.hostname;
    } catch {
      return 'Custom Background';
    }
  };

  // Preset color swatches
  const COLOR_SWATCHES = [
    '#ea580c', '#c2410c', '#9a3412', '#7c2d12', '#431407', '#2c0d00',
    '#16a34a', '#15803d', '#166534', '#14532d', '#052e16', '#022c22',
    '#2563eb', '#1d4ed8', '#1e40af', '#1e3a8a', '#172554', '#0c0a09',
    '#9333ea', '#7e22ce', '#6b21a8', '#581c87', '#3b0764', '#271038',
  ];

  // State for managing auth modal visibility and mode
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login');
  const [authError, setAuthError] = useState<string>('');

  // Use next-themes for theme management
  const { theme, setTheme, themes, resolvedTheme } = useTheme();

  const speechSynthesis = useRef<SpeechSynthesis | null>(null);
  const recognition = useRef<any | null>(null);
  const currentUtterance = useRef<SpeechSynthesisUtterance | null>(null);

  // Initialize speech synthesis and recognition
  useEffect(() => {
    if (typeof window !== 'undefined') {
      speechSynthesis.current = window.speechSynthesis;

      // Initialize speech recognition
      if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
        const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        recognition.current = new SpeechRecognition();
        if (recognition.current) {
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

  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = localStorage.getItem(CUSTOM_BG_MEDIA_KEY) || "";
    setCustomBgUrl(saved);
    // Preserve env-provided/default media when no custom URL is saved.
    if (saved.trim()) {
      applyCustomBackgroundMedia(saved);
    }

    const savedUserBg = localStorage.getItem(USER_BUBBLE_BG_KEY) || "";
    const savedUserText = localStorage.getItem(USER_BUBBLE_TEXT_KEY) || "";
    const savedAssistantBg = localStorage.getItem(ASSISTANT_BUBBLE_BG_KEY) || "";
    const savedAssistantText = localStorage.getItem(ASSISTANT_BUBBLE_TEXT_KEY) || "";
    const savedAssistantBorder = localStorage.getItem(ASSISTANT_BUBBLE_BORDER_KEY) || "";

    if (savedUserBg) setUserBubbleBg(savedUserBg);
    if (savedUserText) setUserBubbleText(savedUserText);
    if (savedAssistantBg) setAssistantBubbleBg(savedAssistantBg);
    if (savedAssistantText) setAssistantBubbleText(savedAssistantText);
    if (savedAssistantBorder) setAssistantBubbleBorder(savedAssistantBorder);

    applyBubbleColors({
      userBg: savedUserBg || undefined,
      userText: savedUserText || undefined,
      assistantBg: savedAssistantBg || undefined,
      assistantText: savedAssistantText || undefined,
      assistantBorder: savedAssistantBorder || undefined,
    });
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
    if (screenReader && (messages?.length ?? 0) > 0) {
      const lastMessage = messages?.[messages.length - 1];
      if (lastMessage?.role === 'assistant') {
        speakText(lastMessage.content);
      }
    }
  }, [messages, screenReader, speechRate, speechVolume]);

  // Function to handle switching between login and signup forms
  const handleAuthSwitch = (mode: 'login' | 'signup') => {
    setAuthMode(mode);
    setAuthError('');
    setShowAuthModal(true);
  };

  // Function to close the auth modal
  const handleCloseAuthModal = () => {
    setShowAuthModal(false);
    setAuthError('');
    // Optionally reset authMode to 'login' when closing
    setAuthMode('login');
  };

  // Enhanced logout with confirmation
  const handleLogout = async () => {
    try {
      logout();
      setShowAuthModal(false);
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  // Handle successful authentication
  const handleAuthSuccess = () => {
    setShowAuthModal(false);
    setAuthError('');
    setAuthMode('login');
  };

  const handleApplyCustomBg = () => {
    const trimmed = customBgUrl.trim();
    if (!trimmed) {
      applyCustomBackgroundMedia("");
      if (typeof window !== "undefined") localStorage.removeItem(CUSTOM_BG_MEDIA_KEY);
      toast.success("Custom background cleared");
      return;
    }
    try {
      new URL(trimmed);
      if (typeof window !== "undefined") {
        localStorage.setItem(CUSTOM_BG_MEDIA_KEY, trimmed);
        saveToBackgroundHistory(trimmed, bgUrlName || undefined);
        
        // Warm cache for the new custom background
        const proxiedUrl = `/api/image-proxy?url=${encodeURIComponent(trimmed)}`;
        const img = new Image();
        img.src = proxiedUrl;
        console.log('[Settings] Preloading custom background:', trimmed);
      }
      applyCustomBackgroundMedia(trimmed);
      toast.success("Custom ambient background applied");
      setBgUrlName("");
    } catch {
      toast.error("Invalid background media URL");
    }
  };

  const handleClearCustomBg = () => {
    setCustomBgUrl("");
    setBgUrlName("");
    if (typeof window !== "undefined") localStorage.removeItem(CUSTOM_BG_MEDIA_KEY);
    applyCustomBackgroundMedia("");
  };
  
  const handleSelectBackground = (url: string, name?: string) => {
    setCustomBgUrl(url);
    if (url) {
      if (typeof window !== "undefined") {
        localStorage.setItem(CUSTOM_BG_MEDIA_KEY, url);
        if (name) saveToBackgroundHistory(url, name);
      }
      applyCustomBackgroundMedia(url);
      toast.success(`${name || 'Background'} applied`);
    } else {
      handleClearCustomBg();
      toast.success("Background cleared");
    }
    // Keep selector open for easy switching
    // setShowBgSelector(false);
  };

  const handleApplyBubbleColors = () => {
    applyBubbleColors({
      userBg: userBubbleBg,
      userText: userBubbleText,
      assistantBg: assistantBubbleBg,
      assistantText: assistantBubbleText,
      assistantBorder: assistantBubbleBorder,
    });
    if (typeof window !== "undefined") {
      localStorage.setItem(USER_BUBBLE_BG_KEY, userBubbleBg);
      localStorage.setItem(USER_BUBBLE_TEXT_KEY, userBubbleText);
      localStorage.setItem(ASSISTANT_BUBBLE_BG_KEY, assistantBubbleBg);
      localStorage.setItem(ASSISTANT_BUBBLE_TEXT_KEY, assistantBubbleText);
      localStorage.setItem(ASSISTANT_BUBBLE_BORDER_KEY, assistantBubbleBorder);
    }
    toast.success("Message bubble colors updated");
  };

  return (
    <div className="fixed top-0 right-0 h-full w-80 bg-black/80 backdrop-blur-md p-6 border-l border-white/10 overflow-y-auto custom-scrollbar z-50">
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
          background: linear-gradient(45deg, #8b5cf6, #ec4899);
          border-color: #8b5cf6;
          box-shadow: 0 0 8px #8b5cf640;
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

          {isAuthenticated ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate" title={user?.email}>
                    {user?.email || 'N/A'}
                  </p>
                  {user?.username && (
                    <p className="text-xs text-gray-400 truncate" title={user.username}>
                      @{user.username}
                    </p>
                  )}
                  <div className="flex items-center gap-1">
                    <div className="w-2 h-2 bg-green-400 rounded-full"></div>
                    <span className="text-xs text-green-400">Online</span>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    size="sm"
                    variant="outline"
                    asChild
                    className="text-xs px-2"
                    title="User Settings"
                  >
                    <a href="/settings">
                      <SettingsIcon className="h-3 w-3" />
                    </a>
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleLogout}
                    className="text-xs px-2"
                    disabled={isLoading}
                    title="Sign Out"
                  >
                    <LogOut className="h-3 w-3" />
                  </Button>
                </div>
              </div>
              <div className="text-xs text-gray-400 flex items-center justify-between">
                <span>{user?.subscriptionTier === 'premium' ? 'Premium Account' : 'Free Account'}</span>
                <div className="flex items-center gap-1">
                  {user?.subscriptionTier === 'premium' ? (
                    <>
                      <Trophy className="h-3 w-3 text-yellow-400" />
                      <span className="text-yellow-400">Active</span>
                    </>
                  ) : (
                    <span className="text-gray-400">Free</span>
                  )}
                </div>
              </div>
              <div className="text-xs text-gray-500">
                {user?.subscriptionTier === 'premium' 
                  ? 'Premium • Priority support'
                  : 'Unimited prompts • Basic features'
                }
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="text-sm text-gray-300">
                {isLoading ? 'Checking authentication...' : 'Sign up for unlimited prompts and exclusive features'}
              </div>
              {authError && (
                <div className="text-xs text-red-400 p-2 bg-red-500/10 rounded border border-red-500/20">
                  {authError}
                </div>
              )}
              <div className="flex gap-2">
                <Button
                  size="sm"
                  className="flex-1 bg-gradient-to-r from-gray-900 to-gray-700 hover:from-black hover:to-gray-800"
                  onClick={() => handleAuthSwitch('signup')}
                  disabled={isLoading}
                >
                  <LogIn className="h-3 w-3 mr-1" />
                  {isLoading ? 'Loading...' : 'Sign Up'}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1"
                  onClick={() => handleAuthSwitch('login')}
                  disabled={isLoading}
                >
                  <Mail className="h-3 w-3 mr-1" />
                  {isLoading ? 'Loading...' : 'Sign In'}
                </Button>
              </div>
              <div className="text-xs text-center text-gray-500">
                Free: 10 prompts/day • Premium: Unlimited
              </div>
            </div>
          )}
        </div>

        {/* Custom Background URL Section */}
        <div className="bg-black/30 rounded-lg p-4 border border-white/10">
          <div className="flex items-center gap-2 mb-4">
            <Palette className="h-4 w-4" />
            <h3 className="font-medium">Background</h3>
          </div>

          <div className="space-y-2">
            <Label htmlFor="custom-bg-url" className="text-xs text-white/70">
              Custom: Background URL
            </Label>
            <Input
              id="custom-bg-url"
              value={customBgUrl}
              onChange={(e) => setCustomBgUrl(e.target.value)}
              placeholder="https://.../background.gif"
              className="bg-black/30 border-white/20 text-xs"
            />
            <Input
              value={bgUrlName}
              onChange={(e) => setBgUrlName(e.target.value)}
              placeholder="Save as (optional, e.g. 'Sunset Sky')"
              className="bg-black/30 border-white/20 text-xs"
            />
            <div className="flex gap-2">
              <Button size="sm" className="flex-1" onClick={handleApplyCustomBg}>
                Apply
              </Button>
              <Button size="sm" variant="outline" onClick={() => setShowBgSelector(!showBgSelector)}>
                {showBgSelector ? 'Close' : 'Select'}
              </Button>
            </div>

            {/* Background URL Selector */}
            {showBgSelector && (
              <div className="space-y-3 mt-2 p-3 bg-black/30 rounded-lg border border-white/10">
                <div className="text-xs text-gray-400 font-medium">Preset Backgrounds</div>
                <div className="grid grid-cols-2 gap-2">
                  {PRESET_BACKGROUNDS.map((preset) => {
                    // Use image proxy for external URLs to bypass CORS and enable SSRF validation
                    const proxiedUrl = preset.url ? `/api/image-proxy?url=${encodeURIComponent(preset.url)}` : null;
                    return (
                      <button
                        key={preset.id}
                        onClick={() => handleSelectBackground(preset.url, preset.name)}
                        className="relative overflow-hidden h-16 rounded-lg border border-white/10 hover:border-white/30 transition-all group"
                      >
                        {preset.url ? (
                          <Image
                            src={proxiedUrl || preset.url}
                            alt={preset.name}
                            fill
                            className="object-cover"
                            sizes="64px"
                            unoptimized={!proxiedUrl}
                            onError={(e) => {
                              // Fallback to direct URL if proxy fails
                              const target = e.target as HTMLImageElement;
                              if (target.src.includes('/api/image-proxy')) {
                                target.src = preset.url;
                              }
                            }}
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center bg-gray-800">
                            <X className="w-6 h-6 text-gray-500" />
                          </div>
                        )}
                        <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                          <span className="text-xs text-white font-medium">{preset.name}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>

                {savedBackgrounds.length > 0 && (
                  <>
                    <div className="text-xs text-gray-400 font-medium mt-3">Saved Backgrounds</div>
                    <div className="space-y-1 max-h-32 overflow-auto">
                      {savedBackgrounds.map((bg, idx) => {
                        // Use image proxy for external URLs to bypass CORS and enable SSRF validation
                        const proxiedUrl = bg.url ? `/api/image-proxy?url=${encodeURIComponent(bg.url)}` : null;
                        return (
                          <button
                            key={idx}
                            onClick={() => handleSelectBackground(bg.url, bg.name)}
                            className="w-full flex items-center gap-2 p-2 rounded bg-black/20 hover:bg-white/10 transition-all text-left"
                          >
                            <div className="w-8 h-6 rounded overflow-hidden flex-shrink-0 bg-gray-800 relative">
                              <Image
                                src={proxiedUrl || bg.url}
                                alt={bg.name}
                                fill
                                className="object-cover"
                                sizes="32px"
                                unoptimized={!proxiedUrl}
                                onError={(e) => {
                                  // Fallback to direct URL if proxy fails
                                  const target = e.target as HTMLImageElement;
                                  if (target.src.includes('/api/image-proxy')) {
                                    target.src = bg.url;
                                  }
                                }}
                              />
                            </div>
                            <span className="text-xs text-white/80 truncate flex-1">{bg.name}</span>
                            <span className="text-[10px] text-gray-500 truncate max-w-[100px]">{bg.url}</span>
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Themes Section */}
        <div className="bg-black/30 rounded-lg p-4 border border-white/10">
          <div className="flex items-center gap-2 mb-4">
            <Palette className="h-4 w-4" />
            <h3 className="font-medium">Theme</h3>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {THEME_OPTIONS.map((option) => {
              const isActive = theme === option.id;
              return (
                <button
                  key={option.id}
                  onClick={() => setTheme(option.id)}
                  className={`relative overflow-hidden flex flex-col items-center gap-2 p-3 rounded-xl border transition-all duration-200 ${
                    isActive
                      ? 'border-white/40 bg-white/15 shadow-lg shadow-white/5'
                      : 'border-white/10 hover:border-white/25 hover:bg-white/8'
                  }`}
                >
                  {/* Theme preview gradient */}
                  <div className={`w-full h-10 rounded-lg ${option.swatch} shadow-inner`} />

                  {/* Theme name */}
                  <span className="text-xs font-medium text-white/90">{option.label}</span>

                  {/* Active indicator */}
                  {isActive && (
                    <div className="absolute top-2 right-2 w-5 h-5 bg-white/20 backdrop-blur-sm rounded-full flex items-center justify-center">
                      <Check className="w-3 h-3 text-white" />
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          <div className="mt-3 text-xs text-gray-400 text-center">
            Active: <span className="text-white font-medium capitalize">{resolvedTheme || theme}</span>
          </div>
        </div>

        <div className="mt-4 space-y-2">
            <Label className="text-xs text-white/70">Message Bubble Colors</Label>
            
            {/* Color Picker Popover */}
            {openColorPicker && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setOpenColorPicker(null)}>
                <div className="bg-neutral-900 border border-white/20 rounded-xl p-4 max-w-sm w-full mx-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-sm font-medium text-white">
                      Select {selectedColorType === 'bg' ? 'Background' : selectedColorType === 'text' ? 'Text' : 'Border'} Color
                    </h4>
                    <button onClick={() => setOpenColorPicker(null)} className="text-white/50 hover:text-white">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="grid grid-cols-8 gap-1.5 mb-3">
                    {COLOR_SWATCHES.map((color) => (
                      <button
                        key={color}
                        onClick={() => {
                          if (openColorPicker === 'user-bg') setUserBubbleBg(color);
                          else if (openColorPicker === 'user-text') setUserBubbleText(color);
                          else if (openColorPicker === 'assistant-bg') setAssistantBubbleBg(color);
                          else if (openColorPicker === 'assistant-text') setAssistantBubbleText(color);
                          else if (openColorPicker === 'assistant-border') setAssistantBubbleBorder(color);
                          setOpenColorPicker(null);
                        }}
                        className={`w-7 h-7 rounded-md border-2 transition-all hover:scale-110 ${
                          ((openColorPicker === 'user-bg' && userBubbleBg === color) ||
                           (openColorPicker === 'user-text' && userBubbleText === color) ||
                           (openColorPicker === 'assistant-bg' && assistantBubbleBg === color) ||
                           (openColorPicker === 'assistant-text' && assistantBubbleText === color) ||
                           (openColorPicker === 'assistant-border' && assistantBubbleBorder === color))
                            ? 'border-white scale-110'
                            : 'border-transparent'
                        }`}
                        style={{ backgroundColor: color }}
                        title={color}
                      />
                    ))}
                  </div>
                  <div className="flex items-center gap-2">
                    <Input
                      type="text"
                      placeholder="#000000"
                      className="flex-1 bg-black/30 border-white/20 text-xs font-mono"
                      onChange={(e) => {
                        const val = e.target.value;
                        if (openColorPicker === 'user-bg') setUserBubbleBg(val);
                        else if (openColorPicker === 'user-text') setUserBubbleText(val);
                        else if (openColorPicker === 'assistant-bg') setAssistantBubbleBg(val);
                        else if (openColorPicker === 'assistant-text') setAssistantBubbleText(val);
                        else if (openColorPicker === 'assistant-border') setAssistantBubbleBorder(val);
                      }}
                    />
                    <Button size="sm" onClick={() => setOpenColorPicker(null)}>Done</Button>
                  </div>
                </div>
              </div>
            )}
            
            <div className="flex items-center justify-center gap-6 py-3">
              {/* User Bubble */}
              <div className="flex flex-col items-center gap-2">
                <div className="relative">
                  <div
                    className="w-16 h-16 rounded-full border-2 border-white/30 hover:border-white/60 transition-all cursor-pointer shadow-lg"
                    style={{ backgroundColor: userBubbleBg }}
                    onClick={() => { setSelectedColorType('bg'); setOpenColorPicker('user-bg'); }}
                    title="Your Bubble Background"
                  />
                  <div
                    className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full border-2 border-white/30 hover:border-white/60 transition-all cursor-pointer shadow-md"
                    style={{ backgroundColor: userBubbleText }}
                    onClick={() => { setSelectedColorType('text'); setOpenColorPicker('user-text'); }}
                    title="Your Text Color"
                  />
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: userBubbleBg }} />
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: userBubbleText }} />
                  <span className="text-[11px] text-white/70 font-medium">You</span>
                </div>
              </div>

              {/* Assistant Bubble */}
              <div className="flex flex-col items-center gap-2">
                <div className="relative">
                  <div
                    className="w-16 h-16 rounded-full border-2 border-white/30 hover:border-white/60 transition-all cursor-pointer shadow-lg"
                    style={{ backgroundColor: assistantBubbleBg }}
                    onClick={() => { setSelectedColorType('bg'); setOpenColorPicker('assistant-bg'); }}
                    title="Assistant Bubble Background"
                  />
                  <div
                    className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full border-2 border-white/30 hover:border-white/60 transition-all cursor-pointer shadow-md"
                    style={{ backgroundColor: assistantBubbleText }}
                    onClick={() => { setSelectedColorType('text'); setOpenColorPicker('assistant-text'); }}
                    title="Assistant Text Color"
                  />
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: assistantBubbleBg }} />
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: assistantBubbleText }} />
                  <span className="text-[11px] text-white/70 font-medium">Assistant</span>
                </div>
              </div>

              {/* Border Color */}
              <div className="flex flex-col items-center gap-2">
                <div
                  className="w-12 h-12 rounded-full border-4 hover:border-opacity-60 transition-all cursor-pointer shadow-lg flex items-center justify-center"
                  style={{ borderColor: assistantBubbleBorder }}
                  onClick={() => { setSelectedColorType('border'); setOpenColorPicker('assistant-border'); }}
                  title="Assistant Border Color"
                >
                  <div
                    className="w-6 h-6 rounded-full shadow-inner"
                    style={{ backgroundColor: assistantBubbleBorder }}
                  />
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-3 h-3 rounded-full border-2" style={{ borderColor: assistantBubbleBorder, backgroundColor: 'transparent' }} />
                  <span className="text-[11px] text-white/70 font-medium">Border</span>
                </div>
              </div>
            </div>
            <Button size="sm" className="w-full" onClick={handleApplyBubbleColors}>
              Apply Bubble Colors
            </Button>
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

            {/* LiveKit Voice Rooms Toggle */}
            {onLivekitToggle && (
              <div className="flex items-center justify-between">
                <div className="flex items-center">
                  {livekitEnabled ? (
                    <Mic className="h-4 w-4 mr-2 text-green-400" />
                  ) : (
                    <MicOff className="h-4 w-4 mr-2" />
                  )}
                  <Label htmlFor="livekit-enabled">LiveKit Voice Rooms</Label>
                </div>
                <div
                  className={`custom-toggle ${livekitEnabled ? 'active' : ''}`}
                  onClick={() => onLivekitToggle && onLivekitToggle(!livekitEnabled)}
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

        {/* Environment Variables Section - User Overrides */}
        <div className="bg-black/30 rounded-lg p-4 border border-white/10">
          <div className="flex items-center gap-2 mb-4">
            <SettingsIcon className="h-4 w-4" />
            <h3 className="font-medium">User Feature Overrides</h3>
          </div>
          <p className="text-xs text-gray-400 mb-3">
            Override environment variables for your session. Settings sync to your account and persist across devices.
          </p>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <Label htmlFor="opencode-enabled" className="text-sm">OpenCode</Label>
                <p className="text-xs text-gray-500">OpenCode AI integration (alternative to default LLM)</p>
              </div>
              <div
                className={`custom-toggle ${envVars.OPENCODE_ENABLED ? 'active' : ''}`}
                onClick={() => toggleEnvVar('OPENCODE_ENABLED')}
                title={envVars.OPENCODE_ENABLED ? 'Enabled' : 'Disabled'}
              >
                <div className="custom-toggle-slider" />
              </div>
            </div>

            <div className="flex items-center justify-between">
              <div className="flex-1">
                <Label htmlFor="nullclaw-enabled" className="text-sm">Nullclaw</Label>
                <p className="text-xs text-gray-500">Nullclaw integration for advanced agent capabilities</p>
              </div>
              <div
                className={`custom-toggle ${envVars.NULLCLAW_ENABLED ? 'active' : ''}`}
                onClick={() => toggleEnvVar('NULLCLAW_ENABLED')}
                title={envVars.NULLCLAW_ENABLED ? 'Enabled' : 'Disabled'}
              >
                <div className="custom-toggle-slider" />
              </div>
            </div>
          </div>

          <div className="mt-4 space-y-2">
            <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg">
              <p className="text-xs text-blue-400">
                💡 <strong>How it works:</strong> Your preferences override server environment variables for your session only.
              </p>
            </div>
            <div className="p-3 bg-green-500/10 border border-green-500/20 rounded-lg">
              <p className="text-xs text-green-400">
                ✅ <strong>Synced to account:</strong> Settings persist across devices when logged in.
              </p>
            </div>
          </div>
        </div>

        {/* Oracle VM Configuration */}
        <div className="bg-black/30 rounded-lg p-4 border border-white/10">
          <div className="flex items-center gap-2 mb-4">
            <Server className="h-4 w-4" />
            <h3 className="font-medium">Oracle VM Sandbox</h3>
          </div>
          <p className="text-xs text-gray-400 mb-3">
            Connect to your Oracle Cloud Infrastructure VM for sandboxed code execution via SSH.
          </p>
          <div className="space-y-3">
            <div>
              <Label htmlFor="oracle-vm-host" className="text-xs text-white/70">VM Host (IP or hostname)</Label>
              <Input
                id="oracle-vm-host"
                value={oracleVmConfig.host}
                onChange={(e) => setOracleVmConfig(prev => ({ ...prev, host: e.target.value }))}
                placeholder="192.168.1.100 or vm-host.oraclecloud.com"
                className="bg-black/30 border-white/20 text-xs"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label htmlFor="oracle-vm-port" className="text-xs text-white/70">SSH Port</Label>
                <Input
                  id="oracle-vm-port"
                  type="number"
                  value={oracleVmConfig.port}
                  onChange={(e) => setOracleVmConfig(prev => ({ ...prev, port: parseInt(e.target.value) || 22 }))}
                  placeholder="22"
                  className="bg-black/30 border-white/20 text-xs"
                />
              </div>
              <div>
                <Label htmlFor="oracle-vm-user" className="text-xs text-white/70">Username</Label>
                <Input
                  id="oracle-vm-user"
                  value={oracleVmConfig.username}
                  onChange={(e) => setOracleVmConfig(prev => ({ ...prev, username: e.target.value }))}
                  placeholder="opc"
                  className="bg-black/30 border-white/20 text-xs"
                />
              </div>
            </div>
            <div>
              <Label htmlFor="oracle-vm-key" className="text-xs text-white/70">SSH Private Key Path</Label>
              <Input
                id="oracle-vm-key"
                value={oracleVmConfig.privateKeyPath}
                onChange={(e) => setOracleVmConfig(prev => ({ ...prev, privateKeyPath: e.target.value }))}
                placeholder="~/.ssh/id_rsa"
                className="bg-black/30 border-white/20 text-xs"
              />
            </div>
            <div>
              <Label htmlFor="oracle-vm-workspace" className="text-xs text-white/70">Workspace Directory</Label>
              <Input
                id="oracle-vm-workspace"
                value={oracleVmConfig.workspace}
                onChange={(e) => setOracleVmConfig(prev => ({ ...prev, workspace: e.target.value }))}
                placeholder="/home/opc/workspace"
                className="bg-black/30 border-white/20 text-xs"
              />
            </div>
            <Button
              size="sm"
              className="w-full"
              onClick={handleSaveOracleVmConfig}
            >
              Save Configuration
            </Button>
            <div className="p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
              <p className="text-xs text-yellow-400">
                ⚠️ <strong>Required:</strong> SSH private key must be configured. Set <code>ORACLE_VM_HOST</code> environment variable to enable.
              </p>
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
            {(messages?.length ?? 0) === 0 ? (
              <p className="text-white/50 italic">No messages yet</p>
            ) : (
              (messages || []).map((message, index) => (
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

      {/* Auth Modal */}
      {showAuthModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-70 backdrop-blur-sm">
          <div className="relative p-6">
            <Button
              variant="ghost"
              size="icon"
              className="absolute top-2 right-2 text-white/70 hover:text-white z-10"
              onClick={handleCloseAuthModal}
              aria-label="Close authentication modal"
            >
              <X className="h-5 w-5" />
            </Button>
            {authMode === 'login' ? (
              <ModalLoginForm 
                onSwitchMode={() => setAuthMode('signup')} 
                onSuccess={handleAuthSuccess}
                onError={setAuthError}
              />
            ) : (
              <ModalSignupForm 
                onSwitchMode={() => setAuthMode('login')} 
                onSuccess={handleAuthSuccess}
                onError={setAuthError}
              />
            )}
            
            {/* OAuth Providers (Auth0 sidelayer) */}
            <div className="mt-4 pt-4 border-t border-white/10">
              <p className="text-xs text-white/50 text-center mb-3">Or continue with</p>
              <div className="flex gap-2 justify-center">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => window.location.href = '/auth/login?connection=google'}
                  className="flex items-center gap-2 bg-white text-gray-800 hover:bg-gray-100 border-0"
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                  </svg>
                  Google
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => window.location.href = '/auth/login?connection=github'}
                  className="flex items-center gap-2 bg-gray-800 text-white hover:bg-gray-700 border-0"
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                  </svg>
                  GitHub
                </Button>
              </div>
              <p className="text-[10px] text-white/30 text-center mt-2">
                Powered by Auth0 (AI Agent integrations sidelayer)
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
