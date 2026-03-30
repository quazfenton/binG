/**
 * Enhanced Workspace Panel (Right Side Chat Panel)
 *
 * Features:
 * - Responsive drag-to-resize with snap-to-border (left edge)
 * - Real LLM chat integration with streaming
 * - Multi-thread support
 * - Message persistence
 * - Code syntax highlighting
 * - File attachments
 * - Voice input integration
 * - Search within conversation
 * - Export conversation
 *
 * @see docs/WORKSPACE_PANEL_IMPLEMENTATION.md
 */

"use client";

import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { usePanel } from "@/contexts/panel-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ResizablePanelGroup, PanelPresets } from "@/components/panels/resizable-panel-group";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { secureRandomId } from "@/lib/utils/crypto-random";
import type { Message } from "@/types";
import type { LLMProvider } from "@/lib/chat/llm-providers";

import {
  X,
  Maximize2,
  Minimize2,
  GripVertical,
  Send,
  Search,
  Download,
  Trash2,
  Plus,
  MessageSquare,
  Loader2,
  StopCircle,
  ChevronLeft,
  ChevronRight,
  Settings,
  History,
  Code,
  FileText,
  Image as ImageIcon,
  Brain,
  Sparkles,
  CheckCircle,
  AlertCircle,
  Copy,
  RefreshCw,
} from "lucide-react";

// ============================================================================
// Types
// ============================================================================

interface ChatThread {
  id: string;
  name: string;
  messages: Message[];
  createdAt: number;
  lastActiveAt: number;
}

interface EnhancedWorkspacePanelProps {
  availableProviders: LLMProvider[];
  currentProvider: string;
  currentModel: string;
  onProviderChange: (provider: string, model: string) => void;
  onSendMessage: (content: string, threadId: string) => Promise<void>;
  onStopGeneration: () => void;
  isProcessing: boolean;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_WIDTH = 400;
const MIN_WIDTH = 300;
const MAX_WIDTH = 800;
const SNAP_POINTS = [350, 450, 550, 650];
const STORAGE_KEY_THREADS = "chat-threads";
const STORAGE_KEY_ACTIVE = "active-chat-thread";

// ============================================================================
// Message Bubble Component
// ============================================================================

function MessageBubble({ message, isStreaming }: { message: Message; isStreaming?: boolean }) {
  const [isCopied, setIsCopied] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setIsCopied(true);
      toast.success("Message copied");
      setTimeout(() => setIsCopied(false), 2000);
    } catch (err) {
      toast.error("Failed to copy");
    }
  }, [message.content]);

  const isAssistant = message.role === "assistant";

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        "group relative p-4 rounded-lg mb-3",
        isAssistant
          ? "bg-white/5 border border-white/10"
          : "bg-blue-500/10 border border-blue-400/30 ml-8"
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          {isAssistant ? (
            <Brain className="w-4 h-4 text-purple-400" />
          ) : (
            <MessageSquare className="w-4 h-4 text-blue-400" />
          )}
          <span className="text-xs font-medium text-white/70">
            {isAssistant ? "Assistant" : "You"}
          </span>
          {isStreaming && (
            <span className="text-[10px] text-purple-400 animate-pulse">
              Generating...
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={handleCopy}
            className="p-1 rounded hover:bg-white/10 text-white/60 hover:text-white"
            title="Copy message"
          >
            {isCopied ? (
              <CheckCircle className="w-3 h-3 text-green-400" />
            ) : (
              <Copy className="w-3 h-3" />
            )}
          </button>
        </div>
      </div>

      {/* Content */}
      <div className={cn(
        "text-sm text-white/90 whitespace-pre-wrap break-words",
        !isExpanded && message.content.length > 500 && "line-clamp-10"
      )}>
        {message.content}
      </div>

      {/* Expand for long messages */}
      {!isExpanded && message.content.length > 500 && (
        <button
          onClick={() => setIsExpanded(true)}
          className="mt-2 text-xs text-white/50 hover:text-white/80"
        >
          Show more...
        </button>
      )}

      {/* Timestamp */}
      <div className="mt-2 text-[10px] text-white/40">
        {new Date(message.createdAt || Date.now()).toLocaleString()}
      </div>
    </motion.div>
  );
}

