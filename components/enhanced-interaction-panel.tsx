"use client";

import React, { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Send,
  Plus,
  Settings,
  Accessibility,
  History,
  Loader2,
  Square,
  MessageSquare,
  Code,
  GripHorizontal,
  Maximize2,
  Minimize2,
  Mic,
  MicOff,
  Wifi,
  WifiOff,
  Zap,
  Sparkles,
  RefreshCw,
  ChevronUp,
  ChevronDown,
  X,
  Check,
} from "lucide-react";
import type { LLMProvider } from "@/lib/api/llm-providers";
import { useEnhancedMobile } from "@/hooks/use-enhanced-mobile";
import { useVoiceInput } from "@/hooks/use-voice-input";
import { cn } from "@/lib/utils";

interface EnhancedInteractionPanelProps {
  onSubmit: (content: string) => void;
  onNewChat: () => void;
  isProcessing: boolean;
  toggleAccessibility: () => void;
  toggleHistory: () => void;
  toggleCodePreview: () => void;
  onStopGeneration?: () => void;
  onRetry?: () => void;
  currentProvider?: string;
  currentModel?: string;
  availableProviders?: LLMProvider[];
  onProviderChange?: (provider: string, model: string) => void;
  pendingDiffs?: Array<{ path: string; diff: string }>;
  onAcceptPendingDiffs?: () => void;
  onDismissPendingDiffs?: () => void;
  networkStatus?: 'online' | 'offline' | 'reconnecting';
  autosuggestEnabled?: boolean;
  voiceEnabled?: boolean;
  onVoiceToggle?: (enabled: boolean) => void;
}

interface Suggestion {
  id: string;
  text: string;
  category: 'quick' | 'template' | 'completion';
  icon?: React.ReactNode;
}

