"use client";

import { useState, useEffect, useCallback, useMemo } from "react"; // Import useCallback and useMemo
import { useChat } from "ai/react"; // Import useChat
import type { ChatHistory } from "@/types";

import InteractionPanel from "@/components/interaction-panel";
import AccessibilityControls from "@/components/accessibility-controls";
import ChatHistoryModal from "@/components/chat-history-modal";
import { ChatPanel } from "@/components/chat-panel";
import CodePreviewPanel from "@/components/code-preview-panel";
import CodeMode from "@/components/code-mode";
// import { useConversation } from "@/hooks/use-conversation"; // No longer needed
import { useChatHistory } from "@/hooks/use-chat-history";
import { voiceService } from "@/lib/voice/voice-service";
import { toast } from "sonner";
import type { LLMProvider } from "@/lib/api/llm-providers";
import {
  CodeServiceProvider,
  useCodeService,
} from "@/contexts/code-service-context";
import { parseCodeBlocksFromMessages } from "@/lib/code-parser";

// Main component wrapped with CodeServiceProvider
export default function ConversationInterface() {
  return (
    <CodeServiceProvider>
      <ConversationInterfaceContent />
    </CodeServiceProvider>
  );
}

// Main component content
function ConversationInterfaceContent() {
  const [showAccessibility, setShowAccessibility] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showCodePreview, setShowCodePreview] = useState(false);
  const [showCodeMode, setShowCodeMode] = useState(false);
  const [projectFiles, setProjectFiles] = useState<{ [key: string]: string }>(
    {},
  );
  const [pendingDiffs, setPendingDiffs] = useState<
    { path: string; diff: string }[]
  >([]);
  const [commandsByFile, setCommandsByFile] = useState<
    Record<string, string[]>
  >({});
  const [availableProviders, setAvailableProviders] = useState<LLMProvider[]>(
    [],
  );
  const [currentProvider, setCurrentProvider] = useState<string>("");
  const [currentModel, setCurrentModel] = useState<string>("");
  const [isVoiceEnabled, setIsVoiceEnabled] = useState(false);
  const [chatHistory, setChatHistory] = useState<ChatHistory[]>([]);
  const [currentConversationId, setCurrentConversationId] = useState<
    string | null
  >(null);

  // Enhanced code system integration
  const [activeTab, setActiveTab] = useState<"chat" | "code">("chat");
  const codeServiceContext = useCodeService();

  // Advertisement system
  const [promptCount, setPromptCount] = useState(0);
  const [showAd, setShowAd] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  // ESC key handler for closing temporary panels
  useEffect(() => {
    const handleEscKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        // Close any open temporary panels
        if (showAccessibility) {
          setShowAccessibility(false);
        } else if (showCodePreview) {
          setShowCodePreview(false);
        } else if (showHistory) {
          setShowHistory(false);
        }
      }
    };

    document.addEventListener("keydown", handleEscKey);
    return () => {
      document.removeEventListener("keydown", handleEscKey);
    };
  }, [showAccessibility, showCodePreview, showHistory]);

  const {
    messages,
    input,
    handleInputChange,
    handleSubmit: originalHandleSubmit,
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
      stream: true,
    },
    onResponse: async (response) => {
      if (response.status === 401) {
        toast.error(
          "You are not authorized to perform this action. Please log in.",
        );
      }
      // We rely on useChat for token streaming; commands are extracted from message content via effects below.
    },
    onError: (error) => {
      toast.error(error.message);
    },
    onFinish: () => {
      if (messages.length > 0) {
        const savedChatId = saveCurrentChat(
          messages,
          currentConversationId || undefined,
        );
        if (!currentConversationId && savedChatId) {
          setCurrentConversationId(savedChatId);
        }
        setPromptCount((prev) => prev + 1);
      }
    },
  });

  // Enhanced submit handler that routes to appropriate service based on active tab
  const handleSubmit = useCallback(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();

      if (activeTab === "code") {
        // Use enhanced code service
        try {
          const selectedFiles: { [key: string]: string } = {};

          // Extract current project files if available
          Object.entries(projectFiles).forEach(([path, content]) => {
            selectedFiles[path] = content;
          });

          await codeServiceContext.startSession({
            prompt: input,
            selectedFiles,
            context: {
              messages,
            },
          });

          // Clear input after starting session
          setInput("");

          // Show code preview panel if not already visible
          if (!showCodePreview) {
            setShowCodePreview(true);
          }
        } catch (error) {
          toast.error("Failed to start code session");
          console.error("Code session error:", error);
        }
      } else {
        // Use regular chat
        originalHandleSubmit(e);
      }
    },
    [
      activeTab,
      input,
      projectFiles,
      messages,
      codeServiceContext,
      setInput,
      showCodePreview,
      originalHandleSubmit,
    ],
  );

  // Update code preview panel data when code service completes
  useEffect(() => {
    if (codeServiceContext.state.lastSessionResult) {
      const { files, diffs } = codeServiceContext.state.lastSessionResult;

      // Update project files
      if (files) {
        setProjectFiles((prevFiles) => ({ ...prevFiles, ...files }));
      }

      // Update pending diffs
      if (diffs) {
        setPendingDiffs(diffs);
      }

      // Parse code blocks from messages and add to project files
      const parsedData = parseCodeBlocksFromMessages(messages);
      if (parsedData.codeBlocks.length > 0) {
        const newFiles: { [key: string]: string } = {};
        parsedData.codeBlocks.forEach((block) => {
          if (block.filename && !block.isError) {
            newFiles[block.filename] = block.code;
          }
        });
        setProjectFiles((prevFiles) => ({ ...prevFiles, ...newFiles }));
      }
    }
  }, [codeServiceContext.state.lastSessionResult, messages]);

  const {
    saveCurrentChat,
    loadChat,
    deleteChat,
    getAllChats,
    downloadAllHistory,
    // clearAllChats, // Removed as it does not exist in useChatHistory
  } = useChatHistory();

  // Save chat history whenever messages change (after AI responses)
  useEffect(() => {
    if (messages.length > 0 && !isLoading) {
      // Only save if the last message is from assistant (completed response)
      const lastMessage = messages[messages.length - 1];
      if (lastMessage && lastMessage.role === "assistant") {
        const savedChatId = saveCurrentChat(
          messages,
          currentConversationId || undefined,
        );
        // If it was a new chat and an ID was returned, set it as the current conversation ID
        if (!currentConversationId && savedChatId) {
          setCurrentConversationId(savedChatId);
        }

        // Auto-speak AI responses if voice is enabled
        if (isVoiceEnabled && voiceService.getSettings().autoSpeak) {
          voiceService.speak(lastMessage.content).catch(console.error);
        }
      }
    }
  }, [
    messages,
    isLoading,
    saveCurrentChat,
    currentConversationId,
    isVoiceEnabled,
  ]);

  // Extract and persist streamed COMMANDS blocks into a per-file map
  useEffect(() => {
    if (messages.length === 0) return;
    const lastAssistant = [...messages]
      .reverse()
      .find((m) => m.role === "assistant");
    if (!lastAssistant || typeof lastAssistant.content !== "string") return;
    const content = lastAssistant.content;
    const blocks = [
      ...content.matchAll(
        /=== COMMANDS_START ===([\s\S]*?)=== COMMANDS_END ===/g,
      ),
    ];
    if (blocks.length === 0) return;

    const newEntries: { path: string; diff: string }[] = [];
    for (const match of blocks) {
      const block = match[1];
      try {
        const diffsMatch = block.match(/write_diffs:\s*\[([\s\S]*?)\]/);
        if (diffsMatch) {
          const items = diffsMatch[1]
            .split(/},/)
            .map((s) => (s.endsWith("}") ? s : s + "}"))
            .map((s) => s.trim())
            .filter(Boolean);
          const write_diffs = items.map((raw) => {
            const pathMatch = raw.match(/path:\s*"([^"]+)"/);
            const diffMatch = raw.match(/diff:\s*"([\s\S]*)"/);
            return {
              path: pathMatch?.[1] || "",
              diff: (diffMatch?.[1] || "").replace(/\\n/g, "\n"),
            };
          });
          newEntries.push(...write_diffs);
        }
      } catch {
        // ignore parse errors per block
      }
    }
    if (newEntries.length === 0) return;

    setCommandsByFile((prev) => {
      const next: Record<string, string[]> = { ...prev };
      for (const { path, diff } of newEntries) {
        if (!path) continue;
        const list = next[path] ? [...next[path]] : [];
        // avoid duplicate consecutive identical patches
        if (list.length === 0 || list[list.length - 1] !== diff) {
          list.push(diff);
          next[path] = list;
        }
      }
      return next;
    });
  }, [messages]);

  // Persist commands map by conversation id
  useEffect(() => {
    if (!currentConversationId) return;
    try {
      localStorage.setItem(
        `commands_diffs_${currentConversationId}`,
        JSON.stringify(commandsByFile),
      );
    } catch {}
  }, [commandsByFile, currentConversationId]);

  // Load commands map when switching conversations
  useEffect(() => {
    if (!currentConversationId) return;
    try {
      const raw = localStorage.getItem(
        `commands_diffs_${currentConversationId}`,
      );
      if (raw) setCommandsByFile(JSON.parse(raw));
      else setCommandsByFile({});
    } catch {
      setCommandsByFile({});
    }
  }, [currentConversationId]);

  // Fetch available providers on mount and align defaults with server config
  useEffect(() => {
    fetch("/api/chat")
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          const providers: LLMProvider[] = data.data.providers || [];
          setAvailableProviders(providers);

          // Attempt to restore persisted selection first
          const persistedProvider = (() => {
            try {
              return localStorage.getItem("chat_provider") || "";
            } catch {
              return "";
            }
          })();
          const persistedModel = (() => {
            try {
              return localStorage.getItem("chat_model") || "";
            } catch {
              return "";
            }
          })();

          const serverDefaultProvider: string | undefined =
            data.data.defaultProvider;
          const serverDefaultModel: string | undefined = data.data.defaultModel;

          const pickValid = (provId?: string, modelId?: string) => {
            if (!provId) return undefined;
            const prov = providers.find((p) => p.id === provId);
            if (!prov) return undefined;
            const model =
              modelId && prov.models.includes(modelId)
                ? modelId
                : prov.models[0] || undefined;
            if (!model) return undefined;
            return { provider: prov.id, model } as {
              provider: string;
              model: string;
            };
          };

          // Priority: persisted -> server defaults -> first available
          const fromPersisted = pickValid(persistedProvider, persistedModel);
          const fromServer = pickValid(
            serverDefaultProvider,
            serverDefaultModel,
          );
          const fromFirst =
            providers.length > 0
              ? pickValid(providers[0].id, providers[0].models[0])
              : undefined;

          const selection = fromPersisted || fromServer || fromFirst;
          if (selection) {
            if (!currentProvider) setCurrentProvider(selection.provider);
            if (!currentModel) setCurrentModel(selection.model);
          }
        }
      })
      .catch((error) => {
        console.error("Failed to fetch providers:", error);
        toast.error(
          "Failed to load AI providers. Check your API configuration.",
        );
      });
  }, []); // initial load only

  // Effect to fetch chat history when the history modal is shown
  useEffect(() => {
    if (showHistory) {
      const fetchedChats = getAllChats();
      setChatHistory(fetchedChats);
    }
  }, [showHistory]); // Depend only on showHistory to re-fetch when modal is opened

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
    if (!isEmpty) {
      // Save the current chat before starting a new one, if there are messages
      saveCurrentChat(messages, currentConversationId || undefined);
      setChatHistory(getAllChats());
    }
    setMessages([]);
    setCurrentConversationId(null); // Ensure current conversation ID is reset for a new chat
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
      setCurrentConversationId(chatId);
      toast.success("Chat loaded");
    }
    setShowHistory(false);
  };

  const handleProviderChange = (provider: string, model: string) => {
    setCurrentProvider(provider);
    setCurrentModel(model);
    // Persist selection
    try {
      localStorage.setItem("chat_provider", provider);
      localStorage.setItem("chat_model", model);
    } catch {}
    toast.success(`Switched to ${provider} - ${model}`);
  };

  // Auto-rotate to next provider
  const rotateToNextProvider = useCallback(() => {
    if (availableProviders.length <= 1) return;

    const currentProviderIndex = availableProviders.findIndex(
      (p) => p.name === currentProvider,
    );
    const nextIndex = (currentProviderIndex + 1) % availableProviders.length;
    const nextProvider = availableProviders[nextIndex];

    if (nextProvider && nextProvider.models.length > 0) {
      const nextModel = nextProvider.models[0]; // Use first model of next provider
      handleProviderChange(nextProvider.name, nextModel);
    }
  }, [availableProviders, currentProvider, handleProviderChange]);

  // Auto-rotate on API errors
  useEffect(() => {
    if (error && error.message) {
      const errorMessage = error.message.toLowerCase();
      const shouldRotate =
        errorMessage.includes("rate limit") ||
        errorMessage.includes("quota") ||
        errorMessage.includes("invalid api key") ||
        errorMessage.includes("unauthorized") ||
        errorMessage.includes("not found") ||
        errorMessage.includes("forbidden") ||
        errorMessage.includes("service unavailable") ||
        errorMessage.includes("timeout");

      if (shouldRotate) {
        const errorType =
          errorMessage.includes("rate limit") || errorMessage.includes("quota")
            ? "Rate limit"
            : errorMessage.includes("invalid api key") ||
                errorMessage.includes("unauthorized")
              ? "Invalid API key"
              : errorMessage.includes("not found")
                ? "Service not found"
                : errorMessage.includes("forbidden")
                  ? "Access forbidden"
                  : errorMessage.includes("service unavailable")
                    ? "Service unavailable"
                    : errorMessage.includes("timeout")
                      ? "Request timeout"
                      : "API error";

        toast.info(`${errorType} detected, switching to next provider...`);
        setTimeout(() => {
          rotateToNextProvider();
        }, 1500);
      }
    }
  }, [error, rotateToNextProvider]);

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

  // Check if there are code blocks in messages for preview button glow
  const hasCodeBlocks = useMemo(() => {
    return messages.some(
      (message) =>
        message.role === "assistant" && message.content.includes("```"),
    );
  }, [messages]);

  const handleToggleCodePreview = () => {
    setShowCodePreview((prevShowCodePreview) => {
      const newState = !prevShowCodePreview;
      return newState;
    });
  };

  const handleToggleCodeMode = () => {
    setShowCodeMode((prev) => !prev);
  };

  const handleUpdateProjectFiles = (files: { [key: string]: string }) => {
    setProjectFiles(files);
  };

  const handleCodeModeMessage = (message: string, _context?: any) => {
    // Send the formatted code mode message
    setInput(message);
    setTimeout(() => {
      const fakeEvent = {
        preventDefault: () => {},
        currentTarget: { reset: () => {} },
      } as React.FormEvent<HTMLFormElement>;
      handleSubmit(fakeEvent);
    }, 0);
  };

  const acceptPendingDiffs = () => {
    if (pendingDiffs.length === 0) return;
    const diffMessages = pendingDiffs.map((d, idx) => ({
      id: `diff-${Date.now()}-${idx}`,
      role: "assistant" as const,
      content: `\`\`\`diff ${d.path}\n${d.diff}\n\`\`\``,
    }));
    setMessages((prev) => [...prev, ...diffMessages]);
    setPendingDiffs([]);
    toast.success(
      "Applied diffs to preview. Press Code Preview to view updated state.",
    );
  };

  // Commands map actions
  const applyAllCommandDiffs = () => {
    const entries: { path: string; diff: string }[] = [];
    Object.entries(commandsByFile).forEach(([path, diffs]) => {
      diffs.forEach((diff) => entries.push({ path, diff }));
    });
    if (entries.length === 0) {
      toast.info("No pending command diffs to apply.");
      return;
    }
    const diffMessages = entries.map((d, idx) => ({
      id: `cmd-diff-${Date.now()}-${idx}`,
      role: "assistant" as const,
      content: `\`\`\`diff ${d.path}\n${d.diff}\n\`\`\``,
    }));
    setMessages((prev) => [...prev, ...diffMessages]);
    setCommandsByFile({});
    toast.success(`Applied ${entries.length} diff(s) to preview.`);
  };

  const applyDiffsForFile = (path: string) => {
    const diffs = commandsByFile[path] || [];
    if (diffs.length === 0) return;
    const diffMessages = diffs.map((diff, idx) => ({
      id: `cmd-file-diff-${Date.now()}-${idx}`,
      role: "assistant" as const,
      content: `\`\`\`diff ${path}\n${diff}\n\`\`\``,
    }));
    setMessages((prev) => [...prev, ...diffMessages]);
    setCommandsByFile((prev) => {
      const next = { ...prev };
      delete next[path];
      return next;
    });
    toast.success(`Applied ${diffs.length} diff(s) for ${path}.`);
  };

  const clearAllCommandDiffs = () => {
    setCommandsByFile({});
    toast.info("Cleared all pending command diffs.");
  };

  const clearCommandDiffsForFile = (path: string) => {
    setCommandsByFile((prev) => {
      const next = { ...prev };
      delete next[path];
      return next;
    });
  };

  const squashCommandDiffsForFile = (path: string) => {
    setCommandsByFile((prev) => {
      const list = prev[path] || [];
      if (list.length <= 1) return prev;
      const squashed = list.join("\n");
      return { ...prev, [path]: [squashed] };
    });
    toast.success(`Squashed diffs for ${path}.`);
  };

  const dismissPendingDiffs = () => {
    if (pendingDiffs.length === 0) return;
    setPendingDiffs([]);
    toast.info("Dismissed pending diffs");
  };

  // Intermediary function to handle submit from InteractionPanel with ad system
  const handleChatSubmit = (content: string) => {
    // Check if user needs to see an ad
    if (!isLoggedIn && promptCount > 0 && promptCount % 3 === 0) {
      setShowAd(true);
      return;
    }

    // Increment prompt count for non-logged-in users
    if (!isLoggedIn) {
      setPromptCount((prev) => prev + 1);
    }

    setInput(content);
    // Use setTimeout to ensure input is set before submitting
    setTimeout(() => {
      const fakeEvent = {
        preventDefault: () => {},
        currentTarget: { reset: () => {} },
      } as React.FormEvent<HTMLFormElement>;
      handleSubmit(fakeEvent);
    }, 0);
  };

  // Retry function to resend the last user message
  const handleRetry = () => {
    if (messages.length > 0) {
      // Find the last user message
      const lastUserMessage = [...messages]
        .reverse()
        .find((msg) => msg.role === "user");
      if (lastUserMessage) {
        // Remove any assistant messages after the last user message
        const lastUserIndex = messages.lastIndexOf(lastUserMessage);
        const messagesToKeep = messages.slice(0, lastUserIndex + 1);
        setMessages(messagesToKeep);

        // Resend the last user message
        setInput(lastUserMessage.content);
        setTimeout(() => {
          handleSubmit(
            new Event("submit") as unknown as React.FormEvent<HTMLFormElement>,
          );
        }, 100);
      }
    }
  };

  return (
    <div className="relative w-full h-screen bg-black overflow-hidden touch-pan-y">
      {/* Subtle animated background */}
      <div className="absolute inset-0 opacity-20">
        <div className="absolute inset-0 bg-gradient-to-br from-gray-900/30 via-black to-gray-800/20"></div>
        <div className="absolute inset-0 animate-pulse-slow">
          <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-gray-700/10 rounded-full blur-3xl animate-float-slow"></div>
          <div className="absolute top-3/4 right-1/4 w-80 h-80 bg-gray-600/10 rounded-full blur-3xl animate-float-reverse"></div>
          <div className="absolute bottom-1/4 left-1/2 w-64 h-64 bg-gray-800/10 rounded-full blur-3xl animate-float-slow"></div>
        </div>
      </div>
      <div className="flex flex-col md:flex-row h-full min-h-0">
        {/* Main content area - hidden on mobile when chat is active */}
        <div className="hidden md:flex flex-1 flex-col">
          <div className="flex-1 relative">
            {/* Placeholder for the main 3D scene or other content */}
          </div>
        </div>

        {/* Chat Panel - full width on mobile */}
        <div className="flex-1 md:flex-initial md:border-l md:border-white/10 relative z-10 flex flex-col min-h-0">
          {/* Header showing current provider/model */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-white/10 bg-black/30">
            <div className="text-xs text-white/70 truncate">
              <span className="mr-2">Provider:</span>
              <span className="font-medium text-white">
                {currentProvider || "—"}
              </span>
              <span className="mx-2 text-white/40">|</span>
              <span className="mr-2">Model:</span>
              <span className="font-medium text-white truncate inline-block max-w-[60%] align-bottom">
                {currentModel || "—"}
              </span>
            </div>
            {/* Quick open history */}
            <button
              onClick={() => setShowHistory(true)}
              className="text-xs px-2 py-1 border border-white/20 rounded text-white/70 hover:bg-white/10"
            >
              History
            </button>
          </div>
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
            currentConversationId={currentConversationId}
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

      {/* Interaction Controls - Positioned absolutely to avoid layout conflicts */}
      <InteractionPanel
        onSubmit={handleChatSubmit} // Pass the intermediary function
        onNewChat={handleNewChat}
        isProcessing={isLoading || codeServiceContext.state.isProcessing}
        toggleAccessibility={() => setShowAccessibility(!showAccessibility)}
        toggleHistory={() => setShowHistory(!showHistory)}
        toggleCodePreview={() => {
          handleToggleCodePreview();
        }} // Pass the function with an additional log
        toggleCodeMode={handleToggleCodeMode}
        onStopGeneration={stop} // Pass useChat's stop function
        onRetry={handleRetry} // Pass the retry function
        currentProvider={currentProvider}
        currentModel={currentModel}
        error={error?.message || codeServiceContext.state.error}
        input={input} // Pass input to InteractionPanel
        setInput={setInput} // Pass setInput to InteractionPanel
        availableProviders={availableProviders}
        onProviderChange={handleProviderChange}
        hasCodeBlocks={hasCodeBlocks}
        pendingDiffs={pendingDiffs}
        onAcceptPendingDiffs={acceptPendingDiffs}
        onDismissPendingDiffs={dismissPendingDiffs}
        activeTab={activeTab}
        onActiveTabChange={setActiveTab}
      />

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
        commandsByFile={commandsByFile}
        onApplyAllCommandDiffs={applyAllCommandDiffs}
        onApplyFileCommandDiffs={applyDiffsForFile}
        onClearAllCommandDiffs={clearAllCommandDiffs}
        onClearFileCommandDiffs={clearCommandDiffsForFile}
        onSquashFileCommandDiffs={squashCommandDiffsForFile}
      />

      {/* Code Mode Panel */}
      <CodeMode
        projectFiles={projectFiles}
        onUpdateFiles={handleUpdateProjectFiles}
        onSendMessage={handleCodeModeMessage}
        isVisible={showCodeMode}
        onClose={() => setShowCodeMode(false)}
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

      {/* Advertisement Modal */}
      {showAd && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-gray-900 border border-white/20 rounded-lg p-6 max-w-md w-full">
            <div className="text-center space-y-4">
              <div className="w-16 h-16 bg-gradient-to-r from-purple-500 to-pink-500 rounded-full mx-auto flex items-center justify-center">
                <span className="text-2xl">🚀</span>
              </div>
              <h3 className="text-xl font-bold text-white">
                Continue with Premium
              </h3>
              <p className="text-gray-300 text-sm">
                You've used {promptCount} prompts. Sign up for unlimited access
                and exclusive features!
              </p>

              {/* Ad placeholder */}
              <div className="bg-black/40 border border-white/10 rounded-lg p-4 my-4">
                <div className="text-center text-gray-400 text-sm">
                  [Advertisement Space]
                  <br />
                  <span className="text-xs">
                    Your ad service integration goes here
                  </span>
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => {
                    setIsLoggedIn(true);
                    setShowAd(false);
                    // Continue with the original submission
                    handleSubmit(
                      new Event(
                        "submit",
                      ) as unknown as React.FormEvent<HTMLFormElement>,
                    );
                  }}
                  className="flex-1 bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white px-4 py-2 rounded-lg font-medium transition-all duration-200"
                >
                  Sign Up Free
                </button>
                <button
                  onClick={() => {
                    setShowAd(false);
                    // Continue with the original submission after ad
                    setTimeout(() => {
                      handleSubmit(
                        new Event(
                          "submit",
                        ) as unknown as React.FormEvent<HTMLFormElement>,
                      );
                    }, 100);
                  }}
                  className="flex-1 border border-white/20 text-white px-4 py-2 rounded-lg hover:bg-white/5 transition-all duration-200"
                >
                  Continue
                </button>
              </div>

              <p className="text-xs text-gray-500">
                Free users see ads every 3 prompts
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