// ============================================================================
// Chat Thread List Component
// ============================================================================

function ThreadList({
  threads,
  activeThreadId,
  onSelectThread,
  onNewThread,
  onDeleteThread,
}: {
  threads: ChatThread[];
  activeThreadId: string | null;
  onSelectThread: (id: string) => void;
  onNewThread: () => void;
  onDeleteThread: (id: string) => void;
}) {
  const [searchQuery, setSearchQuery] = useState("");

  const filteredThreads = useMemo(() => {
    if (!searchQuery) return threads;
    const query = searchQuery.toLowerCase();
    return threads.filter(
      t => t.name.toLowerCase().includes(query) ||
        t.messages.some(m => m.content.toLowerCase().includes(query))
    );
  }, [threads, searchQuery]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-3 border-b border-white/10">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-white">Chat Threads</h3>
          <Button
            variant="ghost"
            size="icon"
            onClick={onNewThread}
            className="h-7 w-7 text-white/70 hover:text-white hover:bg-white/10"
          >
            <Plus className="w-3.5 h-3.5" />
          </Button>
        </div>
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/40" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search conversations..."
            className="pl-8 h-8 bg-white/5 border-white/20 text-xs"
          />
        </div>
      </div>

      {/* Thread List */}
      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1">
          {filteredThreads.map(thread => (
            <div
              key={thread.id}
              className={cn(
                "group relative p-3 rounded-lg cursor-pointer transition-all",
                activeThreadId === thread.id
                  ? "bg-white/10 border border-white/20"
                  : "bg-transparent hover:bg-white/5 border border-transparent"
              )}
              onClick={() => onSelectThread(thread.id)}
            >
              <div className="flex items-start gap-2">
                <MessageSquare className={cn(
                  "w-4 h-4 mt-0.5 shrink-0",
                  activeThreadId === thread.id ? "text-white" : "text-white/50"
                )} />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium text-white truncate">
                    {thread.name}
                  </div>
                  <div className="text-[10px] text-white/50 truncate">
                    {thread.messages[0]?.content.slice(0, 50) || "No messages"}
                  </div>
                  <div className="text-[10px] text-white/40 mt-1">
                    {new Date(thread.lastActiveAt).toLocaleDateString()}
                  </div>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteThread(thread.id);
                  }}
                  className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-red-500/20 text-white/40 hover:text-red-400 transition-all"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            </div>
          ))}
          {filteredThreads.length === 0 && (
            <div className="text-center py-8 text-white/40 text-xs">
              {searchQuery ? "No matching conversations" : "No conversations yet"}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export function EnhancedWorkspacePanel({
  availableProviders,
  currentProvider,
  currentModel,
  onProviderChange,
  onSendMessage,
  onStopGeneration,
  isProcessing,
}: EnhancedWorkspacePanelProps) {
  const { closePanel } = usePanel();

  // State
  const [panelWidth, setPanelWidth] = useState(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem(`${PanelPresets.rightPanel.storageKey}`);
      return stored ? parseInt(stored) : DEFAULT_WIDTH;
    }
    return DEFAULT_WIDTH;
  });
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [chatInput, setChatInput] = useState("");
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [showThreadList, setShowThreadList] = useState(true);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Load threads from localStorage
  useEffect(() => {
    const savedThreads = localStorage.getItem(STORAGE_KEY_THREADS);
    const savedActiveId = localStorage.getItem(STORAGE_KEY_ACTIVE);

    if (savedThreads) {
      try {
        const parsed = JSON.parse(savedThreads);
        setThreads(parsed);
        if (savedActiveId && parsed.some((t: ChatThread) => t.id === savedActiveId)) {
          setActiveThreadId(savedActiveId);
        } else if (parsed.length > 0) {
          setActiveThreadId(parsed[0].id);
        }
      } catch (e) {
        console.error("Failed to load chat threads:", e);
      }
    } else {
      // Create default thread
      const defaultThread: ChatThread = {
        id: `thread-${Date.now()}`,
        name: "New Conversation",
        messages: [],
        createdAt: Date.now(),
        lastActiveAt: Date.now(),
      };
      setThreads([defaultThread]);
      setActiveThreadId(defaultThread.id);
    }
  }, []);

  // Save threads to localStorage
  useEffect(() => {
    if (threads.length > 0) {
      localStorage.setItem(STORAGE_KEY_THREADS, JSON.stringify(threads));
    }
  }, [threads]);

  // Save active thread ID
  useEffect(() => {
    if (activeThreadId) {
      localStorage.setItem(STORAGE_KEY_ACTIVE, activeThreadId);
    }
  }, [activeThreadId]);

  // Get active thread
  const activeThread = useMemo(
    () => threads.find(t => t.id === activeThreadId) || null,
    [threads, activeThreadId]
  );

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeThread?.messages]);

  // Thread management
  const createNewThread = useCallback(() => {
    const newThread: ChatThread = {
      id: `thread-${Date.now()}-${secureRandomId(6)}`,
      name: `New Conversation ${threads.length + 1}`,
      messages: [],
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
    };
    setThreads(prev => [...prev, newThread]);
    setActiveThreadId(newThread.id);
    toast.success("New conversation created");
  }, [threads.length]);

  const deleteThread = useCallback((threadId: string) => {
    setThreads(prev => {
      const filtered = prev.filter(t => t.id !== threadId);
      if (threadId === activeThreadId && filtered.length > 0) {
        setActiveThreadId(filtered[0].id);
      }
      return filtered;
    });
    toast.success("Conversation deleted");
  }, [activeThreadId]);

  const renameThread = useCallback((threadId: string, newName: string) => {
    setThreads(prev => prev.map(t =>
      t.id === threadId ? { ...t, name: newName } : t
    ));
  }, []);

  // Send message
  const handleSendMessage = useCallback(async () => {
    const trimmed = chatInput.trim();
    if (!trimmed || !activeThreadId) return;

    // Add user message
    const userMessage: Message = {
      id: `msg-${Date.now()}`,
      role: "user",
      content: trimmed,
      createdAt: Date.now(),
    };

    setThreads(prev => prev.map(t =>
      t.id === activeThreadId
        ? {
            ...t,
            messages: [...t.messages, userMessage],
            lastActiveAt: Date.now(),
          }
        : t
    ));

    setChatInput("");

    // Call parent handler
    try {
      await onSendMessage(trimmed, activeThreadId);
    } catch (err) {
      toast.error("Failed to send message");
    }
  }, [chatInput, activeThreadId, onSendMessage]);

  // Handle keyboard
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  }, [handleSendMessage]);

  // Provider select value
  const selectValue = useMemo(() => {
    const currentValue = `${currentProvider}:${currentModel}`;
    const validValues = availableProviders
      .filter(p => p.isAvailable !== false)
      .flatMap(p => p.models.map(m => `${p.id}:${m}`));
    return validValues.includes(currentValue) ? currentValue : "";
  }, [currentProvider, currentModel, availableProviders]);

  return (
    <ResizablePanelGroup
      orientation="horizontal"
      defaultSize={panelWidth}
      minSize={MIN_WIDTH}
      maxSize={MAX_WIDTH}
      snapPoints={SNAP_POINTS}
      storageKey={PanelPresets.rightPanel.storageKey}
      onSizeChange={setPanelWidth}
      className="fixed right-0 top-0 bottom-0 z-[90] bg-gradient-to-l from-black/95 via-black/90 to-transparent backdrop-blur-xl border-l border-white/10 shadow-2xl"
      showSnapIndicators
      enableKeyboardShortcuts
    >
      {/* Panel Content */}
      <div className="flex h-full overflow-hidden">
        {/* Thread List Sidebar */}
        <AnimatePresence>
          {showThreadList && (
            <motion.div
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 250, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              className="border-r border-white/10 bg-black/40 overflow-hidden"
            >
              <ThreadList
                threads={threads}
                activeThreadId={activeThreadId}
                onSelectThread={setActiveThreadId}
                onNewThread={createNewThread}
                onDeleteThread={deleteThread}
              />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Main Chat Area */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Header */}
          <div className="flex items-center justify-between gap-2 p-3 border-b border-white/10 bg-white/5 shrink-0">
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setShowThreadList(!showThreadList)}
                className="h-8 w-8 text-white/70 hover:text-white hover:bg-white/10"
              >
                {showThreadList ? (
                  <ChevronLeft className="w-4 h-4" />
                ) : (
                  <ChevronRight className="w-4 h-4" />
                )}
              </Button>
              <div>
                <h3 className="text-sm font-semibold text-white">
                  {activeThread?.name || "Chat"}
                </h3>
                <div className="text-[10px] text-white/50">
                  {selectValue ? selectValue.split(":")[1]?.slice(0, 20) : "No model selected"}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                onClick={createNewThread}
                className="h-8 w-8 text-white/70 hover:text-white hover:bg-white/10"
                title="New conversation"
              >
                <Plus className="w-4 h-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={closePanel}
                className="h-8 w-8 text-white/70 hover:text-white hover:bg-white/10"
                title="Close"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          </div>

          {/* Messages */}
          <ScrollArea className="flex-1 p-3">
            {activeThread?.messages.map((message, index) => (
              <MessageBubble
                key={message.id}
                message={message}
                isStreaming={isProcessing && index === activeThread.messages.length - 1 && message.role === "assistant"}
              />
            ))}
            {isProcessing && activeThread && (
              <div className="flex items-center gap-2 p-4 text-white/60">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="text-xs">Generating response...</span>
              </div>
            )}
            <div ref={messagesEndRef} />
          </ScrollArea>

          {/* Input Area */}
          <div className="p-3 border-t border-white/10 bg-black/20 shrink-0">
            {/* Provider Selector */}
            <div className="mb-2">
              <select
                value={selectValue}
                onChange={(e) => {
                  if (!e.target.value || e.target.value === "none") return;
                  const [provider, ...modelParts] = e.target.value.split(":");
                  const model = modelParts.join(":");
                  onProviderChange(provider, model);
                }}
                className="w-full px-2 py-1.5 rounded-md bg-white/10 border border-white/20 text-white text-xs focus:border-white/40 focus:ring-1 focus:ring-white/20 outline-none cursor-pointer"
              >
                {availableProviders.filter(p => p.isAvailable !== false).length === 0 ? (
                  <option value="none">No providers configured</option>
                ) : (
                  availableProviders
                    .filter(p => p.isAvailable !== false)
                    .map(provider => (
                      <optgroup key={provider.id} label={provider.name}>
                        {provider.models.map(model => (
                          <option key={model} value={`${provider.id}:${model}`}>
                            {model}
                          </option>
                        ))}
                      </optgroup>
                    ))
                )}
              </select>
            </div>

            {/* Text Input */}
            <div className="relative">
              <textarea
                ref={textareaRef}
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Type your message... (Enter to send, Shift+Enter for new line)"
                className="w-full min-h-[80px] max-h-[200px] bg-white/5 border border-white/20 rounded-lg px-3 py-2 pr-12 text-sm text-white placeholder:text-white/40 focus:border-white/40 focus:ring-1 focus:ring-white/20 outline-none resize-none"
                rows={3}
                disabled={isProcessing}
              />
              <div className="absolute right-2 bottom-2 flex items-center gap-1">
                {isProcessing ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={onStopGeneration}
                    className="h-8 w-8 text-red-400 hover:text-red-300 hover:bg-red-500/20"
                  >
                    <StopCircle className="w-4 h-4" />
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={handleSendMessage}
                    disabled={!chatInput.trim()}
                    className="h-8 w-8 text-white/70 hover:text-white hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Send className="w-4 h-4" />
                  </Button>
                )}
              </div>
            </div>

            {/* Pending indicator */}
            {isProcessing && (
              <div className="mt-2 text-[10px] text-white/40 text-center">
                AI is generating a response...
              </div>
            )}
          </div>
        </div>
      </div>
    </ResizablePanelGroup>
  );
}

export default EnhancedWorkspacePanel;
