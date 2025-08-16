"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { type Message } from "ai/react";
import { toast } from "sonner";
import { useVoiceInput } from "@/hooks/use-voice-input";
import { useEnhancedStreaming } from "@/hooks/use-enhanced-streaming";
import { useEnhancedMobile } from "@/hooks/use-enhanced-mobile";
import MessageBubble from "@/components/message-bubble";
import AccessibilityControls from "@/components/accessibility-controls";
import CodePreviewPanel from "@/components/code-preview-panel";
import { LLMProvider } from "@/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ArrowDown,
  Wifi,
  WifiOff,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Zap
} from "lucide-react";
import { cn } from "@/lib/utils";

interface EnhancedChatPanelProps {
  messages: Message[];
  input: string;
  handleSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
  isLoading: boolean;
  error: Error | undefined;
  isStreaming: boolean;
  onStopGeneration: () => void;
  setInput: (value: string) => void;
  availableProviders: LLMProvider[];
  onClearChat: () => void;
  onShowHistory: () => void;
  currentConversationId: string | null;
  onSelectHistoryChat: (id: string) => void;
  currentProvider: string;
  currentModel: string;
  voiceEnabled: boolean;
  onVoiceToggle: (enabled: boolean) => void;
  onProviderChange: (provider: string, model: string) => void;
}

