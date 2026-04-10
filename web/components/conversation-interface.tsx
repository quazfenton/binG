"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react"; // Import useCallback, useMemo, and useRef
import { usePanel } from "@/contexts/panel-context";
import { useEnhancedChat } from "@/hooks/use-enhanced-chat"; // Import enhanced chat hook
import { useDiffsPoller } from "@/hooks/use-diffs-poller";
import type { ChatHistory } from "@/types";

import InteractionPanel from "@/components/interaction-panel";
import Settings from "@/components/settings";
import ChatHistoryModal from "@/components/chat-history-modal";
import { ChatPanel } from "@/components/chat-panel";
import { HorizontalSpaceFiller } from "@/components/space-filler";
import CodePreviewPanel from "@/components/code-preview-panel";
import TerminalPanel from "@/components/terminal/TerminalPanel";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
// import { useConversation } from "@/hooks/use-conversation"; // No longer needed
import { useChatHistory } from "@/hooks/use-chat-history";
import { voiceService } from "@/lib/voice/voice-service";
import { toast } from "sonner";
import type { LLMProviderConfig } from "@/lib/chat/llm-providers-types";
import { enhancedBufferManager } from "@/lib/streaming/enhanced-buffer-manager";
import { useStreamingState } from "@/hooks/use-streaming-state";
import { useAuth } from "@/contexts/auth-context";
import { generateSecureId, getOrCreateAnonymousSessionId, buildApiHeaders } from "@/lib/utils";
import { generateSessionName, checkFileConflicts } from "@/lib/session-naming";
import { useOrchestrationMode, getOrchestrationModeHeaders } from "@/contexts/orchestration-mode-context";
import type { OrchestrationMode } from "@/contexts/orchestration-mode-context";
import { useResponseStyle } from "@/contexts/response-style-context";
import { resolveScopedPath } from "@/lib/virtual-filesystem/scope-utils";

type AttachedVirtualFile = any;
import { emitFilesystemUpdated, onFilesystemUpdated } from "@/lib/virtual-filesystem/sync/sync-events";
import {
  parseFilesystemResponse,
  detectNewProjectFolder,
  type FileOperation,
} from '@/lib/chat/file-edit-parser';

/**
 * Render the main conversation interface with chat, filesystem attachments, providers/models selection,
 * history, voice integration, streaming state, code previews, and terminal visibility.
 */
const getStableSessionId = getOrCreateAnonymousSessionId;

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

const CONVERSATION_UI_STATE_KEY = "conversation_ui_state_v1";
const CONVERSATION_UI_STATE_VERSION = 1;

interface PersistedConversationUiState {
  version: number;
  currentConversationId: string | null;
  compositeSessionId: string | null;
  currentProvider: string | null;
  currentModel: string | null;
  updatedAt: number;
}

function readPersistedConversationUiState(): PersistedConversationUiState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(CONVERSATION_UI_STATE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedConversationUiState>;
    if (parsed?.version !== CONVERSATION_UI_STATE_VERSION) return null;
    return {
      version: CONVERSATION_UI_STATE_VERSION,
      currentConversationId: typeof parsed.currentConversationId === "string" ? parsed.currentConversationId : null,
      compositeSessionId: typeof parsed.compositeSessionId === "string" ? parsed.compositeSessionId : null,
      currentProvider: typeof parsed.currentProvider === "string" ? parsed.currentProvider : null,
      currentModel: typeof parsed.currentModel === "string" ? parsed.currentModel : null,
      updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : 0,
    };
  } catch {
    return null;
  }
}

function writePersistedConversationUiState(state: Omit<PersistedConversationUiState, "version" | "updatedAt">): PersistedConversationUiState | null {
  if (typeof window === "undefined") return null;
  const nextState: PersistedConversationUiState = {
    version: CONVERSATION_UI_STATE_VERSION,
    updatedAt: Date.now(),
    ...state,
  };
  try {
    localStorage.setItem(CONVERSATION_UI_STATE_KEY, JSON.stringify(nextState));
    return nextState;
  } catch {
    return null;
  }
}

const buildFilesystemHeaders = (): HeadersInit => buildApiHeaders();

// Use shared file diff utilities - smartApply supersedes applyDiffToContent
import { smartApply } from '@/lib/chat/file-diff-utils';

