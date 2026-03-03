'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import {
  Terminal as TerminalIcon, X, Minimize2, Maximize2, Square,
  Trash2, Copy, ChevronUp, ChevronDown, GripHorizontal,
  Cpu, MemoryStick, Plus, Split, Wifi, WifiOff, Loader2
} from 'lucide-react';
import { toast } from 'sonner';
import { motion } from 'framer-motion';
import { saveTerminalSession, getTerminalSessions, addCommandToHistory } from '@/lib/terminal/terminal-storage';
import { secureRandom, generateSecureId } from '@/lib/utils';
import { checkCommandSecurity, formatSecurityWarning, detectObfuscation, DEFAULT_SECURITY_CONFIG } from '@/lib/terminal/terminal-security';
import { createLogger } from '@/lib/utils/logger';
import { useVirtualFilesystem } from '@/hooks/use-virtual-filesystem';

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

type TerminalMode = 'local' | 'connecting' | 'pty' | 'sandbox-cmd' | 'editor' | 'command-mode';

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
}

interface LocalFileSystem {
  [path: string]: {
    type: 'file' | 'directory';
    content?: string;
    createdAt: number;
    modifiedAt: number;
  };
}

function getAuthToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem('token');
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
  const token = getAuthToken();
  const anonymousSessionId = getAnonymousSessionId();
  const headers: Record<string, string> = {};

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  if (anonymousSessionId) {
    headers['x-anonymous-session-id'] = anonymousSessionId;
  }

  return headers;
}

