"use client";

import { useEffect, useRef, useState } from "react";
import { type Message } from "ai/react"; // Only import Message type, useChat is now in parent
import { toast } from "sonner";
import { useVoiceInput } from "@/hooks/use-voice-input";
import MessageBubble from "@/components/message-bubble";
import AccessibilityControls from "@/components/accessibility-controls";
import CodePreviewPanel from "@/components/code-preview-panel";
import InteractionPanel from "@/components/interaction-panel";
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
  onStartGestureDetection: () => void; // Passed to AccessibilityControls
  onStopGestureDetection: () => void; // Passed to AccessibilityControls
  currentConversationId: string | null;
  onSelectHistoryChat: (id: string) => void;
  // Props for InteractionPanel
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
  onStartGestureDetection,
  onStopGestureDetection,
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

  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

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

  const handleCodeGeneration = () => {
    setIsCodePreviewOpen(true);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-4 space-y-4" style={{ paddingBottom: "200px" }}>
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
          />
        ))}
        {isLoading && (
          <MessageBubble
            message={{ id: "loading", role: "assistant", content: "..." }}
            isStreaming={isStreaming}
          />
        )}
        <div ref={messagesEndRef} />
      </div>

      <InteractionPanel
        onSubmit={handleUserMessageSubmit}
        onNewChat={onClearChat}
        isProcessing={isLoading}
        toggleAccessibility={onStartGestureDetection}
        toggleHistory={onShowHistory}
        onStopGeneration={onStopGeneration}
        currentProvider={currentProvider}
        currentModel={currentModel}
        error={error?.message}
        input={input}
        setInput={setInput}
        availableProviders={availableProviders}
        onProviderChange={onProviderChange}
        voiceEnabled={voiceEnabled}
        onVoiceToggle={onVoiceToggle}
      />

      <CodePreviewPanel
        isOpen={isCodePreviewOpen}
        onClose={() => setIsCodePreviewOpen(false)}
        messages={messages}
      />
    </div>
  );
}