export default function ConversationInterface() {
  const { user } = useAuth();
  const { isOpen: isWorkspaceOpen } = usePanel();
  const { config: orchestrationConfig } = useOrchestrationMode();
  const { params: responseStyleParams, presetKey: responseStylePreset } = useResponseStyle();
  const [embedMode, setEmbedMode] = useState(false);

  // Chat panel horizontal resizing state
  const [chatPanelWidth, setChatPanelWidth] = useState(450); // Default width
  const [isDesktop, setIsDesktop] = useState(false); // Track if we're on desktop
  const [isChatResizing, setIsChatResizing] = useState(false);
  const chatResizeStartX = useRef(0);
  const chatResizeStartWidth = useRef(450);
  const chatSnapThreshold = useRef(false); // Use ref to avoid effect re-runs during drag

  // Detect desktop viewport
  useEffect(() => {
    const checkDesktop = () => setIsDesktop(window.innerWidth >= 768);
    checkDesktop();
    window.addEventListener('resize', checkDesktop);
    return () => window.removeEventListener('resize', checkDesktop);
  }, []);

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
        try {
          import('@bing/platform/secrets').then(({ secrets }) => {
            secrets.set('auth-token', e.data.token);
          });
        } catch {}
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);
  const [showAccessibility, setShowAccessibility] = useState(false);
  const [showResponseStyle, setShowResponseStyle] = useState(
    () => typeof window !== 'undefined' && localStorage.getItem('show_response_style') === 'true'
  );
  const [showHistory, setShowHistory] = useState(false);
  const [showCodePreview, setShowCodePreview] = useState(false);
  const [showTerminal, setShowTerminal] = useState(false);
  const [terminalMinimized, setTerminalMinimized] = useState(false);
  const [attachedFilesystemFiles, setAttachedFilesystemFiles] = useState<Record<string, AttachedVirtualFile>>({});
  const [commandsByFile, setCommandsByFile] = useState<
    Record<string, string[]>
  >({});
  const [availableProviders, setAvailableProviders] = useState<LLMProviderConfig[]>(
    [],
  );
  const [currentProvider, setCurrentProvider] = useState<string>(() => {
    const persisted = readPersistedConversationUiState();
    if (persisted?.currentProvider) {
      return persisted.currentProvider;
    }
    if (typeof window !== 'undefined') {
      return localStorage.getItem("chat_provider") || "openrouter";
    }
    return "openrouter";
  });
  const [currentModel, setCurrentModel] = useState<string>(() => {
    const persisted = readPersistedConversationUiState();
    if (persisted?.currentModel) {
      return persisted.currentModel;
    }
    if (typeof window !== 'undefined') {
      return localStorage.getItem("chat_model") || "nvidia/nemotron-3-nano-30b-a3b:free";
    }
    return "nvidia/nemotron-3-nano-30b-a3b:free";
  });
  const [isVoiceEnabled, setIsVoiceEnabled] = useState(false);
  const [livekitEnabled, setLivekitEnabled] = useState(false);
  const [chatHistory, setChatHistory] = useState<ChatHistory[]>([]);
  const [currentConversationId, setCurrentConversationId] = useState<
    string | null
  >(() => {
    const persisted = readPersistedConversationUiState();
    if (persisted?.currentConversationId) {
      return persisted.currentConversationId;
    }
    if (typeof window !== 'undefined') {
      return sessionStorage.getItem('current_conversation_id') || null;
    }
    return null;
  });
  // Generate initial session ID using new naming system
  // Always start fresh to prevent stale session IDs like "002" from being reused
  const [compositeSessionId, setCompositeSessionId] = useState<string>('');

  // Generate session name on mount (always fresh, never restored)
  // FIX: Use composite userId$sessionId format for ALL users (logged-in + anonymous)
  // Anonymous users get "anon$001" format - their data is local-only until they sign up
  // Logged-in users get "12345$001" format - their data persists in the database
  useEffect(() => {
    let cancelled = false;
    if (!compositeSessionId) {
      // Clear ANY stale sessionStorage to prevent old session IDs from persisting
      if (typeof window !== 'undefined') {
        sessionStorage.removeItem('current_composite_session_id');
        sessionStorage.removeItem('current_conversation_id');
      }

      generateSessionName(undefined, true, false).then((newId) => {
        if (!cancelled) {
          if (user?.id) {
            // Logged-in user: composite format "userId$sessionNumber" (e.g., "12345$001")
            const compositeId = `${user.id}$${newId}`;
            setCompositeSessionId(compositeId);
            console.log('[ConversationInterface] Using composite session ID (authenticated):', compositeId);
          } else {
            // Anonymous user: composite format "anon$sessionNumber" (e.g., "anon$001")
            // Data is local-only until user signs up to migrate it
            const compositeId = `anon$${newId}`;
            setCompositeSessionId(compositeId);
            console.log('[ConversationInterface] Using composite session ID (anonymous):', compositeId);
          }
        }
      });
    }
    return () => {
      cancelled = true;
    };
  }, [compositeSessionId, user?.id]); // Re-run when compositeSessionId is cleared or user logs in

  // Persist compositeSessionId to sessionStorage so page refresh restores it
  useEffect(() => {
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('current_composite_session_id', compositeSessionId);
    }
  }, [compositeSessionId]);
  
  // Project name for simpler terminal paths (e.g., "webGame" instead of long session ID)
  const [projectName, setProjectName] = useState<string>('workspace');
  
  // Track if LLM folder detection has already run for this session (one-time only)
  const [llmFolderDetected, setLlmFolderDetected] = useState(false);
  // Store the detected folder name for immediate use in path resolution
  const [detectedFolderName, setDetectedFolderName] = useState<string | null>(null);
  
  // Track pending approval required for existing session file edits
  const [pendingApprovalDiffs, setPendingApprovalDiffs] = useState<{ path: string; diff: string }[]>([]);
  const [showApprovalDialog, setShowApprovalDialog] = useState(false);
  
  // CRITICAL FIX: Sanitize composite session ID for filesystem scope path.
  // filesystemScopePath is consumed by VFS, terminal, code preview, etc.
  // These consumers need SIMPLE session folder names (e.g., "004"), not composite IDs (e.g., "1$004").
  // The $ character in folder names causes path resolution issues.
  const simpleSessionFolder = useMemo(() => {
    if (!compositeSessionId) return '000';
    // If composite format (userId$sessionId), extract only the session part
    const dollarIndex = compositeSessionId.lastIndexOf('$');
    if (dollarIndex !== -1) {
      return compositeSessionId.slice(dollarIndex + 1) || compositeSessionId;
    }
    // If already simple, use as-is
    return compositeSessionId;
  }, [compositeSessionId]);

  const filesystemScopePath = useMemo(
    () => `project/sessions/${detectedFolderName || simpleSessionFolder}`,
    [detectedFolderName, simpleSessionFolder],
  );

  const providerRef = useRef(currentProvider);
  const modelRef = useRef(currentModel);
  const filesystemContextRef = useRef<{ attachedFiles: AttachedVirtualFile[]; applyFileEdits: boolean; scopePath: string }>({
    attachedFiles: [],
    applyFileEdits: true,
    scopePath: filesystemScopePath,
  });
  const compositeSessionIdRef = useRef(compositeSessionId);
  const persistedUiStateUpdatedAtRef = useRef(0);
  // NOTE: [CONTINUE_REQUESTED] auto-continue handled server-side via streamWithAutoContinue
  // and the auto-continue event handler in use-enhanced-chat.ts.
  const chatHistorySavedRef = useRef<string | null>(null);
  const diffApplyQueueRef = useRef<Promise<void>>(Promise.resolve());

  // Track processed message IDs to prevent re-processing on page reload
  const processedMessageIdsRef = useRef<Set<string>>(new Set());
  const hasLoadedInitialMessagesRef = useRef(false);

  // Track permanently rejected diffs to prevent infinite retry loops
  // Key: "resolvedPath::diff_hash", Value: failure count
  const rejectedDiffsRef = useRef<Map<string, number>>(new Map());
  const MAX_RETRY_ATTEMPTS = 2;  // After this many failures, permanently reject

  useEffect(() => {
    providerRef.current = currentProvider;
  }, [currentProvider]);

  useEffect(() => {
    modelRef.current = currentModel;
  }, [currentModel]);

  useEffect(() => {
    compositeSessionIdRef.current = compositeSessionId;
  }, [compositeSessionId]);

  // Load user API keys from secrets storage for provider override
  const apiKeysRef = useRef<Record<string, string>>({});
  const [userApiKeysLoaded, setUserApiKeysLoaded] = useState(false);

  // Reload user API keys from secrets storage
  const reloadUserApiKeys = useCallback(async () => {
    try {
      const { secrets } = await import('@bing/platform/secrets');
      const stored = await secrets.get('user-api-keys');
      if (stored) {
        apiKeysRef.current = JSON.parse(stored);
      } else {
        apiKeysRef.current = {};
      }
      setUserApiKeysLoaded(true);
      return apiKeysRef.current;
    } catch {
      setUserApiKeysLoaded(true);
      return {};
    }
  }, []);

  // Re-merge user API keys into available providers (marks them as available)
  const refreshProviderAvailability = useCallback((providers: LLMProviderConfig[], userKeys: Record<string, string>) => {
    if (Object.keys(userKeys).length === 0) return providers;
    return providers.map((p) => {
      if (userKeys[p.id]) {
        return { ...p, isAvailable: true };
      }
      return p;
    });
  }, []);

  // Initial load on mount
  useEffect(() => {
    reloadUserApiKeys();
  }, [reloadUserApiKeys]);

  // Listen for API key changes from settings panel
  useEffect(() => {
    const handleKeysChanged = async () => {
      const newKeys = await reloadUserApiKeys();

      // Update providers directly in state â€” skip server re-fetch to avoid 5-min cache staleness.
      // Mark any provider where the user has a key as available, regardless of server env vars.
      setAvailableProviders((prev) => {
        if (Object.keys(newKeys).length === 0 || prev.length === 0) return prev;
        return prev.map((p) => {
          if (newKeys[p.id]) {
            return { ...p, isAvailable: true };
          }
          return p;
        });
      });
    };

    window.addEventListener('user-api-keys-changed', handleKeysChanged);
    return () => window.removeEventListener('user-api-keys-changed', handleKeysChanged);
  }, [reloadUserApiKeys]);
  
  // Persist currentConversationId to sessionStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      if (currentConversationId) {
        sessionStorage.setItem('current_conversation_id', currentConversationId);
      } else {
        sessionStorage.removeItem('current_conversation_id');
      }
    }
  }, [currentConversationId]);
  
  useEffect(() => {
    const persisted = writePersistedConversationUiState({
      currentConversationId,
      compositeSessionId,
      currentProvider,
      currentModel,
    });
    if (persisted) {
      persistedUiStateUpdatedAtRef.current = persisted.updatedAt;
    }
  }, [currentConversationId, compositeSessionId, currentProvider, currentModel]);

  // CRITICAL FIX: Clear any stale persisted compositeSessionId on mount
  // This ensures next page reload doesn't restore stale session IDs
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const persisted = readPersistedConversationUiState();
    if (persisted?.compositeSessionId) {
      // Always clear persisted compositeSessionId to force fresh generation on next reload
      // This prevents stale session IDs like "002" from persisting across page reloads
      writePersistedConversationUiState({
        currentConversationId: persisted.currentConversationId,
        compositeSessionId: '',  // Clear to force fresh generation
        currentProvider: persisted.currentProvider,
        currentModel: persisted.currentModel,
      });
      console.log('[ConversationInterface] Cleared stale persisted compositeSessionId:', persisted.compositeSessionId);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const handleStorage = (event: StorageEvent) => {
      if (event.key !== CONVERSATION_UI_STATE_KEY || !event.newValue) {
        return;
      }

      const persisted = readPersistedConversationUiState();
      if (!persisted || persisted.updatedAt <= persistedUiStateUpdatedAtRef.current) {
        return;
      }

      persistedUiStateUpdatedAtRef.current = persisted.updatedAt;
      if (persisted.currentConversationId !== null) {
        setCurrentConversationId(persisted.currentConversationId);
      }
      // CRITICAL FIX: Don't restore compositeSessionId from storage - always use fresh generated ID
      // This prevents stale session IDs from being restored via storage events
      // if (persisted.compositeSessionId) {
      //   setCompositeSessionId(persisted.compositeSessionId);
      // }
      if (persisted.currentProvider) {
        setCurrentProvider(persisted.currentProvider);
      }
      if (persisted.currentModel) {
        setCurrentModel(persisted.currentModel);
      }
    };

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  // Expose project name setter globally for LLM/chat to update
  useEffect(() => {
    (window as any).__setProjectName = setProjectName;
  }, []);

  const [activeTab, setActiveTab] = useState<"chat" | "extras" | "integrations" | "shell">("chat");

  // Update active tab and trigger side effects
  useEffect(() => {
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

  // Diffs are now handled via SSE filesystem events + useVirtualFilesystem
  // Removed useDiffsPoller to prevent redundant polling (causes event storms)
  // File changes are automatically synced via filesystem-updated events
  const diffsPoller = {
    diffs: [],
    isPolling: false,
    lastPolledAt: null,
    pollCount: 0,
    startPolling: () => {},
    stopPolling: () => {},
    pollNow: async () => {},
    clearDiffs: () => {},
    reset: () => {},
  };

  const queueCommandDiffs = useCallback((entries: Array<{ path: string; diff: string }>) => {
    if (entries.length === 0) {
      return;
    }

    setCommandsByFile((prev) => {
      const next: Record<string, string[]> = { ...prev };
      for (const { path, diff } of entries) {
        if (!path) continue;
        const list = next[path] ? [...next[path]] : [];
        if (list.length === 0 || list[list.length - 1] !== diff) {
          list.push(diff);
          next[path] = list;
        }
      }
      return next;
    });
  }, []);



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

  useEffect(() => {
    filesystemContextRef.current = {
      attachedFiles: Object.values(attachedFilesystemFiles),
      applyFileEdits: true,
      scopePath: filesystemScopePath,
    };
  }, [attachedFilesystemFiles, filesystemScopePath]);

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
    orchestrationMode: orchestrationConfig.mode,
    body: () => ({
      provider: providerRef.current,
      model: modelRef.current,
      stream: true,
      mode: 'enhanced', // Enable spec amplification for enhanced responses
      agentMode: 'v1', // Use V1 mode for spec amplification (V2 has its own planning)
      conversationId: compositeSessionIdRef.current,
      // Pass user API keys for provider override (if user set custom keys)
      apiKeys: Object.keys(apiKeysRef.current).length > 0 ? apiKeysRef.current : undefined,
      // Pass response style parameters
      presetKey: responseStylePreset || undefined,
      responseDepth: responseStyleParams.responseDepth,
      expertiseLevel: responseStyleParams.expertiseLevel,
      reasoningMode: responseStyleParams.reasoningMode,
      tone: responseStyleParams.tone,
      creativityLevel: responseStyleParams.creativityLevel,
      citationStrictness: responseStyleParams.citationStrictness,
      outputFormat: responseStyleParams.outputFormat,
      selfCorrection: responseStyleParams.selfCorrection,
      filesystemContext: {
        attachedFiles: filesystemContextRef.current.attachedFiles.map((file) => ({
          path: file.path,
          content: file.content,
          language: file.language,
          version: file.version,
          lastModified: file.lastModified,
        })),
        applyFileEdits: true,
        scopePath: filesystemContextRef.current.scopePath,
      },
    }),
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

  // Restore chat on mount if there's a saved conversation
  useEffect(() => {
    if (currentConversationId && messages.length === 0) {
      const chat = loadChat(currentConversationId);
      if (chat) {
        setMessages(chat.messages);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run on mount

  // Save chat history whenever messages change (after AI responses)
  useEffect(() => {
    if (messages.length > 0 && !isLoading) {
      // Only save if the last message is from assistant (completed response)
      const lastMessage = messages[messages.length - 1];
      if (lastMessage && lastMessage.role === "assistant") {
        // Track last message ID to prevent duplicate saves
        const lastMessageId = lastMessage.id;
        if (chatHistorySavedRef.current === lastMessageId) {
          return; // Skip if we already saved this message
        }
        chatHistorySavedRef.current = lastMessageId;

        const savedChatId = saveCurrentChat(
          messages,
          currentConversationId || undefined,
        );
        // If it was a new chat and an ID was returned, set it as the current conversation ID
        if (!currentConversationId && savedChatId) {
          setCurrentConversationId(savedChatId);
          persistFilesystemScope(savedChatId, compositeSessionId);
        }

        // Auto-speak AI responses if voice is enabled
        if (isVoiceEnabled && voiceService.getSettings().autoSpeak) {
          voiceService.speak(lastMessage.content).catch(console.error);
        }

        // NOTE: [CONTINUE_REQUESTED] auto-continue is now handled server-side
        // in streamWithAutoContinue â†’ emits 'auto-continue' event â†’
        // useEnhanced-chat strips the token and auto-submits continuation.
        // No UI-side duplication needed.
      }
    }
  }, [
    messages,
    isLoading,
    saveCurrentChat,
    currentConversationId,
    compositeSessionId,
    isVoiceEnabled,
    handleSubmit,
    setInput
  ]);

  // Extract and persist streamed COMMANDS blocks into a per-file map
  useEffect(() => {
    if (messages.length === 0) return;

    // Skip processing on initial load - messages are already persisted
    if (!hasLoadedInitialMessagesRef.current) {
      hasLoadedInitialMessagesRef.current = true;
      // Mark all existing messages as processed to prevent re-processing on page reload
      messages.forEach(m => processedMessageIdsRef.current.add(m.id));
      console.log('[ConversationInterface] Initial load - marked', messages.length, 'messages as processed');
      return;
    }

    const lastAssistant = [...messages]
      .reverse()
      .find((m) => m.role === "assistant");
    if (!lastAssistant || typeof lastAssistant.content !== "string") return;

    const assistantContent = lastAssistant.content.trim();
    const isIncompleteResponse =
      assistantContent.includes('âš ï¸ _Response may be incomplete due to a connection issue._') ||
      (lastAssistant as any)?.metadata?.isPending === true;

    // CRITICAL FIX: Don't process while streaming - wait for complete content
    // This ensures we parse complete file diffs, not partial content
    // Also skip parsing for incomplete/truncated responses
    if (isLoading || !assistantContent || isIncompleteResponse) {
      return;
    }

    // Skip if already processed this message ID (after streaming complete)
    if (processedMessageIdsRef.current.has(lastAssistant.id)) {
      return;
    }
    processedMessageIdsRef.current.add(lastAssistant.id);

    // Create context for API response processing (simplified - no longer need input-response-separator)
    // Directly parse the response using file-edit-parser
    const parsedResponse = parseFilesystemResponse(lastAssistant.content);

    // Convert to legacy format for compatibility with existing code
    const processedResponse = {
      mode: parsedResponse.writes.length > 0 || parsedResponse.diffs.length > 0 ? 'code' as const : 'chat' as const,
      content: lastAssistant.content,
      codeBlocks: [],
      fileDiffs: [
        ...parsedResponse.writes.map(w => ({ path: w.path, diff: w.content, type: 'create' as const })),
        ...parsedResponse.diffs.map(d => ({ path: d.path, diff: d.diff, type: 'modify' as const })),
      ],
      shouldShowDiffs: parsedResponse.writes.length > 0 || parsedResponse.diffs.length > 0,
      shouldOpenCodePreview: parsedResponse.writes.length > 0 || parsedResponse.diffs.length > 0,
      isInputParsing: false,
    };

    // Only process diffs if we have file edits
    if (!processedResponse.shouldShowDiffs || !processedResponse.fileDiffs.length) return;

    // LLM Folder Detection: Check if AI response indicates a new project with single folder structure
    // This only applies to NEW sessions (no prior messages/files) with multiple files under one folder
    // Only run once per session to avoid re-triggering
    // CRITICAL: This MUST run BEFORE applying diffs to ensure files go to correct session folder
    const detectedFolder = !llmFolderDetected && detectNewProjectFolder(lastAssistant.content);

    // Check if this is the first message being processed (initial project creation)
    const isFirstMessage = processedMessageIdsRef.current.size === 1;
    if (detectedFolder && isFirstMessage) {
      // Only apply for new sessions with no prior messages - use LLM-suggested folder name
      // Set the detected folder name immediately for use in path resolution
      setDetectedFolderName(detectedFolder);

      // Generate the official session name (handles conflicts, registers in usedNames, etc.)
      generateSessionName(detectedFolder, true, true).then((newSessionId) => {
        setCompositeSessionId(newSessionId);
        setLlmFolderDetected(true); // Mark as detected to prevent re-triggering
        toast.success(`Project initialized: ${newSessionId}`);
      });
    }

    const newEntries: { path: string; diff: string }[] = processedResponse.fileDiffs.map(fileDiff => ({
      path: fileDiff.path,
      diff: fileDiff.diff,
    }));

    // CRITICAL FIX: Filter out obviously invalid paths BEFORE conflict detection
    // This prevents infinite loops on malformed LLM output (JSX attributes, CSS values, etc.)
    const validEntries = newEntries.filter(entry => {
      const path = entry.path?.trim();
      if (!path) {
        console.warn('[ConversationInterface] Filtering out entry with empty path');
        return false;
      }

      // Reject paths ending with quotes (likely extracted from JSX/HTML attributes)
      if (path.endsWith('"') || path.endsWith("'") || path.endsWith('`')) {
        console.warn('[ConversationInterface] Filtering out path ending with quote (JSX/HTML fragment):', path);
        return false;
      }

      // Reject paths with spaces in the last segment (likely not a real file path)
      const lastSegment = path.split('/').pop() || path;
      if (/\s/.test(lastSegment)) {
        console.warn('[ConversationInterface] Filtering out path with space in filename:', path);
        return false;
      }

      // Reject paths that are too short or too long
      if (path.length < 3 || path.length > 500) {
        console.warn('[ConversationInterface] Filtering out path with invalid length:', path);
        return false;
      }

      // Reject paths containing obvious code fragments
      const codeFragmentPatterns = [
        /["']\s*[>,)]\s*$/,  // Ends with quote followed by JSX/JS punctuation
        /^\s*[<{]/,          // Starts with JSX/JS opening brackets
        /[;}]\s*$/,          // Ends with JS closing brace/semicolon
        /^\s*import\s+/,     // Import statement fragment
        /^\s*export\s+/,     // Export statement fragment
        /^\s*const\s+/,      // Variable declaration
        /^\s*function\s+/,   // Function declaration
      ];
      if (codeFragmentPatterns.some(pattern => pattern.test(path))) {
        console.warn('[ConversationInterface] Filtering out path that looks like code fragment:', path);
        return false;
      }

      return true;
    });

    if (validEntries.length === 0) {
      console.log('[ConversationInterface] All entries filtered out as invalid - skipping diff application');
      return;
    }

    if (validEntries.length !== newEntries.length) {
      console.log(`[ConversationInterface] Filtered from ${newEntries.length} to ${validEntries.length} valid entries`);
    }

    if (validEntries.length === 0) return;

    // Rule #2: For existing sessions, check if edits would overwrite existing files
    // SMART CONFLICT DETECTION:
    // - Editing existing files = OK (auto-apply, this is expected behavior)
    // - New files with same names as existing = CONFLICT (require approval)
    // - LLM suggesting folder name that exists = Check if folder is empty
    const isExistingSession = currentConversationId !== null || messages.length > 0;

    if (isExistingSession) {
      // DEBOUNCE: Wait 500ms before checking conflicts to prevent request storms on app load
      const debounceTimer = setTimeout(async () => {
        // Query actual filesystem state for accurate conflict detection
        let existingFilePaths: string[] = [];

        try {
          const listResponse = await fetch(`/api/filesystem/list?path=${encodeURIComponent(filesystemScopePath)}`, {
            headers: buildFilesystemHeaders(),
          });

          if (listResponse.ok) {
            const payload = await listResponse.json().catch(() => null);
            if (payload?.success && payload?.data?.nodes) {
              // Get file paths from the actual filesystem
              existingFilePaths = payload.data.nodes
                .filter((node: any) => node.type === 'file')
                .map((node: any) => node.path);
            } else {
              // Malformed payload - treat as error
              throw new Error('Invalid filesystem list response');
            }
          } else if (listResponse.status === 429) {
            // Rate limited - skip conflict check for NOW, use attached files as fallback
            // DO NOT permanently reject - rate limits are transient
            console.warn('[ConflictCheck] Rate limited, using cached filesystem state');
            existingFilePaths = Object.keys(attachedFilesystemFiles);
          } else {
            // Non-OK response - treat as error
            throw new Error(`Filesystem list failed: ${listResponse.status}`);
          }
        } catch (listError) {
          console.warn('Failed to query filesystem for conflict detection:', listError);
          // Fall back to attached files if API fails
          existingFilePaths = Object.keys(attachedFilesystemFiles);
        }

        const newFilePaths = validEntries.map(e => e.path);

        // SMART CONFLICT LOGIC:
        // 1. Check if ALL new files are editing existing files (expected behavior - auto-apply)
        // 2. Check if ANY new files would create conflicts with different content (require approval)
        const allFilesExist = newFilePaths.every(newPath =>
          existingFilePaths.some(existingPath => existingPath.toLowerCase() === newPath.toLowerCase())
        );

        // If all files being edited already exist, this is expected behavior - auto-apply
        // This allows AI to fix bugs, update code, etc. in existing sessions
        if (allFilesExist && newFilePaths.length > 0) {
          console.log('[ConflictCheck] All files exist - this is an edit operation, auto-applying');
          queueCommandDiffs(validEntries);
          // Auto-apply the detected diffs immediately
          if (applyDiffsRef.current) {
            void applyDiffsRef.current(validEntries);
          }
          return;
        }

        // Some files are new, check for actual conflicts
        const conflictCheck = checkFileConflicts(existingFilePaths, newFilePaths, true);

        if (conflictCheck.needsApproval) {
          // Store pending diffs for approval instead of auto-applying
          setPendingApprovalDiffs(validEntries);
          setShowApprovalDialog(true);
          toast.info(`${conflictCheck.existingFiles.length} file(s) would be overwritten. Review required.`);

          // Still store in commandsByFile for manual review
          queueCommandDiffs(validEntries);
          return; // Don't auto-apply - require approval
        }

        // Auto-apply the detected diffs immediately to trigger filesystem event for MessageBubble UI
        // The diffs will also be stored in commandsByFile for manual review/revert
        queueCommandDiffs(validEntries);
        if (applyDiffsRef.current) {
          void applyDiffsRef.current(validEntries);
        }
      }, 500); // 500ms debounce

      // Cleanup debounce timer on unmount or when dependencies change
      return () => {
        if (debounceTimer) clearTimeout(debounceTimer);
      };
    }

    // Auto-apply the detected diffs immediately to trigger filesystem event for MessageBubble UI
    // The diffs will also be stored in commandsByFile for manual review/revert
    queueCommandDiffs(validEntries);
    if (applyDiffsRef.current) {
      void applyDiffsRef.current(validEntries);
    }
  }, [messages, attachedFilesystemFiles, currentConversationId, filesystemScopePath, queueCommandDiffs, isLoading]);

  // Reset processed message tracking when switching conversations
  useEffect(() => {
    if (!currentConversationId) return;
    
    // Clear processed IDs and reset initial load flag for new conversation
    processedMessageIdsRef.current.clear();
    hasLoadedInitialMessagesRef.current = false;
    
    console.log('[ConversationInterface] Conversation changed - reset processed tracking');
  }, [currentConversationId]);

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
  // Also merges user-provided API keys so providers with user keys appear in dropdown
  useEffect(() => {
    fetch("/api/providers", { credentials: 'include' })
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          let providers: LLMProviderConfig[] = data.data.providers || [];

          // Merge user-provided API keys: mark providers as available if user has a key
          providers = refreshProviderAvailability(providers, apiKeysRef.current);

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
  }, [refreshProviderAvailability]);

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

  // Function to update session ID based on LLM's suggested folder name
  // Called when AI response indicates a single-folder project structure
  const updateSessionFromLLM = useCallback((suggestedFolderName: string) => {
    // Only update if this is a new session (no existing files)
    // and the name is valid
    const cleanName = suggestedFolderName.replace(/[^a-zA-Z0-9_-]/g, '').substring(0, 50);
    if (cleanName.length > 0 && messages.length === 0) {
      generateSessionName(cleanName, true, true).then((newSessionId) => {
        setCompositeSessionId(newSessionId);
        toast.success(`Project initialized: ${newSessionId}`);
      });
    }
  }, [messages.length]);

  // Expose the LLM folder detection function globally for AI responses
  useEffect(() => {
    (window as any).__updateSessionFromLLM = updateSessionFromLLM;
  }, [updateSessionFromLLM]);

  const handleNewChat = () => {
    const isEmpty = messages.length === 0;
    if (!isEmpty) {
      // Save the current chat before starting a new one, if there are messages
      saveCurrentChat(messages, currentConversationId || undefined);
    }

    // Clean up any active streaming sessions
    streamingState.cleanupCompletedSessions();

    // Clear filesystem session ID synchronously FIRST to prevent stale session access
    // This ensures no file operations can target the previous workspace
    setCompositeSessionId('');
    compositeSessionIdRef.current = '';

    setMessages([]);
    setCurrentConversationId(null); // Ensure current conversation ID is reset for a new chat
    
    // Reset LLM folder detection flag for new session
    setLlmFolderDetected(false);
    // Reset approval state for new session
    setPendingApprovalDiffs([]);
    setShowApprovalDialog(false);

    // Update chat history to reflect the saved chat
    setChatHistory(getAllChats());

    toast.success("New chat started");
    
    // Generate new session name asynchronously AFTER state is cleared
    // This will trigger the useEffect which handles the actual generation
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
      setCompositeSessionId(restoredScopeId || chatId);
      // Reset approval state when loading different chat
      setPendingApprovalDiffs([]);
      setShowApprovalDialog(false);
      toast.success("Chat loaded");
    }

    // Update chat history to reflect any changes
    setChatHistory(getAllChats());
    setShowHistory(false);
  };

  const handleProviderChange = useCallback((provider: string, model: string) => {
    setCurrentProvider(provider);
    setCurrentModel(model);
    // Persist selection
    try {
      localStorage.setItem("chat_provider", provider);
      localStorage.setItem("chat_model", model);
    } catch {}
    toast.success(`Switched to ${provider} - ${model}`);
  }, []);

  // Auto-rotate to next provider
  const rotateToNextProvider = useCallback(() => {
    if (availableProviders.length <= 1) return;

    const currentProviderIndex = availableProviders.findIndex(
      (p) => p.id === currentProvider,
    );
    const nextIndex = (currentProviderIndex + 1) % availableProviders.length;
    const nextProvider = availableProviders[nextIndex];

    if (nextProvider && nextProvider.models.length > 0) {
      const nextModel = nextProvider.models[0]; // Use first model of next provider
      handleProviderChange(nextProvider.id, nextModel);
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

  // Check if there are code blocks in messages for preview button glow (legacy markdown code blocks)
  const hasCodeBlocks = useMemo(() => {
    return messages.some(
      (message) =>
        message.role === "assistant" && message.content.includes("```"),
    );
  }, [messages]);

  // Track VFS MCP file edits for code preview button glow
  // VFS tools write files directly without markdown code blocks, so we need separate tracking
  const [hasMcpFileEdits, setHasMcpFileEdits] = useState(false);

  useEffect(() => {
    const unsubscribe = onFilesystemUpdated((event) => {
      const source = event?.detail?.source;
      // Light up the code preview button when files are edited via MCP tools
      if (source?.startsWith('mcp-tool')) {
        setHasMcpFileEdits(true);
      }
    });
    return () => unsubscribe();
  }, []);

  // Reset MCP file edit tracking when conversation changes
  useEffect(() => {
    setHasMcpFileEdits(false);
  }, [currentConversationId]);

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
    void applyDiffsToFilesystemQueued(entries);
  };

  const applyDiffsForFile = (path: string) => {
    const diffs = commandsByFile[path] || [];
    if (diffs.length === 0) return;
    const entries = diffs.map((diff) => ({ path, diff }));
    void applyDiffsToFilesystemQueued(entries);
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

  const applyDiffsToFilesystem = useCallback(async (entries: Array<{ path: string; diff: string }>) => {
    if (!entries.length) return;
    const scopePath = filesystemScopePath || "project";
    const failed: Record<string, string[]> = {};
    let appliedCount = 0;
    let lastWriteMetadata: {
      workspaceVersion?: number;
      commitId?: string;
      sessionId?: string | null;
    } | null = null;

    console.debug('[applyDiffsToFilesystem] Starting diff application', {
      entryCount: entries.length,
      entries: entries.map(e => ({ path: e.path, diffLength: e.diff.length, diffPreview: e.diff.slice(0, 200) })),
      filesystemScopePath: scopePath,
      compositeSessionId,
    });

    // Create simple hash for diff tracking
    function hashDiff(diff: string): string {
      return diff.length.toString(36) + '-' + diff.slice(0, 20).replace(/\s/g, '');
    }

    // Client-side path validation to prevent retry loops on invalid paths
    // Matches server-side validation and pre-filter validation
    function isValidFilePath(path: string): boolean {
      const lastSegment = path.split('/').pop() || path;

      // CRITICAL: Reject paths ending with quotes (JSX/HTML fragments)
      if (path.endsWith('"') || path.endsWith("'") || path.endsWith('`')) {
        console.warn('[applyDiffsToFilesystem] Rejecting path ending with quote (JSX fragment):', path);
        return false;
      }

      // Reject CSS values, SCSS variables, operators, etc.
      if (/^[0-9.]+[a-z]*$/i.test(lastSegment)) return false;  // "0.3s", "10px"
      if (/^\$/.test(lastSegment)) return false;  // SCSS variables
      if (/^[@.#:]/.test(lastSegment)) return false;  // CSS selectors
      if (/^[,;:!?()\[\]{}\/]+$/.test(lastSegment)) return false;  // Operators
      if (/^v-/.test(lastSegment)) return false;  // Vue directives
      if (/[,\s]$/.test(lastSegment)) return false;  // Trailing comma/space
      
      // Reject paths with spaces in filename
      if (/\s/.test(lastSegment)) return false;

      return true;
    }

    for (const entry of entries) {
      const resolvedPath = resolveScopedPath(entry.path, scopePath);
      
      // Check if this diff has been permanently rejected (exceeded retry limit)
      const diffKey = `${resolvedPath}::${hashDiff(entry.diff)}`;
      const failureCount = rejectedDiffsRef.current.get(diffKey) || 0;
      if (failureCount >= MAX_RETRY_ATTEMPTS) {
        console.warn('[applyDiffsToFilesystem] Skipping permanently rejected diff (exceeded retry limit):', {
          path: resolvedPath,
          failureCount,
          diffLength: entry.diff.length,
        });
        continue;  // Skip this diff permanently
      }

      // CRITICAL FIX: Skip obviously invalid paths BEFORE attempting read
      // This prevents infinite retry loops on CSS values, SCSS variables, etc.
      if (!isValidFilePath(resolvedPath)) {
        console.warn('[applyDiffsToFilesystem] Skipping invalid path (CSS value, SCSS var, etc.):', resolvedPath);
        // Mark as permanently rejected to prevent retry
        rejectedDiffsRef.current.set(diffKey, MAX_RETRY_ATTEMPTS);
        failed[entry.path] = failed[entry.path] || [];
        failed[entry.path].push(entry.diff);
        continue;
      }
      
      // CRITICAL FIX: Skip empty diffs entirely - don't add to failed list, just ignore
      // This prevents infinite loops on malformed LLM output
      if (!entry.diff || entry.diff.trim().length === 0) {
        console.debug('[applyDiffsToFilesystem] Skipping empty diff (prevents infinite loop):', resolvedPath);
        continue;
      }
      
      let currentContent = "";
      let readErrorMsg: string | null = null;
      try {
        const readResponse = await fetch("/api/filesystem/read", {
          method: "POST",
          headers: buildFilesystemHeaders(),
          body: JSON.stringify({ path: resolvedPath }),
        });
        if (readResponse.ok) {
          const payload = await readResponse.json().catch(() => null);
          if (payload?.success && payload?.data?.content != null) {
            currentContent = payload.data.content;
          }
        } else if (readResponse.status === 404) {
          // File doesn't exist yet - this is OK for new file creation
          // Set empty content and let diff/create logic handle it
          currentContent = "";
          readErrorMsg = null; // Clear error for 404 - it's expected for new files
        } else if (readResponse.status === 400 || readResponse.status === 429) {
          // Invalid path or rate limited - skip this file to prevent retry loop
          console.warn('[applyDiffsToFilesystem] Skipping path due to server rejection:', resolvedPath, 'status:', readResponse.status);
          // Mark as permanently rejected for 429 (rate limit) or 400 (invalid path)
          rejectedDiffsRef.current.set(diffKey, MAX_RETRY_ATTEMPTS);
          failed[entry.path] = failed[entry.path] || [];
          failed[entry.path].push(entry.diff);
          continue;
        } else {
          readErrorMsg = `Read failed with status ${readResponse.status}`;
        }
      } catch (readError: any) {
        readErrorMsg = readError.message || 'Network error during read';
        currentContent = "";
      }

      const patchResult = await smartApply({
        content: currentContent,
        path: entry.path,
        diff: entry.diff,
        // LLM repair callback: asks the chat API to fix a broken diff
        llm: async (prompt: string): Promise<string> => {
          try {
            const response = await fetch('/api/chat', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', ...buildFilesystemHeaders() },
              body: JSON.stringify({
                messages: [{ role: 'user', content: prompt }],
                provider: 'openai',
                model: 'gpt-4o-mini',
                maxTokens: 4000,
                temperature: 0,
              }),
            });
            if (!response.ok) return '';
            const data = await response.json();
            return data.content || data.response || '';
          } catch {
            return '';
          }
        },
      });

      const nextContent = patchResult.content;

      if (patchResult.strategy !== 'unified') {
        console.debug('[applyDiffsToFilesystem] Used strategy:', patchResult.strategy, {
          path: resolvedPath,
          confidence: patchResult.confidence,
          attempts: patchResult.attempts,
        });
      }

      if (nextContent == null) {
        // Track failure for retry limit
        rejectedDiffsRef.current.set(diffKey, failureCount + 1);
        
        failed[entry.path] = failed[entry.path] || [];
        failed[entry.path].push(entry.diff);
        console.warn('[applyDiffsToFilesystem] Diff application returned null', {
          path: resolvedPath,
          currentContentLength: currentContent.length,
          currentContentPreview: currentContent.slice(0, 300),
          diffPreview: entry.diff.slice(0, 500),
          readError: readErrorMsg,
          isNewFile: currentContent === "" && !readErrorMsg,
          suggestion: readErrorMsg
            ? 'File may not exist or read error occurred'
            : 'Diff may not match current content or is malformed',
          failureCount: failureCount + 1,
          willRetry: failureCount + 1 < MAX_RETRY_ATTEMPTS,
        });
        continue;
      }

      if (nextContent === currentContent) {
        appliedCount += 1;
        console.debug('[applyDiffsToFilesystem] Diff produced no change (already applied or no-op)', {
          path: resolvedPath,
          contentLength: currentContent.length,
        });
        continue;
      }

      try {
        const writeResponse = await fetch("/api/filesystem/write", {
          method: "POST",
          headers: buildFilesystemHeaders(),
          body: JSON.stringify({
            path: resolvedPath,
            content: nextContent,
            sessionId: compositeSessionId,
            source: "command-diff",
            integration: "command-diff",
          }),
        });
        if (!writeResponse.ok) {
          const text = await writeResponse.text().catch(() => "");
          throw new Error(text || `Write failed (${writeResponse.status})`);
        }
        const payload = await writeResponse.json().catch(() => null);
        if (!payload?.success) {
          throw new Error(payload?.error || "Write failed");
        }
        lastWriteMetadata = {
          workspaceVersion: payload?.data?.workspaceVersion,
          commitId: payload?.data?.commitId,
          sessionId: payload?.data?.sessionId,
        };
        appliedCount += 1;
        console.debug('[applyDiffsToFilesystem] Diff applied successfully', {
          path: resolvedPath,
          previousContentLength: currentContent.length,
          newContentLength: nextContent.length,
        });
      } catch (writeError: any) {
        // Track failure for retry limit
        rejectedDiffsRef.current.set(diffKey, failureCount + 1);
        
        failed[entry.path] = failed[entry.path] || [];
        failed[entry.path].push(entry.diff);
        console.warn('[applyDiffsToFilesystem] Write failed', {
          path: resolvedPath,
          error: writeError.message,
          nextContentLength: nextContent.length,
          failureCount: failureCount + 1,
          willRetry: failureCount + 1 < MAX_RETRY_ATTEMPTS,
        });
      }
    }

    if (appliedCount > 0) {
      // CRITICAL FIX: Don't emit filesystem event for self-applied diffs
      // This prevents infinite read loops where:
      // 1. We apply diffs â†’ emit event â†’ trigger refresh â†’ re-read files â†’ apply diffs again
      // The files are already updated in the VFS, no need to trigger refresh
      console.debug('[applyDiffsToFilesystem] Skipping emitFilesystemUpdated for self-applied diffs (prevents infinite loop)', {
        appliedCount,
        scopePath: filesystemScopePath,
      });
      // emitFilesystemUpdated({
      //   scopePath: filesystemScopePath || "project",
      //   paths: entries.map((entry) => resolveScopedPath(entry.path, scopePath)),
      //   source: "command-diff",
      //   workspaceVersion: lastWriteMetadata?.workspaceVersion,
      //   commitId: lastWriteMetadata?.commitId,
      //   sessionId: lastWriteMetadata?.sessionId || compositeSessionId,
      // });
    }

    setCommandsByFile((prev) => {
      const attemptedPaths = new Set(entries.map((entry) => entry.path));
      const next: Record<string, string[]> = {};
      for (const [path, diffs] of Object.entries(prev)) {
        const remaining = failed[path] || [];
        if (attemptedPaths.has(path)) {
          if (remaining.length > 0) {
            next[path] = remaining;
          }
        } else {
          next[path] = diffs;
        }
      }
      return next;
    });

    if (appliedCount > 0) {
      toast.success(`Applied ${appliedCount} diff${appliedCount === 1 ? "" : "s"} to filesystem.`);
    }
    const failedCount = Object.values(failed).reduce((sum, list) => sum + list.length, 0);
    if (failedCount > 0) {
      // failed contains diff payloads (strings), not error messages
      // Group by file path for better user feedback
      const failedPaths = Object.keys(failed);
      const totalFailedDiffs = failedCount;
      
      toast.error(`Diff application failed: ${totalFailedDiffs} edit(s) could not be applied to ${failedPaths.length} file(s). This usually means the file content has changed since the diff was generated. Please review the files and try again.`);
      console.error('[Diff Application Failed]', {
        failedFiles: failedPaths,
        failedDiffs: failed,
        reason: 'Search blocks not found or patches could not be applied',
        totalEntriesAttempted: entries.length,
        appliedCount,
        failedCount: totalFailedDiffs,
        sessionId: compositeSessionId,
        scopePath,
      });
    }
  }, [filesystemScopePath, compositeSessionId]);

  const applyDiffsToFilesystemQueued = useCallback((entries: Array<{ path: string; diff: string }>) => {
    if (!entries.length) {
      return Promise.resolve();
    }

    const run = async () => {
      await applyDiffsToFilesystem(entries);
    };

    const queued = diffApplyQueueRef.current.then(run, run);
    diffApplyQueueRef.current = queued.catch(() => {});
    return queued;
  }, [applyDiffsToFilesystem]);

  // Ref to hold applyDiffsToFilesystem for use in useEffect (before callback definition)
  const applyDiffsRef = useRef(applyDiffsToFilesystemQueued);
  useEffect(() => {
    applyDiffsRef.current = applyDiffsToFilesystemQueued;
  }, [applyDiffsToFilesystemQueued]);

  // Apply polled diffs to filesystem (defined after applyDiffsToFilesystem)
  const applyPolledDiffs = useCallback(async (pathsToApply?: string[]) => {
    const diffsToApply = pathsToApply
      ? diffsPoller.diffs.filter(d => pathsToApply.includes(d.path))
      : diffsPoller.diffs;

    if (diffsToApply.length === 0) {
      toast.info("No polled diffs to apply.");
      return;
    }

    const entries = diffsToApply.map(d => ({ path: d.path, diff: d.diff }));
    try {
      await applyDiffsToFilesystemQueued(entries);
    } finally {
      // Clear the applied diffs from the poller after apply completes
      diffsPoller.clearDiffs();
    }
  }, [diffsPoller.diffs, applyDiffsToFilesystemQueued, diffsPoller.clearDiffs]);

  // Handle chat submission - no login restrictions
  const refreshAttachedFiles = useCallback(async (
    files: Record<string, AttachedVirtualFile>,
    scopePath: string,
  ): Promise<Record<string, AttachedVirtualFile>> => {
    const entries = Object.values(files);
    if (entries.length === 0) return files;

    const headers = buildFilesystemHeaders();
    const refreshed = await Promise.all(entries.map(async (file) => {
      const resolvedPath = resolveScopedPath(file.path, scopePath);
      try {
        const response = await fetch("/api/filesystem/read", {
          method: "POST",
          headers,
          body: JSON.stringify({ path: resolvedPath }),
        });
        if (!response.ok) {
          return file;
        }
        const payload = await response.json().catch(() => null);
        if (!payload?.success || !payload?.data) {
          return file;
        }
        const data = payload.data;
        return {
          path: data.path || resolvedPath,
          content: typeof data.content === "string" ? data.content : file.content,
          language: data.language || file.language,
          version: typeof data.version === "number" ? data.version : file.version,
          lastModified: data.lastModified || file.lastModified,
        } as AttachedVirtualFile;
      } catch {
        return file;
      }
    }));

    const next: Record<string, AttachedVirtualFile> = {};
    for (const entry of refreshed) {
      next[entry.path] = entry;
    }
    return next;
  }, []);

  const attachmentRefreshState = useRef({
    lastRefreshAt: 0,
    inFlight: false,
    timer: null as ReturnType<typeof setTimeout> | null,
  });
  const lastAttachmentWorkspaceVersionRef = useRef(0);

  const scheduleAttachmentRefresh = useCallback((reason: string) => {
    if (Object.keys(attachedFilesystemFiles).length === 0) return;

    const now = Date.now();
    const MIN_REFRESH_MS = 3000;
    const state = attachmentRefreshState.current;
    const elapsed = now - state.lastRefreshAt;
    const delay = Math.max(0, MIN_REFRESH_MS - elapsed);

    if (state.timer) {
      return;
    }

    state.timer = setTimeout(async () => {
      state.timer = null;
      if (state.inFlight) return;
      state.inFlight = true;
      try {
        const refreshed = await refreshAttachedFiles(attachedFilesystemFiles, filesystemScopePath);
        setAttachedFilesystemFiles(refreshed);
        filesystemContextRef.current = {
          attachedFiles: Object.values(refreshed),
          applyFileEdits: true,
          scopePath: filesystemScopePath,
        };
      } finally {
        state.inFlight = false;
        state.lastRefreshAt = Date.now();
      }
    }, delay);
  }, [attachedFilesystemFiles, filesystemScopePath, refreshAttachedFiles]);

  useEffect(() => {
    const unsubscribe = onFilesystemUpdated((event) => {
      const scopePath = event?.detail?.scopePath;
      if (scopePath && scopePath !== filesystemScopePath) {
        return;
      }
      const workspaceVersion = event?.detail?.workspaceVersion;
      if (typeof workspaceVersion === 'number') {
        if (workspaceVersion <= lastAttachmentWorkspaceVersionRef.current) {
          return;
        }
        lastAttachmentWorkspaceVersionRef.current = workspaceVersion;
      }
      scheduleAttachmentRefresh('filesystem-updated');
    });
    return () => {
      unsubscribe();
      const state = attachmentRefreshState.current;
      if (state.timer) {
        clearTimeout(state.timer);
        state.timer = null;
      }
    };
  }, [filesystemScopePath, scheduleAttachmentRefresh]);

  useEffect(() => {
    if (Object.keys(attachedFilesystemFiles).length === 0) return;
    const interval = setInterval(() => {
      scheduleAttachmentRefresh('interval');
    }, 15000);
    return () => clearInterval(interval);
  }, [attachedFilesystemFiles, scheduleAttachmentRefresh]);

  const handleChatSubmit = async (content: string) => {
    // Increment prompt count for tracking (no restrictions)
    if (!isLoggedIn) {
      setPromptCount((prev) => prev + 1);
    }

    let refreshedFiles = attachedFilesystemFiles;
    if (Object.keys(attachedFilesystemFiles).length > 0) {
      refreshedFiles = await refreshAttachedFiles(attachedFilesystemFiles, filesystemScopePath);
      setAttachedFilesystemFiles(refreshedFiles);
      filesystemContextRef.current = {
        attachedFiles: Object.values(refreshedFiles),
        applyFileEdits: true,
        scopePath: filesystemScopePath,
      };
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
    persistFilesystemScope(currentConversationId, compositeSessionId);
  }, [currentConversationId, compositeSessionId]);

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

  // Handle approval for pending file edits in existing sessions
  const handleApproveEdits = useCallback(async () => {
    if (pendingApprovalDiffs.length === 0) return;
    
    if (applyDiffsRef.current) {
      await applyDiffsRef.current(pendingApprovalDiffs);
    }
    
    setPendingApprovalDiffs([]);
    setShowApprovalDialog(false);
    toast.success("File edits approved and applied");
  }, [pendingApprovalDiffs]);

  const handleDenyEdits = useCallback(() => {
    setPendingApprovalDiffs([]);
    setShowApprovalDialog(false);
    toast.info("File edits denied");
  }, []);

  // Memoized callbacks for InteractionPanel to prevent unnecessary re-renders
  const toggleAccessibility = useCallback(() => setShowAccessibility(prev => !prev), []);
  const toggleResponseStyle = useCallback((enabled: boolean) => {
    setShowResponseStyle(enabled);
    localStorage.setItem('show_response_style', String(enabled));
  }, []);
  const toggleHistory = useCallback(() => setShowHistory(prev => !prev), []);
  const toggleCodePreview = useCallback(() => {
    handleToggleCodePreview();
  }, [handleToggleCodePreview]);

  // Chat panel resize handlers
  const handleChatResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsChatResizing(true);
    chatResizeStartX.current = e.clientX;
    chatResizeStartWidth.current = chatPanelWidth;
    chatSnapThreshold.current = false;
  }, [chatPanelWidth]);

  useEffect(() => {
    if (!isChatResizing) return;
    
    const handleChatResizeMove = (e: MouseEvent) => {
      const delta = e.clientX - chatResizeStartX.current;
      // Reverse: dragging left makes panel wider, dragging right makes it narrower
      let newWidth = chatResizeStartWidth.current - delta;
      
      // Min/max constraints
      newWidth = Math.max(300, Math.min(1200, newWidth));
      
      // Check snap threshold to workspace panel (within 20px of edge when workspace is open)
      if (isWorkspaceOpen) {
        const snapPoint = 400; // Approximate workspace panel width
        const distanceToSnap = Math.abs(newWidth - snapPoint);
        chatSnapThreshold.current = distanceToSnap < 20;
      }
      
      setChatPanelWidth(newWidth);
    };
    
    const handleChatResizeEnd = () => {
      setIsChatResizing(false);
      
      // Optional snap to workspace panel edge (user must intentionally drag to snap point)
      if (isWorkspaceOpen && chatSnapThreshold.current) {
        setChatPanelWidth(400); // Snap to workspace panel edge
      }
    };
    
    document.addEventListener('mousemove', handleChatResizeMove);
    document.addEventListener('mouseup', handleChatResizeEnd);
    
    return () => {
      document.removeEventListener('mousemove', handleChatResizeMove);
      document.removeEventListener('mouseup', handleChatResizeEnd);
    };
  }, [isChatResizing, isWorkspaceOpen]);

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
        {/* Horizontal space filler - allows ChatPanel to expand on desktop */}
        <HorizontalSpaceFiller />
        
        {/* Main content area - hidden on mobile when chat is active */}
        <div className="hidden md:flex flex-1 flex-col">
          <div className="flex-1 relative">
            {/* Placeholder for the main 3D scene or other content */}
          </div>
        </div>

        {/* Chat Panel - full width on mobile, resizable on desktop */}
        <div 
          className="relative z-10 flex flex-col min-h-0 w-full md:border-l md:border-white/10"
          style={{ 
            width: isDesktop ? chatPanelWidth : '100%',
            minWidth: '300px',
            maxWidth: '1200px',
          } as React.CSSProperties}
        >
          {/* Resize handle - thin invisible line on left edge */}
          <div
            className={`absolute left-0 top-0 bottom-0 w-1 cursor-ew-resize z-20 transition-colors ${
              isChatResizing 
                ? 'bg-blue-400/50' 
                : chatSnapThreshold.current 
                  ? 'bg-cyan-400/70'  // Show snap indicator
                  : 'hover:bg-white/30 bg-transparent'
            }`}
            onMouseDown={handleChatResizeStart}
            title="Drag to resize chat panel"
          />
          {/* Header showing current provider/model */}
          {!embedMode && (
            <div className="flex items-center justify-between px-3 py-2 border-b border-white/10 bg-black/30">
              <div className="text-xs text-white/70 truncate">
                <span className="mr-2">Provider:</span>
                <span className="font-medium text-white">
                  {currentProvider || "â€”"}
                </span>
                <span className="mx-2 text-white/40">|</span>
                <span className="mr-2">Model:</span>
                <span className="font-medium text-white truncate inline-block max-w-[60%] align-bottom">
                  {currentModel || "â€”"}
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
            onShowHistory={() => { setShowHistory(true); }} // Map to setShowHistory
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
        onSubmit={(content) => {
          setTimeout(() => {
            void handleChatSubmit(content);
          }, 0);
        }}
        onNewChat={handleNewChat}
        isProcessing={isLoading}
        allowInputWhileProcessing={true}
        toggleAccessibility={toggleAccessibility}
        toggleHistory={toggleHistory}
        toggleCodePreview={toggleCodePreview}
        onStopGeneration={() => {
          // Abort the current request
          stop();
          // Note: We do NOT clear pendingInput - if user typed during processing,
          // it stays queued and will be sent when they press Send again
          // This allows them to continue their thought after stopping
        }}
        onRetry={handleRetry}
        currentProvider={currentProvider}
        currentModel={currentModel}
        error={error?.message}
        input={input}
        setInput={setInput}
        availableProviders={availableProviders}
        onProviderChange={handleProviderChange}
        hasCodeBlocks={hasCodeBlocks}
        hasMcpFileEdits={hasMcpFileEdits}
        activeTab={activeTab}
        onActiveTabChange={setActiveTab as any}
        userId={user?.id?.toString() || getStableSessionId()}
        onAttachedFilesChange={handleAttachedFilesChange}
        filesystemScopePath={filesystemScopePath}
        showResponseStyle={showResponseStyle}
        // Note: useDiffsPoller removed - file changes synced via filesystem-updated events + SSE
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
          livekitEnabled={livekitEnabled}
          onLivekitToggle={(enabled) => setLivekitEnabled(enabled)}
          showResponseStyle={showResponseStyle}
          onResponseStyleToggle={toggleResponseStyle}
        />
      )}

      {/* Code Preview Panel */}
      {showCodePreview && (
        <CodePreviewPanel
          isOpen={showCodePreview}
          messages={messages}
          onClose={() => { setShowCodePreview(false); }}
          filesystemScopePath={filesystemScopePath}
          commandsByFile={commandsByFile}
          onApplyAllCommandDiffs={applyAllCommandDiffs}
          onApplyFileCommandDiffs={applyDiffsForFile}
          onClearAllCommandDiffs={clearAllCommandDiffs}
          onClearFileCommandDiffs={clearCommandDiffsForFile}
          onSquashFileCommandDiffs={squashCommandDiffsForFile}
          // Polled diffs integration
          polledDiffs={diffsPoller.diffs}
          onApplyPolledDiffs={applyPolledDiffs}
          onClearPolledDiffs={diffsPoller.clearDiffs}
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

      {/* Approval Dialog for existing session file edits */}
      {showApprovalDialog && (
        <ConfirmationDialog
          isOpen={showApprovalDialog}
          title="Review File Changes"
          message={`The AI wants to modify ${pendingApprovalDiffs.length} existing file(s) in this session. Do you want to approve these changes?`}
          confirmLabel="Approve"
          cancelLabel="Deny"
          onConfirm={handleApproveEdits}
          onCancel={handleDenyEdits}
        />
      )}
    </div>
  );
}