export function EnhancedChatPanel({
  messages,
  input,
  handleSubmit,
  isLoading,
  error,
  isStreaming,
  onStopGeneration,
  availableProviders,
  onClearChat,
  onShowHistory,
  currentConversationId,
  onSelectHistoryChat,
  currentProvider,
  currentModel,
  voiceEnabled,
  onVoiceToggle,
  setInput,
  onProviderChange,
}: EnhancedChatPanelProps) {
  // Enhanced hooks
  const mobile = useEnhancedMobile();
  const streaming = useEnhancedStreaming({
    enableOfflineSupport: true,
    enableNetworkRecovery: true,
    onToken: (content) => {
      // Handle real-time token updates
      console.log("Token received:", content);
    },
    onComplete: () => {
      mobile.hapticFeedback('light');
    },
    onError: (error) => {
      mobile.hapticFeedback('heavy');
    },
  });

  const { isListening, startListening, stopListening, transcript } = useVoiceInput();

  // State management
  const [isCodePreviewOpen, setIsCodePreviewOpen] = useState(false);
  const [isAccessibilityOptionsOpen, setIsAccessibilityOptionsOpen] = useState(false);
  const [isUserScrolledUp, setIsUserScrolledUp] = useState(false);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const [virtualScrollOffset, setVirtualScrollOffset] = useState(0);
  const [visibleMessageRange, setVisibleMessageRange] = useState({ start: 0, end: messages.length });

  // Refs
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const lastMessageRef = useRef<HTMLDivElement>(null);
  const intersectionObserverRef = useRef<IntersectionObserver | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);

  // Enhanced scroll handling with mobile optimizations
  const handleScroll = useCallback(() => {
    if (!scrollContainerRef.current) return;

    const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
    const isNearBottom = scrollHeight - scrollTop - clientHeight < 100;

    setIsUserScrolledUp(!isNearBottom);
    setShowJumpToLatest(!isNearBottom);

    // Virtual scrolling for performance
    if (messages.length > 50) {
      const itemHeight = 120; // Approximate message height
      const visibleStart = Math.floor(scrollTop / itemHeight);
      const visibleEnd = Math.min(
        messages.length,
        visibleStart + Math.ceil(clientHeight / itemHeight) + 5 // Buffer
      );

      setVisibleMessageRange({ start: Math.max(0, visibleStart - 5), end: visibleEnd });
    }

    // Update virtual scroll offset
    setVirtualScrollOffset(scrollTop);
  }, [messages.length]);

  // Enhanced auto-scroll with layout shift prevention
  const scrollToBottom = useCallback((behavior: 'smooth' | 'instant' = 'smooth') => {
    if (!messagesEndRef.current) return;

    // Use mobile-optimized scrolling
    if (mobile.device.isMobile) {
      mobile.scrollToElement(messagesEndRef.current, {
        behavior,
        block: 'nearest',
        offset: mobile.safeArea.bottom + 20,
      });
    } else {
      messagesEndRef.current.scrollIntoView({
        behavior,
        block: 'nearest',
      });
    }

    setIsUserScrolledUp(false);
    setShowJumpToLatest(false);
  }, [mobile]);

  // Auto-scroll management
  useEffect(() => {
    if (!isUserScrolledUp || messages.length <= 1) {
      // Small delay to prevent layout shift
      const timeoutId = setTimeout(() => {
        scrollToBottom('smooth');
      }, 50);

      return () => clearTimeout(timeoutId);
    }
  }, [messages, isUserScrolledUp, scrollToBottom]);

  // Handle voice input
  useEffect(() => {
    if (transcript) {
      setInput(transcript);
    }
  }, [transcript, setInput]);

  // Message submission handler
  const handleUserMessageSubmit = useCallback((content: string) => {
    setInput(content);
    handleSubmit(new Event('submit') as unknown as React.FormEvent<HTMLFormElement>);

    // Haptic feedback on mobile
    mobile.hapticFeedback('selection');
  }, [setInput, handleSubmit, mobile]);

  // Jump to latest with animation
  const jumpToLatest = useCallback(() => {
    scrollToBottom('smooth');
    mobile.hapticFeedback('light');
  }, [scrollToBottom, mobile]);

  // Pull-to-refresh gesture (mobile)
  useEffect(() => {
    const cleanup = mobile.onGesture('chat-pull-refresh', (gesture) => {
      if (gesture.type === 'swipe' && gesture.direction === 'down' &&
          scrollContainerRef.current?.scrollTop === 0) {
        mobile.hapticFeedback('light');
        toast.info('Refreshing conversation...');
        // Could trigger a refresh action here
      }
    });

    return cleanup;
  }, [mobile]);

  // Network status handling
  useEffect(() => {
    if (mobile.network.isOnline && streaming.networkStatus === 'offline') {
      toast.success('Connection restored');
    } else if (!mobile.network.isOnline) {
      toast.warning('Connection lost');
    }
  }, [mobile.network.isOnline, streaming.networkStatus]);

  // Intersection observer for visibility detection
  useEffect(() => {
    if (!lastMessageRef.current) return;

    intersectionObserverRef.current = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setShowJumpToLatest(false);
          }
        });
      },
      { threshold: 0.1 }
    );

    intersectionObserverRef.current.observe(lastMessageRef.current);

    return () => {
      intersectionObserverRef.current?.disconnect();
    };
  }, [messages.length]);

  // Keyboard management for mobile
  useEffect(() => {
    if (mobile.device.isMobile && mobile.keyboard.isVisible) {
      // Adjust scroll position when keyboard appears
      setTimeout(() => {
        if (!isUserScrolledUp) {
          scrollToBottom('instant');
        }
      }, 300);
    }
  }, [mobile.keyboard.isVisible, mobile.device.isMobile, isUserScrolledUp, scrollToBottom]);

  // Memoized visible messages for performance
  const visibleMessages = useMemo(() => {
    if (messages.length <= 50) return messages;

    return messages.slice(visibleMessageRange.start, visibleMessageRange.end);
  }, [messages, visibleMessageRange]);

  // Network status indicator
  const NetworkStatusIndicator = () => (
    <div className={cn(
      "flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium transition-all",
      streaming.networkStatus === 'online'
        ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
        : streaming.networkStatus === 'offline'
        ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
        : "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400"
    )}>
      {streaming.networkStatus === 'online' ? (
        <><Wifi className="w-3 h-3" /> Online</>
      ) : streaming.networkStatus === 'offline' ? (
        <><WifiOff className="w-3 h-3" /> Offline</>
      ) : (
        <><RefreshCw className="w-3 h-3 animate-spin" /> Connecting</>
      )}
    </div>
  );

  // Streaming metrics display
  const StreamingMetrics = () => {
    if (!streaming.metrics || !mobile.device.isMobile) return null;

    return (
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        {streaming.metrics.timeToFirstToken > 0 && (
          <div className="flex items-center gap-1">
            <Zap className="w-3 h-3" />
            {streaming.metrics.timeToFirstToken}ms TTFT
          </div>
        )}
        {streaming.metrics.tokensPerSecond > 0 && (
          <div className="flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {streaming.metrics.tokensPerSecond.toFixed(1)} t/s
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full relative min-h-0">
      {/* Status Bar - Mobile */}
      {mobile.device.isMobile && (
        <div className="flex items-center justify-between p-2 border-b border-border/50">
          <NetworkStatusIndicator />
          <StreamingMetrics />
          {streaming.canRetry && (
            <Button
              size="sm"
              variant="ghost"
              onClick={streaming.retry}
              className="h-6 px-2 text-xs"
            >
              <RefreshCw className="w-3 h-3 mr-1" />
              Retry
            </Button>
          )}
        </div>
      )}

      {/* Messages Container */}
      <div
        ref={scrollContainerRef}
        className={cn(
          "flex-1 overflow-y-auto overscroll-contain touch-pan-y",
          "px-2 sm:px-4 space-y-2",
          mobile.device.isMobile ? "pb-safe-bottom" : "pb-4"
        )}
        style={{
          paddingBottom: mobile.device.isMobile ?
            `max(env(safe-area-inset-bottom, 0px) + 120px, 120px)` : "120px",
          WebkitOverflowScrolling: "touch",
          scrollBehavior: mobile.isReducedMotion ? "auto" : "smooth"
        }}
        onScroll={handleScroll}
      >
        {/* Empty State */}
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground space-y-4">
            <div className="text-center space-y-2">
              <p className="text-lg font-medium">Start a conversation</p>
              <p className="text-sm max-w-md">
                Type a message{mobile.device.supportsTouch && ", use voice input,"} or explore the features below
              </p>
            </div>

            {/* Quick action buttons for mobile */}
            {mobile.device.isMobile && (
              <div className="flex flex-wrap gap-2 justify-center mt-6">
                <Button size="sm" variant="outline">Ask a question</Button>
                <Button size="sm" variant="outline">Generate code</Button>
                <Button size="sm" variant="outline">Explain concept</Button>
              </div>
            )}
          </div>
        )}

        {/* Virtual scrolling spacer - top */}
        {messages.length > 50 && visibleMessageRange.start > 0 && (
          <div style={{ height: visibleMessageRange.start * 120 }} />
        )}

        {/* Messages */}
        {visibleMessages.map((message, index) => {
          const isLastMessage = index === visibleMessages.length - 1;
          const actualIndex = visibleMessageRange.start + index;

          return (
            <div
              key={message.id || actualIndex}
              ref={isLastMessage ? lastMessageRef : undefined}
            >
              <MessageBubble
                message={message}
                isStreaming={isLoading && isLastMessage}
                isMobile={mobile.device.isMobile}
                touchTargetSize={mobile.getTouchTargetSize()}
              />
            </div>
          );
        })}

        {/* Loading indicator with TTFT skeleton */}
        {isLoading && (
          <div className="space-y-2">
            <MessageBubble
              message={{
                id: "loading",
                role: "assistant",
                content: streaming.content || "..."
              }}
              isStreaming={true}
              isMobile={mobile.device.isMobile}
              showSkeleton={!streaming.content}
              touchTargetSize={mobile.getTouchTargetSize()}
            />

            {/* TTFT indicator */}
            {!streaming.content && streaming.isConnecting && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground ml-4">
                <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
                Connecting...
              </div>
            )}
          </div>
        )}

        {/* Error state with recovery options */}
        {streaming.error && (
          <div className="mx-4 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
              <div className="flex-1 space-y-2">
                <p className="text-sm font-medium text-red-900 dark:text-red-100">
                  Connection interrupted
                </p>
                <p className="text-xs text-red-700 dark:text-red-300">
                  {streaming.error.message}
                </p>
                {streaming.canRetry && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={streaming.retry}
                    className="mt-2 h-8"
                  >
                    <RefreshCw className="w-3 h-3 mr-2" />
                    Retry
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />

        {/* Virtual scrolling spacer - bottom */}
        {messages.length > 50 && visibleMessageRange.end < messages.length && (
          <div style={{ height: (messages.length - visibleMessageRange.end) * 120 }} />
        )}
      </div>

      {/* Jump to Latest Button */}
      {showJumpToLatest && (
        <div className={cn(
          "absolute right-4 z-10",
          mobile.device.isMobile ? "bottom-32" : "bottom-64"
        )}>
          <Button
            onClick={jumpToLatest}
            size={mobile.device.isMobile ? "default" : "sm"}
            className={cn(
              "bg-black/60 hover:bg-black/80 backdrop-blur-sm border border-white/20 text-white shadow-lg transition-all duration-200 flex items-center gap-2",
              mobile.device.isMobile && "min-h-touch min-w-touch"
            )}
            title="Jump to latest message"
          >
            <ArrowDown className="w-4 h-4" />
            {mobile.device.isMobile && messages.length > 10 && (
              <Badge variant="secondary" className="text-xs">
                {messages.length - visibleMessageRange.end}
              </Badge>
            )}
          </Button>
        </div>
      )}

      {/* Accessibility Controls Overlay */}
      {isAccessibilityOptionsOpen && (
        <div className="absolute inset-0 z-50">
          <AccessibilityControls
            onClose={() => setIsAccessibilityOptionsOpen(false)}
            messages={messages}
            voiceEnabled={voiceEnabled}
            onVoiceToggle={onVoiceToggle}
            isProcessing={isLoading}
            isMobile={mobile.device.isMobile}
          />
        </div>
      )}

      {/* Code Preview Panel */}
      <CodePreviewPanel
        isOpen={isCodePreviewOpen}
        onClose={() => setIsCodePreviewOpen(false)}
        messages={messages}
        isMobile={mobile.device.isMobile}
      />
    </div>
  );
}
