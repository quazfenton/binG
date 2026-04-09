'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import {
  Terminal as TerminalIcon, X, Minimize2, Maximize2, Square,
  Trash2, Copy, ChevronUp, ChevronDown, GripHorizontal,
  Cpu, MemoryStick, Plus, Split, Wifi, WifiOff, Loader2,
  ClipboardPaste, Check
} from 'lucide-react';
import { toast } from 'sonner';
import { motion } from 'framer-motion';
import { saveTerminalSession, getTerminalSessions, addCommandToHistory } from '@/lib/terminal/terminal-storage';
import { secureRandom, generateSecureId } from '@/lib/utils';
import { checkCommandSecurity, formatSecurityWarning, detectObfuscation, DEFAULT_SECURITY_CONFIG } from '@/lib/terminal/security/terminal-security';
import { createLogger } from '@/lib/utils/logger';
import { useVirtualFilesystem } from '@/hooks/use-virtual-filesystem';
import { wireTerminalHandlers, cleanupHandlers, type TerminalHandlers } from '@/lib/terminal/commands/terminal-handler-wiring';
import type { LocalFilesystemEntry } from '@/lib/terminal/commands/local-filesystem-executor';
import { extractSessionIdFromPath, normalizeScopePath } from '@/lib/virtual-filesystem/scope-utils';
import { clipboard } from '@bing/platform/clipboard';
import { emitFilesystemUpdated, onFilesystemUpdated } from '@/lib/virtual-filesystem/sync/sync-events';
import { createRefreshScheduler } from '@/lib/virtual-filesystem/refresh-scheduler';
import { getSponsorAd, trackAdView, adsEnabled, type EthicalAdResponse } from '@/lib/ads/ethical-ads-service';
import { desktopPtyManager, shouldUseDesktopPty, type DesktopPtyInstance, requestShellCompletion } from '@/lib/terminal/desktop-pty-provider';
import { createWebLocalPty, isWebLocalPtyAvailable, type WebLocalPtyInstance } from '@/lib/terminal/web-local-pty';
import { isDesktopMode } from '@/lib/utils/desktop-env';

const logger = createLogger('TerminalPanel');

interface TerminalPanelProps {
  userId?: string;
  isOpen: boolean;
  onClose: () => void;
  onMinimize?: () => void;
  isMinimized?: boolean;
}

interface SandboxInfo {
  sessionId?: string;
  sandboxId?: string;
  status: 'creating' | 'active' | 'error' | 'none';
  resources?: {
    cpu?: string;
    memory?: string;
  };
}

type TerminalMode = 'local' | 'connecting' | 'pty' | 'sandbox-cmd' | 'editor' | 'command-mode' | 'desktop-pty';

/*
  'local' - Local shell simulation in browser
  'connecting' - Sandbox is being provisioned
  'pty' - Connected to sandbox via PTY (full terminal)
  'sandbox-cmd' - Connected to sandbox via command-mode (line-based, no PTY)
  'editor' - Nano/vim editor overlay active
*/

interface TerminalInstance {
  id: string;
  name: string;
  sandboxInfo: SandboxInfo;
  mode: TerminalMode;
  xtermRef: React.RefObject<HTMLDivElement | null>;
  terminal: any | null;
  fitAddon: any | null;
  eventSource: EventSource | null;
  websocket: WebSocket | null;
  isConnected: boolean;
  // Desktop PTY session (Tauri)
  ptyInstance?: DesktopPtyInstance;
  // Web local PTY session (node-pty)
  webLocalPtyInstance?: WebLocalPtyInstance;
}

interface LocalFileSystem {
  [path: string]: {
    type: 'file' | 'directory';
    content?: string;
    createdAt: number;
    modifiedAt: number;
  };
}

async function getAuthToken(): Promise<string | null> {
  if (typeof window === 'undefined') return null;
  try {
    const { secrets } = await import('@bing/platform/secrets');
    return await secrets.get('auth-token');
  } catch {
    return null;
  }
}

function getAnonymousSessionId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    let sessionId = localStorage.getItem('anonymous_session_id');
    if (!sessionId) {
      sessionId = generateSecureId('anon');
      localStorage.setItem('anonymous_session_id', sessionId);
      console.log('[TerminalPanel] Generated new anonymous session ID:', sessionId);
    }
    return sessionId;
  } catch (err) {
    console.warn('[TerminalPanel] Failed to access localStorage for anonymous session:', err);
    return null;
  }
}

function getAuthHeaders(): Record<string, string> {
  // Auth is handled via HttpOnly cookies (credentials: 'include')
  // No need to manually set Authorization header
  // Token-based auth was replaced by cookie-based auth for security
  return {};
}

const createMinimalProject = (scopePath: string = 'project'): LocalFileSystem => {
  // Use parent sessions directory as root, not specific session folder
  // This allows 'ls' to show all session folders (001, 002, web_app, etc.)
  const parentScopePath = scopePath.replace(/\/sessions\/[^/]+$/, '') || 'project/sessions';
  return {
  [parentScopePath]: { type: 'directory', createdAt: Date.now(), modifiedAt: Date.now() },
  'project': { type: 'directory', createdAt: Date.now(), modifiedAt: Date.now() },
  };
};

