"use client";

import { useState, useEffect, useCallback, useMemo } from "react"; // Import useCallback and useMemo
import { useEnhancedChat } from "@/hooks/use-enhanced-chat"; // Import enhanced chat hook
import type { ChatHistory } from "@/types";

import InteractionPanel from "@/components/interaction-panel";
import Settings from "@/components/settings";
import ChatHistoryModal from "@/components/chat-history-modal";
import { ChatPanel } from "@/components/chat-panel";
import CodePreviewPanel from "@/components/code-preview-panel";
import TerminalPanel from "@/components/terminal/TerminalPanel";
// import { useConversation } from "@/hooks/use-conversation"; // No longer needed
import { useChatHistory } from "@/hooks/use-chat-history";
import { voiceService } from "@/lib/voice/voice-service";
import { toast } from "sonner";
import type { LLMProvider } from "@/lib/api/llm-providers";
import { enhancedBufferManager } from "@/lib/streaming/enhanced-buffer-manager";
import { useStreamingState } from "@/hooks/use-streaming-state";
import { setCurrentMode } from "@/lib/mode-manager";
import {
  createInputContext,
  processSafeContent,
  shouldGenerateDiffsForContext,
  debugContentProcessing
} from "@/lib/input-response-separator";
import { useAuth } from "@/contexts/auth-context";
import { generateSecureId } from "@/lib/utils";
import type { AttachedVirtualFile } from "@/hooks/use-virtual-filesystem";

/**
 * Render the main conversation interface with chat, filesystem attachments, providers/models selection,
 * history, voice integration, streaming state, code previews, and terminal visibility.
 */
function getStableSessionId(): string {
  if (typeof window === 'undefined') return 'server-session';
  
  let sessionId = localStorage.getItem('anonymous_session_id');
  if (!sessionId) {
    sessionId = generateSecureId('anon');
    localStorage.setItem('anonymous_session_id', sessionId);
  }
  return sessionId;
}

function getFilesystemScopeMappingKey(chatId: string): string {
  return `chat_filesystem_scope_${chatId}`;
}

function persistFilesystemScope(chatId: string, scopeId: string) {
  if (typeof window === "undefined" || !chatId || !scopeId) return;
  try {
    localStorage.setItem(getFilesystemScopeMappingKey(chatId), scopeId);
  } catch {}
}

function restoreFilesystemScope(chatId: string): string | null {
  if (typeof window === "undefined" || !chatId) return null;
  try {
    return localStorage.getItem(getFilesystemScopeMappingKey(chatId));
  } catch {
    return null;
  }
}