export function EnhancedInteractionPanel({
  onSubmit,
  onNewChat,
  isProcessing,
  toggleAccessibility,
  toggleHistory,
  toggleCodePreview,
  onStopGeneration,
  onRetry,
  currentProvider = '',
  currentModel = '',
  availableProviders = [],
  onProviderChange,
  pendingDiffs = [],
  onAcceptPendingDiffs,
  onDismissPendingDiffs,
  networkStatus = 'online',
  autosuggestEnabled = true,
  voiceEnabled = false,
  onVoiceToggle,
}: EnhancedInteractionPanelProps) {
  // Enhanced mobile hook
  const mobile = useEnhancedMobile();

  // Voice input
  const { isListening, startListening, stopListening, transcript } = useVoiceInput();

  // State management
  const [input, setInput] = useState('');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(-1);
  const [panelHeight, setPanelHeight] = useState(() => {
    if (mobile.device.isMobile) {
      return Math.min(280, mobile.device.height * 0.4);
    }
    return 320;
  });
  const [isDragging, setIsDragging] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [showProviderSelect, setShowProviderSelect] = useState(false);

  // Refs
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);
  const resizeHandleRef = useRef<HTMLDivElement>(null);

  // Keyboard state tracking
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [inputFocused, setInputFocused] = useState(false);

  // Quick suggestions for mobile
  const quickSuggestions: Suggestion[] = useMemo(() => [
    { id: 'explain', text: 'Explain this concept...', category: 'quick', icon: <MessageSquare className="w-4 h-4" /> },
    { id: 'code', text: 'Generate code for...', category: 'quick', icon: <Code className="w-4 h-4" /> },
    { id: 'debug', text: 'Help me debug...', category: 'quick', icon: <Zap className="w-4 h-4" /> },
    { id: 'optimize', text: 'How can I optimize...', category: 'quick', icon: <Sparkles className="w-4 h-4" /> },
  ], []);

  // Handle keyboard visibility changes
  useEffect(() => {
    if (mobile.keyboard.isVisible !== mobile.keyboard.wasVisible) {
      setKeyboardHeight(mobile.keyboard.height);

      if (mobile.keyboard.isVisible && inputFocused) {
        // Keyboard appeared - adjust panel
        setTimeout(() => {
          textareaRef.current?.scrollIntoView({
            behavior: 'smooth',
            block: 'nearest',
          });
        }, 300);
      }
    }
  }, [mobile.keyboard.isVisible, mobile.keyboard.height, mobile.keyboard.wasVisible, inputFocused]);

  // Handle voice transcript
  useEffect(() => {
    if (transcript) {
      setInput(transcript);
      setShowSuggestions(false);
    }
  }, [transcript]);

  // Generate suggestions based on input
  useEffect(() => {
    if (!autosuggestEnabled || input.length < 2) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    const filteredSuggestions = quickSuggestions.filter(suggestion =>
      suggestion.text.toLowerCase().includes(input.toLowerCase())
    );

    // Add completion suggestions (mock for now)
    if (input.length > 10) {
      const completions: Suggestion[] = [
        { id: 'complete-1', text: input + ' in Python', category: 'completion' },
        { id: 'complete-2', text: input + ' with examples', category: 'completion' },
      ];
      filteredSuggestions.push(...completions);
    }

    setSuggestions(filteredSuggestions.slice(0, mobile.device.isMobile ? 4 : 6));
    setShowSuggestions(filteredSuggestions.length > 0);
    setSelectedSuggestionIndex(-1);
  }, [input, autosuggestEnabled, quickSuggestions, mobile.device.isMobile]);

  // Handle input changes
  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);

    // Auto-resize textarea
    const textarea = e.target;
    textarea.style.height = 'auto';
    const newHeight = Math.min(textarea.scrollHeight, mobile.device.isMobile ? 120 : 160);
    textarea.style.height = `${newHeight}px`;
  }, [mobile.device.isMobile]);

  // Handle form submission
  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();

    if (!input.trim() || isProcessing) return;

    // Haptic feedback
    mobile.hapticFeedback('selection');

    onSubmit(input.trim());
    setInput('');
    setShowSuggestions(false);

    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [input, isProcessing, onSubmit, mobile]);

  // Handle suggestion selection
  const handleSuggestionSelect = useCallback((suggestion: Suggestion) => {
    setInput(suggestion.text);
    setShowSuggestions(false);
    mobile.hapticFeedback('light');

    // Focus textarea after selection
    setTimeout(() => {
      textareaRef.current?.focus();
    }, 100);
  }, [mobile]);

  // Handle keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!showSuggestions || suggestions.length === 0) {
      // Handle other keyboard shortcuts
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSubmit(e);
      }
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedSuggestionIndex(prev =>
          prev < suggestions.length - 1 ? prev + 1 : 0
        );
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedSuggestionIndex(prev =>
          prev > 0 ? prev - 1 : suggestions.length - 1
        );
        break;
      case 'Enter':
        if (selectedSuggestionIndex >= 0) {
          e.preventDefault();
          handleSuggestionSelect(suggestions[selectedSuggestionIndex]);
        } else if (!e.shiftKey) {
          e.preventDefault();
          handleSubmit(e);
        }
        break;
      case 'Escape':
        setShowSuggestions(false);
        setSelectedSuggestionIndex(-1);
        break;
    }
  }, [showSuggestions, suggestions, selectedSuggestionIndex, handleSuggestionSelect, handleSubmit]);

  // Handle voice input toggle
  const handleVoiceToggle = useCallback(() => {
    if (isListening) {
      stopListening();
      mobile.hapticFeedback('light');
    } else {
      startListening();
      mobile.hapticFeedback('medium');
    }
  }, [isListening, startListening, stopListening, mobile]);

  // Handle provider change
  const handleProviderChange = useCallback((providerId: string) => {
    const provider = availableProviders.find(p => p.id === providerId);
    if (provider && onProviderChange) {
      onProviderChange(providerId, provider.models[0] || '');
      mobile.hapticFeedback('selection');
    }
  }, [availableProviders, onProviderChange, mobile]);

  // Calculate panel styling based on mobile state
  const panelStyles = useMemo(() => {
    const baseHeight = isMinimized ? 60 : panelHeight;
    const keyboardOffset = mobile.device.isMobile && mobile.keyboard.isVisible ?
      mobile.keyboard.height + mobile.safeArea.bottom : mobile.safeArea.bottom;

    return {
      height: baseHeight,
      paddingBottom: keyboardOffset,
      transform: isDragging ? 'scale(1.02)' : 'scale(1)',
    };
  }, [isMinimized, panelHeight, mobile, isDragging]);

  // Network status indicator
  const NetworkStatus = () => (
    <div className={cn(
      "flex items-center gap-2 px-2 py-1 rounded-full text-xs font-medium",
      networkStatus === 'online'
        ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
        : networkStatus === 'offline'
        ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
        : "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400"
    )}>
      {networkStatus === 'online' ? (
        <Wifi className="w-3 h-3" />
      ) : networkStatus === 'offline' ? (
        <WifiOff className="w-3 h-3" />
      ) : (
        <RefreshCw className="w-3 h-3 animate-spin" />
      )}
      {mobile.device.isMobile ? '' : networkStatus}
    </div>
  );

  return (
    <div
      ref={panelRef}
      className={cn(
        "fixed bottom-0 left-0 right-0 bg-background/95 backdrop-blur-sm border-t border-border/50 transition-all duration-300 z-50",
        mobile.device.isMobile && "pb-safe-bottom"
      )}
      style={panelStyles}
    >
      {/* Drag handle for desktop */}
      {!mobile.device.isMobile && (
        <div
          ref={resizeHandleRef}
          className="absolute top-0 left-0 right-0 h-1 bg-border/30 hover:bg-border cursor-ns-resize group"
          onMouseDown={() => setIsDragging(true)}
        >
          <div className="flex justify-center pt-1">
            <GripHorizontal className="w-4 h-4 text-muted-foreground group-hover:text-foreground" />
          </div>
        </div>
      )}

      {/* Header Bar */}
      <div className="flex items-center justify-between p-3 border-b border-border/30">
        <div className="flex items-center gap-2">
          {/* Network Status */}
          <NetworkStatus />

          {/* Provider Selector */}
          {availableProviders.length > 0 && (
            <Select value={currentProvider} onValueChange={handleProviderChange}>
              <SelectTrigger className="w-auto h-8 text-xs border-border/50">
                <SelectValue placeholder="Provider" />
              </SelectTrigger>
              <SelectContent>
                {availableProviders.map((provider) => (
                  <SelectItem key={provider.id} value={provider.id}>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{provider.name}</span>
                      {provider.id === currentProvider && (
                        <Badge variant="secondary" className="text-xs">
                          {currentModel}
                        </Badge>
                      )}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        <div className="flex items-center gap-1">
          {/* Action buttons */}
          <Button
            size="sm"
            variant="ghost"
            onClick={toggleHistory}
            className="h-8 w-8 p-0"
            style={{ minHeight: mobile.getTouchTargetSize(), minWidth: mobile.getTouchTargetSize() }}
          >
            <History className="w-4 h-4" />
          </Button>

          <Button
            size="sm"
            variant="ghost"
            onClick={toggleCodePreview}
            className="h-8 w-8 p-0"
            style={{ minHeight: mobile.getTouchTargetSize(), minWidth: mobile.getTouchTargetSize() }}
          >
            <Code className="w-4 h-4" />
          </Button>

          <Button
            size="sm"
            variant="ghost"
            onClick={() => setIsMinimized(!isMinimized)}
            className="h-8 w-8 p-0"
            style={{ minHeight: mobile.getTouchTargetSize(), minWidth: mobile.getTouchTargetSize() }}
          >
            {isMinimized ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </Button>
        </div>
      </div>

      {/* Pending Diffs Notification */}
      {pendingDiffs.length > 0 && !isMinimized && (
        <div className="bg-blue-50 dark:bg-blue-900/20 border-b border-blue-200 dark:border-blue-800 p-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
              <span className="text-sm font-medium text-blue-900 dark:text-blue-100">
                {pendingDiffs.length} file{pendingDiffs.length > 1 ? 's' : ''} ready to apply
              </span>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={onAcceptPendingDiffs}
                className="h-8 px-3 bg-blue-600 hover:bg-blue-700"
                style={{ minHeight: mobile.getTouchTargetSize() }}
              >
                <Check className="w-3 h-3 mr-1" />
                Apply
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={onDismissPendingDiffs}
                className="h-8 w-8 p-0"
                style={{ minHeight: mobile.getTouchTargetSize(), minWidth: mobile.getTouchTargetSize() }}
              >
                <X className="w-3 h-3" />
              </Button>
            </div>
          </div>
        </div>
      )}

      {!isMinimized && (
        <div className="flex-1 p-3">
          {/* Quick Actions (Mobile) */}
          {mobile.device.isMobile && input.length === 0 && (
            <div className="mb-3">
              <div className="flex gap-2 overflow-x-auto pb-2">
                {quickSuggestions.map((suggestion) => (
                  <Button
                    key={suggestion.id}
                    size="sm"
                    variant="outline"
                    onClick={() => handleSuggestionSelect(suggestion)}
                    className="whitespace-nowrap shrink-0"
                    style={{ minHeight: mobile.getTouchTargetSize() }}
                  >
                    {suggestion.icon}
                    <span className="ml-2">{suggestion.text.split('...')[0]}</span>
                  </Button>
                ))}
              </div>
            </div>
          )}

          {/* Input Form */}
          <form onSubmit={handleSubmit} className="relative">
            {/* Suggestions Dropdown */}
            {showSuggestions && suggestions.length > 0 && (
              <div
                ref={suggestionsRef}
                className="absolute bottom-full left-0 right-0 mb-2 bg-background border border-border rounded-lg shadow-lg max-h-40 overflow-y-auto z-10"
              >
                {suggestions.map((suggestion, index) => (
                  <button
                    key={suggestion.id}
                    type="button"
                    onClick={() => handleSuggestionSelect(suggestion)}
                    className={cn(
                      "w-full text-left px-3 py-2 hover:bg-accent flex items-center gap-2 transition-colors",
                      index === selectedSuggestionIndex && "bg-accent",
                      mobile.device.isMobile && "py-3"
                    )}
                    style={{ minHeight: mobile.device.isMobile ? mobile.getTouchTargetSize() : 'auto' }}
                  >
                    {suggestion.icon}
                    <span className="text-sm">{suggestion.text}</span>
                    <Badge variant="secondary" className="ml-auto text-xs">
                      {suggestion.category}
                    </Badge>
                  </button>
                ))}
              </div>
            )}

            {/* Main Input Area */}
            <div className="flex gap-2 items-end">
              <div className="flex-1 relative">
                <Textarea
                  ref={textareaRef}
                  value={input}
                  onChange={handleInputChange}
                  onKeyDown={handleKeyDown}
                  onFocus={() => setInputFocused(true)}
                  onBlur={() => setInputFocused(false)}
                  placeholder={
                    isListening
                      ? "Listening..."
                      : mobile.device.isMobile
                        ? "Ask anything..."
                        : "Type your message... (Enter to send, Shift+Enter for new line)"
                  }
                  className={cn(
                    "min-h-[44px] max-h-32 resize-none transition-all duration-200",
                    mobile.device.isMobile && "text-base", // Prevent zoom on iOS
                    isListening && "ring-2 ring-blue-500 ring-opacity-50"
                  )}
                  style={{
                    minHeight: mobile.getTouchTargetSize(),
                    fontSize: mobile.device.isMobile ? '16px' : '14px', // Prevent iOS zoom
                  }}
                  disabled={isProcessing}
                />

                {/* Character counter for mobile */}
                {mobile.device.isMobile && input.length > 100 && (
                  <div className="absolute bottom-2 right-2 text-xs text-muted-foreground bg-background/80 px-1 rounded">
                    {input.length}
                  </div>
                )}
              </div>

              {/* Voice Input Button */}
              {voiceEnabled && (
                <Button
                  type="button"
                  size="sm"
                  variant={isListening ? "default" : "outline"}
                  onClick={handleVoiceToggle}
                  className={cn(
                    "shrink-0 transition-all duration-200",
                    isListening && "animate-pulse bg-red-500 hover:bg-red-600"
                  )}
                  style={{
                    minHeight: mobile.getTouchTargetSize(),
                    minWidth: mobile.getTouchTargetSize()
                  }}
                  disabled={isProcessing}
                >
                  {isListening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                </Button>
              )}

              {/* Submit/Stop Button */}
              <Button
                type={isProcessing ? "button" : "submit"}
                size="sm"
                onClick={isProcessing ? onStopGeneration : undefined}
                disabled={!input.trim() && !isProcessing}
                className={cn(
                  "shrink-0 transition-all duration-200",
                  isProcessing && "bg-red-500 hover:bg-red-600"
                )}
                style={{
                  minHeight: mobile.getTouchTargetSize(),
                  minWidth: mobile.getTouchTargetSize()
                }}
              >
                {isProcessing ? (
                  mobile.device.isMobile ? <Square className="w-4 h-4" /> : <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
              </Button>
            </div>

            {/* Mobile-specific bottom actions */}
            {mobile.device.isMobile && (
              <div className="flex items-center justify-between mt-2">
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={onNewChat}
                    className="text-xs h-8"
                  >
                    <Plus className="w-3 h-3 mr-1" />
                    New
                  </Button>

                  {onRetry && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={onRetry}
                      className="text-xs h-8"
                    >
                      <RefreshCw className="w-3 h-3 mr-1" />
                      Retry
                    </Button>
                  )}
                </div>

                <div className="flex gap-1">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={toggleAccessibility}
                    className="h-8 w-8 p-0"
                  >
                    <Accessibility className="w-4 h-4" />
                  </Button>

                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => setShowProviderSelect(!showProviderSelect)}
                    className="h-8 w-8 p-0"
                  >
                    <Settings className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            )}
          </form>
        </div>
      )}
    </div>
  );
}
