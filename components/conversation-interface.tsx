"use client";

import { useState, useRef, Suspense, useEffect } from "react";
import InteractionPanel from "@/components/interaction-panel";
import AccessibilityControls from "@/components/accessibility-controls";
import ChatHistoryModal from "@/components/chat-history-modal";
import ChatPanel from "@/components/chat-panel";
import CodePreviewPanel from "@/components/code-preview-panel";
import { useConversation } from "@/hooks/use-conversation";
import { useChatHistory } from "@/hooks/use-chat-history";
import { voiceService } from "@/lib/voice/voice-service";
import { toast } from "sonner";
import type { LLMProvider } from "@/lib/api/llm-providers";

export default function ConversationInterface() {
  const [showAccessibility, setShowAccessibility] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showChatPanel, setShowChatPanel] = useState(true);
  const [showCodePreview, setShowCodePreview] = useState(false);
  const [availableProviders, setAvailableProviders] = useState<LLMProvider[]>(
    [],
  );
  const [isVoiceEnabled, setIsVoiceEnabled] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const {
    messages,
    addMessage,
    isProcessing,
    isStreaming,
    error,
    thoughtProcess,
    conversationContext,
    conversationMood,
    clearMessages,
    settings,
    updateSettings,
    stopGeneration,
    getCurrentStreamingMessage,
  } = useConversation();

  const {
    saveCurrentChat,
    loadChat,
    deleteChat,
    getAllChats,
    downloadAllHistory,
  } = useChatHistory();

  // Fetch available providers on mount
  useEffect(() => {
    fetch("/api/chat")
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          setAvailableProviders(data.data.providers);
          // Set default provider if none selected
          if (!settings.provider && data.data.providers.length > 0) {
            const defaultProvider = data.data.providers[0];
            updateSettings({
              provider: defaultProvider.id,
              model: defaultProvider.models[0],
            });
          }
        }
      })
      .catch((error) => {
        console.error("Failed to fetch providers:", error);
        toast.error(
          "Failed to load AI providers. Check your API configuration.",
        );
      });
  }, [settings.provider, updateSettings]);

  // Handle voice service events
  useEffect(() => {
    const handleVoiceEvent = (event: any) => {
      switch (event.type) {
        case "transcription":
          if (event.data.isFinal && event.data.text.trim()) {
            addMessage({
              role: "user",
              content: event.data.text.trim(),
            });
          }
          break;
        case "error":
          toast.error(`Voice error: ${event.data.message}`);
          break;
        case "connected":
          toast.success("Voice service connected");
          break;
        case "disconnected":
          toast.info("Voice service disconnected");
          break;
      }
    };

    voiceService.addEventListener(handleVoiceEvent);
    return () => voiceService.removeEventListener(handleVoiceEvent);
  }, [addMessage]);

  // Show error notifications
  useEffect(() => {
    if (error) {
      toast.error(error);
    }
  }, [error]);

  const handleNewChat = () => {
    if (messages.length > 0) {
      saveCurrentChat(messages);
    }
    stopGeneration();
    clearMessages();
    toast.success("New chat started");
  };

  const handleLoadChat = (chatId: string) => {
    const chat = loadChat(chatId);
    if (chat) {
      stopGeneration();
      clearMessages();
      // Load messages one by one to trigger animations
      chat.messages.forEach((message, index) => {
        setTimeout(() => {
          addMessage(message, false); // false = don't trigger AI response
        }, index * 100);
      });
      toast.success("Chat loaded");
    }
    setShowHistory(false);
  };

  const handleProviderChange = (provider: string, model: string) => {
    updateSettings({ provider, model });
    toast.success(`Switched to ${provider} - ${model}`);
  };

  const handleVoiceToggle = (enabled: boolean) => {
    setIsVoiceEnabled(enabled);
    const voiceSettings = voiceService.getSettings();
    voiceService.updateSettings({
      ...voiceSettings,
      enabled,
      autoSpeak: enabled,
      microphoneEnabled: enabled,
      transcriptionEnabled: enabled,
    });

    if (enabled) {
      toast.success("Voice features enabled");
    } else {
      toast.info("Voice features disabled");
      voiceService.stopSpeaking();
      voiceService.stopListening();
    }
  };

  const handleToggleCodePreview = () => {
    setShowCodePreview(!showCodePreview);
    if (!showCodePreview) {
      toast.success("Code preview panel opened");
    }
  };

  // Get display messages (including streaming)
  const displayMessages = [...messages];
  const streamingMessage = getCurrentStreamingMessage();
  if (streamingMessage) {
    displayMessages.push(streamingMessage);
  }

  return (
    <div className="relative w-full h-screen bg-black overflow-hidden">

      {/* 2D Chat Panel */}
      {showChatPanel && (
        <ChatPanel
          messages={displayMessages}
          isProcessing={isProcessing || isStreaming}
          onProviderChange={handleProviderChange}
          onVoiceToggle={handleVoiceToggle}
          onVisibilityToggle={setShowChatPanel}
          selectedProvider={settings.provider}
          selectedModel={settings.model}
          voiceEnabled={isVoiceEnabled}
          visible={showChatPanel}
          onToggleCodePreview={handleToggleCodePreview}
        />
      )}

      {/* Interaction Controls */}
      <InteractionPanel
        onSubmit={addMessage}
        onNewChat={handleNewChat}
        isProcessing={isProcessing || isStreaming}
        conversationContext={conversationContext}
        toggleAccessibility={() => setShowAccessibility(!showAccessibility)}
        toggleHistory={() => setShowHistory(!showHistory)}
        onStopGeneration={stopGeneration}
        showChatPanel={showChatPanel}
        onToggleChatPanel={() => setShowChatPanel(!showChatPanel)}
        currentProvider={settings.provider}
        currentModel={settings.model}
        error={error}
      />

      {/* Chat History Modal */}
      {showHistory && (
        <ChatHistoryModal
          onClose={() => setShowHistory(false)}
          onLoadChat={handleLoadChat}
          onDeleteChat={deleteChat}
          onDownloadAll={downloadAllHistory}
          chats={getAllChats()}
        />
      )}

      {/* Code Preview Panel */}
      <CodePreviewPanel
        messages={displayMessages}
        isOpen={showCodePreview}
        onClose={() => setShowCodePreview(false)}
      />

      {/* Accessibility Layer */}
      {showAccessibility && (
        <AccessibilityControls
          onClose={() => setShowAccessibility(false)}
          messages={displayMessages}
          isProcessing={isProcessing || isStreaming}
          voiceEnabled={isVoiceEnabled}
          onVoiceToggle={handleVoiceToggle}
        />
      )}

      {/* Ambient Mood Indicator */}
      <div
        className="absolute bottom-4 right-4 w-16 h-16 rounded-full opacity-50 pointer-events-none"
        style={{
          background: `radial-gradient(circle, ${conversationMood.color} 0%, rgba(0,0,0,0) 70%)`,
          animation: "pulse 2s infinite",
        }}
      />
    </div>
  );
}
