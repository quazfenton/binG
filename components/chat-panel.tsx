"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { type Message } from "ai/react"; // Only import Message type, useChat is now in parent
import { toast } from "sonner";
import { useVoiceInput } from "@/hooks/use-voice-input";
import MessageBubble from "@/components/message-bubble";
import AccessibilityControls from "@/components/accessibility-controls";
import CodePreviewPanel from "@/components/code-preview-panel";
import { LLMProvider } from "@/types";

interface ChatPanelProps {
  // Props from useChat in parent (ConversationInterface)
  messages: Message[];
  input: string;
  handleSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
  isLoading: boolean;
  error: Error | undefined;
  isStreaming: boolean;
  onStopGeneration: () => void;
  setInput: (value: string) => void; // Add setInput prop

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

export function ChatPanel({
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
  setInput, // Destructure setInput
  onProviderChange,
}: ChatPanelProps) {
  const { isListening, startListening, stopListening, transcript } =
    useVoiceInput();

  const [isCodePreviewOpen, setIsCodePreviewOpen] = useState(false);
  const [isAccessibilityOptionsOpen, setIsAccessibilityOptionsOpen] = useState(false); // State to control accessibility options visibility
  const [isUserScrolledUp, setIsUserScrolledUp] = useState(false);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Handle scroll position tracking
  const handleScroll = useCallback(() => {
    if (!scrollContainerRef.current) return;
    
    const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 50; // 50px threshold
    
    setIsUserScrolledUp(!isAtBottom);
    setShowJumpToLatest(!isAtBottom);
  }, []);

  // Auto-scroll only if user is at bottom or it's a new conversation
  useEffect(() => {
    if (!isUserScrolledUp || messages.length <= 1) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isUserScrolledUp]);

  // Jump to latest function
  const jumpToLatest = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    setIsUserScrolledUp(false);
    setShowJumpToLatest(false);
  }, []);

  useEffect(() => {
    if (transcript) {
      setInput(transcript); // Use setInput directly
    }
  }, [transcript, setInput]);

  // This function now takes the content string directly from InteractionPanel
  const handleUserMessageSubmit = (content: string) => {
    setInput(content); // Use setInput directly
    // Trigger the parent's handleSubmit
    handleSubmit(new Event('submit') as unknown as React.FormEvent<HTMLFormElement>);
  };

  // Handler for the accessibility button in InteractionPanel
  const handleToggleAccessibilityOptions = () => {
    setIsAccessibilityOptionsOpen(prevState => {
      const newState = !prevState;
      return newState; // Return the new state
    });
  };

  const toggleCodePreview = () => {
    setIsCodePreviewOpen(prev => !prev);
  };

  return (
    <div className="flex flex-col h-full relative min-h-0">
      <div 
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto p-2 sm:p-4 space-y-2 overscroll-contain touch-pan-y" 
        style={{ 
          paddingBottom: "120px",
          WebkitOverflowScrolling: "touch",
          scrollBehavior: "smooth"
        }}
        onScroll={handleScroll}
      >
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
            <p className="text-lg">Start a conversation</p>
            <p className="text-sm">Type a message or use voice input</p>
          </div>
        )}

        {messages.map((m: Message) => (
          <MessageBubble
            key={m.id}
            message={m}
            isStreaming={isLoading && m.id === messages[messages.length - 1]?.id}
          />
        ))}
        {isLoading && (
          <MessageBubble
            message={{ id: "loading", role: "assistant", content: "..." }}
            isStreaming={true}
          />
        )}
        <div ref={messagesEndRef} />
        {/* Extra padding div for better scrolling */}
        <div className="h-20" />
      </div>

      {/* Jump to Latest Button */}
      {showJumpToLatest && (
        <div className="absolute bottom-64 right-6 z-10">
          <button
            onClick={jumpToLatest}
            className="bg-black/60 hover:bg-black/80 backdrop-blur-sm border border-white/20 text-white p-2 rounded-full shadow-lg transition-all duration-200 flex items-center gap-2"
            title="Jump to latest message"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
            </svg>
          </button>
        </div>
      )}

      {/* Conditionally render AccessibilityControls as overlay */}
      {isAccessibilityOptionsOpen && (
        <div className="absolute inset-0 z-50">
          <AccessibilityControls
            onClose={handleToggleAccessibilityOptions}
            messages={messages}
            voiceEnabled={voiceEnabled}
            onVoiceToggle={onVoiceToggle}
            isProcessing={isLoading}
          />
        </div>
      )}

      <CodePreviewPanel
        isOpen={isCodePreviewOpen}
        onClose={() => setIsCodePreviewOpen(false)}
        messages={messages}
      />
    </div>
  );
}
