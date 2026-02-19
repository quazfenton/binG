'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import {
  Terminal as TerminalIcon, X, Minimize2, Maximize2, Square,
  Trash2, Copy, ChevronUp, ChevronDown,
  Cpu, MemoryStick, Plus, Split
} from 'lucide-react';
import { toast } from 'sonner';
import { motion } from 'framer-motion';
import { saveTerminalSession, getTerminalSessions, addCommandToHistory } from '@/lib/terminal/terminal-storage';
import { secureRandom, generateSecureId } from '@/lib/utils';

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

interface TerminalInstance {
  id: string;
  name: string;
  sandboxInfo: SandboxInfo;
  xtermRef: React.RefObject<HTMLDivElement>;
  terminal: any | null;      // xterm Terminal instance
  fitAddon: any | null;      // FitAddon instance
  eventSource: EventSource | null;
  isConnected: boolean;
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
    }
    return sessionId;
  } catch {
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
    headers['X-Anonymous-Session-Id'] = anonymousSessionId;
  }

  return headers;
}

export default function TerminalPanel({
  userId,
  isOpen,
  onClose,
  onMinimize,
  isMinimized = false
}: TerminalPanelProps) {
  const [terminals, setTerminals] = useState<TerminalInstance[]>([]);
  const [activeTerminalId, setActiveTerminalId] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isSplitView, setIsSplitView] = useState(false);

  // Refs to hold mutable terminal state without triggering re-renders
  const terminalsRef = useRef<TerminalInstance[]>([]);
  terminalsRef.current = terminals;
  const preConnectLineBufferRef = useRef<Record<string, string>>({});
  const preConnectQueueRef = useRef<Record<string, string[]>>({});

  // Auto-create terminal when panel opens and no terminals exist
  useEffect(() => {
    if (isOpen && terminals.length === 0) {
      // Try to restore previous sessions first
      const savedSessions = getTerminalSessions();
      if (savedSessions.length > 0) {
        // Restore most recent session
        const session = savedSessions[0];
        createTerminal(session.name, session.sandboxInfo);
      } else {
        createTerminal('Terminal 1');
      }
    }
  }, [isOpen]);

  // Clean up on unmount and when panel closes
  useEffect(() => {
    return () => {
      terminalsRef.current.forEach(t => {
        t.eventSource?.close();
        t.terminal?.dispose();
      });
    };
  }, []);

  // Close sandbox sessions when panel closes (but save session info for reuse)
  useEffect(() => {
    if (!isOpen && terminals.length > 0) {
      // Close EventSource connections to prevent resource leaks
      // SSE streams continue in background if not explicitly closed
      terminals.forEach(t => {
        t.eventSource?.close();
      });
      
      // Save session info before closing sandbox
      terminals.forEach(t => {
        saveTerminalSession({
          id: t.id,
          name: t.name,
          commandHistory: [], // xterm handles this internally
          sandboxInfo: {
            ...t.sandboxInfo,
            status: 'none' // Mark as closed, but keep sandboxId for reuse
          },
          lastUsed: Date.now()
        });
      });
    }
  }, [isOpen]);

  // Handle resize when expand state or split view changes
  useEffect(() => {
    const timer = setTimeout(() => {
      terminals.forEach(t => {
        if (t.fitAddon && t.terminal) {
          try {
            t.fitAddon.fit();
          } catch {
            // Terminal not yet attached
          }
        }
      });
    }, 100);
    return () => clearTimeout(timer);
  }, [isExpanded, isSplitView, activeTerminalId, isMinimized]);

  // Global resize handler
  useEffect(() => {
    const handleResize = () => {
      terminalsRef.current.forEach(t => {
        if (t.fitAddon && t.terminal) {
          try { t.fitAddon.fit(); } catch { /* ignore */ }
        }
      });
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const createTerminal = useCallback((name?: string, sandboxInfo?: any) => {
    const newTerminal: TerminalInstance = {
      id: generateSecureId('terminal'),
      name: name || `Terminal ${terminalsRef.current.length + 1}`,
      sandboxInfo: sandboxInfo || { status: 'none' },
      xtermRef: React.createRef<HTMLDivElement>(),
      terminal: null,
      fitAddon: null,
      eventSource: null,
      isConnected: false,
    };

    preConnectLineBufferRef.current[newTerminal.id] = '';
    preConnectQueueRef.current[newTerminal.id] = [];
    setTerminals(prev => [...prev, newTerminal]);
    setActiveTerminalId(newTerminal.id);
    return newTerminal.id;
  }, []);

  const closeTerminal = useCallback((terminalId: string) => {
    const terminal = terminalsRef.current.find(t => t.id === terminalId);
    if (terminal) {
      terminal.eventSource?.close();
      terminal.terminal?.dispose();
    }
    delete preConnectLineBufferRef.current[terminalId];
    delete preConnectQueueRef.current[terminalId];

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
    setTerminals(prev => prev.map(t =>
      t.id === terminalId ? { ...t, ...updates } : t
    ));
  }, []);

  // Initialize xterm.js for a terminal instance when its container mounts
  const initXterm = useCallback(async (terminalId: string, containerEl: HTMLDivElement) => {
    const existing = terminalsRef.current.find(t => t.id === terminalId);
    if (!existing || existing.terminal) return; // Already initialized

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

      // Initial fit after a frame
      requestAnimationFrame(() => {
        try { fitAddon.fit(); } catch { /* ignore */ }
      });

      // Show friendly welcome message - sandbox connects lazily on first command
      terminal.writeln('\x1b[1;32m● Terminal ready\x1b[0m');
      terminal.writeln('\x1b[90mType a command to connect to sandbox...\x1b[0m');
      terminal.writeln('\x1b[90mSandbox will initialize automatically on first command\x1b[0m');
      terminal.writeln('');
      terminal.writeln('\x1b[36mQuick commands:\x1b[0m');
      terminal.writeln('  \x1b[32mls\x1b[0m - List files');
      terminal.writeln('  \x1b[32mpwd\x1b[0m - Show current directory');
      terminal.writeln('  \x1b[32mnode --version\x1b[0m - Check Node.js version');
      terminal.writeln('');
      terminal.write('local$ ');

      updateTerminalState(terminalId, { terminal, fitAddon });

      // Store refs on the mutable object for immediate access
      const termRef = terminalsRef.current.find(t => t.id === terminalId);
      if (termRef) {
        termRef.terminal = terminal;
        termRef.fitAddon = fitAddon;
      }

      // Set up input handler — sends keystrokes to PTY via POST
      terminal.onData((data: string) => {
        const term = terminalsRef.current.find(t => t.id === terminalId);
        if (!term) return;

        // If not connected yet, trigger sandbox initialization
        if (term.sandboxInfo.status === 'none' || !term.isConnected) {
          if (term.sandboxInfo.status !== 'creating') {
            connectTerminal(terminalId);
          }

          // Pre-connect local line editor + queue so terminal remains usable
          // while sandbox provisioning is in progress.
          const buffer = preConnectLineBufferRef.current[terminalId] ?? '';
          let nextBuffer = buffer;
          let queuedCommand: string | null = null;

          for (const ch of data) {
            if (ch === '\r' || ch === '\n') {
              term.terminal?.write('\r\n');
              const command = nextBuffer.trim();
              nextBuffer = '';
              if (command) {
                const queue = preConnectQueueRef.current[terminalId] ?? [];
                queue.push(command);
                preConnectQueueRef.current[terminalId] = queue;
                queuedCommand = command;
              }
              term.terminal?.write('local$ ');
            } else if (ch === '\u007f') {
              if (nextBuffer.length > 0) {
                nextBuffer = nextBuffer.slice(0, -1);
                term.terminal?.write('\b \b');
              }
            } else if (ch >= ' ') {
              nextBuffer += ch;
              term.terminal?.write(ch);
            }
          }

          preConnectLineBufferRef.current[terminalId] = nextBuffer;
          if (queuedCommand) {
            term.terminal?.writeln('\x1b[90m[queued] command will run once sandbox is connected\x1b[0m');
          }
          return;
        }

        if (term.sandboxInfo.sessionId) {
          sendInput(term.sandboxInfo.sessionId, data);
        }
      });

      // Handle resize events from FitAddon
      terminal.onResize(({ cols, rows }: { cols: number; rows: number }) => {
        const term = terminalsRef.current.find(t => t.id === terminalId);
        if (term?.isConnected && term.sandboxInfo.sessionId) {
          sendResize(term.sandboxInfo.sessionId, cols, rows);
        }
      });

    } catch (err) {
      console.error('[TerminalPanel] Failed to load xterm.js:', err);
      toast.error('Failed to initialize terminal. Install @xterm/xterm @xterm/addon-fit @xterm/addon-web-links');
    }
  }, []);

  // Send input to PTY
  const sendInput = useCallback(async (sessionId: string, data: string) => {
    try {
      await fetch('/api/sandbox/terminal/input', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(),
        },
        credentials: 'include',
        body: JSON.stringify({ sessionId, data }),
      });
    } catch {
      // Silently ignore individual input failures
    }
  }, []);

  // Send resize to PTY
  const sendResize = useCallback(async (sessionId: string, cols: number, rows: number) => {
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
    } catch {
      // Silently ignore resize failures
    }
  }, []);

  const flushPreConnectQueue = useCallback(async (terminalId: string, sessionId: string) => {
    const queue = preConnectQueueRef.current[terminalId];
    if (!queue || queue.length === 0) return;

    const toRun = [...queue];
    preConnectQueueRef.current[terminalId] = [];

    for (const command of toRun) {
      await sendInput(sessionId, `${command}\n`);
    }
  }, [sendInput]);

  // Connect terminal to sandbox PTY
  const connectTerminal = useCallback(async (terminalId: string) => {
    const term = terminalsRef.current.find(t => t.id === terminalId);
    if (!term || term.sandboxInfo.status === 'creating' || term.isConnected) return;

    const token = getAuthToken();
    const anonymousSessionId = getAnonymousSessionId();

    updateTerminalState(terminalId, {
      sandboxInfo: { status: 'creating' },
    });
    term.sandboxInfo = { status: 'creating' };
    
    // Show loading message - but don't mention time estimates
    term.terminal?.writeln('');
    term.terminal?.writeln('\x1b[33m⟳ Preparing your sandbox...\x1b[0m');
    term.terminal?.writeln('\x1b[90mThis only happens once - future terminals will be instant!\x1b[0m');
    term.terminal?.writeln('');

    try {
      // Step 1: Ensure sandbox session exists
      const sessionRes = await fetch('/api/sandbox/terminal', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(),
        },
        credentials: 'include',
      });

      if (!sessionRes.ok) {
        throw new Error('Failed to create sandbox session');
      }

      const sessionData = await sessionRes.json();
      const { sessionId, sandboxId } = sessionData;

      // Step 2: Connect SSE stream (this creates the PTY)
      const streamUrl = `/api/sandbox/terminal/stream?sessionId=${encodeURIComponent(sessionId)}&sandboxId=${encodeURIComponent(sandboxId)}${token ? `&token=${encodeURIComponent(token)}` : ''}${anonymousSessionId ? `&anonymousSessionId=${encodeURIComponent(anonymousSessionId)}` : ''}`;
      const eventSource = new EventSource(streamUrl);

      eventSource.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          const currentTerm = terminalsRef.current.find(t => t.id === terminalId);
          if (!currentTerm?.terminal) return;

          switch (msg.type) {
            case 'pty':
              currentTerm.terminal.write(msg.data);
              break;

            case 'agent:tool_start':
              currentTerm.terminal.writeln('');
              currentTerm.terminal.writeln(`\x1b[1;35m🤖 Agent → ${msg.data.toolName}\x1b[0m`);
              if (msg.data.toolName === 'exec_shell' && msg.data.args?.command) {
                currentTerm.terminal.writeln(`\x1b[90m   $ ${msg.data.args.command}\x1b[0m`);
              } else if (msg.data.args) {
                const argStr = Object.entries(msg.data.args)
                  .map(([k, v]) => `${k}=${typeof v === 'string' && v.length > 80 ? v.slice(0, 80) + '…' : v}`)
                  .join(', ');
                currentTerm.terminal.writeln(`\x1b[90m   ${argStr}\x1b[0m`);
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

            case 'agent:stream':
              if (msg.data.text) {
                currentTerm.terminal.write(`\x1b[36m${msg.data.text}\x1b[0m`);
              }
              break;

            case 'agent:complete':
              currentTerm.terminal.writeln('');
              currentTerm.terminal.writeln(`\x1b[1;32m🤖 Agent complete (${msg.data.totalSteps ?? 0} steps)\x1b[0m`);
              currentTerm.terminal.writeln('');
              break;

            case 'agent:error':
              currentTerm.terminal.writeln('');
              currentTerm.terminal.writeln(`\x1b[1;31m🤖 Agent error: ${msg.data.message}\x1b[0m`);
              currentTerm.terminal.writeln('');
              break;

            case 'port_detected':
              currentTerm.terminal.writeln('');
              currentTerm.terminal.writeln(`\x1b[1;34m🌐 Preview available: ${msg.data.url}\x1b[0m`);
              toast.info(`Preview available on port ${msg.data.port}`, {
                action: {
                  label: 'Open',
                  onClick: () => window.open(msg.data.url, '_blank'),
                },
              });
              break;

            case 'error':
              currentTerm.terminal.writeln(`\x1b[31m${msg.data}\x1b[0m`);
              break;

            case 'ping':
              break;
          }
        } catch {
          // Malformed SSE data
        }
      };

      eventSource.onerror = () => {
        const currentTerm = terminalsRef.current.find(t => t.id === terminalId);
        if (currentTerm?.isConnected) {
          currentTerm.terminal?.writeln('\x1b[31m⚠ Connection lost. Reconnecting...\x1b[0m');
          // EventSource auto-reconnects
        }
      };

      const sandboxInfo: SandboxInfo = {
        sessionId,
        sandboxId,
        status: 'active',
      };

      updateTerminalState(terminalId, {
        sandboxInfo,
        eventSource,
        isConnected: true,
      });

      // Update mutable ref immediately
      const termMut = terminalsRef.current.find(t => t.id === terminalId);
      if (termMut) {
        termMut.sandboxInfo = sandboxInfo;
        termMut.eventSource = eventSource;
        termMut.isConnected = true;
      }

      // Show success message - makes it feel instant even if it took time
      term.terminal?.writeln('');
      term.terminal?.writeln('\x1b[1;32m✓ Sandbox ready!\x1b[0m');
      term.terminal?.writeln('\x1b[90mYour isolated development environment is ready to use.\x1b[0m');
      term.terminal?.writeln('');

      if (!userId) {
        term.terminal?.writeln('\x1b[33m⚠ Dev mode: Anonymous session (sign in for persistence)\x1b[0m');
      }

      // Send initial resize
      if (term.terminal) {
        sendResize(sessionId, term.terminal.cols, term.terminal.rows);
      }

      preConnectLineBufferRef.current[terminalId] = '';
      await flushPreConnectQueue(terminalId, sessionId);

    } catch (error) {
      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      updateTerminalState(terminalId, {
        sandboxInfo: { status: 'error' },
        isConnected: false,
      });
      const termMut = terminalsRef.current.find(t => t.id === terminalId);
      if (termMut) {
        termMut.sandboxInfo = { status: 'error' };
        termMut.isConnected = false;
      }
      term.terminal?.writeln(`\x1b[31m✗ Failed to connect: ${errMsg}\x1b[0m`);
      term.terminal?.writeln('\x1b[90mPress any key to retry...\x1b[0m');
    }
  }, [userId, updateTerminalState, sendResize, flushPreConnectQueue]);

  // Ref callback to mount xterm when DOM element is available
  const setXtermContainer = useCallback((terminalId: string) => (el: HTMLDivElement | null) => {
    if (el) {
      const term = terminalsRef.current.find(t => t.id === terminalId);
      if (term && !term.terminal) {
        initXterm(terminalId, el);
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
      const text = selection || active.terminal.buffer.active.getLine(0)?.translateToString() || '';
      await navigator.clipboard.writeText(selection || text);
      toast.success(selection ? 'Selection copied' : 'Copied to clipboard');
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
    } catch {
      // Continue with cleanup
    }
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
        } catch {
          // Continue
        }
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
      if (terminals.length > 1) {
        killTerminal(terminals[terminals.length - 1].id);
      }
      setIsSplitView(false);
    } else {
      if (terminals.length < 2) {
        createTerminal('Terminal 2');
      }
      setIsSplitView(true);
    }
  }, [isSplitView, terminals, killTerminal, createTerminal]);

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
            {terminals.some(t => t.sandboxInfo.status === 'active') && (
              <span className="text-xs text-green-400 flex items-center gap-1">
                <span className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse" />
                {terminals.filter(t => t.sandboxInfo.status === 'active').length} connected
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

  const activeTerminal = terminals.find(t => t.id === activeTerminalId);

  return (
    <motion.div
      initial={{ y: 100, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 100, opacity: 0 }}
      className={`fixed bottom-0 left-0 right-0 z-50 bg-black/95 border-t border-white/10 backdrop-blur-sm flex flex-col ${
        isExpanded ? 'h-[80vh]' : 'h-[400px]'
      }`}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-white/10 bg-black/50 shrink-0">
        <div className="flex items-center gap-3 flex-1">
          <div className="flex items-center gap-2">
            <TerminalIcon className="w-4 h-4 text-green-400" />
            <span className="text-sm font-medium text-white">Terminal</span>
          </div>

          {/* Terminal tabs */}
          <div className="flex items-center gap-1 ml-4">
            {terminals.map((terminal) => (
              <div
                key={terminal.id}
                className={`flex items-center gap-2 px-3 py-1 rounded-t text-xs cursor-pointer border-b-2 transition-colors ${
                  activeTerminalId === terminal.id
                    ? 'bg-white/10 border-green-400 text-white'
                    : 'border-transparent text-white/50 hover:text-white hover:bg-white/5'
                }`}
                onClick={() => setActiveTerminalId(terminal.id)}
              >
                <span className="flex items-center gap-1">
                  <span className={`w-1.5 h-1.5 rounded-full ${
                    terminal.sandboxInfo.status === 'active' ? 'bg-green-400 animate-pulse' :
                    terminal.sandboxInfo.status === 'creating' ? 'bg-yellow-400 animate-pulse' :
                    'bg-gray-400'
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
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            ))}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => createTerminal()}
              className="h-6 w-6 p-0 ml-1 text-white/50 hover:text-white"
            >
              <Plus className="w-4 h-4" />
            </Button>
          </div>

          {activeTerminal && (
            <div className="flex items-center gap-2 text-xs ml-auto">
              <span className={`flex items-center gap-1 ${
                activeTerminal.sandboxInfo.status === 'active' ? 'text-green-400' :
                activeTerminal.sandboxInfo.status === 'creating' ? 'text-yellow-400' :
                'text-gray-400'
              }`}>
                <span className="w-1.5 h-1.5 bg-current rounded-full animate-pulse" />
                {activeTerminal.sandboxInfo.status === 'active' ? 'Connected' :
                 activeTerminal.sandboxInfo.status === 'creating' ? 'Connecting...' :
                 'Ready'}
              </span>
              {activeTerminal.sandboxInfo.status === 'active' && activeTerminal.sandboxInfo.resources && (
                <>
                  <span className="text-white/30">|</span>
                  <span className="text-white/50 flex items-center gap-1">
                    <Cpu className="w-3 h-3" />
                    {activeTerminal.sandboxInfo.resources.cpu || '2 vCPU'}
                  </span>
                  <span className="text-white/50 flex items-center gap-1">
                    <MemoryStick className="w-3 h-3" />
                    {activeTerminal.sandboxInfo.resources.memory || '4 GB'}
                  </span>
                </>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={toggleSplitView}
            className={`text-white/60 hover:text-white ${
              isSplitView ? 'bg-white/10' : ''
            }`}
            title={isSplitView ? 'Disable split view' : 'Enable split view'}
          >
            <Split className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={copyOutput}
            className="text-white/60 hover:text-white"
          >
            <Copy className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => clearTerminal()}
            className="text-white/60 hover:text-white"
          >
            <Trash2 className="w-4 h-4" />
          </Button>
          {terminals.some(t => t.sandboxInfo.status === 'active') && (
            <Button
              variant="ghost"
              size="sm"
              onClick={killAllTerminals}
              className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
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
          >
            {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onMinimize}
            className="text-white/60 hover:text-white"
          >
            <Minimize2 className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="text-white/60 hover:text-white"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Terminal Content — xterm.js instances */}
      <div className={`flex flex-1 min-h-0 ${isSplitView ? 'flex-row' : 'flex-col'}`}>
        {terminals.map((terminal) => (
          <div
            key={terminal.id}
            className={`flex-1 min-h-0 ${
              !isSplitView && activeTerminalId !== terminal.id ? 'hidden' : ''
            } ${
              isSplitView && terminals.length > 1 ? 'border-r border-white/10 last:border-r-0' : ''
            }`}
          >
            <div
              ref={setXtermContainer(terminal.id)}
              className="w-full h-full"
              style={{ padding: '4px' }}
            />
          </div>
        ))}
      </div>

      {/* Status bar */}
      {activeTerminal && (
        <div className="flex items-center justify-between px-4 py-1 border-t border-white/10 bg-black/50 text-[10px] text-white/30 shrink-0">
          <span>
            {activeTerminal.isConnected
              ? `PTY ${activeTerminal.terminal?.cols || 0}×${activeTerminal.terminal?.rows || 0}`
              : 'Press any key to connect'
            }
          </span>
          {activeTerminal.sandboxInfo.sandboxId && (
            <span className="font-mono">{activeTerminal.sandboxInfo.sandboxId.slice(0, 12)}…</span>
          )}
        </div>
      )}
    </motion.div>
  );
}
