"use client";

import { useState, useRef, Suspense, useEffect, useCallback, useMemo } from "react";
import { type Message } from "ai/react";
import type { ChatHistory } from "@/types";
import {
  ResizablePanel,
  ResizablePanelGroup,
  ResizableHandle,
} from "@/components/ui/resizable";
import { EnhancedChatPanel } from "@/components/enhanced-chat-panel";
import { EnhancedInteractionPanel } from "@/components/enhanced-interaction-panel";
import AccessibilityControls from "@/components/accessibility-controls";
import ChatHistoryModal from "@/components/chat-history-modal";
import CodePreviewPanel from "@/components/code-preview-panel";
import CodeMode from "@/components/code-mode";
import { useChatHistory } from "@/hooks/use-chat-history";
import { useEnhancedStreaming } from "@/hooks/use-enhanced-streaming";
import { useEnhancedMobile } from "@/hooks/use-enhanced-mobile";
import { voiceService } from "@/lib/voice/voice-service";
import { toast } from "sonner";
import type { LLMProvider } from "@/lib/api/llm-providers";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Wifi,
  WifiOff,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Zap,
  Clock,
  Activity,
  Smartphone,
  Monitor,
  Tablet,
} from "lucide-react";
import { cn } from "@/lib/utils";

export default function EnhancedConversationInterface() {
  // Enhanced mobile hook
  const mobile = useEnhancedMobile();

  // State management
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [showAccessibility, setShowAccessibility] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showCodePreview, setShowCodePreview] = useState(false);
  const [showCodeMode, setShowCodeMode] = useState(false);
  const [projectFiles, setProjectFiles] = useState<{ [key: string]: string }>({});
  const [pendingDiffs, setPendingDiffs] = useState<{ path: string; diff: string }[]>([]);
  const [commandsByFile, setCommandsByFile] = useState<Record<string, string[]>>({});
  const [availableProviders, setAvailableProviders] = useState<LLMProvider[]>([]);
  const [currentProvider, setCurrentProvider] = useState<string>("");
  const [currentModel, setCurrentModel] = useState<string>("");
  const [isVoiceEnabled, setIsVoiceEnabled] = useState(false);
  const [chatHistory, setChatHistory] = useState<ChatHistory[]>([]);
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);

  // Advertisement system
  const [promptCount, setPromptCount] = useState(0);
  const [showAd, setShowAd] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  // Refs
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const conversationRef = useRef<HTMLDivElement>(null);

  // Enhanced streaming with mobile optimizations
  const streaming = useEnhancedStreaming({
    enableOfflineSupport: mobile.device.isMobile,
    enableNetworkRecovery: true,
    onToken: (content) => {
      // Update the last message with new content
      setMessages(prev => {
        const newMessages = [...prev];
        const lastMessage = newMessages[newMessages.length - 1];

        if (lastMessage && lastMessage.role === 'assistant') {
          lastMessage.content += content;
        } else {
          // Create new assistant message
          newMessages.push({
            id: `msg-${Date.now()}`,
            role: 'assistant',
            content: content,
          });
        }

        return newMessages;
      });
    },
    onCommands: (commands) => {
      // Handle command processing
      if (commands.write_diffs) {
        setPendingDiffs(commands.write_diffs);
      }
      if (commands.request_files) {
        // Handle file requests
        console.log('Files requested:', commands.request_files);
      }
    },
    onError: (error) => {
      console.error('Streaming error:', error);
      // Show mobile-friendly error message
      if (mobile.device.isMobile) {
        toast.error('Connection lost. Tap to retry.', {
          action: {
            label: 'Retry',
            onClick: () => streaming.retry(),
          },
        });
      }
    },
    onComplete: () => {
      // Haptic feedback on completion
      mobile.hapticFeedback('light');

      // Auto-speak if enabled
      if (isVoiceEnabled && voiceService.getSettings().autoSpeak) {
        const lastMessage = messages[messages.length - 1];
        if (lastMessage && lastMessage.role === 'assistant') {
          voiceService.speak(lastMessage.content).catch(console.error);
        }
      }
    },
  });

  // Chat history management
  const {
    saveCurrentChat,
    loadChat,
    deleteChat,
    getAllChats,
    downloadAllHistory,
  } = useChatHistory();

  // ESC key handler for closing panels
  useEffect(() => {
    const handleEscKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (showAccessibility) {
          setShowAccessibility(false);
        } else if (showCodePreview) {
          setShowCodePreview(false);
        } else if (showHistory) {
          setShowHistory(false);
        }
      }
    };

    document.addEventListener('keydown', handleEscKey);
    return () => {
      document.removeEventListener('keydown', handleEscKey);
    };
  }, [showAccessibility, showCodePreview, showHistory]);

  // Load available providers on mount
  useEffect(() => {
    const loadProviders = async () => {
      try {
        const response = await fetch('/api/chat');
        const data = await response.json();

        if (data.success) {
          setAvailableProviders(data.data.providers);
          setCurrentProvider(data.data.defaultProvider);
          setCurrentModel(data.data.defaultModel);
          setIsVoiceEnabled(data.data.features.voiceEnabled);
        }
      } catch (error) {
        console.error('Failed to load providers:', error);
        toast.error('Failed to load AI providers');
      }
    };

    loadProviders();
  }, []);

  // Save chat history when messages change
  useEffect(() => {
    if (messages.length > 0 && !streaming.isStreaming) {
      const lastMessage = messages[messages.length - 1];
      if (lastMessage && lastMessage.role === 'assistant') {
        const savedChatId = saveCurrentChat(messages, currentConversationId || undefined);
        if (!currentConversationId && savedChatId) {
          setCurrentConversationId(savedChatId);
        }
      }
    }
  }, [messages, streaming.isStreaming, saveCurrentChat, currentConversationId]);

  // Extract commands from messages
  useEffect(() => {
    if (messages.length === 0) return;

    const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant');
    if (!lastAssistant || typeof lastAssistant.content !== 'string') return;

    const content = lastAssistant.content;
    const blocks = [...content.matchAll(/=== COMMANDS_START ===([\s\S]*?)=== COMMANDS_END ===/g)];
    if (blocks.length === 0) return;

    const newEntries: { path: string; diff: string }[] = [];
    for (const match of blocks) {
      const block = match[1];
      try {
        const diffsMatch = block.match(/write_diffs:\s*\[([\s\S]*?)\]/);
        if (diffsMatch) {
          const items = diffsMatch[1]
            .split(/},/)
            .map(s => (s.endsWith('}') ? s : s + '}'))
            .map(s => s.trim())
            .filter(Boolean);
          const write_diffs = items.map(raw => {
            const pathMatch = raw.match(/path:\s*"([^"]+)"/);
            const diffMatch = raw.match(/diff:\s*"([\s\S]*)"/);
            return {
              path: pathMatch?.[1] || '',
              diff: (diffMatch?.[1] || '').replace(/\\n/g, '\n')
            };
          });
          newEntries.push(...write_diffs);
        }
      } catch {
        // ignore parse errors
      }
    }

    if (newEntries.length === 0) return;

    setCommandsByFile(prev => {
      const next: Record<string, string[]> = { ...prev };
      for (const { path, diff } of newEntries) {
        if (!path) continue;
        const list = next[path] ? [...next[path]] : [];
        if (list.length === 0 || list[list.length - 1] !== diff) {
          list.push(diff);
          next[path] = list;
        }
      }
      return next;
    });
  }, [messages]);

  // Persist commands by conversation ID
  useEffect(() => {
    if (!currentConversationId) return;
    try {
      localStorage.setItem(`commands_diffs_${currentConversationId}`, JSON.stringify(commandsByFile));
    } catch {}
  }, [commandsByFile, currentConversationId]);

  // Load commands when switching conversations
  useEffect(() => {
    if (!currentConversationId) return;
    try {
      const raw = localStorage.getItem(`commands_diffs_${currentConversationId}`);
      if (raw) setCommandsByFile(JSON.parse(raw));
      else setCommandsByFile({});
    } catch {
      setCommandsByFile({});
    }
  }, [currentConversationId]);

  // Handle message submission
  const handleSubmit = useCallback(async (content: string) => {
    if (!content.trim() || streaming.isStreaming) return;

    // Add user message immediately
    const userMessage: Message = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: content.trim(),
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setPromptCount(prev => prev + 1);

    // Show ad logic (if needed)
    if (!isLoggedIn && promptCount > 0 && promptCount % 5 === 0) {
      setShowAd(true);
    }

    try {
      // Start streaming
      await streaming.startStreaming('/api/chat', {
        messages: [...messages, userMessage],
        provider: currentProvider,
        model: currentModel,
        stream: true,
      });
    } catch (error) {
      console.error('Failed to start streaming:', error);
      toast.error('Failed to send message');
    }
  }, [messages, currentProvider, currentModel, streaming, promptCount, isLoggedIn]);

  // Handle provider changes
  const handleProviderChange = useCallback((provider: string, model: string) => {
    setCurrentProvider(provider);
    setCurrentModel(model);
    mobile.hapticFeedback('selection');
  }, [mobile]);

  // Handle clear chat
  const handleClearChat = useCallback(() => {
    setMessages([]);
    setInput('');
    setCurrentConversationId(null);
    setCommandsByFile({});
    setPendingDiffs([]);
    streaming.clear();
    mobile.hapticFeedback('medium');
  }, [streaming, mobile]);

  // Handle history chat selection
  const handleSelectHistoryChat = useCallback((id: string) => {
    try {
      const chat = chatHistory.find(c => c.id === id);
      if (chat) {
        setMessages(chat.messages);
        setCurrentConversationId(id);
        setShowHistory(false);
        mobile.hapticFeedback('selection');
      }
    } catch (error) {
      console.error('Failed to load chat:', error);
      toast.error('Failed to load chat');
    }
  }, [chatHistory, mobile]);

  // Accept pending diffs
  const handleAcceptPendingDiffs = useCallback(() => {
    if (pendingDiffs.length === 0) return;

    // Apply diffs (implementation would depend on your file system)
    console.log('Applying diffs:', pendingDiffs);

    setPendingDiffs([]);
    mobile.hapticFeedback('success');
    toast.success(`Applied changes to ${pendingDiffs.length} file${pendingDiffs.length > 1 ? 's' : ''}`);
  }, [pendingDiffs, mobile]);

  // Dismiss pending diffs
  const handleDismissPendingDiffs = useCallback(() => {
    setPendingDiffs([]);
    mobile.hapticFeedback('light');
  }, [mobile]);

  // Device info display for desktop
  const DeviceInfo = () => (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      {mobile.device.isMobile ? (
        <Smartphone className="w-3 h-3" />
      ) : mobile.device.isTablet ? (
        <Tablet className="w-3 h-3" />
      ) : (
        <Monitor className="w-3 h-3" />
      )}
      <span>{mobile.device.width}×{mobile.device.height}</span>
      {mobile.device.isMobile && (
        <>
          <span>•</span>
          <span>{mobile.device.orientation}</span>
          {mobile.network.effectiveType !== 'unknown' && (
            <>
              <span>•</span>
              <span className="uppercase">{mobile.network.effectiveType}</span>
            </>
          )}
        </>
      )}
    </div>
  );

  // Streaming metrics display
  const StreamingMetrics = () => {
    if (!streaming.metrics) return null;

    return (
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        {streaming.metrics.timeToFirstToken > 0 && (
          <div className="flex items-center gap-1">
            <Zap className="w-3 h-3 text-blue-500" />
            <span>{streaming.metrics.timeToFirstToken}ms TTFT</span>
          </div>
        )}
        {streaming.metrics.tokensPerSecond > 0 && (
          <div className="flex items-center gap-1">
            <Activity className="w-3 h-3 text-green-500" />
            <span>{streaming.metrics.tokensPerSecond.toFixed(1)} t/s</span>
          </div>
        )}
        {streaming.metrics.totalTokens > 0 && (
          <div className="flex items-center gap-1">
            <Clock className="w-3 h-3 text-orange-500" />
            <span>{streaming.metrics.totalTokens} tokens</span>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className={cn(
      "relative w-full h-screen bg-black overflow-hidden",
      mobile.device.supportsTouch && "touch-pan-y"
    )}>
      {/* Background */}
      <div className="absolute inset-0 opacity-20">
        <div className="absolute inset-0 bg-gradient-to-br from-gray-900/30 via-black to-gray-800/20"></div>
        {!mobile.isReducedMotion && (
          <div className="absolute inset-0 animate-pulse-slow">
            <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-gray-700/10 rounded-full blur-3xl animate-float-slow"></div>
            <div className="absolute top-3/4 right-1/4 w-80 h-80 bg-gray-600/10 rounded-full blur-3xl animate-float-reverse"></div>
            <div className="absolute bottom-1/4 left-1/2 w-64 h-64 bg-gray-800/10 rounded-full blur-3xl animate-float-slow"></div>
          </div>
        )}
      </div>

      {/* Status Bar - Desktop */}
      {!mobile.device.isMobile && (
        <div className="absolute top-4 right-4 z-40 flex items-center gap-4 bg-black/40 backdrop-blur-sm border border-white/10 rounded-lg px-3 py-2">
          <DeviceInfo />
          <StreamingMetrics />
          {streaming.networkStatus !== 'online' && (
            <Badge variant={streaming.networkStatus === 'offline' ? 'destructive' : 'secondary'}>
              {streaming.networkStatus === 'offline' ? (
                <WifiOff className="w-3 h-3 mr-1" />
              ) : (
                <RefreshCw className="w-3 h-3 mr-1 animate-spin" />
              )}
              {streaming.networkStatus}
            </Badge>
          )}
        </div>
      )}

      <div className={cn(
        "flex h-full min-h-0",
        mobile.device.isMobile ? "flex-col" : "flex-row"
      )}>
        {/* Main content area - hidden on mobile when chat is active */}
        {!mobile.device.isMobile && (
          <div className="flex-1 flex-col hidden md:flex">
            <div className="flex-1 relative">
              {/* Placeholder for 3D scene or main content */}
              <canvas
                ref={canvasRef}
                className="absolute inset-0 w-full h-full opacity-30"
              />
            </div>
          </div>
        )}

        {/* Chat Panel */}
        <div className={cn(
          "relative z-10 flex flex-col min-h-0",
          mobile.device.isMobile
            ? "flex-1"
            : "flex-initial md:border-l md:border-white/10 w-96 lg:w-[480px]"
        )}>
          {/* Header */}
          {!mobile.device.isMobile && (
            <div className="border-b border-white/10 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-white font-medium">AI Assistant</h2>
                  <p className="text-gray-400 text-sm">
                    {currentProvider && currentModel && (
                      <>
                        {availableProviders.find(p => p.id === currentProvider)?.name} • {currentModel}
                      </>
                    )}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setShowHistory(true)}
                    className="text-gray-400 hover:text-white"
                  >
                    <Badge variant="secondary" className="mr-2">
                      {messages.length}
                    </Badge>
                    History
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* Enhanced Chat Panel */}
          <EnhancedChatPanel
            messages={messages}
            input={input}
            handleSubmit={() => {}} // Handled by interaction panel
            isLoading={streaming.isStreaming || streaming.isConnecting}
            error={streaming.error}
            isStreaming={streaming.isStreaming}
            onStopGeneration={streaming.stop}
            setInput={setInput}
            availableProviders={availableProviders}
            onClearChat={handleClearChat}
            onShowHistory={() => setShowHistory(true)}
            currentConversationId={currentConversationId}
            onSelectHistoryChat={handleSelectHistoryChat}
            currentProvider={currentProvider}
            currentModel={currentModel}
            voiceEnabled={isVoiceEnabled}
            onVoiceToggle={setIsVoiceEnabled}
            onProviderChange={handleProviderChange}
          />
        </div>
      </div>

      {/* Enhanced Interaction Panel */}
      <EnhancedInteractionPanel
        onSubmit={handleSubmit}
        onNewChat={handleClearChat}
        isProcessing={streaming.isStreaming || streaming.isConnecting}
        toggleAccessibility={() => setShowAccessibility(!showAccessibility)}
        toggleHistory={() => setShowHistory(!showHistory)}
        toggleCodePreview={() => setShowCodePreview(!showCodePreview)}
        onStopGeneration={streaming.stop}
        onRetry={streaming.retry}
        currentProvider={currentProvider}
        currentModel={currentModel}
        availableProviders={availableProviders}
        onProviderChange={handleProviderChange}
        pendingDiffs={pendingDiffs}
        onAcceptPendingDiffs={handleAcceptPendingDiffs}
        onDismissPendingDiffs={handleDismissPendingDiffs}
        networkStatus={streaming.networkStatus}
        autosuggestEnabled={true}
        voiceEnabled={isVoiceEnabled}
        onVoiceToggle={setIsVoiceEnabled}
      />

      {/* Overlays */}
      {showAccessibility && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm">
          <AccessibilityControls
            onClose={() => setShowAccessibility(false)}
            messages={messages}
            voiceEnabled={isVoiceEnabled}
            onVoiceToggle={setIsVoiceEnabled}
            isProcessing={streaming.isStreaming}
            isMobile={mobile.device.isMobile}
          />
        </div>
      )}

      {showHistory && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm">
          <ChatHistoryModal
            isOpen={showHistory}
            onClose={() => setShowHistory(false)}
            onSelectChat={handleSelectHistoryChat}
            onDeleteChat={deleteChat}
            isMobile={mobile.device.isMobile}
          />
        </div>
      )}

      {showCodePreview && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm">
          <CodePreviewPanel
            isOpen={showCodePreview}
            onClose={() => setShowCodePreview(false)}
            messages={messages}
            isMobile={mobile.device.isMobile}
          />
        </div>
      )}

      {showCodeMode && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm">
          <CodeMode
            isVisible={showCodeMode}
            onClose={() => setShowCodeMode(false)}
            pendingDiffs={commandsByFile}
            onApplyDiff={handleAcceptPendingDiffs}
            files={projectFiles}
            onUpdateFile={(path, content) =>
              setProjectFiles(prev => ({ ...prev, [path]: content }))
            }
            isMobile={mobile.device.isMobile}
          />
        </div>
      )}

      {/* Advertisement Modal */}
      {showAd && !isLoggedIn && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-md w-full">
            <h3 className="text-lg font-semibold mb-4">Enjoying the experience?</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
              Sign up for unlimited conversations and advanced features.
            </p>
            <div className="flex gap-3">
              <Button onClick={() => setShowAd(false)} className="flex-1">
                Sign Up
              </Button>
              <Button
                variant="outline"
                onClick={() => setShowAd(false)}
                className="flex-1"
              >
                Continue
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Network Recovery Toast Area */}
      {mobile.device.isMobile && !mobile.network.isOnline && (
        <div className="fixed bottom-32 left-4 right-4 z-40">
          <div className="bg-red-500 text-white px-4 py-3 rounded-lg shadow-lg flex items-center justify-between">
            <div className="flex items-center gap-2">
              <WifiOff className="w-4 h-4" />
              <span className="text-sm font-medium">Offline</span>
            </div>
            {streaming.canRetry && (
              <Button
                size="sm"
                variant="ghost"
                onClick={streaming.retry}
                className="text-white hover:bg-white/20 h-auto py-1 px-2"
              >
                <RefreshCw className="w-3 h-3 mr-1" />
                Retry
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
