"use client";

import { useState, useRef, Suspense, useEffect, useCallback } from "react"; // Import useCallback
import { useChat, type Message } from "ai/react"; // Import useChat and Message type
import type { ChatHistory } from "@/types";
import {
  ResizablePanel,
  ResizablePanelGroup,
  ResizableHandle,
} from "@/components/ui/resizable";
import InteractionPanel from "@/components/interaction-panel";
import AccessibilityControls from "@/components/accessibility-controls";
import ChatHistoryModal from "@/components/chat-history-modal";
import { ChatPanel } from "@/components/chat-panel";
import CodePreviewPanel from "@/components/code-preview-panel";
// import { useConversation } from "@/hooks/use-conversation"; // No longer needed
import { useChatHistory } from "@/hooks/use-chat-history";
import { voiceService } from "@/lib/voice/voice-service";
import { toast } from "sonner";
import type { LLMProvider } from "@/lib/api/llm-providers";

export default function ConversationInterface() {
  const [showAccessibility, setShowAccessibility] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showCodePreview, setShowCodePreview] = useState(false);
  const [availableProviders, setAvailableProviders] = useState<LLMProvider[]>(
    [],
  );
  const [currentProvider, setCurrentProvider] = useState<string>("");
  const [currentModel, setCurrentModel] = useState<string>("");
  const [isVoiceEnabled, setIsVoiceEnabled] = useState(false);
  const [chatHistory, setChatHistory] = useState<ChatHistory[]>([]);
  const canvasRef = useRef<HTMLCanvasElement>(null); // This ref is not used in this component, consider removing if not needed elsewhere

  const {
    messages,
    input,
    handleInputChange,
    handleSubmit,
    isLoading,
    error,
    setMessages,
    stop,
    setInput, // Destructure setInput from useChat
  } = useChat({
    api: "/api/chat",
    body: {
      provider: currentProvider,
      model: currentModel,
    },
    onResponse: (response) => {
      if (response.status === 401) {
        toast.error(
          "You are not authorized to perform this action. Please log in."
        );
      }
    },
    onError: (error) => {
      toast.error(error.message);
    },
    onFinish: () => {
      if (messages.length > 0) {
        saveCurrentChat(messages);
      }
    },
  });

  const {
    saveCurrentChat,
    loadChat,
    deleteChat,
    getAllChats,
    downloadAllHistory,
    // clearAllChats, // Removed as it does not exist in useChatHistory
  } = useChatHistory();

  // Fetch available providers on mount
  useEffect(() => {
    fetch("/api/chat")
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          setAvailableProviders(data.data.providers);
          // Set default provider and model from the first available provider
          if (data.data.providers.length > 0) {
            const defaultProvider = data.data.providers[0];
            if (!currentProvider) {
              setCurrentProvider(defaultProvider.id);
            }
            if (!currentModel) {
              setCurrentModel(defaultProvider.models[0]);
            }
          }
        }
      })
      .catch((error) => {
        console.error("Failed to fetch providers:", error);
        toast.error(
          "Failed to load AI providers. Check your API configuration.",
        );
      });
  }, []); // Removed settings.provider, updateSettings from dependency array

  useEffect(() => {
    if (showHistory) {
      console.log("[ConversationInterface] History modal opened. Fetching chats.");
      const chats = getAllChats();
      const isChatHistoryEmpty = chats.length === 0;
      console.log(`[ConversationInterface] Fetched chats. Is it empty? ${isChatHistoryEmpty}`, chats);
      setChatHistory(chats);
    }
  }, [showHistory, getAllChats]);

  // Handle voice service events
  useEffect(() => {
    const handleVoiceEvent = (event: any) => {
      switch (event.type) {
        case "transcription":
          if (event.data.isFinal && event.data.text.trim()) {
            // If useChat is managing input, update input directly
            setInput(event.data.text.trim());
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
  }, [handleInputChange]); // Added handleInputChange to dependency array

  // Show error notifications
  useEffect(() => {
    if (error) {
      toast.error(error.message); // Access error.message
    }
  }, [error]);

  const handleNewChat = () => {
    const isEmpty = messages.length === 0;
    console.log(`[ConversationInterface] handleNewChat called. Is messages empty? ${isEmpty}`);
    if (!isEmpty) {
      saveCurrentChat(messages);
      setChatHistory(getAllChats());
    }
    setMessages([]);
    toast.success("New chat started");
  };

  const handleDeleteChat = (chatId: string) => {
    deleteChat(chatId);
    setChatHistory(getAllChats());
  };

  const handleLoadChat = (chatId: string) => {
    const chat = loadChat(chatId);
    if (chat) {
      setMessages(chat.messages); // Load messages using useChat's setMessages
      toast.success("Chat loaded");
    }
    setShowHistory(false);
  };

  const handleProviderChange = (provider: string, model: string) => {
    setCurrentProvider(provider);
    setCurrentModel(model);
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
    setShowCodePreview((prevShowCodePreview) => !prevShowCodePreview);
  };

  // Intermediary function to handle submit from InteractionPanel
  const handleChatSubmit = (content: string) => {
    setInput(content);
    // The handleSubmit from useChat expects a React.FormEvent.
    // Creating a dummy event might be necessary if it's not handled internally.
    // However, the current implementation passes it directly, which might be fine if useChat handles it.
    handleSubmit(new Event('submit') as unknown as React.FormEvent<HTMLFormElement>);
  };

  return (
    <div className="relative w-full h-screen bg-black overflow-hidden">
      <div className="flex flex-col md:flex-row h-full">
        {/* Main content area */}
        <div className="flex-1 flex flex-col">
          <div className="flex-1 relative">
            {/* Placeholder for the main 3D scene or other content */}
          </div>

          {/* Interaction Controls */}
          {/* The log here is to check if handleToggleCodePreview is defined when passed */}
          <InteractionPanel
            onSubmit={handleChatSubmit} // Pass the intermediary function
            onNewChat={handleNewChat}
            isProcessing={isLoading}
            toggleAccessibility={() => setShowAccessibility(!showAccessibility)}
            toggleHistory={() => setShowHistory(!showHistory)}
            toggleCodePreview={handleToggleCodePreview} // This is the prop in question
            onStopGeneration={stop} // Pass useChat's stop function
            currentProvider={currentProvider}
            currentModel={currentModel}
            error={error?.message}
            input={input} // Pass input to InteractionPanel
            setInput={setInput} // Pass setInput to InteractionPanel
            availableProviders={availableProviders}
            onProviderChange={handleProviderChange}
          />
        </div>

        {/* Chat Panel */}
        <div className="md:border-l md:border-white/10">
          <ChatPanel
            messages={messages} // Pass messages from useChat
            input={input} // Pass input from useChat
            handleSubmit={handleSubmit} // Pass handleSubmit from useChat
            isLoading={isLoading} // Pass isLoading from useChat
            error={error} // Pass error from useChat
            isStreaming={isLoading} // useChat's isLoading can represent streaming
            onStopGeneration={stop} // Pass stop from useChat
            availableProviders={availableProviders}
            onClearChat={handleNewChat} // Map to handleNewChat
            onShowHistory={() => setShowHistory(true)} // Map to setShowHistory
            onStartGestureDetection={() => { /* Implement gesture start logic */ }} // Placeholder
            onStopGestureDetection={() => { /* Implement gesture stop logic */ }} // Placeholder
            currentConversationId={null} // Placeholder, needs actual conversation ID from history
            onSelectHistoryChat={handleLoadChat}
            currentProvider={currentProvider}
            currentModel={currentModel}
            voiceEnabled={isVoiceEnabled}
            onVoiceToggle={handleVoiceToggle}
            setInput={setInput} // Pass setInput to ChatPanel
            onProviderChange={handleProviderChange}
          />
        </div>
      </div>

      {/* Chat History Modal */}
      {showHistory && (
        <ChatHistoryModal
          onClose={() => setShowHistory(false)}
          onLoadChat={handleLoadChat}
          onDeleteChat={handleDeleteChat}
          onDownloadAll={downloadAllHistory}
          chats={chatHistory}
        />
      )}

      {/* Code Preview Panel */}
      <CodePreviewPanel
        messages={messages}
        isOpen={showCodePreview}
        onClose={() => setShowCodePreview(false)}
      />

      {/* Accessibility Layer */}
      {showAccessibility && (
        <AccessibilityControls
          onClose={() => setShowAccessibility(false)}
          messages={messages}
          isProcessing={isLoading}
          voiceEnabled={isVoiceEnabled}
          onVoiceToggle={handleVoiceToggle}
        />
      )}
    </div>
  );
}