const createInitialFileSystem = (): LocalFileSystem => ({
  'project': { type: 'directory', createdAt: Date.now(), modifiedAt: Date.now() },
  'project/README.md': { 
    type: 'file', 
    content: '# My Project\n\nWelcome to your project!\n\nThis is a local shell simulation.\n',
    createdAt: Date.now(), 
    modifiedAt: Date.now() 
  },
  'project/package.json': {
    type: 'file',
    content: '{\n  "name": "my-project",\n  "version": "1.0.0",\n  "description": "A sample project"\n}\n',
    createdAt: Date.now(),
    modifiedAt: Date.now()
  },
  'project/src': { type: 'directory', createdAt: Date.now(), modifiedAt: Date.now() },
  'project/src/index.js': {
    type: 'file',
    content: 'console.log("Hello, World!");\n',
    createdAt: Date.now(),
    modifiedAt: Date.now()
  },
});

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
  
  // Phase 2: Sandbox lifecycle control
  const [sandboxStatus, setSandboxStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected');
  const [autoConnectSandbox, setAutoConnectSandbox] = useState(false); // Default: off (lazy init)
  const [idleTimeLeft, setIdleTimeLeft] = useState<number | null>(null);
  const [lastActivity, setLastActivity] = useState<number>(Date.now());
  
  // Idle timeout configuration (15 minutes default, 0 to disable)
  const IDLE_TIMEOUT_MS = parseInt(process.env.NEXT_PUBLIC_SANDBOX_IDLE_TIMEOUT_MS || '900000', 10);
  const IDLE_WARNING_MS = parseInt(process.env.NEXT_PUBLIC_SANDBOX_IDLE_WARNING_MS || '60000', 10);

  const terminalsRef = useRef<TerminalInstance[]>([]);
  terminalsRef.current = terminals;
  const resizeStartY = useRef<number>(0);
  const resizeStartHeight = useRef<number>(0);

  // Store the filesystem scope path for auto-cd on connect
  const filesystemScopePathRef = useRef<string | undefined>(filesystemScopePath);
  filesystemScopePathRef.current = filesystemScopePath;

  // Use virtual filesystem to get real files instead of mock
  const virtualFilesystem = useVirtualFilesystem(filesystemScopePath || 'project');
  const {
    listDirectory: listVfsDirectory,
    readFile: readVfsFile,
    getSnapshot: getVfsSnapshot,
  } = virtualFilesystem;

  // Sync local filesystem with virtual filesystem on mount and when scope changes
  useEffect(() => {
   if (!isOpen) return;
   
   const syncVfsToLocal = async () => {
     try {
       const snapshot = await getVfsSnapshot();
       const files = snapshot?.files || [];
       
       if (files.length === 0) {
         // Keep mock filesystem when VFS is empty
         if (Object.keys(localFileSystemRef.current).length <= 1) {
           localFileSystemRef.current = createInitialFileSystem();
         }
         return;
       }

       // Merge VFS files into existing local filesystem (don't destroy local-only files)
       const fs = localFileSystemRef.current;
       
       // Ensure project root exists
       if (!fs['project']) {
         fs['project'] = { type: 'directory', createdAt: Date.now(), modifiedAt: Date.now() };
       }
       
       for (const file of files) {
         // Normalize VFS path to project-relative
         let relativePath = file.path;
         // Strip session prefix if present
         relativePath = relativePath.replace(/^project\/sessions\/[^/]+\//, '');
         // Strip leading project/ to avoid duplication
         relativePath = relativePath.replace(/^project\//, '');
         
         const fullPath = `project/${relativePath}`;
         
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
       
       console.log('[TerminalPanel] Merged VFS into project/:', Object.keys(fs).length, 'entries');
     } catch (error) {
       console.error('[TerminalPanel] Failed to sync VFS:', error);
     }
   };
   
   syncVfsToLocal();
  }, [isOpen, filesystemScopePath, getVfsSnapshot]);

  // Bidirectional sync: Poll VFS for changes from code-preview-panel/editor
  useEffect(() => {
    if (!isOpen) return;
    
    const pollInterval = setInterval(async () => {
      try {
        const snapshot = await getVfsSnapshot();
        const currentFiles = Object.keys(localFileSystemRef.current);
        const vfsFiles = snapshot?.files?.map(f => f.path) || [];
        
        // Check if VFS has new/changed files
        const hasChanges = vfsFiles.some(f => !currentFiles.includes(f));
        if (hasChanges) {
          console.log('[Terminal] VFS changed, re-syncing...');
          // Trigger re-sync
          const syncVfsToLocal = async () => {
            try {
              const snapshot = await getVfsSnapshot();
              const files = snapshot?.files || [];

              if (files.length === 0) {
                if (Object.keys(localFileSystemRef.current).length <= 1) {
                  localFileSystemRef.current = createInitialFileSystem();
                }
                return;
              }

              const fs = localFileSystemRef.current;

              if (!fs['project']) {
                fs['project'] = { type: 'directory', createdAt: Date.now(), modifiedAt: Date.now() };
              }

              for (const file of files) {
                let relativePath = file.path;
                relativePath = relativePath.replace(/^project\/sessions\/[^/]+\//, '');
                relativePath = relativePath.replace(/^project\//, '');

                const fullPath = `project/${relativePath}`;

                const parts = fullPath.split('/');
                for (let i = 1; i < parts.length; i++) {
                  const dirPath = parts.slice(0, i).join('/');
                  if (!fs[dirPath]) {
                    fs[dirPath] = { type: 'directory', createdAt: Date.now(), modifiedAt: Date.now() };
                  }
                }

                if (file.content !== undefined) {
                  fs[fullPath] = {
                    type: 'file',
                    content: file.content,
                    createdAt: Date.now(),
                    modifiedAt: new Date(file.lastModified).getTime(),
                  };
                }
              }

              console.log('[Terminal] Re-synced VFS:', Object.keys(fs).length, 'entries');
            } catch (error) {
              console.error('[Terminal] Re-sync error:', error);
            }
          };
          syncVfsToLocal();
        }
      } catch (error) {
        console.error('[Terminal] Poll error:', error);
      }
    }, 2000);
    
    return () => clearInterval(pollInterval);
  }, [isOpen, getVfsSnapshot]);

  const localFileSystemRef = useRef<LocalFileSystem>(createInitialFileSystem());
  const localShellCwdRef = useRef<Record<string, string>>({});
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
  const connectTerminalRef = useRef<(terminalId: string) => Promise<void>>();

  // Input batching to reduce HTTP overhead (ARCH 4)
  const inputBatchRef = useRef<Record<string, string>>({});
  const inputFlushRef = useRef<Record<string, NodeJS.Timeout>>({});

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

  // Save terminal state on unmount/close
  useEffect(() => {
    return () => {
      // Save terminal state to localStorage
      const state = {
        commandHistory: commandHistoryRef.current,
        sandboxConnected: sandboxStatus === 'connected',
        timestamp: Date.now(),
      };
      localStorage.setItem('terminal-state', JSON.stringify(state));
      console.log('[Terminal] Saved state to localStorage');
      
      // Also save to database via saveTerminalSession
      terminalsRef.current.forEach(t => {
        t.eventSource?.close();
        t.terminal?.dispose();
        
        saveTerminalSession({
          id: t.id,
          name: t.name,
          commandHistory: commandHistoryRef.current[t.id] || [],
          sandboxInfo: {
            ...t.sandboxInfo,
            status: 'none'
          },
        });
      });
    };
  }, [sandboxStatus]);

  // Phase 2: Idle timeout monitoring
  useEffect(() => {
    // Only monitor if sandbox is connected and timeout is enabled
    if (sandboxStatus !== 'connected' || IDLE_TIMEOUT_MS <= 0) {
      setIdleTimeLeft(null);
      return;
    }
    
    const checkIdle = setInterval(() => {
      const elapsed = Date.now() - lastActivity;
      const remaining = IDLE_TIMEOUT_MS - elapsed;
      
      if (remaining <= 0) {
        // Timeout reached - auto disconnect
        console.log('[Sandbox Idle] Timeout reached, disconnecting...');
        toast.warning('Sandbox disconnected due to inactivity');
        toggleSandboxConnection();
        setIdleTimeLeft(null);
      } else if (remaining <= IDLE_WARNING_MS && remaining > 0) {
        // Show warning in last minute
        setIdleTimeLeft(remaining);
      } else if (remaining > IDLE_WARNING_MS) {
        // Still plenty of time
        setIdleTimeLeft(null);
      }
    }, 10000); // Check every 10 seconds
    
    return () => clearInterval(checkIdle);
  }, [sandboxStatus, lastActivity, IDLE_TIMEOUT_MS, IDLE_WARNING_MS, toggleSandboxConnection]);

  // Update last activity on user input
  const updateActivity = useCallback(() => {
    setLastActivity(Date.now());
  }, []);

  useEffect(() => {
    if (!isOpen && terminals.length > 0) {
      terminals.forEach(t => {
        t.eventSource?.close();
        t.websocket?.close();
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
  }, [activeTerminalId, executeLocalShellCommand, sendInput]);

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

    // Set default cwd to project (matches createInitialFileSystem)
    localShellCwdRef.current[id] = 'project';
    reconnectCooldownUntilRef.current[id] = 0;
    commandQueueRef.current[id] = [];
    commandHistoryRef.current[id] = [];
    historyIndexRef.current[id] = -1;
    lineBufferRef.current[id] = '';
    cursorPosRef.current[id] = 0;
    editorSessionRef.current[id] = null;

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
  }, []);

  const closeTerminal = useCallback((terminalId: string) => {
    const terminal = terminalsRef.current.find(t => t.id === terminalId);
    if (terminal) {
      terminal.eventSource?.close();
      terminal.websocket?.close();
      terminal.terminal?.dispose();
      terminal.xtermRef.current = null;
      // Abort any pending connection
      connectAbortRef.current[terminalId]?.abort();
      delete connectAbortRef.current[terminalId];
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
      Object.assign(termRef, updates);
    }
  }, []);

  const resolveLocalPath = useCallback((cwd: string, input: string): string => {
    const raw = (input || '').trim().replace(/\\/g, '/');
    if (!raw) return cwd;

    // Handle absolute paths
    if (raw.startsWith('/')) {
      const parts = raw.split('/').filter(Boolean);
      const stack: string[] = [];
      for (const part of parts) {
        if (part === '.') continue;
        if (part === '..') {
          if (stack.length > 0) stack.pop();
          continue;
        }
        stack.push(part);
      }
      const result = stack.join('/');
      // Default to project root if no root specified
      if (!result.startsWith('project')) {
        return `project/${result}`.replace(/\/+/g, '/');
      }
      return result;
    }

    // Handle relative paths
    const base = raw.startsWith('project') ? raw : `${cwd}/${raw}`.replace(/\/+/g, '/');
    const parts = base.split('/').filter(Boolean);
    const stack: string[] = [];
    for (const part of parts) {
      if (part === '.') continue;
      if (part === '..') {
        if (stack.length > 1) stack.pop();
        continue;
      }
      stack.push(part);
    }
    if (stack.length === 0 || stack[0] !== 'project') {
      return 'project';
    }
    return stack.join('/');
  }, []);

  const syncFileToVFS = useCallback(async (filePath: string, content: string) => {
    try {
      await fetch('/api/filesystem/write', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(),
        },
        credentials: 'include',
        body: JSON.stringify({ path: filePath, content }),
      });
    } catch {
      // Best-effort sync; local filesystem remains authoritative in local mode
    }
  }, []);

  const getParentPath = (path: string): string => {
    const parts = path.split('/').filter(Boolean);
    parts.pop();
    return parts.join('/') || 'project';
  };

  const listLocalDirectory = (path: string): string[] => {
    const fs = localFileSystemRef.current;
    const entries: string[] = [];

    for (const key of Object.keys(fs)) {
      const parent = getParentPath(key);
      if (parent === path) {
        // Extract just the entry name (last part of the path)
        const name = key.split('/').pop() || key;
        entries.push(name);
      }
    }
    return entries.sort();
  };

  const getPrompt = (mode: TerminalMode, cwd: string): string => {
    const displayCwd = cwd.replace(/^(project|workspace)/, '~');
    switch (mode) {
      case 'local':
        return `\x1b[34m[local]\x1b[0m \x1b[1;32m${displayCwd}$\x1b[0m `;
      case 'pty':
        return `\x1b[32m${displayCwd}$\x1b[0m `;
      case 'sandbox-cmd':
        return `\x1b[35m[sandbox]\x1b[0m \x1b[1;32m${displayCwd}$\x1b[0m `;
      case 'connecting':
        return `\x1b[33m[connecting...]\x1b[0m \x1b[1;32m${displayCwd}$\x1b[0m `;
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
    const cwd = localShellCwdRef.current[terminalId] || 'project';
    const trimmed = command.trim();
    if (!trimmed) {
      write(getPrompt(mode, cwd));
      return true;
    }
    
    // Security check - block dangerous commands in local shell
    if (!isPtyMode) {
      const securityResult = checkCommandSecurity(trimmed);
      if (!securityResult.allowed) {
        write(formatSecurityWarning(securityResult));
        write('');
        const newCwd = localShellCwdRef.current[terminalId] || 'project';
        write(`\x1b[1;32m${newCwd.replace(/^project/, '~')}$\x1b[0m `);
        
        // Log blocked command for security monitoring
        if (DEFAULT_SECURITY_CONFIG.logBlockedCommands) {
          logger.warn('Blocked command', {
            command: trimmed,
            reason: securityResult.reason,
            severity: securityResult.severity,
            terminalId,
          });
        }
        return true;
      }
      
      // Check for obfuscation attempts
      if (DEFAULT_SECURITY_CONFIG.enableObfuscationDetection) {
        const obfuscation = detectObfuscation(trimmed);
        if (obfuscation.detected && DEFAULT_SECURITY_CONFIG.blockOnObfuscation) {
          write(`\x1b[33m⚠️ Obfuscation detected: ${obfuscation.patterns.join(', ')}\x1b[0m\r\n`);
          write('\x1b[90mThis command was blocked due to suspicious patterns.\x1b[0m\r\n');
          write('\x1b[90mFor full terminal access, use the sandbox terminal (type "connect").\x1b[0m\r\n');
          const newCwd = localShellCwdRef.current[terminalId] || 'project';
          write(`\x1b[1;32m${newCwd.replace(/^project/, '~')}$\x1b[0m `);
          return true;
        }
      }
    }
    
    if (!commandHistoryRef.current[terminalId]) {
      commandHistoryRef.current[terminalId] = [];
    }
    const history = commandHistoryRef.current[terminalId];
    if (history.length === 0 || history[history.length - 1] !== trimmed) {
      history.push(trimmed);
      if (history.length > 100) history.shift();
    }
    historyIndexRef.current[terminalId] = history.length;

    const parts = trimmed.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
    const args: string[] = [];
    for (const p of parts) {
      if (p.startsWith('"') && p.endsWith('"')) {
        args.push(p.slice(1, -1));
      } else if (p.startsWith("'") && p.endsWith("'")) {
        args.push(p.slice(1, -1));
      } else {
        args.push(p);
      }
    }
    
    const cmd = args[0] || '';
    const arg1 = args[1] || '';
    const arg2 = args[2] || '';
    const allArgs = args.slice(1).join(' ');

    const writeLine = (text: string) => write(text + '\r\n');
    const writeError = (text: string) => write(`\x1b[31m${text}\x1b[0m\r\n`);

    switch (cmd) {
      case 'help': {
        writeLine('\x1b[36m=== Local Shell Commands ===\x1b[0m');
        writeLine('\x1b[33mFile Operations:\x1b[0m');
        writeLine('  ls [-l] [path]     List directory contents');
        writeLine('  pwd                Print working directory');
        writeLine('  cd <dir>           Change directory');
        writeLine('  cat <file>         Display file contents');
        writeLine('  head <file>        Show first 10 lines');
        writeLine('  tail <file>        Show last 10 lines');
        writeLine('  grep <pat> <file>  Search file for pattern');
        writeLine('  wc <file>          Count lines/words/chars');
        writeLine('  tree [dir]         Show directory tree');
        writeLine('  find [dir] [pat]   Find files');
        writeLine('  mkdir <dir>        Create directory');
        writeLine('  touch <file>       Create empty file');
        writeLine('  rm [-rf] <path>    Remove file/directory');
        writeLine('  cp <src> <dst>     Copy file');
        writeLine('  mv <src> <dst>     Move/rename file');
        writeLine('  echo <text>        Output text');
        writeLine('');
        writeLine('\x1b[33mText Editing:\x1b[0m');
        writeLine('  nano <file>        Edit file with nano');
        writeLine('  vim <file>         Edit file with vim');
        writeLine('  vi <file>          Edit file with vi');
        writeLine('');
        writeLine('\x1b[33mSystem:\x1b[0m');
        writeLine('  clear              Clear terminal');
        writeLine('  history            Show command history');
        writeLine('  whoami              Display current user');
        writeLine('  date               Display current date/time');
        writeLine('  env                Display environment variables');
        writeLine('');
        writeLine('\x1b[33mSandbox:\x1b[0m');
        writeLine('  connect            Connect to sandbox');
        writeLine('  disconnect         Disconnect from sandbox');
        writeLine('  status             Show sandbox status');
        writeLine('');
        writeLine('\x1b[33mPreview:\x1b[0m');
        writeLine('  preview [path]     Preview directory in Sandpack');
        writeLine('                     (opens visual app preview)');
        writeLine('  preview:html [path] Preview as HTML iframe');
        writeLine('  preview:raw [path]  View raw HTML source');
        writeLine('  preview:parcel [path] Preview with Parcel bundler');
        writeLine('  preview:devbox [path] Preview with DevBox runtime');
        writeLine('  preview:pyodide [path] Execute Python in browser');
        writeLine('  preview:vite [path]   Build with Vite');
        return true;
      }

      case 'clear': {
        write('\x1bc');
        return true;
      }

      case 'pwd': {
        writeLine(cwd.replace(/^project/, '~'));
        return true;
      }

      case 'cd': {
        const target = allArgs || 'project';
        const nextPath = resolveLocalPath(cwd, target);
        const fs = localFileSystemRef.current;
        
        if (fs[nextPath] && fs[nextPath].type === 'directory') {
          localShellCwdRef.current[terminalId] = nextPath;
        } else if (!fs[nextPath]) {
          writeError(`cd: no such directory: ${target}`);
        } else {
          writeError(`cd: not a directory: ${target}`);
        }
        return true;
      }

      case 'ls': {
        const showLong = arg1 === '-l' || arg1 === '-la' || arg1 === '-al';
        const target = showLong ? (arg1.startsWith('-') ? arg2 : arg1) : (arg1 || cwd);
        const targetPath = resolveLocalPath(cwd, target);
        const fs = localFileSystemRef.current;
        
        if (!fs[targetPath]) {
          writeError(`ls: cannot access '${target}': No such file or directory`);
          return true;
        }
        
        if (fs[targetPath].type === 'file') {
          if (showLong) {
            const info = fs[targetPath];
            const date = new Date(info.modifiedAt).toLocaleDateString();
            writeLine(`-rw-r--r--  1 user  staff  ${info.content?.length || 0}  ${date}  ${target}`);
          } else {
            writeLine(target);
          }
          return true;
        }
        
        const entries = listLocalDirectory(targetPath);
        if (entries.length === 0) {
          return true;
        }
        
        if (showLong) {
          for (const entry of entries) {
            const entryPath = targetPath === 'project' ? `project/${entry}` : `${targetPath}/${entry}`;
            const info = fs[entryPath];
            const prefix = info.type === 'directory' ? 'd' : '-';
            const date = new Date(info.modifiedAt).toLocaleDateString();
            const size = info.content?.length || (info.type === 'directory' ? 0 : 4096);
            writeLine(`${prefix}rw-r--r--  1 user  staff  ${String(size).padStart(5)}  ${date}  ${entry}${info.type === 'directory' ? '/' : ''}`);
          }
        } else {
          const dirs: string[] = [];
          const files: string[] = [];
          for (const entry of entries) {
            const entryPath = targetPath === 'project' ? `project/${entry}` : `${targetPath}/${entry}`;
            if (fs[entryPath]?.type === 'directory') {
              dirs.push(`\x1b[34m${entry}/\x1b[0m`);
            } else {
              files.push(entry);
            }
          }
          write([...dirs, ...files].join('  '));
          if (entries.length > 0) write('\r\n');
        }
        return true;
      }

      case 'cat': {
        if (!arg1) {
          writeError('cat: missing file operand');
          return true;
        }
        const filePath = resolveLocalPath(cwd, arg1);
        const fs = localFileSystemRef.current;
        
        if (!fs[filePath]) {
          writeError(`cat: ${arg1}: No such file or directory`);
          return true;
        }
        if (fs[filePath].type === 'directory') {
          writeError(`cat: ${arg1}: Is a directory`);
          return true;
        }
        const content = fs[filePath].content || '';
        write(content.replace(/\n/g, '\r\n'));
        if (!content.endsWith('\n')) write('\r\n');
        return true;
      }

      case 'mkdir': {
        if (!arg1) {
          writeError('mkdir: missing operand');
          return true;
        }
        const dirs = arg1.includes(' ') ? arg1.split(' ') : [arg1];
        for (const d of dirs) {
          const dirPath = resolveLocalPath(cwd, d);
          const fs = localFileSystemRef.current;
          
          if (fs[dirPath]) {
            writeError(`mkdir: cannot create directory '${d}': File exists`);
            continue;
          }
          
          const parent = getParentPath(dirPath);
          if (!fs[parent]) {
            writeError(`mkdir: cannot create directory '${d}': No such file or directory`);
            continue;
          }
          
          fs[dirPath] = { type: 'directory', createdAt: Date.now(), modifiedAt: Date.now() };
        }
        return true;
      }

      case 'touch': {
        if (!arg1) {
          writeError('touch: missing file operand');
          return true;
        }
        const files = arg1.includes(' ') ? arg1.split(' ') : [arg1];
        const fs = localFileSystemRef.current;
        
        for (const f of files) {
          const filePath = resolveLocalPath(cwd, f);
          const parent = getParentPath(filePath);
          
          if (!fs[parent]) {
            writeError(`touch: cannot touch '${f}': No such file or directory`);
            continue;
          }
          
          if (fs[filePath]) {
            fs[filePath].modifiedAt = Date.now();
          } else {
            fs[filePath] = { type: 'file', content: '', createdAt: Date.now(), modifiedAt: Date.now() };
          }
        }
        return true;
      }

      case 'rm': {
        if (!arg1) {
          writeError('rm: missing operand');
          return true;
        }
        const isRecursive = arg1 === '-rf' || arg1 === '-fr' || arg1 === '-r';
        const target = isRecursive ? arg2 : arg1;
        const targetPath = resolveLocalPath(cwd, target);
        const fs = localFileSystemRef.current;
        
        if (!fs[targetPath]) {
          writeError(`rm: cannot remove '${target}': No such file or directory`);
          return true;
        }
        
        if (fs[targetPath].type === 'directory') {
          if (!isRecursive) {
            writeError(`rm: cannot remove '${target}': Is a directory`);
            return true;
          }
        }
        
        delete fs[targetPath];
        return true;
      }

      case 'rmdir': {
        if (!arg1) {
          writeError('rmdir: missing operand');
          return true;
        }
        const dirPath = resolveLocalPath(cwd, arg1);
        const fs = localFileSystemRef.current;
        
        if (!fs[dirPath]) {
          writeError(`rmdir: failed to remove '${arg1}': No such file or directory`);
          return true;
        }
        
        if (fs[dirPath].type !== 'directory') {
          writeError(`rmdir: failed to remove '${arg1}': Not a directory`);
          return true;
        }
        
        const entries = listLocalDirectory(dirPath);
        if (entries.length > 0) {
          writeError(`rmdir: failed to remove '${arg1}': Directory not empty`);
          return true;
        }
        
        delete fs[dirPath];
        return true;
      }

      case 'cp': {
        if (!arg1 || !arg2) {
          writeError('cp: missing file operand');
          return true;
        }
        const srcPath = resolveLocalPath(cwd, arg1);
        const dstPath = resolveLocalPath(cwd, arg2);
        const fs = localFileSystemRef.current;
        
        if (!fs[srcPath]) {
          writeError(`cp: cannot stat '${arg1}': No such file or directory`);
          return true;
        }
        
        if (fs[srcPath].type === 'directory') {
          writeError(`cp: cannot copy directory '${arg1}': Not implemented`);
          return true;
        }
        
        const dstParent = getParentPath(dstPath);
        if (!fs[dstParent]) {
          writeError(`cp: cannot create file '${arg2}': No such file or directory`);
          return true;
        }
        
        fs[dstPath] = {
          type: 'file',
          content: fs[srcPath].content,
          createdAt: Date.now(),
          modifiedAt: Date.now()
        };
        return true;
      }

      case 'mv': {
        if (!arg1 || !arg2) {
          writeError('mv: missing file operand');
          return true;
        }
        const srcPath = resolveLocalPath(cwd, arg1);
        const dstPath = resolveLocalPath(cwd, arg2);
        const fs = localFileSystemRef.current;
        
        if (!fs[srcPath]) {
          writeError(`mv: cannot stat '${arg1}': No such file or directory`);
          return true;
        }
        
        const dstParent = getParentPath(dstPath);
        if (!fs[dstParent]) {
          writeError(`mv: cannot move '${arg1}': No such file or directory`);
          return true;
        }
        
        fs[dstPath] = { ...fs[srcPath], modifiedAt: Date.now() };
        delete fs[srcPath];
        return true;
      }

      case 'echo': {
        let text = allArgs;
        if ((text.startsWith('"') && text.endsWith('"')) || 
            (text.startsWith("'") && text.endsWith("'"))) {
          text = text.slice(1, -1);
        }
        
        if (arg1 === '>' && arg2) {
          const filePath = resolveLocalPath(cwd, arg2);
          const fs = localFileSystemRef.current;
          const parent = getParentPath(filePath);
          
          if (!fs[parent]) {
            writeError(`echo: cannot write to '${arg2}': No such file or directory`);
            return true;
          }
          
          const echoContent = text.replace(/\\n/g, '\n');
          fs[filePath] = {
            type: 'file',
            content: echoContent,
            createdAt: fs[filePath]?.createdAt || Date.now(),
            modifiedAt: Date.now()
          };
          syncFileToVFS(filePath, echoContent);
        } else {
          writeLine(text.replace(/\\n/g, '\n').replace(/\\t/g, '\t'));
        }
        return true;
      }

      case 'whoami': {
        writeLine(userId ? userId : 'anonymous');
        return true;
      }

      case 'date': {
        writeLine(new Date().toString());
        return true;
      }

      case 'env': {
        writeLine('HOME=/home/user');
        writeLine('USER=user');
        writeLine('PATH=/usr/local/bin:/usr/bin:/bin');
        writeLine('SHELL=/bin/bash');
        writeLine('TERM=xterm-256color');
        return true;
      }

      case 'history': {
        const history = commandHistoryRef.current[terminalId] || [];
        history.forEach((cmd, i) => {
          writeLine(`  ${i + 1}  ${cmd}`);
        });
        return true;
      }

      case 'nano':
      case 'vim':
      case 'vi': {
        const filePath = resolveLocalPath(cwd, arg1);
        const fs = localFileSystemRef.current;
        
        if (!arg1) {
          writeError(`${cmd}: missing file operand`);
          return true;
        }
        
        const parent = getParentPath(filePath);
        if (!fs[parent] && parent !== 'project') {
          writeError(`${cmd}: ${arg1}: No such file or directory`);
          return true;
        }
        
        const existing = fs[filePath];
        const content = existing?.content || '';
        
        editorSessionRef.current[terminalId] = {
          type: cmd as 'nano' | 'vim' | 'vi',
          filePath,
          content,
          cursor: 0,
          cursorLine: 0,
          cursorCol: 0,
          lines: content.split('\n'),
          originalContent: content,
          clipboard: ''
        };
        
        const mode = cmd === 'vim' || cmd === 'vi' ? 'NORMAL' : 'EDITOR';
        write(`\x1b[2J\x1b[H`);
        writeLine(`\x1b[1;32m ${cmd === 'nano' ? 'Nano' : 'Vim'} - ${arg1}\x1b[0m`);
        writeLine('\x1b[90m─────────────────────────────────────\x1b[0m');
        
        const maxLines = 15;
        const displayLines = editorSessionRef.current[terminalId].lines.slice(0, maxLines);
        displayLines.forEach((line, i) => {
          const prefix = i === 0 ? '> ' : '  ';
          writeLine(`${prefix}${line || ''}`);
        });
        
        if (editorSessionRef.current[terminalId].lines.length > maxLines) {
          writeLine(`\x1b[90m... ${editorSessionRef.current[terminalId].lines.length - maxLines} more lines ...\x1b[0m`);
        }
        
        writeLine('\x1b[90m─────────────────────────────────────\x1b[0m');
        
        if (cmd === 'nano') {
          writeLine('\x1b[36m^G Get Help  ^O WriteOut  ^R Read File  ^Y Prev Pg  ^C Cur Pos\x1b[0m');
          writeLine('\x1b[36m^X Exit       ^K Cut        ^U Paste      ^J Justify   ^T To Spell\x1b[0m');
        } else {
          writeLine('\x1b[33mNORMAL MODE\x1b[0m - Press \x1b[32mi\x1b[0m to insert, \x1b[32m:w\x1b[0m to save, \x1b[32m:q\x1b[0m to quit');
        }
        
        writeLine(`\x1b[90mFile: ${arg1} | Lines: ${editorSessionRef.current[terminalId].lines.length}\x1b[0m`);
        
        updateTerminalState(terminalId, { mode: 'command-mode' });
        return true;
      }

      case 'connect': {
        writeLine('\x1b[33mInitiating sandbox connection...\x1b[0m');
        // Trigger actual connection
        connectTerminal(terminalId);
        return false; // Don't show prompt, connection will handle it
      }

      case 'disconnect': {
        const term = terminalsRef.current.find(t => t.id === terminalId);
        if (term?.isConnected) {
          term.eventSource?.close();
          term.isConnected = false;
          updateTerminalState(terminalId, { isConnected: false, sandboxInfo: { status: 'none' }, mode: 'local' });
          writeLine('\x1b[90mDisconnected from sandbox.\x1b[0m');
        }
        return true;
      }

      case 'status': {
        const term = terminalsRef.current.find(t => t.id === terminalId);
        if (!term) return true;
        
        writeLine('\x1b[36m=== Terminal Status ===\x1b[0m');
        writeLine(`  Mode:      ${term.mode}`);
        writeLine(`  Connected: ${term.isConnected ? '\x1b[32myes\x1b[0m' : '\x1b[31mno\x1b[0m'}`);
        if (term.sandboxInfo) {
          writeLine(`  Status:    ${term.sandboxInfo.status}`);
          if (term.sandboxInfo.sandboxId) {
            writeLine(`  Sandbox:   ${term.sandboxInfo.sandboxId}`);
          }
          if (term.sandboxInfo.sessionId) {
            writeLine(`  Session:   ${term.sandboxInfo.sessionId}`);
          }
          if (term.sandboxInfo.resources) {
            writeLine(`  CPU:       ${term.sandboxInfo.resources.cpu}`);
            writeLine(`  Memory:    ${term.sandboxInfo.resources.memory}`);
          }
        }
        return true;
      }

      case 'preview': {
        // Send preview command to code-preview-panel
        const previewPath = allArgs || cwd;
        const event = new CustomEvent('code-preview-manual', {
          detail: { directory: previewPath, mode: 'sandpack' }
        });
        window.dispatchEvent(event);
        
        writeLine(`\x1b[32m▶ Sending preview request for: ${previewPath}\x1b[0m`);
        writeLine(`\x1b[90mCheck the Code Preview panel to see the result.\x1b[0m`);
        return true;
      }

      case 'preview:html': {
        // Send HTML iframe preview command
        const previewPath = allArgs || cwd;
        const event = new CustomEvent('code-preview-manual', {
          detail: { directory: previewPath, mode: 'iframe' }
        });
        window.dispatchEvent(event);
        
        writeLine(`\x1b[32m▶ Sending HTML preview request for: ${previewPath}\x1b[0m`);
        writeLine(`\x1b[90mOpening in iframe mode.\x1b[0m`);
        return true;
      }

      case 'preview:raw': {
        // Send raw HTML view command
        const previewPath = allArgs || cwd;
        const event = new CustomEvent('code-preview-manual', {
          detail: { directory: previewPath, mode: 'raw' }
        });
        window.dispatchEvent(event);
        
        writeLine(`\x1b[32m▶ Sending raw HTML request for: ${previewPath}\x1b[0m`);
        writeLine(`\x1b[90mOpening in raw source mode.\x1b[0m`);
        return true;
      }

      case 'preview:parcel': {
        // Send Parcel bundler preview command
        const previewPath = allArgs || cwd;
        const event = new CustomEvent('code-preview-manual', {
          detail: { directory: previewPath, mode: 'parcel' }
        });
        window.dispatchEvent(event);
        
        writeLine(`\x1b[32m⚡ Sending Parcel request for: ${previewPath}\x1b[0m`);
        writeLine(`\x1b[90mOpening with Parcel zero-config bundler.\x1b[0m`);
        return true;
      }

      case 'preview:devbox': {
        // Send DevBox runtime preview command
        const previewPath = allArgs || cwd;
        const event = new CustomEvent('code-preview-manual', {
          detail: { directory: previewPath, mode: 'devbox' }
        });
        window.dispatchEvent(event);
        
        writeLine(`\x1b[32m🔵 Sending DevBox request for: ${previewPath}\x1b[0m`);
        writeLine(`\x1b[90mOpening full-stack runtime environment.\x1b[0m`);
        return true;
      }

      case 'preview:pyodide': {
        // Send Pyodide Python preview command
        const previewPath = allArgs || cwd;
        const event = new CustomEvent('code-preview-manual', {
          detail: { directory: previewPath, mode: 'pyodide' }
        });
        window.dispatchEvent(event);
        
        writeLine(`\x1b[32m🐍 Sending Pyodide request for: ${previewPath}\x1b[0m`);
        writeLine(`\x1b[90mExecuting Python in browser via Pyodide.\x1b[0m`);
        return true;
      }

      case 'preview:vite': {
        // Send Vite build preview command
        const previewPath = allArgs || cwd;
        const event = new CustomEvent('code-preview-manual', {
          detail: { directory: previewPath, mode: 'vite' }
        });
        window.dispatchEvent(event);
        
        writeLine(`\x1b[32m⚡ Sending Vite build request for: ${previewPath}\x1b[0m`);
        writeLine(`\x1b[90mBuilding with Vite (next-gen frontend tooling).\x1b[0m`);
        return true;
      }

      case 'tree': {
        const targetPath = resolveLocalPath(cwd, arg1 || '.');
        const fs = localFileSystemRef.current;
        if (!fs[targetPath] || fs[targetPath].type !== 'directory') {
          writeError(`tree: '${arg1 || '.'}': No such directory`);
          return true;
        }
        writeLine(`\x1b[34m${targetPath.split('/').pop() || targetPath}\x1b[0m`);
        const printTree = (dirPath: string, prefix: string) => {
          const entries = listLocalDirectory(dirPath).sort();
          entries.forEach((entry, i) => {
            const entryPath = `${dirPath}/${entry}`;
            const isLast = i === entries.length - 1;
            const connector = isLast ? '└── ' : '├── ';
            const info = fs[entryPath];
            if (info?.type === 'directory') {
              writeLine(`${prefix}${connector}\x1b[34m${entry}/\x1b[0m`);
              printTree(entryPath, prefix + (isLast ? '    ' : '│   '));
            } else {
              writeLine(`${prefix}${connector}${entry}`);
            }
          });
        };
        printTree(targetPath, '');
        return true;
      }

      case 'find': {
        const targetPath = resolveLocalPath(cwd, arg1 || '.');
        const fs = localFileSystemRef.current;
        const pattern = arg2 || '';
        for (const key of Object.keys(fs).sort()) {
          if (key.startsWith(targetPath)) {
            const relativePath = key.replace(targetPath, '.').replace(/^\.\//, './');
            if (!pattern || relativePath.includes(pattern)) {
              writeLine(relativePath);
            }
          }
        }
        return true;
      }

      case 'wc': {
        if (!arg1) { writeError('wc: missing file operand'); return true; }
        const filePath = resolveLocalPath(cwd, arg1);
        const fs = localFileSystemRef.current;
        if (!fs[filePath] || fs[filePath].type !== 'file') {
          writeError(`wc: ${arg1}: No such file`);
          return true;
        }
        const content = fs[filePath].content || '';
        const lines = content.split('\n').length;
        const words = content.split(/\s+/).filter(Boolean).length;
        const chars = content.length;
        writeLine(`  ${lines}  ${words}  ${chars} ${arg1}`);
        return true;
      }

      case 'head': {
        if (!arg1) { writeError('head: missing file operand'); return true; }
        const filePath = resolveLocalPath(cwd, arg1);
        const fs = localFileSystemRef.current;
        if (!fs[filePath] || fs[filePath].type !== 'file') {
          writeError(`head: ${arg1}: No such file`);
          return true;
        }
        const lines = (fs[filePath].content || '').split('\n').slice(0, 10);
        lines.forEach(l => writeLine(l));
        return true;
      }

      case 'tail': {
        if (!arg1) { writeError('tail: missing file operand'); return true; }
        const filePath = resolveLocalPath(cwd, arg1);
        const fs = localFileSystemRef.current;
        if (!fs[filePath] || fs[filePath].type !== 'file') {
          writeError(`tail: ${arg1}: No such file`);
          return true;
        }
        const lines = (fs[filePath].content || '').split('\n');
        lines.slice(-10).forEach(l => writeLine(l));
        return true;
      }

      case 'grep': {
        if (!arg1 || !arg2) { writeError('grep: Usage: grep <pattern> <file>'); return true; }
        const filePath = resolveLocalPath(cwd, arg2);
        const fs = localFileSystemRef.current;
        if (!fs[filePath] || fs[filePath].type !== 'file') {
          writeError(`grep: ${arg2}: No such file`);
          return true;
        }
        const lines = (fs[filePath].content || '').split('\n');
        lines.forEach((line, i) => {
          if (line.includes(arg1)) {
            writeLine(`\x1b[35m${i + 1}:\x1b[0m${line.replace(new RegExp(arg1.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), `\x1b[31m${arg1}\x1b[0m`)}`);
          }
        });
        return true;
      }

      default: {
        // Suggest sandbox for execution commands
        const execCmds = ['node', 'python', 'python3', 'npm', 'npx', 'yarn', 'pnpm', 'pip', 'pip3', 'cargo', 'go', 'ruby', 'java', 'gcc', 'g++', 'make', 'docker', 'git', 'curl', 'wget'];
        if (execCmds.includes(cmd)) {
          writeLine(`\x1b[33m⚠ "${cmd}" requires a sandbox environment.\x1b[0m`);
          writeLine('\x1b[90mType "connect" to connect to a sandbox with full execution.\x1b[0m');
        } else {
          writeError(`command not found: ${cmd}`);
          writeLine('\x1b[90mType "help" for available commands.\x1b[0m');
        }
        return true;
      }
    }
  }, [resolveLocalPath, userId, updateTerminalState, syncFileToVFS]);

  const handleEditorInput = useCallback((
    terminalId: string,
    input: string,
    write: (text: string) => void
  ) => {
    const session = editorSessionRef.current[terminalId];
    if (!session) return;

    const writeLine = (text: string) => write(text + '\r\n');

    if ((session as any).pendingExit) {
      const key = input.toLowerCase();
      if (key === 'y') {
        const fs = localFileSystemRef.current;
        const fileContent = session.lines.join('\n');
        fs[session.filePath] = {
          type: 'file',
          content: fileContent,
          createdAt: fs[session.filePath]?.createdAt || Date.now(),
          modifiedAt: Date.now()
        };
        syncFileToVFS(session.filePath, fileContent);
        writeLine(`\x1b[32m"${session.filePath}" saved\x1b[0m`);
        editorSessionRef.current[terminalId] = null;
        updateTerminalState(terminalId, { mode: 'local' });
        const cwd = localShellCwdRef.current[terminalId] || 'project';
        write(getPrompt('local', cwd));
      } else if (key === 'n') {
        editorSessionRef.current[terminalId] = null;
        updateTerminalState(terminalId, { mode: 'local' });
        const cwd = localShellCwdRef.current[terminalId] || 'project';
        writeLine('\x1b[90mChanges discarded.\x1b[0m');
        write(getPrompt('local', cwd));
      } else if (key === 'c' || input === '\x1b') {
        delete (session as any).pendingExit;
        const maxLines = 15;
        const scrollOffset = Math.max(0, session.cursorLine - maxLines + 1);
        const displayLines = session.lines.slice(scrollOffset, scrollOffset + maxLines);
        write(`\x1b[2J\x1b[H`);
        writeLine(`\x1b[1;32m Nano - ${session.filePath.split('/').pop()}\x1b[0m`);
        writeLine('\x1b[90m─────────────────────────────────────\x1b[0m');
        displayLines.forEach((l, i) => {
          const actualLine = scrollOffset + i;
          const prefix = actualLine === session.cursorLine ? '\x1b[32m>\x1b[0m ' : '  ';
          writeLine(`${prefix}${l || ''}`);
        });
        if (session.lines.length > scrollOffset + maxLines) {
          writeLine(`\x1b[90m... ${session.lines.length - scrollOffset - maxLines} more lines ...\x1b[0m`);
        }
        writeLine('\x1b[90m─────────────────────────────────────\x1b[0m');
        writeLine('\x1b[36m^G Help  ^O Save  ^X Exit  ^K Cut  ^U Paste\x1b[0m');
        writeLine(`\x1b[90mLine ${session.cursorLine + 1}/${session.lines.length} | Col ${session.cursorCol}\x1b[0m`);
      }
      return;
    }

    if (input === '\x1b[A') {
      if (session.cursorLine > 0) {
        session.cursorLine--;
        const line = session.lines[session.cursorLine] || '';
        session.cursorCol = Math.min(session.cursorCol, line.length);
      }
      const maxLines = 15;
      const scrollOffset = Math.max(0, session.cursorLine - maxLines + 1);
      const displayLines = session.lines.slice(scrollOffset, scrollOffset + maxLines);
      write(`\x1b[2J\x1b[H`);
      writeLine(`\x1b[1;32m ${session.type === 'nano' ? 'Nano' : 'Vim'} - ${session.filePath.split('/').pop()}\x1b[0m`);
      writeLine('\x1b[90m─────────────────────────────────────\x1b[0m');
      displayLines.forEach((l, i) => {
        const actualLine = scrollOffset + i;
        const prefix = actualLine === session.cursorLine ? '\x1b[32m>\x1b[0m ' : '  ';
        writeLine(`${prefix}${l || ''}`);
      });
      if (session.lines.length > scrollOffset + maxLines) {
        writeLine(`\x1b[90m... ${session.lines.length - scrollOffset - maxLines} more lines ...\x1b[0m`);
      }
      writeLine('\x1b[90m─────────────────────────────────────\x1b[0m');
      if (session.type === 'nano') {
        writeLine('\x1b[36m^G Help  ^O Save  ^X Exit  ^K Cut  ^U Paste\x1b[0m');
      } else {
        writeLine('\x1b[33mNORMAL MODE\x1b[0m');
      }
      writeLine(`\x1b[90mLine ${session.cursorLine + 1}/${session.lines.length} | Col ${session.cursorCol}\x1b[0m`);
      return;
    }
    if (input === '\x1b[B') {
      if (session.cursorLine < session.lines.length - 1) {
        session.cursorLine++;
        const line = session.lines[session.cursorLine] || '';
        session.cursorCol = Math.min(session.cursorCol, line.length);
      }
      const maxLines = 15;
      const scrollOffset = Math.max(0, session.cursorLine - maxLines + 1);
      const displayLines = session.lines.slice(scrollOffset, scrollOffset + maxLines);
      write(`\x1b[2J\x1b[H`);
      writeLine(`\x1b[1;32m ${session.type === 'nano' ? 'Nano' : 'Vim'} - ${session.filePath.split('/').pop()}\x1b[0m`);
      writeLine('\x1b[90m─────────────────────────────────────\x1b[0m');
      displayLines.forEach((l, i) => {
        const actualLine = scrollOffset + i;
        const prefix = actualLine === session.cursorLine ? '\x1b[32m>\x1b[0m ' : '  ';
        writeLine(`${prefix}${l || ''}`);
      });
      if (session.lines.length > scrollOffset + maxLines) {
        writeLine(`\x1b[90m... ${session.lines.length - scrollOffset - maxLines} more lines ...\x1b[0m`);
      }
      writeLine('\x1b[90m─────────────────────────────────────\x1b[0m');
      if (session.type === 'nano') {
        writeLine('\x1b[36m^G Help  ^O Save  ^X Exit  ^K Cut  ^U Paste\x1b[0m');
      } else {
        writeLine('\x1b[33mNORMAL MODE\x1b[0m');
      }
      writeLine(`\x1b[90mLine ${session.cursorLine + 1}/${session.lines.length} | Col ${session.cursorCol}\x1b[0m`);
      return;
    }
    if (input === '\x1b[D') {
      if (session.cursorCol > 0) session.cursorCol--;
      const maxLines = 15;
      const scrollOffset = Math.max(0, session.cursorLine - maxLines + 1);
      const displayLines = session.lines.slice(scrollOffset, scrollOffset + maxLines);
      write(`\x1b[2J\x1b[H`);
      writeLine(`\x1b[1;32m ${session.type === 'nano' ? 'Nano' : 'Vim'} - ${session.filePath.split('/').pop()}\x1b[0m`);
      writeLine('\x1b[90m─────────────────────────────────────\x1b[0m');
      displayLines.forEach((l, i) => {
        const actualLine = scrollOffset + i;
        const prefix = actualLine === session.cursorLine ? '\x1b[32m>\x1b[0m ' : '  ';
        writeLine(`${prefix}${l || ''}`);
      });
      if (session.lines.length > scrollOffset + maxLines) {
        writeLine(`\x1b[90m... ${session.lines.length - scrollOffset - maxLines} more lines ...\x1b[0m`);
      }
      writeLine('\x1b[90m─────────────────────────────────────\x1b[0m');
      if (session.type === 'nano') {
        writeLine('\x1b[36m^G Help  ^O Save  ^X Exit  ^K Cut  ^U Paste\x1b[0m');
      } else {
        writeLine('\x1b[33mNORMAL MODE\x1b[0m');
      }
      writeLine(`\x1b[90mLine ${session.cursorLine + 1}/${session.lines.length} | Col ${session.cursorCol}\x1b[0m`);
      return;
    }
    if (input === '\x1b[C') {
      const line = session.lines[session.cursorLine] || '';
      if (session.cursorCol < line.length) session.cursorCol++;
      const maxLines = 15;
      const scrollOffset = Math.max(0, session.cursorLine - maxLines + 1);
      const displayLines = session.lines.slice(scrollOffset, scrollOffset + maxLines);
      write(`\x1b[2J\x1b[H`);
      writeLine(`\x1b[1;32m ${session.type === 'nano' ? 'Nano' : 'Vim'} - ${session.filePath.split('/').pop()}\x1b[0m`);
      writeLine('\x1b[90m─────────────────────────────────────\x1b[0m');
      displayLines.forEach((l, i) => {
        const actualLine = scrollOffset + i;
        const prefix = actualLine === session.cursorLine ? '\x1b[32m>\x1b[0m ' : '  ';
        writeLine(`${prefix}${l || ''}`);
      });
      if (session.lines.length > scrollOffset + maxLines) {
        writeLine(`\x1b[90m... ${session.lines.length - scrollOffset - maxLines} more lines ...\x1b[0m`);
      }
      writeLine('\x1b[90m─────────────────────────────────────\x1b[0m');
      if (session.type === 'nano') {
        writeLine('\x1b[36m^G Help  ^O Save  ^X Exit  ^K Cut  ^U Paste\x1b[0m');
      } else {
        writeLine('\x1b[33mNORMAL MODE\x1b[0m');
      }
      writeLine(`\x1b[90mLine ${session.cursorLine + 1}/${session.lines.length} | Col ${session.cursorCol}\x1b[0m`);
      return;
    }

    if (input === '\r' || input === '\n') {
      writeLine('');
      
      const currentLine = session.lines[session.cursorLine] || '';
      if (currentLine.startsWith(':')) {
        const cmd = currentLine.slice(1).trim();
        
        if (cmd === 'q' || cmd === 'q!') {
          editorSessionRef.current[terminalId] = null;
          updateTerminalState(terminalId, { mode: 'local' });
          const cwd = localShellCwdRef.current[terminalId] || 'project';
          writeLine(`\x1b[90mExit without saving.\x1b[0m`);
          write(getPrompt('editor', cwd));
          return;
        }
        
        if (cmd === 'wq' || cmd === 'x' || cmd === 'w') {
          const fs = localFileSystemRef.current;
          const fileContent = session.lines.join('\n');
          fs[session.filePath] = {
            type: 'file',
            content: fileContent,
            createdAt: fs[session.filePath]?.createdAt || Date.now(),
            modifiedAt: Date.now()
          };
          syncFileToVFS(session.filePath, fileContent);
          writeLine(`\x1b[32m"${session.filePath}" ${session.lines.length}L ${fileContent.length}C written\x1b[0m`);
          
          if (cmd === 'wq' || cmd === 'x') {
            editorSessionRef.current[terminalId] = null;
            updateTerminalState(terminalId, { mode: 'local' });
            const cwd = localShellCwdRef.current[terminalId] || 'project';
            write(getPrompt('editor', cwd));
          } else {
            session.originalContent = session.lines.join('\n');
            session.cursorLine = 0;
            session.cursorCol = 0;
            writeLine('\x1b[33mNORMAL MODE\x1b[0m');
          }
          return;
        }
        
        if (cmd === 'w') {
          writeLine('\x1b[90mUse :w to save or :wq to save and quit\x1b[0m');
          return;
        }
        
        writeLine(`\x1b[31mUnknown command: ${cmd}\x1b[0m`);
        session.lines[session.cursorLine] = '';
        return;
      }
      
      if (session.cursorLine < session.lines.length) {
        session.lines[session.cursorLine] = currentLine;
      }
      session.cursorLine++;
      if (session.cursorLine >= session.lines.length) {
        session.lines.push('');
      }
      session.cursorCol = 0;
      
      const maxLines = 15;
      const displayLines = session.lines.slice(0, maxLines);
      write(`\x1b[2J\x1b[H`);
      writeLine(`\x1b[1;32m Nano - ${session.filePath.split('/').pop()}\x1b[0m`);
      writeLine('\x1b[90m─────────────────────────────────────\x1b[0m');
      displayLines.forEach((line, i) => {
        const prefix = i === session.cursorLine ? '\x1b[32m>\x1b[0m ' : '  ';
        writeLine(`${prefix}${line || ''}`);
      });
      if (session.lines.length > maxLines) {
        writeLine(`\x1b[90m... ${session.lines.length - maxLines} more lines ...\x1b[0m`);
      }
      writeLine('\x1b[90m─────────────────────────────────────\x1b[0m');
      writeLine('\x1b[36m^G Help  ^O Save  ^X Exit  ^K Cut  ^U Paste\x1b[0m');
      writeLine(`\x1b[90mFile: ${session.filePath.split('/').pop()} | Lines: ${session.lines.length}\x1b[0m`);
      return;
    }

    if (input === '\x1b' || input === '\x03') {
      editorSessionRef.current[terminalId] = null;
      updateTerminalState(terminalId, { mode: 'local' });
      const cwd = localShellCwdRef.current[terminalId] || 'project';
      writeLine('');
      writeLine('\x1b[90mEditor closed.\x1b[0m');
      write(getPrompt('editor', cwd));
      return;
    }

    if (input === '\x7f') {
      if (session.cursorCol > 0) {
        const line = session.lines[session.cursorLine] || '';
        session.lines[session.cursorLine] = line.slice(0, -1) + line.slice(session.cursorCol);
        session.cursorCol--;
      }
      const maxLines = 15;
      const displayLines = session.lines.slice(0, maxLines);
      write(`\x1b[2J\x1b[H`);
      writeLine(`\x1b[1;32m Nano - ${session.filePath.split('/').pop()}\x1b[0m`);
      writeLine('\x1b[90m─────────────────────────────────────\x1b[0m');
      displayLines.forEach((l, i) => {
        const prefix = i === session.cursorLine ? '\x1b[32m>\x1b[0m ' : '  ';
        writeLine(`${prefix}${l || ''}`);
      });
      if (session.lines.length > maxLines) {
        writeLine(`\x1b[90m... ${session.lines.length - maxLines} more lines ...\x1b[0m`);
      }
      writeLine('\x1b[90m─────────────────────────────────────\x1b[0m');
      writeLine('\x1b[36m^G Help  ^O Save  ^X Exit  ^K Cut  ^U Paste\x1b[0m');
      writeLine(`\x1b[90mFile: ${session.filePath.split('/').pop()} | Lines: ${session.lines.length}\x1b[0m`);
      return;
    }

    if (input === '\x07') {
      writeLine('\x1b[36m==== Nano Help ====\x1b[0m');
      writeLine('\x1b[33m^G\x1b[0m  \x1b[37mDisplay this help     \x1b[33m^X\x1b[0m  \x1b[37mExit editor\x1b[0m');
      writeLine('\x1b[33m^O\x1b[0m  \x1b[37mSave (WriteOut)       \x1b[33m^K\x1b[0m  \x1b[37mCut line\x1b[0m');
      writeLine('\x1b[33m^U\x1b[0m  \x1b[37mPaste (Uncut)        \x1b[33m^Y\x1b[0m  \x1b[37mPrevious page\x1b[0m');
      writeLine('\x1b[33m^C\x1b[0m  \x1b[37mShow cursor position\x1b[0m');
      const maxLines = 15;
      const displayLines = session.lines.slice(0, maxLines);
      write(`\x1b[2J\x1b[H`);
      writeLine(`\x1b[1;32m Nano - ${session.filePath.split('/').pop()}\x1b[0m`);
      writeLine('\x1b[90m─────────────────────────────────────\x1b[0m');
      displayLines.forEach((l, i) => {
        const prefix = i === session.cursorLine ? '\x1b[32m>\x1b[0m ' : '  ';
        writeLine(`${prefix}${l || ''}`);
      });
      if (session.lines.length > maxLines) {
        writeLine(`\x1b[90m... ${session.lines.length - maxLines} more lines ...\x1b[0m`);
      }
      writeLine('\x1b[90m─────────────────────────────────────\x1b[0m');
      writeLine('\x1b[36m^G Help  ^O Save  ^X Exit  ^K Cut  ^U Paste\x1b[0m');
      writeLine(`\x1b[90mFile: ${session.filePath.split('/').pop()} | Lines: ${session.lines.length}\x1b[0m`);
      return;
    }

    if (input === '\x0f') {
      const fs = localFileSystemRef.current;
      const fileContent = session.lines.join('\n');
      fs[session.filePath] = {
        type: 'file',
        content: fileContent,
        createdAt: fs[session.filePath]?.createdAt || Date.now(),
        modifiedAt: Date.now()
      };
      syncFileToVFS(session.filePath, fileContent);
      writeLine(`\x1b[32m"${session.filePath}" ${session.lines.length}L ${fileContent.length}C written\x1b[0m`);
      session.originalContent = fileContent;
      const maxLines = 15;
      const displayLines = session.lines.slice(0, maxLines);
      write(`\x1b[2J\x1b[H`);
      writeLine(`\x1b[1;32m Nano - ${session.filePath.split('/').pop()}\x1b[0m`);
      writeLine('\x1b[90m─────────────────────────────────────\x1b[0m');
      displayLines.forEach((l, i) => {
        const prefix = i === session.cursorLine ? '\x1b[32m>\x1b[0m ' : '  ';
        writeLine(`${prefix}${l || ''}`);
      });
      if (session.lines.length > maxLines) {
        writeLine(`\x1b[90m... ${session.lines.length - maxLines} more lines ...\x1b[0m`);
      }
      writeLine('\x1b[90m─────────────────────────────────────\x1b[0m');
      writeLine('\x1b[36m^G Help  ^O Save  ^X Exit  ^K Cut  ^U Paste\x1b[0m');
      writeLine(`\x1b[90mFile: ${session.filePath.split('/').pop()} | Lines: ${session.lines.length}\x1b[0m`);
      return;
    }

    if (input === '\x18') {
      if (session.lines.join('\n') !== session.originalContent) {
        (session as any).pendingExit = true;
        write(`\x1b[2J\x1b[H`);
        writeLine('\x1b[33mSave modified buffer?\x1b[0m');
        writeLine('');
        writeLine('  \x1b[32mY\x1b[0m  Yes - save and exit');
        writeLine('  \x1b[31mN\x1b[0m  No - discard changes and exit');
        writeLine('  \x1b[90mC\x1b[0m  Cancel - return to editor');
      } else {
        editorSessionRef.current[terminalId] = null;
        updateTerminalState(terminalId, { mode: 'local' });
        const cwd = localShellCwdRef.current[terminalId] || 'project';
        writeLine('');
        writeLine('\x1b[90mExit.\x1b[0m');
        write(getPrompt('local', cwd));
      }
      return;
    }

    if (input === '\x0b') {
      const line = session.lines[session.cursorLine] || '';
      session.clipboard = (session.clipboard || '') + (session.clipboard ? '\n' : '') + line;
      session.lines[session.cursorLine] = '';
      session.cursorCol = 0;
      const maxLines = 15;
      const displayLines = session.lines.slice(0, maxLines);
      write(`\x1b[2J\x1b[H`);
      writeLine(`\x1b[1;32m Nano - ${session.filePath.split('/').pop()}\x1b[0m`);
      writeLine('\x1b[90m─────────────────────────────────────\x1b[0m');
      displayLines.forEach((l, i) => {
        const prefix = i === session.cursorLine ? '\x1b[32m>\x1b[0m ' : '  ';
        writeLine(`${prefix}${l || ''}`);
      });
      if (session.lines.length > maxLines) {
        writeLine(`\x1b[90m... ${session.lines.length - maxLines} more lines ...\x1b[0m`);
      }
      writeLine('\x1b[90m─────────────────────────────────────\x1b[0m');
      writeLine('\x1b[36m^G Help  ^O Save  ^X Exit  ^K Cut  ^U Paste\x1b[0m');
      writeLine(`\x1b[90mFile: ${session.filePath.split('/').pop()} | Lines: ${session.lines.length}\x1b[0m`);
      return;
    }

    if (input === '\x15') {
      if (session.clipboard) {
        const lines = session.clipboard.split('\n');
        const currentLine = session.lines[session.cursorLine] || '';
        const beforeCursor = currentLine.slice(0, session.cursorCol);
        const afterCursor = currentLine.slice(session.cursorCol);
        session.lines[session.cursorLine] = beforeCursor + lines[0] + afterCursor;
        session.cursorCol = beforeCursor.length + lines[0].length;
        for (let i = 1; i < lines.length; i++) {
          session.lines.splice(session.cursorLine + i, 0, lines[i]);
        }
        session.cursorLine += lines.length - 1;
        if (session.cursorLine >= session.lines.length) {
          session.lines.push('');
          session.cursorLine = session.lines.length - 1;
        }
      }
      const maxLines = 15;
      const displayLines = session.lines.slice(0, maxLines);
      write(`\x1b[2J\x1b[H`);
      writeLine(`\x1b[1;32m Nano - ${session.filePath.split('/').pop()}\x1b[0m`);
      writeLine('\x1b[90m─────────────────────────────────────\x1b[0m');
      displayLines.forEach((l, i) => {
        const prefix = i === session.cursorLine ? '\x1b[32m>\x1b[0m ' : '  ';
        writeLine(`${prefix}${l || ''}`);
      });
      if (session.lines.length > maxLines) {
        writeLine(`\x1b[90m... ${session.lines.length - maxLines} more lines ...\x1b[0m`);
      }
      writeLine('\x1b[90m─────────────────────────────────────\x1b[0m');
      writeLine('\x1b[36m^G Help  ^O Save  ^X Exit  ^K Cut  ^U Paste\x1b[0m');
      writeLine(`\x1b[90mFile: ${session.filePath.split('/').pop()} | Lines: ${session.lines.length}\x1b[0m`);
      return;
    }

    if (input === '\x12') {
      writeLine('\x1b[90mFile to insert [from ./]: \x1b[0m');
      const maxLines = 15;
      const displayLines = session.lines.slice(0, maxLines);
      write(`\x1b[2J\x1b[H`);
      writeLine(`\x1b[1;32m Nano - ${session.filePath.split('/').pop()}\x1b[0m`);
      writeLine('\x1b[90m─────────────────────────────────────\x1b[0m');
      displayLines.forEach((l, i) => {
        const prefix = i === session.cursorLine ? '\x1b[32m>\x1b[0m ' : '  ';
        writeLine(`${prefix}${l || ''}`);
      });
      if (session.lines.length > maxLines) {
        writeLine(`\x1b[90m... ${session.lines.length - maxLines} more lines ...\x1b[0m`);
      }
      writeLine('\x1b[90m─────────────────────────────────────\x1b[0m');
      writeLine('\x1b[36m^G Help  ^O Save  ^X Exit  ^K Cut  ^U Paste\x1b[0m');
      writeLine(`\x1b[90mFile: ${session.filePath.split('/').pop()} | Lines: ${session.lines.length}\x1b[0m`);
      return;
    }

    if (input === '\x19') {
      if (session.cursorLine > 0) {
        session.cursorLine--;
        const line = session.lines[session.cursorLine] || '';
        session.cursorCol = Math.min(session.cursorCol, line.length);
      }
      const maxLines = 15;
      const displayLines = session.lines.slice(0, maxLines);
      write(`\x1b[2J\x1b[H`);
      writeLine(`\x1b[1;32m Nano - ${session.filePath.split('/').pop()}\x1b[0m`);
      writeLine('\x1b[90m─────────────────────────────────────\x1b[0m');
      displayLines.forEach((l, i) => {
        const prefix = i === session.cursorLine ? '\x1b[32m>\x1b[0m ' : '  ';
        writeLine(`${prefix}${l || ''}`);
      });
      if (session.lines.length > maxLines) {
        writeLine(`\x1b[90m... ${session.lines.length - maxLines} more lines ...\x1b[0m`);
      }
      writeLine('\x1b[90m─────────────────────────────────────\x1b[0m');
      writeLine('\x1b[36m^G Help  ^O Save  ^X Exit  ^K Cut  ^U Paste\x1b[0m');
      writeLine(`\x1b[90mFile: ${session.filePath.split('/').pop()} | Lines: ${session.lines.length}\x1b[0m`);
      return;
    }

    if (input >= ' ') {
      const line = session.lines[session.cursorLine] || '';
      const before = line.slice(0, session.cursorCol);
      const after = line.slice(session.cursorCol);
      session.lines[session.cursorLine] = before + input + after;
      session.cursorCol++;
      
      const maxLines = 15;
      const displayLines = session.lines.slice(0, maxLines);
      write(`\x1b[2J\x1b[H`);
      writeLine(`\x1b[1;32m Nano - ${session.filePath.split('/').pop()}\x1b[0m`);
      writeLine('\x1b[90m─────────────────────────────────────\x1b[0m');
      displayLines.forEach((l, i) => {
        const prefix = i === session.cursorLine ? '\x1b[32m>\x1b[0m ' : '  ';
        writeLine(`${prefix}${l || ''}`);
      });
      if (session.lines.length > maxLines) {
        writeLine(`\x1b[90m... ${session.lines.length - maxLines} more lines ...\x1b[0m`);
      }
      writeLine('\x1b[90m─────────────────────────────────────\x1b[0m');
      writeLine('\x1b[36m^G Help  ^O Save  ^X Exit  ^K Cut  ^U Paste\x1b[0m');
      writeLine(`\x1b[90mFile: ${session.filePath.split('/').pop()} | Lines: ${session.lines.length}\x1b[0m`);
    }
  }, [updateTerminalState, syncFileToVFS]);

  const sendInput = useCallback(async (sessionId: string, data: string) => {
    // Check if there's a WebSocket available for this session
    const term = terminalsRef.current.find(t => t.sandboxInfo.sessionId === sessionId && t.websocket && t.websocket.readyState === WebSocket.OPEN);

    if (term?.websocket) {
      // Use WebSocket for bidirectional streaming (ARCH 4 improvement)
      term.websocket.send(JSON.stringify({ type: 'input', data }));
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
        await fetch('/api/sandbox/terminal/input', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...getAuthHeaders(),
          },
          credentials: 'include',
          body: JSON.stringify({ sessionId, data: batch }),
        });
      } catch {}
    }, 50);
  }, []);

  const sendResize = useCallback(async (sessionId: string, cols: number, rows: number) => {
    // Check if there's a WebSocket available for this session
    const term = terminalsRef.current.find(t => t.sandboxInfo.sessionId === sessionId && t.websocket && t.websocket.readyState === WebSocket.OPEN);

    if (term?.websocket) {
      // Use WebSocket for resize (lower latency)
      term.websocket.send(JSON.stringify({ type: 'resize', cols, rows }));
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

      terminal.open(containerEl);
      containerEl.addEventListener('click', () => terminal.focus());

      requestAnimationFrame(() => {
        try { fitAddon.fit(); } catch {}
        terminal.focus();
      });

      // Write welcome message
      terminal.writeln('');
      terminal.writeln('\x1b[1;32m● Terminal Ready\x1b[0m');
      terminal.writeln('\x1b[90m  Local shell mode active immediately.\x1b[0m');
      terminal.writeln('\x1b[90m  Type "help" for commands.\x1b[0m');
      terminal.writeln('\x1b[90m  Type "connect" to connect to sandbox.\x1b[0m');
      terminal.writeln('');

      const cwd = localShellCwdRef.current[terminalId] || 'project';
      terminal.write(getPrompt('local', cwd));

      updateTerminalState(terminalId, { terminal, fitAddon, mode: 'local' });

      const termRef = terminalsRef.current.find(t => t.id === terminalId);
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

        // PTY mode: forward raw bytes to sandbox, skip local handling
        if (term.mode === 'pty' && term.sandboxInfo.sessionId) {
          // Buffer input until connected
          if (term.sandboxInfo.status === 'active') {
            void sendInput(term.sandboxInfo.sessionId, data);
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

        const session = editorSessionRef.current[terminalId];
        if (session) {
          handleEditorInput(terminalId, data, (text) => term.terminal?.write(text));
          return;
        }

        // Use ref for lineBuffer and cursor position to survive reconnects
        let lineBuffer = lineBufferRef.current[terminalId] || '';
        let cursorPos = cursorPosRef.current[terminalId] ?? lineBuffer.length;

        if (data === '\u001b[H') {
          // Home key - move cursor to start
          cursorPos = 0;
          cursorPosRef.current[terminalId] = 0;
          const prompt = getPrompt(term.mode, localShellCwdRef.current[terminalId] || 'project');
          term.terminal?.write(`\r${prompt}${lineBuffer}\x1b[${prompt.length + 1}G`);
          return;
        }

        if (data === '\u001b[F') {
          // End key - move cursor to end
          cursorPos = lineBuffer.length;
          cursorPosRef.current[terminalId] = cursorPos;
          const prompt = getPrompt(term.mode, localShellCwdRef.current[terminalId] || 'project');
          term.terminal?.write(`\x1b[G\x1b[${prompt.length + lineBuffer.length + 1}G`);
          return;
        }

        if (data === '\u001b[D') {
          // Left arrow - move cursor left
          if (cursorPos > 0) {
            cursorPos--;
            cursorPosRef.current[terminalId] = cursorPos;
            term.terminal?.write('\x1b[D');
          }
          return;
        }

        if (data === '\u001b[C') {
          // Right arrow - move cursor right
          if (cursorPos < lineBuffer.length) {
            cursorPos++;
            cursorPosRef.current[terminalId] = cursorPos;
            term.terminal?.write('\x1b[C');
          }
          return;
        }

        if (data === '\u007f' || data === '\b') {
          // Backspace - delete character before cursor
          if (cursorPos > 0) {
            const beforeCursor = lineBuffer.slice(0, cursorPos - 1);
            const afterCursor = lineBuffer.slice(cursorPos);
            lineBuffer = beforeCursor + afterCursor;
            lineBufferRef.current[terminalId] = lineBuffer;
            cursorPos--;
            cursorPosRef.current[terminalId] = cursorPos;
            // Clear from cursor to end, then rewrite the rest
            term.terminal?.write('\x1b[D\x1b[K' + lineBuffer.slice(cursorPos));
            const moveBack = lineBuffer.length - cursorPos;
            if (moveBack > 0) {
              term.terminal?.write(`\x1b[${moveBack}D`);
            }
          }
          return;
        }

        if (data === '\u007e') {
          // Delete key - delete character at cursor
          if (cursorPos < lineBuffer.length) {
            const beforeCursor = lineBuffer.slice(0, cursorPos);
            const afterCursor = lineBuffer.slice(cursorPos + 1);
            lineBuffer = beforeCursor + afterCursor;
            lineBufferRef.current[terminalId] = lineBuffer;
            // Clear from cursor to end, then rewrite the rest
            term.terminal?.write('\x1b[K' + lineBuffer.slice(cursorPos));
            const moveBack = lineBuffer.length - cursorPos;
            if (moveBack > 0) {
              term.terminal?.write(`\x1b[${moveBack}D`);
            }
          }
          return;
        }


        if (data === '\u0015') {
          // Ctrl+U - clear line from cursor to start
          if (cursorPos > 0) {
            lineBuffer = lineBuffer.slice(cursorPos);
            lineBufferRef.current[terminalId] = lineBuffer;
            cursorPos = 0;
            cursorPosRef.current[terminalId] = 0;
            term.terminal?.write('\r\x1b[K' + getPrompt(term.mode, localShellCwdRef.current[terminalId] || 'project') + lineBuffer);
          }
          return;
        }

        if (data === '\u000b') {
          // Ctrl+K - clear line from cursor to end
          if (cursorPos < lineBuffer.length) {
            lineBuffer = lineBuffer.slice(0, cursorPos);
            lineBufferRef.current[terminalId] = lineBuffer;
            term.terminal?.write('\x1b[K');
          }
          return;
        }

        if (data === '\r' || data === '\n') {
          term.terminal?.write('\r\n');
          const command = lineBuffer.trim();
          lineBufferRef.current[terminalId] = '';
          cursorPosRef.current[terminalId] = 0;

          if (command) {
            const isConnectCmd = command.trim() === 'connect';

            executeLocalShellCommand(
              terminalId,
              command,
              (text) => term.terminal?.write(text),
              term.mode === 'pty',
              term.mode
            ).then((shouldShowPrompt) => {
              if (shouldShowPrompt && !isConnectCmd) {
                const newCwd = localShellCwdRef.current[terminalId] || 'project';
                term.terminal?.write(getPrompt(term.mode, newCwd));
              } else if (isConnectCmd) {
                const reconnectAllowedAt = reconnectCooldownUntilRef.current[terminalId] || 0;
                const remaining = Math.ceil((reconnectAllowedAt - Date.now()) / 1000);
                if (remaining > 0) {
                  term.terminal?.writeln(`\x1b[33mReconnect cooldown: ${remaining}s remaining.\x1b[0m`);
                  const cwd = localShellCwdRef.current[terminalId] || 'project';
                  term.terminal?.write(getPrompt(term.mode, cwd));
                } else if (term.sandboxInfo.status !== 'creating' && Date.now() >= reconnectAllowedAt) {
                  updateTerminalState(terminalId, { mode: 'connecting' });
                  connectTerminal(terminalId);
                }
              }
            });
          } else {
            const newCwd = localShellCwdRef.current[terminalId] || 'project';
            term.terminal?.write(getPrompt(term.mode, newCwd));
          }
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
            // Clear current line and rewrite with history command
            const prompt = getPrompt(term.mode, localShellCwdRef.current[terminalId] || 'project');
            term.terminal?.write('\r\x1b[K' + prompt + cmd);
            lineBufferRef.current[terminalId] = cmd;
            cursorPosRef.current[terminalId] = cmd.length;
            // Move cursor back to end of line (after prompt + cmd)
            term.terminal?.write(`\x1b[${prompt.length + cmd.length + 1}G`);
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
            // Clear current line and rewrite with history command
            const prompt = getPrompt(term.mode, localShellCwdRef.current[terminalId] || 'project');
            term.terminal?.write('\r\x1b[K' + prompt + cmd);
            lineBufferRef.current[terminalId] = cmd;
            cursorPosRef.current[terminalId] = cmd.length;
            term.terminal?.write(`\x1b[${prompt.length + cmd.length + 1}G`);
          } else {
            // Clear line - no more history
            idx = history.length;
            historyIndexRef.current[terminalId] = idx;
            const prompt = getPrompt(term.mode, localShellCwdRef.current[terminalId] || 'project');
            term.terminal?.write('\r\x1b[K' + prompt);
            lineBufferRef.current[terminalId] = '';
            cursorPosRef.current[terminalId] = 0;
          }
          return;
        }

        if (data === '\t') {
          // Enhanced tab completion
          const lastWord = lineBuffer.split(' ').pop() || '';
          if (lastWord) {
            const cwd = localShellCwdRef.current[terminalId] || 'workspace';
            
            // Get completions from filesystem
            const completions = Object.keys(localFileSystemRef.current)
              .filter(k => {
                const relativePath = k.replace(/^workspace\//, '');
                return relativePath.startsWith(lastWord);
              })
              .map(k => k.split('/').pop() || k);
            
            if (completions.length === 1) {
              // Single completion - auto-fill
              const completion = completions[0].slice(lastWord.length);
              lineBufferRef.current[terminalId] = lineBuffer + completion;
              term.terminal?.write(completion);
            } else if (completions.length > 1) {
              // Multiple completions - show list
              term.terminal?.write('\r\n' + completions.join('  ') + '\r\n');
              const prompt = getPrompt(term.mode, cwd);
              term.terminal?.write(prompt + lineBuffer);
            } else {
              // No completions - beep
              term.terminal?.write('\x07');
            }
          }
          return;
        }

        if (data === '\x12') {  // Ctrl+R - History search
          const history = commandHistoryRef.current[terminalId] || [];
          const currentInput = lineBufferRef.current[terminalId] || '';
          
          // Find matching command from history (reverse search)
          const match = history.reverse().find(cmd => 
            cmd.toLowerCase().includes(currentInput.toLowerCase())
          );
          
          if (match) {
            const prompt = getPrompt(term.mode, localShellCwdRef.current[terminalId] || 'workspace');
            // Clear line and write match
            term.terminal?.write('\r\x1b[K' + prompt + match);
            lineBufferRef.current[terminalId] = match;
            cursorPosRef.current[terminalId] = match.length;
            // Move cursor to end of line
            term.terminal?.write(`\x1b[${prompt.length + match.length + 1}G`);
          } else {
            term.terminal?.write('\x07'); // Beep if no match
          }
          return;
        }

        if (data === '\x03') {
          term.terminal?.write('^C\r\n');
          lineBufferRef.current[terminalId] = '';
          const newCwd = localShellCwdRef.current[terminalId] || 'project';
          term.terminal?.write(getPrompt(term.mode, newCwd));
          return;
        }

        if (data >= ' ' || data === '\t') {
          const beforeCursor = lineBuffer.slice(0, cursorPos);
          const afterCursor = lineBuffer.slice(cursorPos);
          lineBuffer = beforeCursor + data + afterCursor;
          lineBufferRef.current[terminalId] = lineBuffer;
          cursorPos++;
          cursorPosRef.current[terminalId] = cursorPos;
          
          // Re-render the line from the cursor position onwards
          term.terminal?.write(data + afterCursor);
          
          // Move cursor back if necessary
          const moveBack = afterCursor.length;
          if (moveBack > 0) {
            term.terminal?.write(`\x1b[${moveBack}D`);
          }
        }
      });

      // Add custom key event handler to intercept arrow keys and prevent viewport scroll
      terminal.attachCustomKeyEventHandler((event: KeyboardEvent) => {
        if (event.type !== 'keydown') return true;
        const t = terminalsRef.current.find(t => t.id === terminalId);
        if (!t) return true;
        if (t.mode === 'pty') return true; // Let PTY handle everything
        
        // Suppress default browser behavior for Ctrl combinations in editor mode
        if (t.mode === 'editor' || t.mode === 'command-mode' || editorSessionRef.current[terminalId]) {
          const ctrlKeys = ['g', 'o', 'x', 'k', 'u', 'r', 'y', 'c', 'j', 't', 's'];
          if (event.ctrlKey && ctrlKeys.includes(event.key.toLowerCase())) {
            event.preventDefault();
            return true;
          }
        }

        // Allow arrow keys and other special keys to pass through
        return true;
      });

      terminal.onResize(({ cols, rows }: { cols: number; rows: number }) => {
        const term = terminalsRef.current.find(t => t.id === terminalId);
        if (term?.isConnected && term.sandboxInfo.sessionId) {
          sendResize(term.sandboxInfo.sessionId, cols, rows);
        }
      });

    } catch (err) {
      logger.error('Failed to load xterm.js', err as Error);
      toast.error('Failed to initialize terminal. Install @xterm/xterm @xterm/addon-fit @xterm/addon-web-links');
    }
  }, [executeLocalShellCommand, handleEditorInput, updateTerminalState, sendInput, sendResize]);

  // Handle sandbox command-mode input (line-based execution)
  const handleSandboxCmdInput = useCallback((
    terminalId: string,
    data: string,
    term: TerminalInstance
  ) => {
    let lineBuffer = lineBufferRef.current[terminalId] || '';

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

      const cwd = term.sandboxInfo.sessionId ? '/workspace' : '~';
      term.terminal?.write(`\x1b[1;32m${cwd}$\x1b[0m `);
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
      const cwd = term.sandboxInfo.sessionId ? '/workspace' : '~';
      term.terminal?.write(`\x1b[1;32m${cwd}$\x1b[0m `);
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
        const cwd = term.sandboxInfo.sessionId ? '/workspace' : '~';
        term.terminal?.write('\r\x1b[K' + ` ${cwd}$ ` + cmd);
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
        const cwd = term.sandboxInfo.sessionId ? '/workspace' : '~';
        term.terminal?.write('\r\x1b[K' + ` ${cwd}$ ` + cmd);
        lineBufferRef.current[terminalId] = cmd;
      } else {
        idx = history.length;
        historyIndexRef.current[terminalId] = idx;
        const cwd = term.sandboxInfo.sessionId ? '/workspace' : '~';
        term.terminal?.write('\r\x1b[K' + ` ${cwd}$ `);
        lineBufferRef.current[terminalId] = '';
      }
      return;
    }

    if (data >= ' ') {
      lineBufferRef.current[terminalId] = lineBuffer + data;
      term.terminal?.write(data);
    }
  }, [sendInput]);

  // Spinner animation frames for connecting status
  const spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

  // Connection timeout in milliseconds (configurable, default 15 seconds)
  const CONNECTION_TIMEOUT_MS = parseInt(
    process.env.NEXT_PUBLIC_TERMINAL_CONNECTION_TIMEOUT_MS || '15000',
    10
  ) || 15000;
  const CONNECTION_TIMEOUT_SECONDS = Math.round(CONNECTION_TIMEOUT_MS / 1000);

  const connectTerminal = useCallback(async (terminalId: string) => {
    connectTerminalRef.current = connectTerminal;
    // Abort any pending connection
    connectAbortRef.current[terminalId]?.abort();
    const ac = new AbortController();
    connectAbortRef.current[terminalId] = ac;

    const term = terminalsRef.current.find(t => t.id === terminalId);
    if (!term || term.sandboxInfo.status === 'creating' || term.isConnected) return;

    const token = getAuthToken();
    const anonymousSessionId = getAnonymousSessionId();

    updateTerminalState(terminalId, {
      sandboxInfo: { status: 'creating' },
      mode: 'connecting',
    });
    term.sandboxInfo = { status: 'creating' };

    term.terminal?.writeln('');
    term.terminal?.writeln('\x1b[33m⟳ Connecting to sandbox...\x1b[0m');
    term.terminal?.writeln('\x1b[90mThis may take a moment on first connection.\x1b[0m');
    term.terminal?.writeln(`\x1b[90mTimeout after ${CONNECTION_TIMEOUT_SECONDS}s will fall back to command-mode.\x1b[0m`);
    term.terminal?.writeln('');

    // Start animated spinner during connection
    let spinnerFrameIndex = 0;
    const spinnerInterval = setInterval(() => {
      const currentTerm = terminalsRef.current.find(t => t.id === terminalId);
      if (!currentTerm?.terminal || currentTerm.sandboxInfo.status !== 'creating') {
        clearInterval(spinnerInterval);
        return;
      }
      const frame = spinnerFrames[spinnerFrameIndex % spinnerFrames.length];
      spinnerFrameIndex++;
      currentTerm.terminal.write(`\r\x1b[33m${frame}\x1b[0m \x1b[90mProvisioning sandbox environment...\x1b[0m`);
    }, 80);

    // Store spinner interval reference for cleanup
    (term as any).__spinnerInterval = spinnerInterval;

    // Set connection timeout
    const connectionTimeout = setTimeout(() => {
      logger.warn('Connection timeout, falling back to command-mode');
      const currentTerm = terminalsRef.current.find(t => t.id === terminalId);
      if (currentTerm && currentTerm.sandboxInfo.status === 'creating') {
        // Clear spinner
        if ((currentTerm as any).__spinnerInterval) {
          clearInterval((currentTerm as any).__spinnerInterval);
          delete (currentTerm as any).__spinnerInterval;
        }
        // Fall back to command-mode
        const scopePath = filesystemScopePathRef.current;
        const sandboxPath = scopePath ? scopePath.replace(/^project\//, '/workspace/') : '/workspace';
        const cwd = sandboxPath;
        localShellCwdRef.current[terminalId] = cwd;
        updateTerminalState(terminalId, {
          sandboxInfo: { status: 'active' },
          isConnected: true,
          mode: 'sandbox-cmd',
        });
        currentTerm.sandboxInfo = { status: 'active' };
        currentTerm.isConnected = true;
        currentTerm.mode = 'sandbox-cmd';
        currentTerm.terminal?.writeln('');
        currentTerm.terminal?.writeln('\x1b[33m⚠ Connection timeout. Using command-mode.\x1b[0m');
        currentTerm.terminal?.writeln('\x1b[90mCommands execute line-by-line. Type "connect" to retry PTY.\x1b[0m');
        currentTerm.terminal?.writeln('');
        currentTerm.terminal?.writeln(`\x1b[90m→ cd ${sandboxPath}\x1b[0m`);
        currentTerm.terminal?.write(`\x1b[1;32m${sandboxPath.replace(/^\/workspace/, '~')}$\x1b[0m `);
      }
    }, CONNECTION_TIMEOUT_MS);

    (term as any).__connectionTimeout = connectionTimeout;

    try {
      const sessionRes = await fetch('/api/sandbox/terminal', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(),
        },
        credentials: 'include',
        signal: ac.signal,
      });

      if (!sessionRes.ok) {
        const errorData = await sessionRes.json().catch(() => ({}));
        
        // Check if this is an auth error that requires sign-in
        if (sessionRes.status === 401 && errorData.requiresAuth) {
          // Fall back to local shell mode for anonymous users
          console.log('[Terminal] Sandbox requires auth, using local shell mode');
          const cwd = localShellCwdRef.current[terminalId] || '/workspace';
          updateTerminalState(terminalId, {
            sandboxInfo: { status: 'active' },
            isConnected: true,
            mode: 'local',
          });
          
          // Get current terminal reference
          const currentTerm = terminalsRef.current.find(t => t.id === terminalId);
          if (currentTerm) {
            currentTerm.sandboxInfo = { status: 'active' };
            currentTerm.isConnected = true;
            currentTerm.mode = 'local';
            currentTerm.terminal?.writeln('');
            currentTerm.terminal?.writeln('\x1b[33m⚠ Sandbox requires authentication\x1b[0m');
            currentTerm.terminal?.writeln('\x1b[90mPlease sign in to use the sandbox terminal.\x1b[0m');
            currentTerm.terminal?.writeln('\x1b[90mUsing local shell mode in the meantime.\x1b[0m');
            currentTerm.terminal?.writeln('');
            currentTerm.terminal?.write(`\x1b[1;32m${cwd.replace(/^\/workspace/, '~')}$\x1b[0m `);
          }
          return;
        }
        
        throw new Error(errorData.error || 'Failed to create sandbox session');
      }

      const sessionData = await sessionRes.json();
      const { sessionId, sandboxId } = sessionData;

      let connectionToken: string | undefined;
      try {
        const tokenRes = await fetch('/api/sandbox/terminal/stream', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...getAuthHeaders(),
          },
          credentials: 'include',
          body: JSON.stringify({ sessionId, sandboxId }),
        });

        if (tokenRes.ok) {
          const tokenData = await tokenRes.json();
          connectionToken = tokenData.connectionToken;
        } else {
          logger.warn('Connection token endpoint not available');
        }
      } catch (err) {
        logger.warn('Failed to get connection token', err as Error);
      }

      // Try WebSocket first if available (WebSocket upgrade for bidirectional streaming)
      const wsSupported = typeof WebSocket !== 'undefined';
      
      if (wsSupported) {
        try {
          // Build WebSocket URL with connection token for authentication
          const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
          let wsUrl = `${wsProtocol}//${window.location.host}/api/sandbox/terminal/ws`;
          if (connectionToken) {
            wsUrl += `?token=${encodeURIComponent(connectionToken)}&sessionId=${encodeURIComponent(sessionId)}&sandboxId=${encodeURIComponent(sandboxId)}`;
          } else {
            wsUrl += `?sessionId=${encodeURIComponent(sessionId)}&sandboxId=${encodeURIComponent(sandboxId)}`;
          }

          const ws = new WebSocket(wsUrl);
          term.websocket = ws;

          // Reconnection state
          let reconnectAttempts = 0;
          const MAX_RECONNECT_ATTEMPTS = 5;
          const INITIAL_RECONNECT_DELAY = 1000; // 1 second

          ws.onopen = () => {
            reconnectAttempts = 0; // Reset on successful connection
            logger.debug('WebSocket connected', { sessionId, sandboxId });
          };

          ws.onmessage = (wsEvent) => {
            try {
              const msg = JSON.parse(wsEvent.data);
              const currentTerm = terminalsRef.current.find(t => t.id === terminalId);
              if (!currentTerm?.terminal) return;

              switch (msg.type) {
                case 'connected': {
                  const connectedInfo: SandboxInfo = {
                    sessionId,
                    sandboxId,
                    status: 'active',
                  };

                  // Clear spinner interval
                  const termWithSpinner = terminalsRef.current.find(t => t.id === terminalId);
                  if (termWithSpinner && (termWithSpinner as any).__spinnerInterval) {
                    clearInterval((termWithSpinner as any).__spinnerInterval);
                    delete (termWithSpinner as any).__spinnerInterval;
                  }
                  // Clear connection timeout
                  if (termWithSpinner && (termWithSpinner as any).__connectionTimeout) {
                    clearTimeout((termWithSpinner as any).__connectionTimeout);
                    delete (termWithSpinner as any).__connectionTimeout;
                  }

                  updateTerminalState(terminalId, {
                    sandboxInfo: connectedInfo,
                    isConnected: true,
                    mode: 'pty',
                  });

                  const termMut = terminalsRef.current.find(t => t.id === terminalId);
                  if (termMut) {
                    termMut.sandboxInfo = connectedInfo;
                    termMut.isConnected = true;
                    termMut.mode = 'pty';
                  }

                  currentTerm.terminal.writeln('');
                  currentTerm.terminal.writeln('\x1b[1;32m✓ Sandbox connected!\x1b[0m');
                  currentTerm.terminal.writeln('\x1b[90mYou now have full terminal access.\x1b[0m');
                  currentTerm.terminal.writeln('');

                  // Auto-cd to filesystem scope path if available
                  const scopePath = filesystemScopePathRef.current;
                  if (scopePath) {
                    // Convert VFS path (project/sessions/...) to sandbox path (/workspace/sessions/...)
                    const sandboxPath = scopePath.replace(/^project\//, '/workspace/');
                    currentTerm.terminal.writeln(`\x1b[90m→ cd ${sandboxPath}\x1b[0m`);
                    ws.send(JSON.stringify({ type: 'input', data: `cd ${sandboxPath}\n` }));
                  }

                  if (currentTerm.terminal) {
                    sendResize(sessionId, currentTerm.terminal.cols, currentTerm.terminal.rows);
                  }

                  const queue = commandQueueRef.current[terminalId] || [];
                  for (const cmd of queue) {
                    ws.send(JSON.stringify({ type: 'input', data: cmd }));
                  }
                  commandQueueRef.current[terminalId] = [];
                  break;
                }

                case 'pty':
                  currentTerm.terminal.write(msg.data);
                  break;

                case 'agent:tool_start':
                  currentTerm.terminal.writeln('');
                  currentTerm.terminal.writeln(`\x1b[1;35m🤖 Agent → ${msg.data.toolName}\x1b[0m`);
                  if (msg.data.toolName === 'exec_shell' && msg.data.args?.command) {
                    currentTerm.terminal.writeln(`\x1b[90m   $ ${msg.data.args.command}\x1b[0m`);
                  }
                  break;

                case 'agent:tool_result': {
                  const r = msg.data.result;
                  if (r?.success) {
                    currentTerm.terminal.writeln(`\x1b[32m   ✓ Success\x1b[0m`);
                  } else {
                    currentTerm.terminal.writeln(`\x1b[31m   ✗ Failed (exit ${r?.exitCode ?? '?'})\x1b[0m`);
                  }
                  if (r?.output) {
                    const lines = r.output.split('\n');
                    const maxLines = 15;
                    const display = lines.length > maxLines
                      ? [...lines.slice(0, maxLines), `\x1b[90m   ... (${lines.length - maxLines} more lines)\x1b[0m`]
                      : lines;
                    display.forEach((line: string) => {
                      currentTerm.terminal.writeln(`\x1b[90m   ${line}\x1b[0m`);
                    });
                  }
                  break;
                }

                case 'agent:complete':
                  currentTerm.terminal.writeln('');
                  currentTerm.terminal.writeln(`\x1b[1;32m🤖 Agent complete (${msg.data.totalSteps ?? 0} steps)\x1b[0m`);
                  currentTerm.terminal.writeln('');
                  break;

                case 'port_detected':
                  currentTerm.terminal.writeln('');
                  currentTerm.terminal.writeln(`\x1b[1;34m🌐 Preview: ${msg.data.url}\x1b[0m`);
                  toast.info(`Preview available on port ${msg.data.port}`, {
                    action: {
                      label: 'Open',
                      onClick: () => window.open(msg.data.url, '_blank'),
                    },
                  });
                  break;

                case 'error':
                  // Clear spinner interval
                  const termWithError = terminalsRef.current.find(t => t.id === terminalId);
                  if (termWithError && (termWithError as any).__spinnerInterval) {
                    clearInterval((termWithError as any).__spinnerInterval);
                    delete (termWithError as any).__spinnerInterval;
                  }
                  // Clear connection timeout
                  if (termWithError && (termWithError as any).__connectionTimeout) {
                    clearTimeout((termWithError as any).__connectionTimeout);
                    delete (termWithError as any).__connectionTimeout;
                  }

                  currentTerm.terminal.writeln(`\x1b[31m${msg.data}\x1b[0m`);
                  if (!currentTerm.isConnected) {
                    updateTerminalState(terminalId, {
                      sandboxInfo: { sessionId, sandboxId, status: 'error' },
                      isConnected: false,
                      mode: 'sandbox-cmd',
                    });
                    const termMut = terminalsRef.current.find(t => t.id === terminalId);
                    if (termMut) {
                      termMut.sandboxInfo = { sessionId, sandboxId, status: 'error' };
                      termMut.isConnected = false;
                      termMut.mode = 'sandbox-cmd';
                    }
                    ws.close();
                    reconnectCooldownUntilRef.current[terminalId] = Date.now() + 5000;
                    currentTerm.terminal.writeln('\x1b[33m⚠ PTY unavailable. Falling back to command-mode.\x1b[0m');
                    currentTerm.terminal.writeln('\x1b[90mType "connect" to retry PTY.\x1b[0m');
                    const cwd = localShellCwdRef.current[terminalId] || 'project';
                    currentTerm.terminal.write(`\x1b[1;32m${cwd.replace(/^project/, '~')}$\x1b[0m `);
                  }
                  break;

                case 'ping':
                  break;
              }
            } catch {}
          };

          ws.onerror = () => {
            logger.warn('WebSocket error, falling back to SSE');
            ws.close();
            // Fall through to SSE implementation - don't throw, just let code continue
          };

          ws.onclose = (event) => {
            const currentTerm = terminalsRef.current.find(t => t.id === terminalId);
            
            // Don't reconnect if already in command-mode or explicitly closed
            if (!currentTerm?.isConnected || currentTerm.mode === 'sandbox-cmd') {
              return;
            }

            // Attempt reconnection with exponential backoff
            if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
              const delay = INITIAL_RECONNECT_DELAY * Math.pow(2, reconnectAttempts);
              reconnectAttempts++;
              
              logger.info('WebSocket closed, attempting reconnection', {
                attempt: reconnectAttempts,
                maxAttempts: MAX_RECONNECT_ATTEMPTS,
                delay,
              });

              currentTerm.terminal?.writeln(`\x1b[33m⚠ Connection lost. Reconnecting (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...\x1b[0m`);

              setTimeout(() => {
                // Reconnect with same parameters
                const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
                const params = new URLSearchParams({
                  sessionId,
                  sandboxId,
                });
                if (connectionToken) {
                  params.set('token', connectionToken);
                }
                const newWsUrl = `${wsProtocol}//${window.location.host}/api/sandbox/terminal/ws?${params.toString()}`;
  
                const newWs = new WebSocket(newWsUrl);
                currentTerm.websocket = newWs;
  
                // Re-attach handlers (simplified - would need to extract handler logic)
                newWs.onopen = () => {
                  reconnectAttempts = 0;
                  logger.debug('WebSocket reconnected');
                  currentTerm.terminal?.writeln('\x1b[32m✓ Reconnected!\x1b[0m');
                };
                newWs.onmessage = ws.onmessage;
                newWs.onerror = ws.onerror;
                newWs.onclose = ws.onclose;
              }, delay);
              }, delay);
            } else {
              // Max reconnection attempts reached, fall back to command-mode
              logger.warn('WebSocket reconnection failed, falling back to command-mode');
              currentTerm.terminal?.writeln('\x1b[31m⚠ Reconnection failed. Falling back to command-mode.\x1b[0m');
              currentTerm.terminal?.writeln('\x1b[90mType "connect" to retry PTY.\x1b[0m');
              
              updateTerminalState(terminalId, {
                isConnected: false,
                mode: 'sandbox-cmd',
              });
              currentTerm.isConnected = false;
              currentTerm.mode = 'sandbox-cmd';
            }
          };

          // Update terminal state with WebSocket
          const pendingSandboxInfo: SandboxInfo = {
            sessionId,
            sandboxId,
            status: 'creating',
          };

          updateTerminalState(terminalId, {
            sandboxInfo: pendingSandboxInfo,
            websocket: ws,
            isConnected: false,
          });

          const termMut = terminalsRef.current.find(t => t.id === terminalId);
          if (termMut) {
            termMut.sandboxInfo = pendingSandboxInfo;
            termMut.websocket = ws;
            termMut.isConnected = false;
          }

          return; // WebSocket path successful, exit early
        } catch (wsError) {
          logger.warn('WebSocket not available, using SSE fallback', wsError as Error);
          // Fall through to SSE implementation
        }
      }

      // SSE fallback (original implementation)
      const tokenParam = connectionToken
        ? `&token=${encodeURIComponent(connectionToken)}`
        : '';
      const streamUrl = `/api/sandbox/terminal/stream?sessionId=${encodeURIComponent(sessionId)}&sandboxId=${encodeURIComponent(sandboxId)}${tokenParam}${anonymousSessionId ? `&anonymousSessionId=${encodeURIComponent(anonymousSessionId)}` : ''}`;

      const eventSource = new EventSource(streamUrl);

      eventSource.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          const currentTerm = terminalsRef.current.find(t => t.id === terminalId);
          if (!currentTerm?.terminal) return;

          switch (msg.type) {
            case 'connected': {
              const connectedInfo: SandboxInfo = {
                sessionId,
                sandboxId,
                status: 'active',
              };

              // Clear spinner interval
              const termWithSpinner = terminalsRef.current.find(t => t.id === terminalId);
              if (termWithSpinner && (termWithSpinner as any).__spinnerInterval) {
                clearInterval((termWithSpinner as any).__spinnerInterval);
                delete (termWithSpinner as any).__spinnerInterval;
              }
              // Clear connection timeout
              if (termWithSpinner && (termWithSpinner as any).__connectionTimeout) {
                clearTimeout((termWithSpinner as any).__connectionTimeout);
                delete (termWithSpinner as any).__connectionTimeout;
              }

              updateTerminalState(terminalId, {
                sandboxInfo: connectedInfo,
                isConnected: true,
                mode: 'pty',
              });

              const termMut = terminalsRef.current.find(t => t.id === terminalId);
              if (termMut) {
                termMut.sandboxInfo = connectedInfo;
                termMut.isConnected = true;
                termMut.mode = 'pty';
              }

              currentTerm.terminal.writeln('');
              currentTerm.terminal.writeln('\x1b[1;32m✓ Sandbox connected!\x1b[0m');
              currentTerm.terminal.writeln('\x1b[90mYou now have full terminal access.\x1b[0m');
              currentTerm.terminal.writeln('');

              if (currentTerm.terminal) {
                sendResize(sessionId, currentTerm.terminal.cols, currentTerm.terminal.rows);
              }

              const queue = commandQueueRef.current[terminalId] || [];
              for (const cmd of queue) {
                void sendInput(sessionId, cmd);
              }
              commandQueueRef.current[terminalId] = [];
              break;
            }

            case 'pty':
              currentTerm.terminal.write(msg.data);
              break;

            case 'agent:tool_start':
              currentTerm.terminal.writeln('');
              currentTerm.terminal.writeln(`\x1b[1;35m🤖 Agent → ${msg.data.toolName}\x1b[0m`);
              if (msg.data.toolName === 'exec_shell' && msg.data.args?.command) {
                currentTerm.terminal.writeln(`\x1b[90m   $ ${msg.data.args.command}\x1b[0m`);
              }
              break;

            case 'agent:tool_result': {
              const r = msg.data.result;
              if (r?.success) {
                currentTerm.terminal.writeln(`\x1b[32m   ✓ Success\x1b[0m`);
              } else {
                currentTerm.terminal.writeln(`\x1b[31m   ✗ Failed (exit ${r?.exitCode ?? '?'})\x1b[0m`);
              }
              if (r?.output) {
                const lines = r.output.split('\n');
                const maxLines = 15;
                const display = lines.length > maxLines
                  ? [...lines.slice(0, maxLines), `\x1b[90m   ... (${lines.length - maxLines} more lines)\x1b[0m`]
                  : lines;
                display.forEach((line: string) => {
                  currentTerm.terminal.writeln(`\x1b[90m   ${line}\x1b[0m`);
                });
              }
              break;
            }

            case 'agent:complete':
              currentTerm.terminal.writeln('');
              currentTerm.terminal.writeln(`\x1b[1;32m🤖 Agent complete (${msg.data.totalSteps ?? 0} steps)\x1b[0m`);
              currentTerm.terminal.writeln('');
              break;

            case 'port_detected':
              currentTerm.terminal.writeln('');
              currentTerm.terminal.writeln(`\x1b[1;34m🌐 Preview: ${msg.data.url}\x1b[0m`);
              toast.info(`Preview available on port ${msg.data.port}`, {
                action: {
                  label: 'Open',
                  onClick: () => window.open(msg.data.url, '_blank'),
                },
              });
              break;

            case 'error':
              // Clear spinner interval
              const termWithError = terminalsRef.current.find(t => t.id === terminalId);
              if (termWithError && (termWithError as any).__spinnerInterval) {
                clearInterval((termWithError as any).__spinnerInterval);
                delete (termWithError as any).__spinnerInterval;
              }
              // Clear connection timeout
              if (termWithError && (termWithError as any).__connectionTimeout) {
                clearTimeout((termWithError as any).__connectionTimeout);
                delete (termWithError as any).__connectionTimeout;
              }

              currentTerm.terminal.writeln(`\x1b[31m${msg.data}\x1b[0m`);
              if (!currentTerm.isConnected) {
                updateTerminalState(terminalId, {
                  sandboxInfo: { sessionId, sandboxId, status: 'error' },
                  isConnected: false,
                  mode: 'sandbox-cmd',
                });
                const termMut = terminalsRef.current.find(t => t.id === terminalId);
                if (termMut) {
                  termMut.sandboxInfo = { sessionId, sandboxId, status: 'error' };
                  termMut.isConnected = false;
                  termMut.mode = 'sandbox-cmd';
                }
                currentTerm.eventSource?.close();
                reconnectCooldownUntilRef.current[terminalId] = Date.now() + 5000;
                currentTerm.terminal.writeln('\x1b[33m⚠ PTY unavailable. Falling back to command-mode.\x1b[0m');
                currentTerm.terminal.writeln('\x1b[90mType "connect" to retry PTY.\x1b[0m');
                const cwd = localShellCwdRef.current[terminalId] || 'project';
                currentTerm.terminal.write(`\x1b[1;32m${cwd.replace(/^project/, '~')}$\x1b[0m `);
              }
              break;

            case 'ping':
              break;
          }
        } catch {}
      };

      eventSource.onerror = () => {
        const currentTerm = terminalsRef.current.find(t => t.id === terminalId);
        if (currentTerm?.isConnected) {
          currentTerm.terminal?.writeln('\x1b[31m⚠ Connection lost. Reconnecting...\x1b[0m');
        }
      };

      const pendingSandboxInfo: SandboxInfo = {
        sessionId,
        sandboxId,
        status: 'creating',
      };

      updateTerminalState(terminalId, {
        sandboxInfo: pendingSandboxInfo,
        eventSource,
        isConnected: false,
      });

      const termMut = terminalsRef.current.find(t => t.id === terminalId);
      if (termMut) {
        termMut.sandboxInfo = pendingSandboxInfo;
        termMut.eventSource = eventSource;
        termMut.isConnected = false;
      }

    } catch (error) {
      // Clear spinner interval
      const termWithError = terminalsRef.current.find(t => t.id === terminalId);
      if (termWithError && (termWithError as any).__spinnerInterval) {
        clearInterval((termWithError as any).__spinnerInterval);
        delete (termWithError as any).__spinnerInterval;
      }
      // Clear connection timeout
      if (termWithError && (termWithError as any).__connectionTimeout) {
        clearTimeout((termWithError as any).__connectionTimeout);
        delete (termWithError as any).__connectionTimeout;
      }

      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      updateTerminalState(terminalId, {
        sandboxInfo: { status: 'error' },
        isConnected: false,
        mode: 'sandbox-cmd',
      });
      const termMut = terminalsRef.current.find(t => t.id === terminalId);
      if (termMut) {
        termMut.sandboxInfo = { status: 'error' };
        termMut.isConnected = false;
        termMut.mode = 'sandbox-cmd';
      }
      reconnectCooldownUntilRef.current[terminalId] = Date.now() + 5000;
      term.terminal?.writeln(`\x1b[31m✗ Failed to connect: ${errMsg}\x1b[0m`);
      term.terminal?.writeln('\x1b[33m⚠ Falling back to command-mode. Type "connect" to retry.\x1b[0m');
      const cwd = localShellCwdRef.current[terminalId] || 'project';
      term.terminal?.write(`\x1b[1;32m${cwd.replace(/^project/, '~')}$\x1b[0m `);
    }
  }, [updateTerminalState, sendResize, sendInput]);

  // Periodic health check for connected terminals
  // Checks connection status every 30 seconds for active PTY terminals
  useEffect(() => {
    const HEALTH_CHECK_INTERVAL = 30000; // 30 seconds
    
    const healthCheckInterval = setInterval(() => {
      terminalsRef.current.forEach(term => {
        if (term.mode === 'pty' && term.isConnected && term.websocket) {
          // Check WebSocket readyState
          if (term.websocket.readyState === WebSocket.CLOSED) {
            logger.warn('Terminal health check: WebSocket closed', {
              terminalId: term.id,
              sandboxId: term.sandboxInfo.sandboxId,
            });
            // Trigger reconnection
            term.websocket = null;
            term.isConnected = false;
            updateTerminalState(term.id, { isConnected: false, mode: 'sandbox-cmd' });
            term.terminal?.writeln('\x1b[31m⚠ Connection lost detected. Type "connect" to reconnect.\x1b[0m');
          } else if (term.websocket.readyState === WebSocket.CLOSING) {
            logger.debug('Terminal health check: WebSocket closing', {
              terminalId: term.id,
            });
          }
        }
      });
    }, HEALTH_CHECK_INTERVAL);

    return () => clearInterval(healthCheckInterval);
  }, [updateTerminalState]);

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
      if (term?.terminal) {
        term.terminal.clear();
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
        await navigator.clipboard.writeText(selection);
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
      await navigator.clipboard.writeText(text);
      toast.success('Copied to clipboard');
    } catch {
      toast.error('Failed to copy to clipboard');
    }
  }, [activeTerminalId]);

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

  // Phase 2: Toggle sandbox connection
  const toggleSandboxConnection = useCallback(async () => {
    if (sandboxStatus === 'connected') {
      // Disconnect - kill sandbox session
      const term = terminalsRef.current.find(t => t.id === activeTerminalId);
      if (term?.sandboxInfo.sessionId) {
        try {
          await fetch('/api/sandbox/terminal', {
            method: 'DELETE',
            headers: {
              'Content-Type': 'application/json',
              ...getAuthHeaders(),
            },
            body: JSON.stringify({ sessionId: term.sandboxInfo.sessionId }),
          });
          setSandboxStatus('disconnected');
          toast.success('Sandbox disconnected');
        } catch (error) {
          toast.error('Failed to disconnect sandbox');
        }
      }
    } else if (sandboxStatus === 'disconnected') {
      // Connect - create new sandbox session
      setSandboxStatus('connecting');
      try {
        const res = await fetch('/api/sandbox/terminal', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...getAuthHeaders(),
          },
        });
        if (res.ok) {
          const data = await res.json();
          toast.success('Sandbox connected: ' + data.sandboxId.slice(0, 12) + '...');
          setSandboxStatus('connected');
          // Reconnect terminal to sandbox
          if (activeTerminalId) {
            connectTerminal(activeTerminalId);
          }
        } else {
          toast.error('Failed to connect sandbox');
          setSandboxStatus('disconnected');
        }
      } catch (error) {
        toast.error('Failed to connect sandbox');
        setSandboxStatus('disconnected');
      }
    }
  }, [sandboxStatus, activeTerminalId, connectTerminal]);

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

  if (!isOpen) return null;

  if (isMinimized) {
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
            className="text-white/60 hover:text-white hidden sm:inline-flex"
            aria-label="Copy terminal output"
          >
            <Copy className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => clearTerminal()}
            className="text-white/60 hover:text-white hidden sm:inline-flex"
            aria-label="Clear terminal"
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
          >
            <div
              ref={setXtermContainer(terminal.id)}
              className="w-full h-full p-2"
              aria-label={`${terminal.name} terminal`}
            />
          </div>
        ))}
      </div>

      {activeTerminal && (
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
      )}
    </motion.div>
  );
}