export default function TerminalPanel({
  userId,
  isOpen,
  onClose,
  onMinimize,
  isMinimized = false,
  filesystemScopePath,
}: TerminalPanelProps & { filesystemScopePath?: string }) {
  const [terminals, setTerminals] = useState<TerminalInstance[]>([]);
  const [activeTerminalId, setActiveTerminalId] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isSplitView, setIsSplitView] = useState(false);
  const [terminalHeight, setTerminalHeight] = useState<number>(450); // Default height in pixels
  const [isResizing, setIsResizing] = useState(false);

  // Rotating sponsor ad (EthicalAds)
  const [sponsorAd, setSponsorAd] = useState<EthicalAdResponse | null>(null);

  useEffect(() => {
    if (!isOpen || !adsEnabled()) return;
    let cancelled = false;
    const loadAd = async () => {
      const ad = await getSponsorAd(['ai', 'developer-tools', 'typescript']);
      if (!cancelled && ad) setSponsorAd(ad);
    };
    void loadAd();
    // Rotate every 60 seconds
    const interval = setInterval(loadAd, 60_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [isOpen]);

  const DEBUG = true;
  const log = (...args: any[]) => console.log('[TerminalPanel]', ...args);
  const logError = (...args: any[]) => console.error('[TerminalPanel ERROR]', ...args);
  const logWarn = (...args: any[]) => console.warn('[TerminalPanel WARN]', ...args);
  
  // Phase 2: Sandbox lifecycle control
  const [sandboxStatus, setSandboxStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected');
  const [autoConnectSandbox, setAutoConnectSandbox] = useState(false); // Default: off (lazy init)
  const [idleTimeLeft, setIdleTimeLeft] = useState<number | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; terminalId: string } | null>(null);
  const [isSelectingMode, setIsSelectingMode] = useState(false);
  const [lastActivity, setLastActivity] = useState<number>(Date.now());
  
  // Idle timeout configuration (15 minutes default, 0 to disable)
  const IDLE_TIMEOUT_MS = parseInt(process.env.NEXT_PUBLIC_SANDBOX_IDLE_TIMEOUT_MS || '900000', 10);
  const IDLE_WARNING_MS = parseInt(process.env.NEXT_PUBLIC_SANDBOX_IDLE_WARNING_MS || '60000', 10);

  // WebSocket terminal configuration
  const WS_TERMINAL_URL = process.env.NEXT_PUBLIC_WEBSOCKET_URL || `ws://localhost:${process.env.NEXT_PUBLIC_WEBSOCKET_PORT || 8080}`;
  const wsReconnectAttempts = useRef<number>(0);
  const WS_MAX_RECONNECT_ATTEMPTS = 5;

  const terminalsRef = useRef<TerminalInstance[]>([]);
  terminalsRef.current = terminals;
  const activeTerminalIdRef = useRef<string | null>(null);
  activeTerminalIdRef.current = activeTerminalId;
  const resizeStartY = useRef<number>(0);
  const resizeStartHeight = useRef<number>(0);

  // Store the filesystem scope path for auto-cd on connect
  const filesystemScopePathRef = useRef<string | undefined>(filesystemScopePath);
  filesystemScopePathRef.current = filesystemScopePath;
  
  // Compute parent sessions path for terminal root (allows listing all sessions)
  // Keep "project/sessions" even when scopePath is deeper like "project/sessions/001/sub"
  const parentSessionsPath =
    filesystemScopePath && /\/sessions(\/.*)?$/.test(filesystemScopePath)
      ? filesystemScopePath.replace(/(\/sessions)\/?.*$/, '$1')
      : 'project/sessions';
  
  // Use virtual filesystem to get real files instead of mock
  // autoLoad: false since TerminalPanel manages its own VFS sync lifecycle
  // Use parent sessions path so terminal starts at project/sessions (not specific session)
  const virtualFilesystem = useVirtualFilesystem(parentSessionsPath, { autoLoad: false });
  const {
    listDirectory: listVfsDirectory,
    readFile: readVfsFile,
    getSnapshot: getVfsSnapshot,
  } = virtualFilesystem;

  // Initialize WebSocket terminal server on mount (ensures backend is started)
  useEffect(() => {
    const initWebSocketServer = async () => {
      if (!isOpen) return;
      try {
        logger.debug('Initializing WebSocket terminal server...');
        // Call backend endpoint to trigger WebSocket server initialization
        await fetch('/api/backend', { 
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        }).catch(() => null);
        logger.info('WebSocket terminal server initialized');
      } catch (err) {
        logger.debug('WebSocket server already initialized or init failed:', err);
      }
    };
    initWebSocketServer();
  }, [isOpen]);

  // Memoize getVfsSnapshot to prevent unnecessary effect re-runs
  const getVfsSnapshotMemoized = useCallback(() => getVfsSnapshot(), [getVfsSnapshot]);

  // Sync local filesystem with virtual filesystem on mount and when scope changes
  const [isVfsSynced, setIsVfsSynced] = useState(false);
  const [vfsFileCount, setVfsFileCount] = useState(0);
  const lastWorkspaceVersionRef = useRef(0);
  
  useEffect(() => {
   // NOTE: We sync VFS regardless of isOpen state to ensure VFS is available
   // for on-demand commands (like 'ls') when terminal opens
   console.log('[TerminalPanel] Starting VFS sync, scopePath:', filesystemScopePath);
   
   const syncVfsToLocal = async () => {
     try {
       const snapshot = await getVfsSnapshotMemoized();
       if (typeof snapshot?.version === 'number') {
         lastWorkspaceVersionRef.current = Math.max(lastWorkspaceVersionRef.current, snapshot.version);
       }
       const files = snapshot?.files || [];

       console.log('[TerminalPanel] VFS Snapshot received:', {
         fileCount: files.length,
         samplePaths: files.slice(0, 5).map(f => f.path),
         scopePath: filesystemScopePath,
       });

       // FIX: Don't reset filesystem to minimal if VFS returns empty - preserve existing data
       // This prevents the filesystem from being wiped after sandbox connection failures
       if (files.length === 0) {
         const existingFs = localFileSystemRef.current;
         const existingKeys = Object.keys(existingFs).filter(k => k !== 'project');

         if (existingKeys.length > 0) {
           // VFS is temporarily empty but we have existing files - keep them
           console.log('[TerminalPanel] VFS appears empty but keeping existing', existingKeys.length, 'entries');
           setIsVfsSynced(true);
           // Don't reset vfsFileCount - keep showing previous count
           return;
         }

         // VFS is truly empty and we have no existing files - create minimal structure
         localFileSystemRef.current = createMinimalProject(parentSessionsPath);
         setIsVfsSynced(true);
         setVfsFileCount(0);
         console.log('[TerminalPanel] VFS is empty, using minimal project structure');
         return;
       }

       // Use ONLY VFS files with their original paths
       const fs: LocalFileSystem = {
         'project': { type: 'directory', createdAt: Date.now(), modifiedAt: Date.now() },
         [parentSessionsPath]: { type: 'directory', createdAt: Date.now(), modifiedAt: Date.now() }
       };

       for (const file of files) {
         // Normalize path: ensure it starts with project/
         let fullPath = file.path;

         // Strip any sandbox/workspace prefixes that might have been stored incorrectly
         fullPath = fullPath
           .replace(/^(\/tmp\/workspaces\/)+/gi, '')
           .replace(/^(tmp\/workspaces\/)+/gi, '')
           .replace(/^(\/workspace\/)+/gi, '')
           .replace(/^(workspace\/)+/gi, '')
           .replace(/^(\/home\/[^/]+\/workspace\/)+/gi, '')
           .replace(/^(home\/[^/]+\/workspace\/)+/gi, '');

         // Ensure path starts with project/
         if (!fullPath.startsWith('project/') && fullPath !== 'project') {
           fullPath = fullPath.replace(/^\/+/, '');
           if (fullPath.startsWith('project/')) {
             fullPath = fullPath.replace(/^project\/(project\/)+/, 'project/');
           } else if (fullPath) {
             fullPath = `project/${fullPath}`;
           } else {
             fullPath = 'project';
           }
         }

         // Create intermediate directories
         const parts = fullPath.split('/');
         for (let i = 1; i < parts.length; i++) {
           const dirPath = parts.slice(0, i).join('/');
           if (!fs[dirPath]) {
             fs[dirPath] = { type: 'directory', createdAt: Date.now(), modifiedAt: Date.now() };
           }
         }

         // Add file
         if (file.content !== undefined) {
           fs[fullPath] = {
             type: 'file',
             content: file.content,
             createdAt: Date.now(),
             modifiedAt: new Date(file.lastModified).getTime(),
           };
         }
       }

        localFileSystemRef.current = fs;
        setVfsFileCount(files.length);
        console.log('[TerminalPanel] Synced VFS files:', Object.keys(fs).length, 'entries');
        console.log('[TerminalPanel] Sample paths:', Object.keys(fs).slice(0, 10));

        // Sync VFS to all terminal executors
        Object.values(terminalHandlersRef.current).forEach(handlers => {
          if (handlers?.localFS) {
            handlers.localFS.syncFileSystem(fs);
          }
        });

        setIsVfsSynced(true);
     } catch (error) {
       console.error('[TerminalPanel] Failed to sync VFS:', error);
       setIsVfsSynced(true); // Still mark as synced to avoid blocking
     }
   };

   // Debounce initial sync to prevent flood on mount
   const timeoutId = setTimeout(() => {
     void syncVfsToLocal();
   }, 500);

   return () => clearTimeout(timeoutId);
  }, [isOpen, filesystemScopePath, getVfsSnapshotMemoized]);

  // Update terminal display when VFS sync completes
  // NOTE: We sync VFS regardless of isOpen state to ensure VFS is available
  // for on-demand commands (like 'ls') when terminal is closed
  useEffect(() => {
    // Always sync VFS regardless of isOpen - needed for shell on-demand commands
    if (!isVfsSynced || terminals.length === 0) return;

    // Update terminal display with loaded files
    terminals.forEach(term => {
      if (term.terminal && term.mode === 'local') {
        // Guard: only clear if terminal is fully initialized (rows > 0 means RenderService is ready)
        if (term.terminal.rows > 0) {
          try {
            term.terminal.clear();
          } catch (error) {
            console.warn('[TerminalPanel] Failed to clear terminal:', error);
          }
          term.terminal.writeln('');
          term.terminal.writeln('\x1b[1;32m● Terminal Ready\x1b[0m');

          if (vfsFileCount > 0) {
            term.terminal.writeln(`\x1b[90m  Loaded ${vfsFileCount} files from workspace.\x1b[0m`);
            term.terminal.writeln('\x1b[90m  Type "ls" to list files.\x1b[0m');

            // Show file listing
            const fs = localFileSystemRef.current;
            const projectFiles = Object.keys(fs).filter(k => k.startsWith('project/') && k.split('/').length === 2);
            if (projectFiles.length > 0) {
              term.terminal.writeln('');
              term.terminal.writeln('\x1b[1;34mWorkspace files:\x1b[0m');
              projectFiles.forEach(f => {
                const info = fs[f];
                const icon = info?.type === 'directory' ? '\x1b[34m📁\x1b[0m' : '\x1b[37m📄\x1b[0m';
                term.terminal.writeln(`  ${icon} ${f.replace('project/', '')}`);
            });
            term.terminal.writeln('');
          }
        } else {
          term.terminal.writeln('\x1b[90m  No files in workspace yet.\x1b[0m');
          term.terminal.writeln('\x1b[90m  Files created here will sync with code preview.\x1b[0m');
        }
        }

        term.terminal.writeln('\x1b[90m  Type "connect" to connect to sandbox.\x1b[0m');
        term.terminal.writeln('');
        
        const cwd = localShellCwdRef.current[term.id] || 'project';
        term.terminal.write(getPrompt('local', cwd));
      }
    });
  }, [isVfsSynced, vfsFileCount, isOpen]);

  // Bidirectional sync: Event-driven refresh from code-preview/editor updates
  useEffect(() => {
    // NOTE: We listen to filesystem-updated events regardless of isOpen state
    // to keep VFS in sync for on-demand commands
    const refresh = async (detail?: any) => {
      log('[filesystem-updated event] received in TerminalPanel', detail);

      try {
        const eventWorkspaceVersion = typeof detail?.workspaceVersion === 'number' ? detail.workspaceVersion : null;
        if (eventWorkspaceVersion !== null && eventWorkspaceVersion <= lastWorkspaceVersionRef.current) {
          log(`[filesystem-updated] skipped stale terminal refresh at workspaceVersion=${eventWorkspaceVersion}`);
          return;
        }

        const snapshot = await getVfsSnapshotMemoized();
        if (typeof snapshot?.version === 'number') {
          lastWorkspaceVersionRef.current = Math.max(lastWorkspaceVersionRef.current, snapshot.version);
        } else if (eventWorkspaceVersion !== null) {
          lastWorkspaceVersionRef.current = Math.max(lastWorkspaceVersionRef.current, eventWorkspaceVersion);
        }
        const files = snapshot?.files || [];
        const normalizedScopePath = normalizeScopePath(filesystemScopePathRef.current);

        log(`[filesystem-updated] got snapshot, filesCount=${files.length}, scope="${normalizedScopePath}"`);

        // FIX: Don't reset filesystem to minimal if VFS returns empty - preserve existing data
        if (files.length === 0) {
          const existingFs = localFileSystemRef.current;
          const existingKeys = Object.keys(existingFs).filter(k => k !== 'project');
          
          if (existingKeys.length > 0) {
            log('[filesystem-updated] VFS appears empty but keeping existing', existingKeys.length, 'entries');
            return;
          }
          
          log('[filesystem-updated] VFS empty, creating minimal project structure');
          localFileSystemRef.current = createMinimalProject(parentSessionsPath);
          return;
        }

        const fs: LocalFileSystem = {
          project: { type: 'directory', createdAt: Date.now(), modifiedAt: Date.now() },
          [parentSessionsPath]: { type: 'directory', createdAt: Date.now(), modifiedAt: Date.now() },
        };

        let fileCount = 0;
        let dirCount = 2; // project + scope path
        
        for (const file of files) {
          const fullPath = normalizeScopePath(file.path);
          const parts = fullPath.split('/');
          for (let i = 1; i < parts.length; i++) {
            const dirPath = parts.slice(0, i).join('/');
            if (!fs[dirPath]) {
              fs[dirPath] = { type: 'directory', createdAt: Date.now(), modifiedAt: Date.now() };
              dirCount++;
            }
          }

          if (file.content !== undefined) {
            fs[fullPath] = {
              type: 'file',
              content: file.content,
              createdAt: Date.now(),
              modifiedAt: new Date(file.lastModified).getTime(),
            };
            fileCount++;
          }
        }

        localFileSystemRef.current = fs;
        log(`[filesystem-updated] synced VFS to local: ${fileCount} files, ${dirCount} directories`);
        
        // Sync VFS to all terminal executors
        Object.values(terminalHandlersRef.current).forEach(handlers => {
          if (handlers?.localFS) {
            handlers.localFS.syncFileSystem(fs);
          }
        });
      } catch (error) {
        logError('[filesystem-updated] re-sync failed', error);
        console.error('[Terminal] Event re-sync error:', error);
      }
    };

    const scheduler = createRefreshScheduler(refresh, { minIntervalMs: 5000, maxDelayMs: 10000 });
    const unsubscribe = onFilesystemUpdated((event) => scheduler.schedule(event.detail));
    log('[TerminalPanel] registered filesystem-updated event listener');
    return () => {
      unsubscribe();
      scheduler.dispose();
      log('[TerminalPanel] removed filesystem-updated event listener');
    };
  }, [isOpen, getVfsSnapshotMemoized]);
  
  const localFileSystemRef = useRef<LocalFileSystem>({});
  const localShellCwdRef = useRef<Record<string, string>>({});

  // NEW: Terminal Handlers (wired up for each terminal)
  const terminalHandlersRef = useRef<Record<string, TerminalHandlers>>({});

  const lastConnectionAttemptRef = useRef<Record<string, number>>({});
  const reconnectCooldownUntilRef = useRef<Record<string, number>>({});
  const commandQueueRef = useRef<Record<string, string[]>>({});
  const commandHistoryRef = useRef<Record<string, string[]>>({});
  const historyIndexRef = useRef<Record<string, number>>({});
  const lineBufferRef = useRef<Record<string, string>>({});
  const cursorPosRef = useRef<Record<string, number>>({});
  const editorSessionRef = useRef<Record<string, {
    type: 'nano' | 'vim' | 'vi';
    filePath: string;
    content: string;
    cursor: number;
    lines: string[];
    cursorLine: number;
    cursorCol: number;
    originalContent: string;
    clipboard: string;
  } | null>>({});
  const connectAbortRef = useRef<Record<string, AbortController>>({});
  const connectTerminalRef = useRef<(terminalId: string) => Promise<void> | undefined>(undefined);

  // Input batching to reduce HTTP overhead (ARCH 4)
  const inputBatchRef = useRef<Record<string, string>>({});
  const inputFlushRef = useRef<Record<string, NodeJS.Timeout>>({});
  
  // Completion state for keyboard navigation (per terminal)
  const completionStateRef = useRef<Record<string, {
    completions: string[];
    selectedIndex: number;
    currentLine: string;
    prefix: string;
  } | null>>({});
  const desktopPtyInputLineRef = useRef<Record<string, string>>({});
  const desktopPtyLastTabTimeRef = useRef<Record<string, number>>({});

  useEffect(() => {
    if (isOpen && terminals.length === 0) {
      // Restore terminal state from localStorage
      const savedState = localStorage.getItem('terminal-state');
      if (savedState) {
        try {
          const state = JSON.parse(savedState);
          console.log('[Terminal] Restored state from localStorage:', state);
          
          // Restore command history
          if (state.commandHistory) {
            commandHistoryRef.current = state.commandHistory;
          }
          
          // Restore sandbox connection preference
          if (state.sandboxConnected) {
            setSandboxStatus('disconnected'); // Don't auto-reconnect, let user choose
            toast.info('Sandbox disconnected. Click to reconnect.');
          }
        } catch (error) {
          console.error('[Terminal] Failed to restore state:', error);
        }
      }
      
      const savedSessions = getTerminalSessions();
      if (savedSessions.length > 0) {
        const session = savedSessions[0];
        createTerminal(session.name, session.sandboxInfo);
      } else {
        createTerminal('Terminal 1');
      }
    }
  }, [isOpen]);

  // State persistence handled by TerminalStateManager handler
  // See: lib/sandbox/terminal-state-manager.ts

  // Phase 2: Toggle sandbox connection
  const toggleSandboxConnection = useCallback(async () => {
    const handlers = activeTerminalId ? terminalHandlersRef.current[activeTerminalId] : undefined;

    if (sandboxStatus === 'connected') {
      if (handlers) {
        try {
          await handlers.connection.disconnect();
          setSandboxStatus('disconnected');
          toast.success('Sandbox disconnected');
        } catch (error) {
          toast.error('Failed to disconnect sandbox');
        }
      }
    } else if (sandboxStatus === 'disconnected') {
      setSandboxStatus('connecting');
      try {
        if (activeTerminalId) {
          await connectTerminal(activeTerminalId);
          const activeTerm = terminalsRef.current.find(t => t.id === activeTerminalId);
          if (activeTerm?.sandboxInfo.sandboxId) {
            toast.success('Sandbox session created: ' + activeTerm.sandboxInfo.sandboxId.slice(0, 12) + '...');
          }
        }
      } catch (error) {
        toast.error('Failed to connect sandbox');
        setSandboxStatus('disconnected');
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sandboxStatus, activeTerminalId]);

  // Idle timeout monitoring handled by TerminalUIManager handler
  // See: lib/sandbox/terminal-ui-manager.ts

  // Refs for callback functions to avoid circular dependency
  const copyOutputRef = useRef<() => Promise<void> | undefined>(undefined);
  const pasteFromClipboardRef = useRef<() => Promise<void> | undefined>(undefined);
  const selectAllRef = useRef<() => void | undefined>(undefined);
  const closeContextMenuRef = useRef<() => void | undefined>(undefined);

  // Keyboard shortcuts handled by TerminalUIManager handler
  // See: lib/sandbox/terminal-ui-manager.ts

  // Health monitoring for active terminal
  useEffect(() => {
    const handler = terminalHandlersRef.current[activeTerminalId || '']?.health;
    if (handler) {
      handler.start();
      return () => handler.stop();
    }
  }, [activeTerminalId]);

  // State persistence for active terminal
  useEffect(() => {
    const handler = terminalHandlersRef.current[activeTerminalId || '']?.state;
    if (handler) {
      const cleanup = handler.setupAutoSave();
      return cleanup;
    }
  }, [activeTerminalId]);

  // Update last activity on user input
  const updateActivity = useCallback(() => {
    setLastActivity(Date.now());
  }, []);

  useEffect(() => {
    if (!isOpen && terminals.length > 0) {
      terminals.forEach(t => {
        t.eventSource?.close();
        t.terminal?.dispose();
      });

      terminals.forEach(t => {
        saveTerminalSession({
          id: t.id,
          name: t.name,
          commandHistory: commandHistoryRef.current[t.id] || [],
          sandboxInfo: {
            ...t.sandboxInfo,
            status: 'none'
          },
          lastUsed: Date.now()
        });
      });
    }
  }, [isOpen]);

  useEffect(() => {
    const timer = setTimeout(() => {
      terminals.forEach(t => {
        if (t.fitAddon && t.terminal) {
          try {
            t.fitAddon.fit();
          } catch {}
        }
      });
    }, 100);
    return () => clearTimeout(timer);
  }, [isExpanded, isSplitView, activeTerminalId, isMinimized]);

  // Refit terminal when switching tabs - DO NOT re-initialize
  useEffect(() => {
    if (activeTerminalId) {
      const term = terminalsRef.current.find(t => t.id === activeTerminalId);
      if (term?.fitAddon && term.terminal) {
        const timer = setTimeout(() => {
          try {
            term.fitAddon.fit();
            term.terminal.focus();
          } catch {}
        }, 50);
        return () => clearTimeout(timer);
      }
    }
  }, [activeTerminalId]);

  useEffect(() => {
    const handleResize = () => {
      terminalsRef.current.forEach(t => {
        if (t.fitAddon && t.terminal) {
          try { t.fitAddon.fit(); } catch {}
        }
      });
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Resize handle for terminal panel height
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    resizeStartY.current = e.clientY;
    resizeStartHeight.current = terminalHeight;
  }, [terminalHeight]);

  const handleResizeMove = useCallback((e: MouseEvent) => {
    if (!isResizing) return;
    const deltaY = resizeStartY.current - e.clientY;
    const newHeight = Math.max(200, Math.min(800, resizeStartHeight.current + deltaY));
    setTerminalHeight(newHeight);
  }, [isResizing]);

  const handleResizeEnd = useCallback(() => {
    setIsResizing(false);
  }, []);

  useEffect(() => {
    if (isResizing) {
      document.addEventListener('mousemove', handleResizeMove);
      document.addEventListener('mouseup', handleResizeEnd);
      return () => {
        document.removeEventListener('mousemove', handleResizeMove);
        document.removeEventListener('mouseup', handleResizeEnd);
      };
    }
  }, [isResizing, handleResizeMove, handleResizeEnd]);

  // Listen for auto-connect events from conversation interface
  useEffect(() => {
    const handleAutoConnect = () => {
      if (activeTerminalId) {
        connectTerminal(activeTerminalId);
      }
    };

    window.addEventListener('terminal-auto-connect', handleAutoConnect);
    return () => window.removeEventListener('terminal-auto-connect', handleAutoConnect);
  }, [activeTerminalId]);

  // Listen for "Run in Terminal" events from chat code blocks
  useEffect(() => {
    const handleRunCommand = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail?.command || !activeTerminalId) return;

      const term = terminalsRef.current.find(t => t.id === activeTerminalId);
      if (!term?.terminal) return;

      // Split multi-line commands and execute each line
      const commands = detail.command.split('\n').filter((l: string) => {
        const trimmed = l.trim();
        // Skip comments and empty lines
        return trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('//');
      });

      if (commands.length === 0) return;

      // If in PTY mode, send directly to sandbox
      if (term.mode === 'pty' && term.sandboxInfo.sessionId) {
        for (const cmd of commands) {
          void sendInput(term.sandboxInfo.sessionId, cmd + '\n');
        }
        toast.success(`Sent ${commands.length} command(s) to terminal`);
        return;
      }

      // In local mode, execute sequentially
      const executeNext = (index: number) => {
        if (index >= commands.length) return;
        const cmd = commands[index].trim();
        lineBufferRef.current[activeTerminalId!] = '';
        cursorPosRef.current[activeTerminalId!] = 0;
        term.terminal?.writeln(`\x1b[90m$ ${cmd}\x1b[0m`);

        executeLocalShellCommand(
          activeTerminalId!,
          cmd,
          (text) => term.terminal?.write(text),
          false,
          term.mode
        ).then((showPrompt) => {
          if (index === commands.length - 1 && showPrompt) {
            const cwd = localShellCwdRef.current[activeTerminalId!] || 'project';
            term.terminal?.write(getPrompt(term.mode, cwd));
          }
          // Execute next command after a small delay
          setTimeout(() => executeNext(index + 1), 100);
        });
      };

      executeNext(0);
      toast.success(`Running ${commands.length} command(s) in terminal`);
    };

    window.addEventListener('terminal-run-command', handleRunCommand);
    return () => window.removeEventListener('terminal-run-command', handleRunCommand);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTerminalId]);

  const createTerminal = useCallback((name?: string, sandboxInfo?: any) => {
    const id = generateSecureId('terminal');
    const newTerminal: TerminalInstance = {
      id,
      name: name || `Terminal ${terminalsRef.current.length + 1}`,
      sandboxInfo: sandboxInfo || { status: 'none' },
      mode: 'local',
      xtermRef: React.createRef<HTMLDivElement>(),
      terminal: null,
      fitAddon: null,
      eventSource: null,
      websocket: null,
      isConnected: false,
    };

    // FIX: Start at parent sessions directory, not specific session folder
    // Session folders (001, 002, etc.) are only created when LLM generates files
    // Starting at project/sessions avoids "directory doesn't exist" errors
    // CORRECTED: Keep project/sessions, not just project
    const parentScopePath = filesystemScopePathRef.current?.replace(/(\/sessions)\/[^/]+$/, '$1') || 'project/sessions';
    localShellCwdRef.current[id] = parentScopePath;
    reconnectCooldownUntilRef.current[id] = 0;
    commandQueueRef.current[id] = [];
    commandHistoryRef.current[id] = [];
    historyIndexRef.current[id] = -1;
    lineBufferRef.current[id] = '';
    cursorPosRef.current[id] = 0;
    editorSessionRef.current[id] = null;
    desktopPtyInputLineRef.current[id] = '';
    desktopPtyLastTabTimeRef.current[id] = 0;

    // WIRE UP ALL HANDLERS
    terminalHandlersRef.current[id] = wireTerminalHandlers({
      terminalId: id,
      filesystemScopePath: filesystemScopePathRef.current,
      getLocalFileSystem: () => localFileSystemRef.current,
      setLocalFileSystem: (fs) => { localFileSystemRef.current = fs },
      syncFileToVFS: syncFileToVFS,
      executeCommand: executeLocalShellCommand,
      write: (text) => {
        const term = terminalsRef.current.find(t => t.id === id);
        term?.terminal?.write(text);
      },
      writeLine: (text) => {
        const term = terminalsRef.current.find(t => t.id === id);
        term?.terminal?.write(text + '\r\n');
      },
      getPrompt: getPrompt,
      getCwd: (terminalId) => localShellCwdRef.current[terminalId] || parentSessionsPath,
      setCwd: (terminalId, cwd) => { localShellCwdRef.current[terminalId] = cwd },
      updateTerminalState: updateTerminalState,
      sendInput: sendInput,
      sendResize: sendResize,
      getAuthToken: getAuthToken as any,
      getAuthHeaders: getAuthHeaders,
      getAnonymousSessionId: getAnonymousSessionId,
      toSandboxScopedPath: toSandboxScopedPath,
      getCommandHistory: (terminalId) => commandHistoryRef.current[terminalId] || [],
      setCommandHistory: (terminalId, history) => { commandHistoryRef.current[terminalId] = history },
      saveTerminalSession: saveTerminalSession,
      getSandboxStatus: () => sandboxStatus,
      setSandboxStatus: (status: string) => setSandboxStatus(status as 'connecting' | 'disconnected' | 'connected'),
      connectTerminal: connectTerminal,
      getTerminals: () => terminalsRef.current,
      getActiveTerminalId: () => activeTerminalId,
      onContextMenu: (x, y, terminalId) => setContextMenu({ x, y, terminalId }),
      onClose: onClose,
      onMinimize: onMinimize,
    });

    // Load persisted command history
    // Match by terminal name (stable) instead of id (randomly generated)
    try {
      const savedSessions = getTerminalSessions();
      const terminalName = name || `Terminal ${terminalsRef.current.length + 1}`;
      const savedSession = savedSessions.find(s => s.name === terminalName);
      if (savedSession?.commandHistory) {
        commandHistoryRef.current[id] = savedSession.commandHistory;
        historyIndexRef.current[id] = savedSession.commandHistory.length;
      }
    } catch (err) {
      logger.warn('Failed to load command history', err);
    }

    setTerminals(prev => [...prev, newTerminal]);
    setActiveTerminalId(id);

    return id;
  }, [
    filesystemScopePathRef,
    getAuthToken,
    getAuthHeaders,
    getAnonymousSessionId,
    saveTerminalSession,
    sandboxStatus,
    setSandboxStatus,
    activeTerminalId,
    onClose,
    onMinimize,
  ]);

  const closeTerminal = useCallback(async (terminalId: string) => {
    const terminal = terminalsRef.current.find(t => t.id === terminalId);
    if (terminal) {
      // CLEANUP HANDLERS FIRST — must await to ensure SSE/WebSocket are closed
      const handlers = terminalHandlersRef.current[terminalId];
      if (handlers) {
        await cleanupHandlers(terminalHandlersRef.current, terminalId);
      }

      terminal.eventSource?.close();
      terminal.websocket?.close();
      terminal.terminal?.dispose();
      terminal.xtermRef.current = null;
      // Abort any pending connection
      connectAbortRef.current[terminalId]?.abort();
      delete connectAbortRef.current[terminalId];
      
      // Close desktop PTY session if any
      if (terminal.ptyInstance) {
        await terminal.ptyInstance.close();
      }
      // Close web local PTY session if any
      if (terminal.webLocalPtyInstance) {
        await terminal.webLocalPtyInstance.close();
      }
      // Clear connection timeout
      if ((terminal as any).__connectionTimeout) {
        clearTimeout((terminal as any).__connectionTimeout);
        delete (terminal as any).__connectionTimeout;
      }
      // Clear spinner interval
      if ((terminal as any).__spinnerInterval) {
        clearInterval((terminal as any).__spinnerInterval);
        delete (terminal as any).__spinnerInterval;
      }

      // Flush any pending input and clear timers
      if (inputFlushRef.current[terminalId]) {
        clearTimeout(inputFlushRef.current[terminalId]);
      }
      const pendingInput = inputBatchRef.current[terminalId];
      if (pendingInput) {
        delete inputBatchRef.current[terminalId];
      }
    }

    // Save command history before cleanup
    const history = commandHistoryRef.current[terminalId];
    if (history && history.length > 0 && terminal) {
      try {
        saveTerminalSession({
          id: terminal.id,
          name: terminal.name,
          commandHistory: history,
          sandboxInfo: terminal.sandboxInfo,
          lastUsed: Date.now(),
        });
      } catch (err) {
        logger.warn('Failed to save command history', err);
      }
    }

    delete localShellCwdRef.current[terminalId];
    delete reconnectCooldownUntilRef.current[terminalId];
    delete commandQueueRef.current[terminalId];
    delete commandHistoryRef.current[terminalId];
    delete historyIndexRef.current[terminalId];
    delete lineBufferRef.current[terminalId];
    delete editorSessionRef.current[terminalId];
    delete cursorPosRef.current[terminalId];
    delete desktopPtyInputLineRef.current[terminalId];
    delete desktopPtyLastTabTimeRef.current[terminalId];
    delete terminalHandlersRef.current[terminalId];

    setTerminals(prev => {
      const updated = prev.filter(t => t.id !== terminalId);
      if (updated.length === 0) {
        setActiveTerminalId(null);
        setIsSplitView(false);
      } else if (activeTerminalId === terminalId) {
        setActiveTerminalId(updated[0].id);
      }
      return updated;
    });
  }, [activeTerminalId]);

  const updateTerminalState = useCallback((terminalId: string, updates: Partial<TerminalInstance>) => {
    // Update React state for UI rendering
    setTerminals(prev => prev.map(t =>
      t.id === terminalId ? { ...t, ...updates } : t
    ));

    // Also update the ref for immediate synchronous access
    const termRef = terminalsRef.current.find(t => t.id === terminalId);
    if (termRef) {
      const oldMode = termRef.mode;
      const oldConnected = termRef.isConnected;
      Object.assign(termRef, updates);

      // Log mode/connection transitions for debugging
      const newMode = updates.mode ?? oldMode;
      const newConnected = updates.isConnected ?? oldConnected;
      if (oldMode !== newMode || oldConnected !== newConnected) {
        logger.info(`[Terminal ${terminalId}] Mode transition: ${oldMode}→${newMode}, connected: ${oldConnected}→${newConnected}`, {
          sandboxId: updates.sandboxInfo?.sessionId ?? termRef.sandboxInfo?.sessionId,
          websocket: !!termRef.websocket,
          wsState: termRef.websocket?.readyState,
          eventSource: !!termRef.eventSource,
        });
      }
    }

    const handlers = terminalHandlersRef.current[terminalId];
    const sessionId = updates.sandboxInfo?.sessionId;
    if (handlers && typeof sessionId === 'string' && sessionId.length > 0) {
      handlers.batcher.setSessionId(sessionId);
    }

    if (handlers && (updates.mode === 'local' || updates.mode === 'sandbox-cmd') && !sessionId) {
      handlers.batcher.clearSession();
    }

    if (terminalId === activeTerminalIdRef.current) {
      if (updates.mode === 'connecting') {
        setSandboxStatus('connecting');
      } else if (updates.isConnected && updates.mode === 'pty') {
        setSandboxStatus('connected');
      } else if (updates.mode === 'local' || updates.mode === 'sandbox-cmd') {
        setSandboxStatus('disconnected');
      }
    }
  }, []);

  // resolveLocalPath migrated to TerminalLocalFSHandler

  // ensureProjectRootExists migrated to TerminalLocalFSHandler

  const getSandboxWorkspaceRoot = useCallback((sandboxId?: string): string => {
    if (!sandboxId) return '/workspace';
    if (sandboxId.startsWith('bing-') || sandboxId.startsWith('sprite-')) return '/home/sprite/workspace';
    if (sandboxId.startsWith('daytona-')) return '/home/daytona/workspace';
    if (sandboxId.startsWith('e2b-')) return '/home/user';
    if (sandboxId.startsWith('csb-') || sandboxId.length === 6) return '/project/workspace';
    return '/workspace';
  }, []);

  const toSandboxScopedPath = useCallback((scopePath?: string, sandboxId?: string): string => {
    const root = getSandboxWorkspaceRoot(sandboxId);
    const rawScope = (scopePath || 'project').replace(/\\/g, '/').replace(/^\/+/, '');
    const normalizedScope = rawScope.startsWith('project/')
      ? rawScope
      : rawScope === 'project'
        ? 'project'
        : `project/${rawScope.replace(/^project\/?/, '')}`;
    return `${root}/${normalizedScope}`.replace(/\/+/g, '/');
  }, [getSandboxWorkspaceRoot]);

  const syncFileToVFS = useCallback(async (filePath: string, content: string) => {
    log(`syncFileToVFS: attempting to sync "${filePath}" (contentLength=${content.length})`);
    try {
      const normalizedScope = normalizeScopePath(filesystemScopePathRef.current);
      const normalizedInput = (filePath || '').replace(/\\/g, '/').replace(/^\/+/, '');
      
      // Fix: Only add scope prefix if path is truly relative (not starting with project/)
      // If path already starts with project/, it's already project-relative, don't add scope
      let scopedFilePath: string;
      if (normalizedInput.startsWith('project/') || normalizedInput.startsWith(normalizedScope)) {
        scopedFilePath = normalizedInput;
      } else if (normalizedInput === 'project') {
        scopedFilePath = 'project';
      } else {
        // Truly relative path - prepend project/ prefix
        scopedFilePath = `project/${normalizedInput}`.replace(/\/+/g, '/');
      }

      log(`syncFileToVFS: normalized paths - scope="${normalizedScope}", input="${normalizedInput}", scoped="${scopedFilePath}"`);

      // NEW: OPFS Terminal Sync - Write to OPFS first for instant persistence
      if (typeof window !== 'undefined') {
        try {
          const { terminalOPFSSync } = await import('@/lib/virtual-filesystem/opfs/terminal-sync');
          // Note: terminal-sync uses browser-only APIs, safe for client bundles
          const sync = terminalOPFSSync;
          
          // Try to sync to OPFS - will fail gracefully if not enabled
          await sync.syncFileEdit(scopedFilePath, content);
          log(`syncFileToVFS: OPFS write complete for "${scopedFilePath}"`);
        } catch (opfsError) {
          logWarn(`syncFileToVFS: OPFS sync failed (non-critical)`, opfsError);
          // Continue with server sync even if OPFS fails
        }
      }

      // Server sync (background, non-blocking)
      const response = await fetch('/api/filesystem/write', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(),
        },
        credentials: 'include',
        body: JSON.stringify({
          path: scopedFilePath,
          content,
          sessionId: extractSessionIdFromPath(normalizedScope),
          source: 'terminal',
          integration: 'terminal',
        }),
      });

      log(`syncFileToVFS: API response status=${response.status}`);

      if (response.ok) {
        const payload = await response.json().catch(() => null);
        emitFilesystemUpdated({
          path: scopedFilePath,
          scopePath: normalizedScope,
          source: 'terminal',
          workspaceVersion: payload?.data?.workspaceVersion,
          commitId: payload?.data?.commitId,
          sessionId: payload?.data?.sessionId || extractSessionIdFromPath(normalizedScope),
        });
        log(`syncFileToVFS: dispatched filesystem-updated event for "${scopedFilePath}"`);
      } else {
        const errorText = await response.text().catch(() => 'unknown');
        logWarn(`syncFileToVFS: API returned non-OK status ${response.status}: ${errorText}`);
      }
    } catch (err: any) {
      logError(`syncFileToVFS: failed to sync "${filePath}"`, err);
    }
  }, []);

  

  // listLocalDirectory migrated to TerminalLocalFSHandler

  const getPrompt = (mode: TerminalMode, cwd: string): string => {
    // Only replace 'project' or 'workspace' at root level with '~', not subdirectories
    // e.g., 'project' -> '~' but 'project/sessions' stays as 'project/sessions'
    const displayCwd = (cwd === 'project' || cwd === 'workspace') 
      ? cwd.replace(/^(project|workspace)/, '~')
      : cwd;
    switch (mode) {
      case 'local':
        return `\x1b[34m[local]\x1b[0m \x1b[1;32m${displayCwd}$\x1b[0m `;
      case 'pty':
        return `\x1b[32m${displayCwd}$\x1b[0m `;
      case 'sandbox-cmd':
        return `\x1b[35m[sandbox]\x1b[0m \x1b[1;32m${displayCwd}$\x1b[0m `;
      case 'connecting':
        return `\x1b[33m[connecting...]\x1b[0m \x1b[1;32m${displayCwd}$\x1b[0m `;
      case 'desktop-pty':
        return `\x1b[36m[desktop]\x1b[0m \x1b[1;32m${displayCwd}$\x1b[0m `;
      case 'editor':
        return `\x1b[33m[editor]\x1b[0m \x1b[1;32m${displayCwd}$\x1b[0m `;
      default:
        return `\x1b[1;32m${displayCwd}$\x1b[0m `;
    }
  };

  const executeLocalShellCommand = useCallback(async (
    terminalId: string,
    command: string,
    write: (text: string) => void,
    isPtyMode: boolean = false,
    mode: TerminalMode = 'local'
  ): Promise<boolean> => {
    // TRY HANDLER FIRST
    const handlers = terminalHandlersRef.current[terminalId];
    if (handlers) {
      return handlers.localFS.executeCommand(command, {
        isPtyMode,
        terminalMode: mode as 'local' | 'connecting' | 'pty' | 'sandbox-cmd' | 'editor',
      });
    }

        // Command execution delegated to LocalCommandExecutor
    // See: lib/sandbox/local-filesystem-executor.ts (835 lines)
    // All 40+ commands available: help, ls, cd, pwd, cat, mkdir, touch, rm, cp, mv, echo, etc.
    
    // Security checks handled by handler
    // VFS sync handled by handler
    // Command history handled by handler
    
    return true; // Handler will execute
  }, []);



    // handleEditorInput migrated to TerminalEditorHandler
  // See: lib/sandbox/terminal-editor-handler.ts (529 lines)



  const sendInput = useCallback(async (sessionId: string, data: string) => {
    // Check if there's a web local PTY instance for this terminal
    const term = terminalsRef.current.find(t => t.id === sessionId && t.webLocalPtyInstance);
    if (term?.webLocalPtyInstance) {
      await term.webLocalPtyInstance.writeInput(data);
      return;
    }

    // Check if there's a WebSocket available for this session
    const wsTerm = terminalsRef.current.find(t => t.sandboxInfo.sessionId === sessionId && t.websocket && t.websocket.readyState === WebSocket.OPEN);

    if (wsTerm?.websocket) {
      // Use WebSocket for bidirectional streaming (ARCH 4 improvement)
      wsTerm.websocket.send(JSON.stringify({ type: 'input', data }));
      return;
    }

    // Batch keystrokes with 50ms debounce to reduce HTTP overhead while maintaining responsiveness
    inputBatchRef.current[sessionId] = (inputBatchRef.current[sessionId] || '') + data;

    // Clear existing flush timer
    if (inputFlushRef.current[sessionId]) {
      clearTimeout(inputFlushRef.current[sessionId]);
    }

    // Flush after 50ms (better batching for network latency)
    inputFlushRef.current[sessionId] = setTimeout(async () => {
      const batch = inputBatchRef.current[sessionId];
      if (!batch) return;

      inputBatchRef.current[sessionId] = '';

      try {
        const resp = await fetch('/api/sandbox/terminal/input', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...getAuthHeaders(),
          },
          credentials: 'include',
          body: JSON.stringify({ sessionId, data: batch }),
        });
        // If terminal session is not ready (503), don't retry — the terminal isn't active yet
        if (resp.status === 503) {
          // Silently drop — the PTY hasn't started yet, sending input makes no sense
          return;
        }
      } catch {}
    }, 50);
  }, []);

  const sendResize = useCallback(async (sessionId: string, cols: number, rows: number) => {
    // Check if there's a web local PTY instance for this terminal
    const term = terminalsRef.current.find(t => t.id === sessionId && t.webLocalPtyInstance);
    if (term?.webLocalPtyInstance) {
      await term.webLocalPtyInstance.resize(cols, rows);
      return;
    }

    // Check if there's a WebSocket available for this session
    const wsTerm = terminalsRef.current.find(t => t.sandboxInfo.sessionId === sessionId && t.websocket && t.websocket.readyState === WebSocket.OPEN);

    if (wsTerm?.websocket) {
      // Use WebSocket for resize (lower latency)
      wsTerm.websocket.send(JSON.stringify({ type: 'resize', cols, rows }));
      return;
    }

    // Fallback to HTTP POST
    try {
      await fetch('/api/sandbox/terminal/resize', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(),
        },
        credentials: 'include',
        body: JSON.stringify({ sessionId, cols, rows }),
      });
    } catch {}
  }, []);

  const initXterm = useCallback(async (terminalId: string, containerEl: HTMLDivElement) => {
    const existing = terminalsRef.current.find(t => t.id === terminalId);

    // CRITICAL: Prevent double initialization - check multiple times
    if (!existing) {
      console.warn('[TerminalPanel] Terminal not found during init:', terminalId);
      return;
    }

    if (existing.terminal) {
      console.log('[TerminalPanel] Terminal already initialized, skipping:', terminalId);
      return;
    }

    // Set initializing flag to prevent concurrent init attempts
    if ((existing as any)._initializing) {
      console.log('[TerminalPanel] Terminal already initializing, skipping:', terminalId);
      return;
    }
    (existing as any)._initializing = true;

    try {
      const { Terminal } = await import('@xterm/xterm');
      const { FitAddon } = await import('@xterm/addon-fit');
      const { WebLinksAddon } = await import('@xterm/addon-web-links');
      // SearchAddon is optional - skip if not installed
      let SearchAddon: any = null;
      try {
        SearchAddon = (await import('@xterm/addon-search')).SearchAddon;
      } catch {
        console.warn('SearchAddon not available, skipping search functionality');
      }

      const terminal = new Terminal({
        cursorBlink: true,
        fontSize: 13,
        fontFamily: '"Cascadia Code", "Fira Code", "JetBrains Mono", Menlo, Monaco, "Courier New", monospace',
        theme: {
          background: '#0a0a0a',
          foreground: '#e0e0e0',
          cursor: '#4ade80',
          selectionBackground: '#4ade8040',
          black: '#1a1a1a',
          red: '#f87171',
          green: '#4ade80',
          yellow: '#facc15',
          blue: '#60a5fa',
          magenta: '#c084fc',
          cyan: '#22d3ee',
          white: '#e0e0e0',
          brightBlack: '#525252',
          brightRed: '#fca5a5',
          brightGreen: '#86efac',
          brightYellow: '#fde68a',
          brightBlue: '#93c5fd',
          brightMagenta: '#d8b4fe',
          brightCyan: '#67e8f9',
          brightWhite: '#ffffff',
        },
        allowProposedApi: true,
        scrollback: 10000,
        convertEol: true,
      });

      const fitAddon = new FitAddon();
      terminal.loadAddon(fitAddon);
      terminal.loadAddon(new WebLinksAddon());
      if (SearchAddon) {
        terminal.loadAddon(new SearchAddon());
      }

      terminal.open(containerEl);
      containerEl.addEventListener('click', () => terminal.focus());

      requestAnimationFrame(() => {
        const safeFit = (phase: 'initial' | 'deferred') => {
          try {
            const dims = fitAddon.proposeDimensions();
            if (!dims || dims.rows <= 0 || dims.cols <= 0) return false;
            fitAddon.fit();
            return true;
          } catch (error) {
            logger.debug(`${phase} terminal fit failed`, error);
            return false;
          }
        };

        if (!safeFit('initial')) {
          setTimeout(() => {
            void safeFit('deferred');
          }, 100);
        }
        terminal.focus();
      });

      // Write welcome message - will be updated by VFS sync effect
      terminal.writeln('');
      // Check if we should use desktop PTY (Tauri)
      if (isDesktopMode() && shouldUseDesktopPty()) {
        terminal.writeln('');
        terminal.writeln('\x1b[1;33m● Desktop Mode - Using Local PTY\x1b[0m');
        terminal.writeln('\x1b[90m  Connecting to real shell...\x1b[0m');

        // Initialize desktop PTY
        let pty = null;
        try {
          pty = await desktopPtyManager.createSession(terminalId, {
            cols: terminal.cols,
            rows: terminal.rows,
            cwd: localShellCwdRef.current[terminalId] || 'project/sessions',
          });
        } catch (ptyError) {
          console.error('[TerminalPanel] Failed to create desktop PTY:', ptyError);
          terminal.writeln('\x1b[31m✗ Failed to connect to local shell\x1b[0m');
          terminal.writeln('\x1b[90m  Falling back to simulated terminal.\x1b[0m');
        }

        if (pty) {
          // Update terminal to use PTY
          const termRef = terminalsRef.current.find(t => t.id === terminalId);
          if (termRef) {
            termRef.ptyInstance = pty;
            termRef.mode = 'desktop-pty';
            termRef.isConnected = true;

            // Handle PTY output
            pty.onOutput((data) => {
              termRef.terminal?.write(data);
            });

            // Handle PTY close
            pty.onClose(() => {
              termRef.mode = 'local';
              termRef.isConnected = false;
              termRef.ptyInstance = undefined;
              termRef.terminal?.writeln('\r\n\x1b[31m[PTY session closed]\x1b[0m');
              termRef.terminal?.write(getPrompt('local', localShellCwdRef.current[terminalId] || 'project'));
            });

            // Handle file changes from PTY - sync to VFS and local filesystem view
            pty.onFileChange((path, type) => {
              console.log('[TerminalPanel] PTY file change:', type, path);

              // Update local filesystem state
              if (type === 'delete') {
                delete localFileSystemRef.current[path];
              } else if (type === 'create' || type === 'update') {
                localFileSystemRef.current[path] = {
                  type: 'file',
                  content: '',
                  createdAt: Date.now(),
                  modifiedAt: Date.now(),
                };
              }

              // Sync to VFS
              if (type !== 'delete' && localFileSystemRef.current[path]) {
                // Read the actual content from file and sync to VFS
                // For now, just trigger a VFS refresh
                getVfsSnapshot().then(snapshot => {
                  lastWorkspaceVersionRef.current = Math.max(
                    lastWorkspaceVersionRef.current,
                    snapshot?.version || 0
                  );
                }).catch(console.error);
              }

              // Sync to terminal executors
              Object.values(terminalHandlersRef.current).forEach(handlers => {
                if (handlers?.localFS) {
                  handlers.localFS.syncFileSystem(localFileSystemRef.current);
                }
              });
            });

            terminal.writeln('\x1b[1;32m✓ Connected to local shell\x1b[0m');
            terminal.writeln('');
          }
        } else {
          terminal.writeln('\x1b[90m  Falling back to simulated terminal.\x1b[0m');
        }
      } else {
        // Web mode: try local PTY via node-pty on server
        terminal.writeln('');
        terminal.writeln('\x1b[1;32m● Terminal Ready\x1b[0m');
        terminal.writeln('\x1b[90m  Checking for local PTY availability...\x1b[0m');

        let webPty: WebLocalPtyInstance | null = null;
        try {
          const available = await isWebLocalPtyAvailable();
          if (available) {
            terminal.writeln('\x1b[90m  Local PTY found on server, connecting...\x1b[0m');
            webPty = await createWebLocalPty({
              cols: terminal.cols,
              rows: terminal.rows,
              cwd: localShellCwdRef.current[terminalId] || 'project/sessions',
            });
          }
        } catch (ptyError) {
          logger.debug('Web local PTY not available', ptyError);
        }

        if (webPty) {
          // Update terminal to use web local PTY
          const termRef = terminalsRef.current.find(t => t.id === terminalId);
          if (termRef) {
            // CRITICAL: Set mode and instance BEFORE clearing, so onData handler
            // routes input to PTY immediately. Clear terminal to remove the
            // "Terminal Ready / Checking PTY..." messages — the PTY provides
            // its own banner and prompt.
            termRef.mode = 'desktop-pty';
            termRef.webLocalPtyInstance = webPty;
            termRef.isConnected = true;

            // Clear any pre-existing local content before PTY output arrives
            termRef.terminal?.clear();

            // Handle PTY output — lookup terminal by ID on each callback to avoid stale refs
            webPty.onOutput((data) => {
              const current = terminalsRef.current.find(t => t.id === terminalId);
              current?.terminal?.write(data);
            });

            // Handle PTY close — lookup terminal by ID to avoid stale refs
            webPty.onClose(() => {
              const current = terminalsRef.current.find(t => t.id === terminalId);
              if (current) {
                current.mode = 'local';
                current.isConnected = false;
                current.webLocalPtyInstance = undefined;
                current.terminal?.writeln('\r\n\x1b[31m[PTY session closed]\x1b[0m');
                current.terminal?.write(getPrompt('local', localShellCwdRef.current[terminalId] || 'project'));
              }
            });
          }

          // Brief status message — PTY will provide its own banner/prompt
          terminal.writeln('\x1b[90m  Connecting to server local PTY...\x1b[0m');
          terminal.writeln('');
        } else {
          terminal.writeln('\x1b[90m  Using simulated terminal.\x1b[0m');
          terminal.writeln('\x1b[90m  Type "connect" to connect to sandbox.\x1b[0m');
        }
      }
      terminal.writeln('');

      // Only set mode: 'local' if PTY was NOT available.
      // If PTY was available, the mode was already set to 'desktop-pty' inside the
      // if (webPty) block above. Overwriting it here causes the terminal to fall
      // back to local command mode after the first command.
      const termRef = terminalsRef.current.find(t => t.id === terminalId);
      const ptyWasAvailable = termRef?.mode === 'desktop-pty' && !!termRef?.webLocalPtyInstance;

      if (!ptyWasAvailable) {
        const cwd = localShellCwdRef.current[terminalId] || normalizeScopePath(filesystemScopePathRef.current);
        terminal.write(getPrompt('local', cwd));
        updateTerminalState(terminalId, { terminal, fitAddon, mode: 'local' });
      }

      if (termRef) {
        termRef.terminal = terminal;
        termRef.fitAddon = fitAddon;
        // Clear initializing flag
        (termRef as any)._initializing = false;
      }

      terminal.onData((data: string) => {
        // Update idle timeout on any user input
        updateActivity();

        const term = terminalsRef.current.find(t => t.id === terminalId);
        if (!term) return;

        // GET HANDLERS FOR THIS TERMINAL
        const handlers = terminalHandlersRef.current[terminalId];

        // Desktop PTY mode: handle Tab for shell completion (Tauri)
        if (term.mode === 'desktop-pty' && term.ptyInstance) {
          // Handle Tab key for shell completion
          if (data === '\t') {
            // Debounce rapid Tab presses to prevent race conditions
            const now = Date.now();
            const lastTabTime = desktopPtyLastTabTimeRef.current[terminalId] || 0;
            if (now - lastTabTime < 300) {
              term.ptyInstance?.writeInput(data);
              return;
            }
            desktopPtyLastTabTimeRef.current[terminalId] = now;

            const currentLine = desktopPtyInputLineRef.current[terminalId] || '';

            if (!currentLine.trim()) {
              // No input - send Tab directly to shell for default completion
              term.ptyInstance.writeInput(data);
              return;
            }

            // Get completions from backend
            const cwd = localShellCwdRef.current[terminalId] || 'project';

            requestShellCompletion(
              term.ptyInstance!.sessionId,
              currentLine,
              0,  // cursor position
              cwd
            ).then((completions) => {
              if (completions.length === 0) {
                // No completions - send Tab to shell for default behavior
                term.ptyInstance?.writeInput(data);
              } else if (completions.length === 1) {
                // Single completion - auto-insert it
                const completion = completions[0];
                // Get the part after the prefix (what user has typed)
                const prefix = currentLine.split(/\s+/).pop() || '';
                const suffix = completion.slice(prefix.length);

                // Write the completion suffix to terminal
                term.terminal?.write(suffix);

                // Update the input line ref
                desktopPtyInputLineRef.current[terminalId] = currentLine + suffix;

                term.ptyInstance?.writeInput(suffix);
              } else {
                // Multiple completions - show them inline with selection
                const displayCompletions = completions.slice(0, 10);
                const prefix = currentLine.split(/\s+/).pop() || '';

                // Store completion state for keyboard navigation
                completionStateRef.current[terminalId] = {
                  completions: displayCompletions,
                  selectedIndex: 0,
                  currentLine,
                  prefix,
                };
                
                // Display completions with first one selected
                term.terminal?.write('\r\n');
                term.terminal?.writeln('\x1b[33mCompletions:\x1b[0m');
                displayCompletions.forEach((comp, idx) => {
                  const isSelected = idx === 0;
                  const marker = isSelected ? '\x1b[36m▶\x1b[0m' : ` \x1b[32m${idx + 1}.\x1b[0m`;
                  const highlight = isSelected ? '\x1b[1;37m' : '';
                  const reset = isSelected ? '\x1b[0m' : '';
                  term.terminal?.writeln(`  ${marker} ${highlight}${comp}${reset}`);
                });
                
                if (completions.length > 10) {
                  term.terminal?.writeln(`  \x1b[90m... and ${completions.length - 10} more\x1b[0m`);
                }
                
                // Show keyboard hint
                term.terminal?.writeln('\x1b[90m  ↑↓ navigate • Enter select • Esc cancel\x1b[0m');
                
                // Re-print prompt and current input
                term.terminal?.write('\r' + getPrompt('desktop-pty', cwd) + currentLine);
              }
            }).catch(() => {
              // Error getting completions - fall back to default Tab
              term.ptyInstance?.writeInput(data);
            });
            
            return;
          }
          
          // Track input characters for completion
          if (data === '\r' || data === '\n') {
            // Enter - check if we're in completion mode
            const enterState = completionStateRef.current[terminalId];
            if (enterState) {
              const selected = enterState.completions[enterState.selectedIndex];
              
              // Insert the selected completion
              const suffix = selected.slice(enterState.prefix.length);
              term.terminal?.write(suffix);
              desktopPtyInputLineRef.current[terminalId] = enterState.currentLine + suffix;
              term.ptyInstance?.writeInput(suffix);
              
              // Clear completion state
              completionStateRef.current[terminalId] = null;
              return;
            }
            
            // Clear the input line
            desktopPtyInputLineRef.current[terminalId] = '';
            completionStateRef.current[terminalId] = null;
          } else if (data === '\u007f') {
            // Backspace - remove last character
            const currentLine = desktopPtyInputLineRef.current[terminalId] || '';
            desktopPtyInputLineRef.current[terminalId] = currentLine.slice(0, -1);
            // Clear completion mode on backspace
            completionStateRef.current[terminalId] = null;
          } else if (data === '\u001b[A') {
            // Up arrow - previous completion
            if (completionStateRef.current[terminalId]) {
              const state = completionStateRef.current[terminalId]!;
              state.selectedIndex = (state.selectedIndex - 1 + state.completions.length) % state.completions.length;
              
              // Re-display completions with new selection
              const cwd = localShellCwdRef.current[terminalId] || 'project';
              term.terminal?.write('\r\n');
              term.terminal?.writeln('\x1b[33mCompletions:\x1b[0m');
              state.completions.forEach((comp, idx) => {
                const isSelected = idx === state.selectedIndex;
                const marker = isSelected ? '\x1b[36m▶\x1b[0m' : ` \x1b[32m${idx + 1}.\x1b[0m`;
                const highlight = isSelected ? '\x1b[1;37m' : '';
                const reset = isSelected ? '\x1b[0m' : '';
                term.terminal?.writeln(`  ${marker} ${highlight}${comp}${reset}`);
              });
              term.terminal?.writeln('\x1b[90m  ↑↓ navigate • Enter select • Esc cancel\x1b[0m');
              term.terminal?.write('\r' + getPrompt('desktop-pty', cwd) + state.currentLine);
              return;
            }
          } else if (data === '\u001b[B') {
            // Down arrow - next completion
            if (completionStateRef.current[terminalId]) {
              const state = completionStateRef.current[terminalId]!;
              state.selectedIndex = (state.selectedIndex + 1) % state.completions.length;
              
              // Re-display completions with new selection
              const cwd = localShellCwdRef.current[terminalId] || 'project';
              term.terminal?.write('\r\n');
              term.terminal?.writeln('\x1b[33mCompletions:\x1b[0m');
              state.completions.forEach((comp, idx) => {
                const isSelected = idx === state.selectedIndex;
                const marker = isSelected ? '\x1b[36m▶\x1b[0m' : ` \x1b[32m${idx + 1}.\x1b[0m`;
                const highlight = isSelected ? '\x1b[1;37m' : '';
                const reset = isSelected ? '\x1b[0m' : '';
                term.terminal?.writeln(`  ${marker} ${highlight}${comp}${reset}`);
              });
              term.terminal?.writeln('\x1b[90m  ↑↓ navigate • Enter select • Esc cancel\x1b[0m');
              term.terminal?.write('\r' + getPrompt('desktop-pty', cwd) + state.currentLine);
              return;
            }
          } else if (data === '\u001b') {
            // Escape - cancel completion mode
            if (completionStateRef.current[terminalId]) {
              completionStateRef.current[terminalId] = null;
              const cwd = localShellCwdRef.current[terminalId] || 'project';
              term.terminal?.write('\r\n');
              term.terminal?.writeln('\x1b[90mCompletion cancelled\x1b[0m');
              term.terminal?.write('\r' + getPrompt('desktop-pty', cwd) + (desktopPtyInputLineRef.current[terminalId] || ''));
              return;
            }
          } else if (data >= ' ') {
            // Regular character - add to input line and clear completion mode
            desktopPtyInputLineRef.current[terminalId] = (desktopPtyInputLineRef.current[terminalId] || '') + data;
            completionStateRef.current[terminalId] = null;
          }
          
          // Forward raw bytes to local PTY
          term.ptyInstance.writeInput(data);
          return;
        }

        // Web local PTY mode: forward input to server-side PTY (no shell completion)
        if (term.mode === 'desktop-pty' && term.webLocalPtyInstance) {
          // Handle Enter for line tracking
          if (data === '\r' || data === '\n') {
            desktopPtyInputLineRef.current[terminalId] = '';
          } else if (data === '\u007f') {
            // Backspace
            const currentLine = desktopPtyInputLineRef.current[terminalId] || '';
            desktopPtyInputLineRef.current[terminalId] = currentLine.slice(0, -1);
          } else if (data >= ' ') {
            desktopPtyInputLineRef.current[terminalId] = (desktopPtyInputLineRef.current[terminalId] || '') + data;
          }

          // Forward raw bytes to web local PTY
          term.webLocalPtyInstance.writeInput(data);
          return;
        }

        // PTY mode: forward raw bytes to sandbox, skip local handling
        if (term.mode === 'pty' && term.sandboxInfo.sessionId) {
          // Buffer input until connected
          if (term.sandboxInfo.status === 'active') {
            if (handlers) {
              handlers.batcher.batch(data);
            } else {
              void sendInput(term.sandboxInfo.sessionId, data);
            }
          } else {
            commandQueueRef.current[terminalId] = [
              ...(commandQueueRef.current[terminalId] || []),
              data
            ];
          }
          return;
        }

        // Sandbox command-mode: line-based execution
        if (term.mode === 'sandbox-cmd' && term.sandboxInfo.sessionId) {
          handleSandboxCmdInput(terminalId, data, term);
          return;
        }

        // Editor mode - use handler
        if (term.mode === 'editor' && handlers?.editor.isOpen()) {
          handlers.editor.handleInput(data);
          return;
        }

        // Local mode - use input handler
        if (handlers) {
          handlers.input.handleInput(data);
          return;
        }
      });

      terminal.onResize(({ cols, rows }: { cols: number; rows: number }) => {
        const term = terminalsRef.current.find(t => t.id === terminalId);
        
        // Desktop PTY: resize the local PTY
        if (term?.mode === 'desktop-pty' && term.ptyInstance) {
          term.ptyInstance.resize(cols, rows);
          return;
        }

        // Web local PTY: resize the server-side PTY
        if (term?.mode === 'desktop-pty' && term.webLocalPtyInstance) {
          term.webLocalPtyInstance.resize(cols, rows);
          return;
        }
        
        // Sandbox PTY: send resize to sandbox
        if (term?.isConnected && term.sandboxInfo.sessionId) {
          sendResize(term.sandboxInfo.sessionId, cols, rows);
        }
      });

    } catch (err) {
      logger.error('Failed to load xterm.js', err as Error);
      toast.error('Failed to initialize terminal. Install @xterm/xterm @xterm/addon-fit @xterm/addon-web-links');
    }
  }, [executeLocalShellCommand, updateTerminalState, sendInput, sendResize]);

  // Handle sandbox command-mode input (line-based execution)
  const handleSandboxCmdInput = useCallback((
    terminalId: string,
    data: string,
    term: TerminalInstance
  ) => {
    const lineBuffer = lineBufferRef.current[terminalId] || '';

    if (data === '\r' || data === '\n') {
      term.terminal?.write('\r\n');
      const command = lineBuffer.trim();
      lineBufferRef.current[terminalId] = '';

      if (command) {
        // Add to queue for execution
        commandQueueRef.current[terminalId] = [
          ...(commandQueueRef.current[terminalId] || []),
          command
        ];

        // Execute via API
        if (term.sandboxInfo.sessionId) {
          sendInput(term.sandboxInfo.sessionId, command + '\n');
        }
      }

      const cwd = localShellCwdRef.current[terminalId] || filesystemScopePathRef.current || 'project';
      term.terminal?.write(getPrompt('sandbox-cmd', cwd));
      return;
    }

    if (data === '\u007f') { // Backspace
      if (lineBuffer.length > 0) {
        lineBufferRef.current[terminalId] = lineBuffer.slice(0, -1);
        term.terminal?.write('\b \b');
      }
      return;
    }

    if (data === '\t') {
      // Basic tab completion in command mode
      return;
    }

    if (data === '\x03') { // Ctrl+C
      term.terminal?.write('^C\r\n');
      lineBufferRef.current[terminalId] = '';
      const cwd = localShellCwdRef.current[terminalId] || filesystemScopePathRef.current || 'project';
      term.terminal?.write(getPrompt('sandbox-cmd', cwd));
      return;
    }

    if (data === '\u001b[A') {
      // Up arrow - previous command in history
      const history = commandHistoryRef.current[terminalId] || [];
      let idx = historyIndexRef.current[terminalId] ?? history.length;
      if (idx > 0) {
        idx--;
        historyIndexRef.current[terminalId] = idx;
        const cmd = history[idx] || '';
        const cwd = localShellCwdRef.current[terminalId] || filesystemScopePathRef.current || 'project';
        term.terminal?.write('\r\x1b[K' + getPrompt('sandbox-cmd', cwd) + cmd);
        lineBufferRef.current[terminalId] = cmd;
      }
      return;
    }

    if (data === '\u001b[B') {
      // Down arrow - next command in history
      const history = commandHistoryRef.current[terminalId] || [];
      let idx = historyIndexRef.current[terminalId] ?? history.length;
      if (idx < history.length - 1) {
        idx++;
        historyIndexRef.current[terminalId] = idx;
        const cmd = history[idx] || '';
        const cwd = localShellCwdRef.current[terminalId] || filesystemScopePathRef.current || 'project';
        term.terminal?.write('\r\x1b[K' + getPrompt('sandbox-cmd', cwd) + cmd);
        lineBufferRef.current[terminalId] = cmd;
      } else {
        idx = history.length;
        historyIndexRef.current[terminalId] = idx;
        const cwd = localShellCwdRef.current[terminalId] || filesystemScopePathRef.current || 'project';
        term.terminal?.write('\r\x1b[K' + getPrompt('sandbox-cmd', cwd));
        lineBufferRef.current[terminalId] = '';
      }
      return;
    }

    if (data >= ' ') {
      lineBufferRef.current[terminalId] = lineBuffer + data;
      term.terminal?.write(data);
    }
  }, [filesystemScopePathRef, getPrompt, sendInput]);

  // Spinner animation frames for connecting status
  const spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

  // Connection timeout in milliseconds (configurable, default 60 seconds for slower connections)
  const CONNECTION_TIMEOUT_MS = parseInt(
    process.env.NEXT_PUBLIC_TERMINAL_CONNECTION_TIMEOUT_MS || '60000',
    10
  ) || 60000;
  const CONNECTION_TIMEOUT_SECONDS = Math.round(CONNECTION_TIMEOUT_MS / 1000);

  const connectTerminal = useCallback(async (terminalId: string) => {
    connectTerminalRef.current = connectTerminal;

    // TRY HANDLER FIRST
    const handlers = terminalHandlersRef.current[terminalId];
    if (handlers) {
      await handlers.connection.connect();
      return;
    }

        // Connection delegated to SandboxConnectionManager
    // See: lib/sandbox/sandbox-connection-manager.ts (1,211 lines)
    // Features:
    // - WebSocket/SSE connection with reconnection
    // - Provider-specific PTY (E2B, Daytona, Sprites, CodeSandbox, Vercel)
    // - Exponential backoff reconnection
    // - Connection throttling
    // - Auto-cd to workspace
    
    logger.warn('Connection handler should have been used');
    return;
  }, []);



  // Health monitoring handled by TerminalHealthMonitor handler
  // See: lib/sandbox/terminal-health-monitor.ts

  const setXtermContainer = useCallback((terminalId: string) => (el: HTMLDivElement | null) => {
    if (el) {
      const term = terminalsRef.current.find(t => t.id === terminalId);
      // CRITICAL FIX: Prevent double initialization
      // Only init if terminal instance doesn't exist AND we haven't already started init
      if (term && !term.terminal && !term.xtermRef.current) {
        term.xtermRef.current = el;
        initXterm(terminalId, el);
      } else if (term && term.terminal && term.xtermRef.current !== el && el) {
        // Re-attach if container changed (e.g., tab switch)
        term.xtermRef.current = el;
        // Refit terminal to new container
        try {
          term.fitAddon?.fit();
          term.terminal.focus();
        } catch {}
      }
    }
  }, [initXterm]);

  const clearTerminal = useCallback((terminalId?: string) => {
    const ids = terminalId ? [terminalId] : terminals.map(t => t.id);
    ids.forEach(id => {
      const term = terminalsRef.current.find(t => t.id === id);
      // Guard: only clear if terminal is fully initialized
      if (term?.terminal && term.terminal.rows > 0) {
        try {
          term.terminal.clear();
        } catch (error) {
          console.warn('[TerminalPanel] Failed to clear terminal:', error);
        }
      }
    });
    toast.info('Terminal cleared');
  }, [terminals]);

  const copyOutput = useCallback(async () => {
    const active = terminalsRef.current.find(t => t.id === activeTerminalId);
    if (!active?.terminal) return;

    try {
      const selection = active.terminal.getSelection();
      if (selection) {
        await clipboard.writeText(selection);
        toast.success('Selection copied');
        return;
      }
      const buffer = active.terminal.buffer.active;
      const lines: string[] = [];
      for (let i = 0; i < buffer.length; i++) {
        const line = buffer.getLine(i)?.translateToString();
        if (line) lines.push(line);
      }
      const text = lines.join('\n');
      await clipboard.writeText(text);
      toast.success('Copied to clipboard');
    } catch {
      toast.error('Failed to copy to clipboard');
    }
  }, [activeTerminalId]);

  const pasteFromClipboard = useCallback(async () => {
    const active = terminalsRef.current.find(t => t.id === activeTerminalId);
    if (!active?.terminal) return;

    try {
      const text = await clipboard.readText();
      if (text) {
        active.terminal.write(text);
        toast.success('Pasted from clipboard');
      }
    } catch {
      toast.error('Failed to paste from clipboard');
    }
  }, [activeTerminalId]);

  const selectAll = useCallback(async () => {
    const active = terminalsRef.current.find(t => t.id === activeTerminalId);
    if (!active?.terminal) return;

    // Select all content in the viewport
    const buffer = active.terminal.buffer.active;
    const startLine = buffer.viewportY;
    const endLine = buffer.viewportY + active.terminal.rows;
    let allText = '';
    
    for (let i = startLine; i < endLine && i < buffer.length; i++) {
      const line = buffer.getLine(i)?.translateToString();
      if (line) allText += line + '\n';
    }
    
    // Write to clipboard
    try {
      await clipboard.writeText(allText.trim());
      toast.success('All visible content copied');
    } catch {
      toast.error('Failed to copy to clipboard');
    }
  }, [activeTerminalId]);

  const handleContextMenu = useCallback((e: React.MouseEvent, terminalId: string) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, terminalId });
  }, []);

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  // Update refs when callbacks change (must be after callback definitions)
  useEffect(() => {
    copyOutputRef.current = copyOutput;
  }, [copyOutput]);

  useEffect(() => {
    pasteFromClipboardRef.current = pasteFromClipboard;
  }, [pasteFromClipboard]);

  useEffect(() => {
    selectAllRef.current = selectAll;
  }, [selectAll]);

  useEffect(() => {
    closeContextMenuRef.current = closeContextMenu;
  }, [closeContextMenu]);

  const toggleSelectionMode = useCallback(() => {
    setIsSelectingMode(prev => !prev);
    toast.info(isSelectingMode ? 'Selection mode disabled' : 'Selection mode enabled - click and drag to select text');
  }, [isSelectingMode]);

  const killTerminal = useCallback(async (terminalId: string) => {
    const terminal = terminalsRef.current.find(t => t.id === terminalId);
    if (!terminal?.sandboxInfo?.sessionId) {
      closeTerminal(terminalId);
      return;
    }

    try {
      terminal.eventSource?.close();
      await fetch('/api/sandbox/terminal', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(),
        },
        credentials: 'include',
        body: JSON.stringify({ sessionId: terminal.sandboxInfo.sessionId }),
      });
    } catch {}
    closeTerminal(terminalId);
    toast.success('Terminal closed');
  }, [closeTerminal]);

  const killAllTerminals = useCallback(async () => {
    for (const terminal of terminalsRef.current) {
      terminal.eventSource?.close();
      if (terminal.sandboxInfo.sessionId) {
        try {
          await fetch('/api/sandbox/terminal', {
            method: 'DELETE',
            headers: {
              'Content-Type': 'application/json',
              ...getAuthHeaders(),
            },
            credentials: 'include',
            body: JSON.stringify({ sessionId: terminal.sandboxInfo.sessionId }),
          });
        } catch {}
      }
      terminal.terminal?.dispose();
    }
    setTerminals([]);
    setActiveTerminalId(null);
    setIsSplitView(false);
    toast.success('All terminals closed');
  }, []);

  const toggleSplitView = useCallback(() => {
    if (isSplitView) {
      // Just disable split view, don't kill terminals
      setIsSplitView(false);
    } else {
      // Enable split view - create second terminal if needed
      if (terminals.length < 2) {
        const newId = createTerminal('Terminal 2');
        // Ensure the new terminal is initialized
        setTimeout(() => {
          const term = terminalsRef.current.find(t => t.id === newId);
          if (term?.xtermRef.current && !term.terminal) {
            initXterm(newId, term.xtermRef.current);
          }
        }, 100);
      }
      setIsSplitView(true);
    }
  }, [isSplitView, terminals.length, createTerminal, initXterm]);

  const getModeIndicator = (mode: TerminalMode, status: string) => {
    switch (mode) {
      case 'local':
        return { icon: <WifiOff className="w-3 h-3" />, text: 'Local', color: 'text-blue-400' };
      case 'connecting':
        return { icon: <span className="w-2 h-2 bg-yellow-400 rounded-full animate-pulse" />, text: 'Connecting...', color: 'text-yellow-400' };
      case 'pty':
        return { icon: <Wifi className="w-3 h-3" />, text: 'Connected', color: 'text-green-400' };
      case 'sandbox-cmd':
        return { icon: <span className="w-2 h-2 bg-purple-400 rounded-full" />, text: 'Command Mode', color: 'text-purple-400' };
      case 'editor':
        return { icon: <span className="w-2 h-2 bg-orange-400 rounded-full" />, text: 'Editor', color: 'text-orange-400' };
      case 'desktop-pty':
        return { icon: <Wifi className="w-3 h-3" />, text: 'Desktop', color: 'text-cyan-400' };
      default:
        return { icon: <WifiOff className="w-3 h-3" />, text: 'Unknown', color: 'text-gray-400' };
    }
  };

  const activeTerminal = terminals.find(t => t.id === activeTerminalId);
  const modeInfo = activeTerminal ? getModeIndicator(activeTerminal.mode, activeTerminal.sandboxInfo.status) : null;

  // Memoize terminal tab rendering for performance (MUST be before early returns)
  const renderTerminalTab = useCallback((terminal: TerminalInstance) => {
    const isActive = activeTerminalId === terminal.id;
    return (
      <div
        key={terminal.id}
        role="tab"
        aria-selected={isActive}
        aria-controls={`terminal-panel-${terminal.id}`}
        tabIndex={isActive ? 0 : -1}
        className={`flex items-center gap-2 px-3 py-1 rounded text-xs cursor-pointer transition-colors ${
          isActive
            ? 'bg-white/15 text-white'
            : 'text-white/50 hover:text-white hover:bg-white/5'
        }`}
        onClick={() => setActiveTerminalId(terminal.id)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setActiveTerminalId(terminal.id);
          }
        }}
      >
        <span className="flex items-center gap-1">
          <span className={`w-1.5 h-1.5 rounded-full ${
            terminal.mode === 'pty' ? 'bg-green-400 animate-pulse' :
            terminal.mode === 'connecting' ? 'bg-yellow-400 animate-pulse' :
            terminal.mode === 'sandbox-cmd' ? 'bg-purple-400' :
            terminal.mode === 'editor' ? 'bg-orange-400' :
            'bg-blue-400'
          }`} />
          {terminal.name}
        </span>
        {terminals.length > 1 && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              closeTerminal(terminal.id);
            }}
            className="hover:text-red-400 transition-colors"
            aria-label={`Close ${terminal.name}`}
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>
    );
  }, [activeTerminalId, terminals.length, closeTerminal]);

  // NOTE: Keep component mounted even when closed to allow VFS sync for on-demand shell commands
  // Priority: minimized bar > full terminal > hidden (mounted for VFS sync)
  
  if (isMinimized && isOpen) {
    // Minimized but still open - render minimized bar (original behavior)
    return (
      <motion.div
        initial={{ y: 100, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 100, opacity: 0 }}
        className="fixed bottom-0 left-0 right-0 z-50 bg-black/90 border-t border-white/10"
      >
        <div className="flex items-center justify-between px-4 py-2">
          <div className="flex items-center gap-2">
            <TerminalIcon className="w-4 h-4 text-green-400" />
            <span className="text-sm text-white">Terminal</span>
            {terminals.some(t => t.mode === 'pty') && (
              <span className="text-xs text-green-400 flex items-center gap-1">
                <span className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse" />
                {terminals.filter(t => t.mode === 'pty').length} connected
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={onMinimize}>
              <Maximize2 className="w-4 h-4" />
            </Button>
            <Button variant="ghost" size="sm" onClick={onClose}>
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </motion.div>
    );
  }

  if (!isOpen) {
    // Keep component mounted but hidden - allows VFS sync effects to continue running
    // This ensures VFS is available for on-demand shell commands like 'ls' when terminal is closed
    return (
      <div
        data-terminal-hidden
        data-scope-path={filesystemScopePath}
        style={{ display: 'none' }}
      />
    );
  }

  return (
    <motion.div
      initial={{ y: 100, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 100, opacity: 0 }}
      style={{ height: terminalHeight }}
      className={`fixed bottom-0 left-0 right-0 z-50 bg-black/95 border-t border-white/10 backdrop-blur-sm flex flex-col`}
      role="application"
      aria-label="Terminal panel"
    >
      {/* Resize handle */}
      <div
        onMouseDown={handleResizeStart}
        className={`absolute -top-1 left-0 right-0 h-2 cursor-ns-resize z-50 ${
          isResizing ? 'bg-blue-500/30' : 'hover:bg-white/10'
        }`}
        title="Drag to resize terminal"
      >
        <div className="flex items-center justify-center h-full">
          <GripHorizontal className="w-4 h-4 text-white/30" />
        </div>
      </div>
      <div className="flex items-center justify-between px-2 sm:px-4 py-2 border-b border-white/10 bg-black/50 shrink-0 gap-2">
        <div className="flex items-center gap-2 sm:gap-3 flex-1 min-w-0 overflow-hidden">
          <div className="flex items-center gap-2">
            <TerminalIcon className="w-4 h-4 text-white/70" />
            <span className="text-sm font-medium text-white/90">Terminal</span>
          </div>

          <div className="hidden sm:flex items-center gap-1 ml-4" role="tablist" aria-label="Terminal tabs">
            {terminals.map((terminal) => renderTerminalTab(terminal))}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => createTerminal()}
              className="h-6 w-6 p-0 ml-1 text-white/50 hover:text-white"
              aria-label="Add new terminal"
            >
              <Plus className="w-4 h-4" />
            </Button>
          </div>

          {activeTerminal && modeInfo && (
            <div className="hidden sm:flex items-center gap-2 text-xs ml-auto">
              <span className={`flex items-center gap-1 ${modeInfo.color}`}>
                {modeInfo.icon}
                {modeInfo.text}
              </span>
              {activeTerminal.sandboxInfo.sandboxId && (
                <>
                  <span className="text-white/30">|</span>
                  <span className="text-white/50 flex items-center gap-1">
                    <Cpu className="w-3 h-3" />
                    {activeTerminal.sandboxInfo.resources?.cpu || '2 vCPU'}
                  </span>
                  <span className="text-white/50 flex items-center gap-1">
                    <MemoryStick className="w-3 h-3" />
                    {activeTerminal.sandboxInfo.resources?.memory || '4 GB'}
                  </span>
                </>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {/* Phase 2: Sandbox connection button */}
          <Button
            variant="ghost"
            size="sm"
            onClick={toggleSandboxConnection}
            className={`text-white/60 hover:text-white ${
              sandboxStatus === 'connected' ? 'bg-green-500/20 text-green-400' :
              sandboxStatus === 'connecting' ? 'bg-yellow-500/20 text-yellow-400' :
              'text-red-400 hover:text-red-300'
            }`}
            title={
              sandboxStatus === 'connected' ? 'Disconnect sandbox' :
              sandboxStatus === 'connecting' ? 'Connecting...' :
              'Connect sandbox'
            }
            aria-label={
              sandboxStatus === 'connected' ? 'Disconnect sandbox' :
              sandboxStatus === 'connecting' ? 'Connecting to sandbox' :
              'Connect sandbox'
            }
          >
            {sandboxStatus === 'connected' ? (
              <Wifi className="w-4 h-4" />
            ) : sandboxStatus === 'connecting' ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <WifiOff className="w-4 h-4" />
            )}
          </Button>
          
          {/* Idle timeout indicator */}
          {idleTimeLeft !== null && IDLE_TIMEOUT_MS > 0 && (
            <div className="text-xs text-yellow-400 px-2 py-1 bg-yellow-500/10 rounded animate-pulse">
              ⏱️ Auto-disconnect in {Math.floor(idleTimeLeft / 60000)}:{String(Math.floor((idleTimeLeft % 60000) / 1000)).padStart(2, '0')}
            </div>
          )}
          
          <Button
            variant="ghost"
            size="sm"
            onClick={toggleSplitView}
            className={`text-white/60 hover:text-white ${
              isSplitView ? 'bg-white/10' : ''
            }`}
            title={isSplitView ? 'Disable split view' : 'Enable split view'}
            aria-label={isSplitView ? 'Disable split view' : 'Enable split view'}
            aria-pressed={isSplitView}
          >
            <Split className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={copyOutput}
            className="text-white/60 hover:text-white"
            aria-label="Copy terminal output"
            title="Copy (Ctrl+Shift+C)"
          >
            <Copy className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={pasteFromClipboard}
            className="text-white/60 hover:text-white"
            aria-label="Paste from clipboard"
            title="Paste (Ctrl+Shift+V)"
          >
            <ClipboardPaste className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => clearTerminal()}
            className="text-white/60 hover:text-white"
            aria-label="Clear terminal"
            title="Clear"
          >
            <Trash2 className="w-4 h-4" />
          </Button>
          {terminals.some(t => t.mode === 'pty') && (
            <Button
              variant="ghost"
              size="sm"
              onClick={killAllTerminals}
              className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
              aria-label="Kill all terminals"
            >
              <Square className="w-4 h-4" />
            </Button>
          )}
          <div className="w-px h-4 bg-white/20 mx-1" />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsExpanded(!isExpanded)}
            className="text-white/60 hover:text-white"
            aria-label={isExpanded ? 'Collapse terminal' : 'Expand terminal'}
            aria-expanded={isExpanded}
          >
            {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onMinimize}
            className="text-white/60 hover:text-white"
            aria-label="Minimize terminal"
          >
            <Minimize2 className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="text-white/60 hover:text-white"
            aria-label="Close terminal"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
      </div>

      <div className={`flex flex-1 min-h-0 w-full ${isSplitView ? 'flex-row' : 'flex-col'}`}>
        {terminals.map((terminal, index) => (
          <div
            key={terminal.id}
            id={`terminal-panel-${terminal.id}`}
            role="tabpanel"
            aria-labelledby={`terminal-tab-${terminal.id}`}
            className={`flex-1 min-h-0 ${
              isSplitView ? 'w-1/2' : 'w-full'
            } ${
              !isSplitView && activeTerminalId !== terminal.id ? 'hidden' : ''
            } ${
              isSplitView && terminals.length > 1 ? 'border-r border-white/10 last:border-r-0' : ''
            }`}
            onContextMenu={(e) => handleContextMenu(e, terminal.id)}
          >
            <div
              ref={setXtermContainer(terminal.id)}
              className={`w-full h-full p-2 ${isSelectingMode ? 'cursor-crosshair' : ''}`}
              aria-label={`${terminal.name} terminal`}
              style={{ userSelect: isSelectingMode ? 'text' : 'none' }}
            />
          </div>
        ))}
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <div
          className="fixed z-[100] bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl py-1 min-w-[180px]"
          style={{ top: contextMenu.y, left: contextMenu.x }}
        >
          <button
            onClick={() => {
              void copyOutput();
              closeContextMenu();
            }}
            className="w-full px-4 py-2 text-left text-sm text-white hover:bg-zinc-800 flex items-center gap-2"
          >
            <Copy className="w-4 h-4" />
            Copy Selection
            <span className="ml-auto text-xs text-zinc-500">Ctrl+Shift+C</span>
          </button>
          <button
            onClick={() => {
              void pasteFromClipboard();
              closeContextMenu();
            }}
            className="w-full px-4 py-2 text-left text-sm text-white hover:bg-zinc-800 flex items-center gap-2"
          >
            <ClipboardPaste className="w-4 h-4" />
            Paste
            <span className="ml-auto text-xs text-zinc-500">Ctrl+Shift+V</span>
          </button>
          <button
            onClick={() => {
              selectAll();
              closeContextMenu();
            }}
            className="w-full px-4 py-2 text-left text-sm text-white hover:bg-zinc-800 flex items-center gap-2"
          >
            <Copy className="w-4 h-4" />
            Copy All
            <span className="ml-auto text-xs text-zinc-500">Ctrl+Shift+A</span>
          </button>
          <div className="border-t border-zinc-700 my-1" />
          <button
            onClick={() => {
              toggleSelectionMode();
              closeContextMenu();
            }}
            className="w-full px-4 py-2 text-left text-sm text-white hover:bg-zinc-800 flex items-center gap-2"
          >
            {isSelectingMode ? <Check className="w-4 h-4 text-green-400" /> : <Square className="w-4 h-4" />}
            {isSelectingMode ? 'Disable Selection' : 'Enable Selection'}
          </button>
          <div className="border-t border-zinc-700 my-1" />
          <button
            onClick={() => {
              clearTerminal(contextMenu.terminalId);
              closeContextMenu();
            }}
            className="w-full px-4 py-2 text-left text-sm text-red-400 hover:bg-red-900/20 flex items-center gap-2"
          >
            <Trash2 className="w-4 h-4" />
            Clear Terminal
          </button>
        </div>
      )}

      {activeTerminal && (
        <>
          {/* Rotating sponsor ad bar — subtle, terminal-styled */}
          {sponsorAd && (
            <a
              href={sponsorAd.url}
              target="_blank"
              rel="noopener sponsored"
              className="block px-4 py-1 border-t border-white/5 bg-gradient-to-r from-purple-500/5 via-transparent to-cyan-500/5 text-[10px] text-white/30 hover:text-white/60 hover:from-purple-500/10 hover:to-cyan-500/10 transition-all duration-500 shrink-0"
              onClick={() => trackAdView(sponsorAd)}
            >
              <span className="uppercase tracking-wider opacity-50 mr-2">Sponsor</span>
              {sponsorAd.text}
            </a>
          )}
          <div className="flex items-center justify-between px-4 py-1.5 border-t border-white/10 bg-black/50 text-[10px] text-white/40 shrink-0">
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1">
              {modeInfo?.icon}
              <span className={modeInfo?.color}>{modeInfo?.text}</span>
            </span>
            {activeTerminal.isConnected && (
              <span>PTY {activeTerminal.terminal?.cols || 0}×{activeTerminal.terminal?.rows || 0}</span>
            )}
            {activeTerminal.mode === 'local' && (
              <span className="text-white/50">Type "help" for commands</span>
            )}
          </div>
          {activeTerminal.sandboxInfo.sandboxId && (
            <span className="font-mono">{activeTerminal.sandboxInfo.sandboxId.slice(0, 12)}…</span>
          )}
        </div>
        </>
      )}
    </motion.div>
  );
}