export default function ConversationInterface() {
  const { user } = useAuth();
  const [embedMode, setEmbedMode] = useState(false);

  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get('embed') === '1' || window.self !== window.top) {
        setEmbedMode(true);
        // Mark as logged in to avoid ads in embed mode
        setIsLoggedIn(true);
        // Notify parent that embed is ready
        window.parent?.postMessage({ type: 'bing:ready' }, '*');
      }
    } catch {}

    const handler = (e: MessageEvent) => {
      // Only accept auth messages from the same origin to prevent token injection
      if (e.origin !== window.location.origin) {
        return;
      }
      if (e?.data?.type === 'bing:auth' && e.data.token) {
        try { localStorage.setItem('token', e.data.token); } catch {}
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);
  const [showAccessibility, setShowAccessibility] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showCodePreview, setShowCodePreview] = useState(false);
  const [showTerminal, setShowTerminal] = useState(false);
  const [terminalMinimized, setTerminalMinimized] = useState(false);
  const [attachedFilesystemFiles, setAttachedFilesystemFiles] = useState<Record<string, AttachedVirtualFile>>({});
  const [commandsByFile, setCommandsByFile] = useState<
    Record<string, string[]>
  >({});
  const [availableProviders, setAvailableProviders] = useState<LLMProvider[]>(
    [],
  );
  const [currentProvider, setCurrentProvider] = useState<string>(
    typeof window !== 'undefined' 
      ? (localStorage.getItem("chat_provider") || "openrouter")
      : "openrouter"
  );
  const [currentModel, setCurrentModel] = useState<string>(
    typeof window !== 'undefined'
      ? (localStorage.getItem("chat_model") || "nvidia/nemotron-3-nano-30b-a3b:free")
      : "nvidia/nemotron-3-nano-30b-a3b:free"
  );
  const [isVoiceEnabled, setIsVoiceEnabled] = useState(false);
  const [chatHistory, setChatHistory] = useState<ChatHistory[]>([]);
  const [currentConversationId, setCurrentConversationId] = useState<
    string | null
  >(null);
  const [filesystemSessionId, setFilesystemSessionId] = useState<string>(
    () => `draft-chat_${Date.now()}_${generateSecureId("chat")}`,
  );
  
  // Project name for simpler terminal paths (e.g., "webGame" instead of long session ID)
  const [projectName, setProjectName] = useState<string>('workspace');
  
  const filesystemScopePath = useMemo(
    () => `project/sessions/${filesystemSessionId}`,
    [filesystemSessionId],
  );
  
  // Expose project name setter globally for LLM/chat to update
  useEffect(() => {
    (window as any).__setProjectName = setProjectName;
  }, []);

  const [activeTab, setActiveTab] = useState<"chat" | "extras" | "integrations" | "shell">("chat");

  // Update mode manager when active tab changes
  useEffect(() => {
    setCurrentMode(activeTab);

    // Auto-open and auto-connect terminal when shell tab is selected
    if (activeTab === 'shell') {
      if (!showTerminal) {
        setShowTerminal(true);
        setTerminalMinimized(false);
      }
      // Auto-focus terminal when opened (disabled auto-connect to prevent sandbox connection loops)
      // Users can manually click "connect" if they want sandbox access
      setTimeout(() => {
        const xtermEl = document.querySelector('.xterm-helper-textarea') as HTMLTextAreaElement;
        xtermEl?.focus();
      }, 100);
    }

    // Auto-focus terminal when shell tab is selected
    if (activeTab === 'shell' && showTerminal) {
      setTimeout(() => {
        const xtermEl = document.querySelector('.xterm-helper-textarea') as HTMLTextAreaElement;
        xtermEl?.focus();
      }, 100);
    }
  }, [activeTab, showTerminal]);

  // Enhanced streaming state management
  const streamingState = useStreamingState({
    onSessionComplete: (sessionId) => {
      console.log(`Streaming session ${sessionId} completed`);
    },
    onSessionError: (sessionId, error) => {
      console.error(`Streaming session ${sessionId} error:`, error);
      toast.error(`Streaming error: ${error.message}`);
    },
    onBackpressureChange: (active) => {
      if (active) {
        toast.info("Streaming slowed due to high load", { duration: 2000 });
      }
    }
  });

  // Advertisement system
  const [, setPromptCount] = useState(0);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const filesystemContext = useMemo(() => ({
    attachedFiles: Object.values(attachedFilesystemFiles).map((file) => ({
      path: file.path,
      content: file.content,
      language: file.language,
      version: file.version,
      lastModified: file.lastModified,
    })),
    applyFileEdits: true,
    scopePath: filesystemScopePath,
  }), [attachedFilesystemFiles, filesystemScopePath]);

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
    handleSubmit: originalHandleSubmit,
    isLoading,
    error,
    setMessages,
    stop,
    setInput, // Destructure setInput from enhanced chat hook
  } = useEnhancedChat({
    api: "/api/chat",
    body: {
      provider: currentProvider,
      model: currentModel,
      stream: true,
      conversationId: filesystemSessionId,
      filesystemContext,
    },
    onResponse: async (response) => {
      if (response.status === 401) {
        toast.error(
          "You are not authorized to perform this action. Please log in.",
        );
      }
      // Enhanced chat hook handles streaming properly
    },
    onError: (error) => {
      toast.error(error.message);
      // Clean up any active streaming sessions on error
      enhancedBufferManager.cleanup();
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
      // Clean up completed streaming sessions
      enhancedBufferManager.cleanup();
    },
  });

  const handleSubmit = useCallback(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      originalHandleSubmit(e);
    },
    [originalHandleSubmit],
  );

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
          persistFilesystemScope(savedChatId, filesystemSessionId);
        }

        // Update chat history state to reflect the saved chat
        setChatHistory(getAllChats());

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
    filesystemSessionId,
    isVoiceEnabled,
    getAllChats, // Added dependency
  ]);

  // Extract and persist streamed COMMANDS blocks into a per-file map
  useEffect(() => {
    if (messages.length === 0) return;
    
    const lastAssistant = [...messages]
      .reverse()
      .find((m) => m.role === "assistant");
    if (!lastAssistant || typeof lastAssistant.content !== "string") return;
    
    // Create context for API response processing
    const responseContext = createInputContext('assistant');
    const processedResponse = processSafeContent(lastAssistant.content, responseContext);
    
    // Debug content processing in development
    debugContentProcessing(lastAssistant.content, responseContext, processedResponse);
    
    // Only process diffs if context allows it
    if (!shouldGenerateDiffsForContext(lastAssistant.content, responseContext) || !processedResponse.fileDiffs) return;

    const newEntries: { path: string; diff: string }[] = processedResponse.fileDiffs.map(fileDiff => ({
      path: fileDiff.path,
      diff: fileDiff.diff,
    }));

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
    fetch("/api/providers", { credentials: 'include' })
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
            // Always update if we have a valid selection and current is not set or not in available providers
            const providerAvailable = providers.some(p => p.id === selection.provider);
            if (!currentProvider || !providerAvailable) {
              setCurrentProvider(selection.provider);
            }
            if (!currentModel || !providers.find(p => p.id === selection.provider)?.models.includes(selection.model)) {
              setCurrentModel(selection.model);
            }
          }
        }
      })
      .catch((error) => {
        console.error("Failed to fetch providers:", error);
        toast.error(
          "Failed to load AI providers. Check your API configuration.",
        );
        // Fallback to defaults if fetch fails
        if (!currentProvider) {
          setCurrentProvider("google");
          setCurrentModel("gemini-2.5-flash");
        }
      });
  }, []); // initial load only

  // Effect to fetch chat history on mount to ensure it's available
  useEffect(() => {
    const fetchedChats = getAllChats();
    setChatHistory(fetchedChats);
  }, [getAllChats]); // Run on mount; getAllChats should be stable from useChatHistory (added to satisfy react-hooks/exhaustive-deps)

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
  }, []);

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
    }

    // Clean up any active streaming sessions
    streamingState.cleanupCompletedSessions();

    setMessages([]);
    setCurrentConversationId(null); // Ensure current conversation ID is reset for a new chat
    setFilesystemSessionId(`draft-chat_${Date.now()}_${generateSecureId("chat")}`);

    // Update chat history to reflect the saved chat
    setChatHistory(getAllChats());

    toast.success("New chat started");
  };

  const handleDeleteChat = (chatId: string) => {
    deleteChat(chatId);
    // Update chat history to reflect the deletion
    setChatHistory(getAllChats());
  };

  const handleLoadChat = (chatId: string) => {
    // Save current chat before loading a different one
    if (messages.length > 0) {
      saveCurrentChat(messages, currentConversationId || undefined);
    }

    const chat = loadChat(chatId);
    if (chat) {
      setMessages(chat.messages); // Load messages using useChat's setMessages
      setCurrentConversationId(chatId);
      const restoredScopeId = restoreFilesystemScope(chatId);
      setFilesystemSessionId(restoredScopeId || chatId);
      toast.success("Chat loaded");
    }

    // Update chat history to reflect any changes
    setChatHistory(getAllChats());
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

  // Check if there are code blocks in messages for preview button glow (mode-aware)
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

  // Handle chat submission - no login restrictions
  const handleChatSubmit = (content: string) => {
    // Increment prompt count for tracking (no restrictions)
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

  useEffect(() => {
    if (!currentConversationId) return;
    persistFilesystemScope(currentConversationId, filesystemSessionId);
  }, [currentConversationId, filesystemSessionId]);

  const handleAttachedFilesChange = useCallback((files: Record<string, AttachedVirtualFile>) => {
    setAttachedFilesystemFiles(files);
  }, []);

  useEffect(() => {
    const lastAssistant = [...messages]
      .reverse()
      .find((message) => message.role === "assistant");
    const requestedFiles = (lastAssistant?.metadata as any)?.filesystem?.requestedFiles;
    if (!Array.isArray(requestedFiles) || requestedFiles.length === 0) {
      return;
    }

    setAttachedFilesystemFiles((previous) => {
      const next = { ...previous };
      for (const file of requestedFiles) {
        if (!file?.path || typeof file?.content !== "string") continue;
        next[file.path] = {
          path: file.path,
          content: file.content,
          language: file.language || "text",
          version: typeof file.version === "number" ? file.version : 1,
          lastModified: new Date().toISOString(),
        };
      }
      return next;
    });
  }, [messages]);

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
    <div className="relative w-full h-screen overflow-hidden touch-pan-y z-[1]">
      {/* Subtle animated background */}
      <div className="absolute inset-0 opacity-45">
        <div
          className="absolute inset-0"
          style={{ background: "var(--app-scene-overlay)" }}
        />
        <div className="absolute inset-0 animate-pulse-slow">
          <div
            className="absolute top-1/4 left-1/4 w-96 h-96 rounded-full blur-3xl animate-float-slow"
            style={{ backgroundColor: "var(--app-orb-1)" }}
          />
          <div
            className="absolute top-3/4 right-1/4 w-80 h-80 rounded-full blur-3xl animate-float-reverse"
            style={{ backgroundColor: "var(--app-orb-2)" }}
          />
          <div
            className="absolute bottom-1/4 left-1/2 w-64 h-64 rounded-full blur-3xl animate-float-slow"
            style={{ backgroundColor: "var(--app-orb-3)" }}
          />
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
          {!embedMode && (
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
          )}
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
            streamingState={streamingState}
          />
        </div>
      </div>

      {/* Interaction Controls - Positioned absolutely to avoid layout conflicts */}
      <InteractionPanel
        onSubmit={handleChatSubmit} // Pass the intermediary function
        onNewChat={handleNewChat}
        isProcessing={isLoading}
        toggleAccessibility={() => setShowAccessibility(!showAccessibility)}
        toggleHistory={() => setShowHistory(!showHistory)}
        toggleCodePreview={() => {
          handleToggleCodePreview();
        }} // Pass the function with an additional log
        onStopGeneration={stop} // Pass useChat's stop function
        onRetry={handleRetry} // Pass the retry function
        currentProvider={currentProvider}
        currentModel={currentModel}
        error={error?.message}
        input={input} // Pass input to InteractionPanel
        setInput={setInput} // Pass setInput to InteractionPanel
        availableProviders={availableProviders}
        onProviderChange={handleProviderChange}
        hasCodeBlocks={hasCodeBlocks}
        activeTab={activeTab}
        onActiveTabChange={setActiveTab}
        userId={user?.id?.toString() || getStableSessionId()} // Use stable user ID or session ID
        onAttachedFilesChange={handleAttachedFilesChange}
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

      {/* Settings Modal */}
      {showAccessibility && (
        <Settings
          onClose={() => setShowAccessibility(false)}
          messages={messages}
          isProcessing={isLoading}
          voiceEnabled={isVoiceEnabled}
          onVoiceToggle={handleVoiceToggle}
        />
      )}

      {/* Code Preview Panel */}
      {showCodePreview && (
        <CodePreviewPanel
          isOpen={showCodePreview}
          messages={messages}
          onClose={() => setShowCodePreview(false)}
          filesystemScopePath={filesystemScopePath}
          commandsByFile={commandsByFile}
          onApplyAllCommandDiffs={applyAllCommandDiffs}
          onApplyFileCommandDiffs={applyDiffsForFile}
          onClearAllCommandDiffs={clearAllCommandDiffs}
          onClearFileCommandDiffs={clearCommandDiffsForFile}
          onSquashFileCommandDiffs={squashCommandDiffsForFile}
        />
      )}

      {/* Terminal Panel */}
      <TerminalPanel
        userId={user?.id?.toString() || getStableSessionId()}
        isOpen={showTerminal}
        onClose={() => {
          setShowTerminal(false);
          // Return to chat tab when terminal is closed
          if (activeTab === 'shell') {
            setActiveTab('chat');
          }
        }}
        onMinimize={() => setTerminalMinimized(!terminalMinimized)}
        isMinimized={terminalMinimized}
        filesystemScopePath={filesystemScopePath}
      />
    </div>
  );
}
