'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Terminal, X, Minimize2, Maximize2, Play, Square,
  Trash2, Copy, ChevronUp, ChevronDown, Command,
  Cpu, MemoryStick, HardDrive, Plus, Split
} from 'lucide-react';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';

interface TerminalPanelProps {
  userId?: string;
  isOpen: boolean;
  onClose: () => void;
  onMinimize?: () => void;
  isMinimized?: boolean;
}

interface TerminalOutput {
  id: string;
  type: 'command' | 'output' | 'error' | 'system';
  content: string;
  timestamp: Date;
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
  outputs: TerminalOutput[];
  input: string;
  isExecuting: boolean;
  sandboxInfo: SandboxInfo;
  terminalRef: React.RefObject<HTMLDivElement>;
  inputRef: React.RefObject<HTMLInputElement>;
  commandHistory: string[];
  historyIndex: number;
  autocompleteSuggestion: string;
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

  // Auto-create terminal when panel opens and no terminals exist
  useEffect(() => {
    if (isOpen && terminals.length === 0) {
      createTerminal('Terminal 1');
    }
  }, [isOpen]);

  // Auto-scroll all terminals
  useEffect(() => {
    terminals.forEach(term => {
      if (term.terminalRef.current) {
        term.terminalRef.current.scrollTop = term.terminalRef.current.scrollHeight;
      }
    });
  }, [terminals]);

  // Focus active terminal input
  useEffect(() => {
    const activeTerminal = terminals.find(t => t.id === activeTerminalId);
    if (isOpen && !isMinimized && activeTerminal?.inputRef.current) {
      activeTerminal.inputRef.current.focus();
    }
  }, [isOpen, isMinimized, activeTerminalId, terminals]);

  const createTerminal = (name?: string) => {
    const newTerminal: TerminalInstance = {
      id: `terminal-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      name: name || `Terminal ${terminals.length + 1}`,
      outputs: [],
      input: '',
      isExecuting: false,
      sandboxInfo: { status: 'none' },
      terminalRef: React.createRef<HTMLDivElement>(),
      inputRef: React.createRef<HTMLInputElement>(),
      commandHistory: [],
      historyIndex: -1,
      autocompleteSuggestion: ''
    };

    setTerminals(prev => {
      const updated = [...prev, newTerminal];
      setActiveTerminalId(newTerminal.id);
      return updated;
    });

    return newTerminal.id;
  };

  const closeTerminal = (terminalId: string) => {
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
  };

  const updateTerminal = (terminalId: string, updates: Partial<TerminalInstance>) => {
    setTerminals(prev => prev.map(t => 
      t.id === terminalId ? { ...t, ...updates } : t
    ));
  };

  const getActiveTerminal = () => {
    return terminals.find(t => t.id === activeTerminalId);
  };

  const initializeTerminalSandbox = async (terminalId: string) => {
    const devUserId = userId || 'dev-anonymous-user';
    
    updateTerminal(terminalId, { 
      sandboxInfo: { status: 'creating' } 
    });
    addOutput(terminalId, 'system', 'Initializing sandbox environment...');

    try {
      const response = await fetch('/api/sandbox/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: devUserId })
      });

      if (response.ok) {
        const data = await response.json();
        updateTerminal(terminalId, {
          sandboxInfo: {
            sessionId: data.session.sessionId,
            sandboxId: data.session.sandboxId,
            status: 'active',
            resources: data.session.resources
          }
        });
        addOutput(terminalId, 'system', `✓ Sandbox ready (${data.session.sandboxId})`);
        if (!userId) {
          addOutput(terminalId, 'system', '⚠️ Dev mode: Anonymous session (sign in for persistence)');
        }
      } else {
        throw new Error('Failed to create sandbox');
      }
    } catch (error) {
      updateTerminal(terminalId, { sandboxInfo: { status: 'error' } });
      addOutput(terminalId, 'error', 'Failed to initialize sandbox. Please try again.');
    }
  };

  const addOutput = (terminalId: string, type: TerminalOutput['type'], content: string) => {
    setTerminals(prev => prev.map(t => {
      if (t.id !== terminalId) return t;
      return {
        ...t,
        outputs: [...t.outputs, {
          id: `output-${Date.now()}-${t.outputs.length}`,
          type,
          content,
          timestamp: new Date()
        }]
      };
    }));
  };

  const executeCommand = async (command: string) => {
    const activeTerminal = getActiveTerminal();
    if (!activeTerminal || !command.trim()) return;
    
    // Initialize sandbox on first command if not already done
    if (!activeTerminal.sandboxInfo.sandboxId || activeTerminal.sandboxInfo.status !== 'active') {
      await initializeTerminalSandbox(activeTerminal.id);
      // If sandbox init failed, don't proceed
      const updatedTerminal = getActiveTerminal();
      if (!updatedTerminal?.sandboxInfo.sandboxId || updatedTerminal.sandboxInfo.status !== 'active') {
        return;
      }
    }
    
    if (activeTerminal.isExecuting) return;

    // Add command to history
    updateTerminal(activeTerminal.id, {
      commandHistory: [...activeTerminal.commandHistory, command].slice(-100), // Keep last 100 commands
      historyIndex: -1,
      autocompleteSuggestion: ''
    });

    updateTerminal(activeTerminal.id, { isExecuting: true });
    addOutput(activeTerminal.id, 'command', `$ ${command}`);

    try {
      const response = await fetch('/api/sandbox/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          command,
          sandboxId: activeTerminal.sandboxInfo.sandboxId
        })
      });

      if (response.ok) {
        const data = await response.json();
        if (data.stdout) addOutput(activeTerminal.id, 'output', data.stdout);
        if (data.stderr) addOutput(activeTerminal.id, 'error', data.stderr);
        if (!data.stdout && !data.stderr) addOutput(activeTerminal.id, 'output', '(no output)');
      } else {
        throw new Error('Execution failed');
      }
    } catch (error) {
      addOutput(activeTerminal.id, 'error', `Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      updateTerminal(activeTerminal.id, { isExecuting: false, input: '' });
    }
  };

  const handleInputChange = (terminalId: string, value: string) => {
    const terminal = terminals.find(t => t.id === terminalId);
    if (!terminal) return;

    // Find autocomplete suggestion from history
    let suggestion = '';
    if (value.length > 0) {
      const matchingCommand = terminal.commandHistory
        .slice()
        .reverse()
        .find(cmd => cmd.toLowerCase().startsWith(value.toLowerCase()));
      if (matchingCommand) {
        suggestion = matchingCommand.slice(value.length);
      }
    }

    updateTerminal(terminalId, { 
      input: value,
      autocompleteSuggestion: suggestion,
      historyIndex: -1 // Reset history index when typing new input
    });
  };

  const handleInputKeyDown = (e: React.KeyboardEvent, terminalId: string) => {
    const terminal = terminals.find(t => t.id === terminalId);
    if (!terminal) return;

    // Handle Tab or Right Arrow for autocomplete
    if ((e.key === 'Tab' || e.key === 'ArrowRight') && terminal.autocompleteSuggestion) {
      e.preventDefault();
      updateTerminal(terminalId, {
        input: terminal.input + terminal.autocompleteSuggestion,
        autocompleteSuggestion: ''
      });
      return;
    }

    // Handle Arrow Up for history navigation
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (terminal.commandHistory.length === 0) return;

      const newIndex = terminal.historyIndex === -1 
        ? terminal.commandHistory.length - 1 
        : Math.max(0, terminal.historyIndex - 1);
      
      updateTerminal(terminalId, {
        input: terminal.commandHistory[newIndex],
        historyIndex: newIndex,
        autocompleteSuggestion: ''
      });
      return;
    }

    // Handle Arrow Down for history navigation
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (terminal.historyIndex === -1) return;

      const newIndex = terminal.historyIndex + 1;
      if (newIndex >= terminal.commandHistory.length) {
        // End of history, clear input
        updateTerminal(terminalId, {
          input: '',
          historyIndex: -1,
          autocompleteSuggestion: ''
        });
      } else {
        updateTerminal(terminalId, {
          input: terminal.commandHistory[newIndex],
          historyIndex: newIndex,
          autocompleteSuggestion: ''
        });
      }
      return;
    }
  };

  const handleSubmit = (e: React.FormEvent, terminalId: string) => {
    e.preventDefault();
    const terminal = terminals.find(t => t.id === terminalId);
    if (terminal) {
      executeCommand(terminal.input);
    }
  };

  const clearTerminal = (terminalId?: string) => {
    if (terminalId) {
      updateTerminal(terminalId, { outputs: [] });
    } else {
      setTerminals(prev => prev.map(t => ({ ...t, outputs: [] })));
    }
    toast.info('Terminal cleared');
  };

  const copyOutput = async () => {
    const text = terminals.flatMap(t => t.outputs).map(o => o.content).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Copied to clipboard');
    } catch {
      toast.error('Failed to copy to clipboard');
    }
  };

  const killTerminal = async (terminalId: string) => {
    const terminal = terminals.find(t => t.id === terminalId);
    if (!terminal?.sandboxInfo?.sessionId || !terminal?.sandboxInfo?.sandboxId) return;

    try {
      await fetch('/api/sandbox/session', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: terminal.sandboxInfo.sessionId,
          sandboxId: terminal.sandboxInfo.sandboxId
        })
      });
      closeTerminal(terminalId);
      toast.success('Terminal closed');
    } catch (error) {
      toast.error('Failed to close terminal');
    }
  };

  const killAllTerminals = async () => {
    for (const terminal of terminals) {
      if (terminal.sandboxInfo.sessionId && terminal.sandboxInfo.sandboxId) {
        try {
          await fetch('/api/sandbox/session', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              sessionId: terminal.sandboxInfo.sessionId,
              sandboxId: terminal.sandboxInfo.sandboxId
            })
          });
        } catch (error) {
          // Continue closing others
        }
      }
    }
    setTerminals([]);
    setActiveTerminalId(null);
    setIsSplitView(false);
    toast.success('All terminals closed');
  };

  const toggleSplitView = () => {
    if (isSplitView) {
      // Close one terminal when disabling split view
      if (terminals.length > 1) {
        const toClose = terminals[terminals.length - 1];
        killTerminal(toClose.id);
      }
      setIsSplitView(false);
    } else {
      // Open second terminal
      if (terminals.length < 2) {
        createTerminal('Terminal 2');
      }
      setIsSplitView(true);
    }
  };

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
            <Terminal className="w-4 h-4 text-green-400" />
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

  const activeTerminal = getActiveTerminal();

  return (
    <motion.div
      initial={{ y: 100, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 100, opacity: 0 }}
      className={`fixed bottom-0 left-0 right-0 z-50 bg-black/95 border-t border-white/10 backdrop-blur-sm ${
        isExpanded ? 'h-[80vh]' : 'h-[400px]'
      }`}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-white/10 bg-black/50">
        <div className="flex items-center gap-3 flex-1">
          <div className="flex items-center gap-2">
            <Terminal className="w-4 h-4 text-green-400" />
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
                    {activeTerminal.sandboxInfo.resources.cpu || '1 vCPU'}
                  </span>
                  <span className="text-white/50 flex items-center gap-1">
                    <MemoryStick className="w-3 h-3" />
                    {activeTerminal.sandboxInfo.resources.memory || '2 GB'}
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

      {/* Terminal Output - Split View */}
      <div className={`flex ${isSplitView ? 'flex-row' : 'flex-col'} h-full`}>
        {terminals.map((terminal) => (
          <div
            key={terminal.id}
            className={`flex-1 flex flex-col min-h-0 ${
              !isSplitView && activeTerminalId !== terminal.id ? 'hidden' : ''
            } ${
              isSplitView && terminals.length > 1 ? 'border-r border-white/10 last:border-r-0' : ''
            }`}
          >
            <div
              ref={terminal.terminalRef}
              className="flex-1 overflow-y-auto p-4 font-mono text-sm min-h-0"
              style={{ maxHeight: isExpanded ? 'calc(80vh - 220px)' : 'calc(400px - 220px)' }}
            >
              {terminal.outputs.length === 0 ? (
                <div className="text-white/30 text-center py-8">
                  <Command className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p>Welcome to {terminal.name}</p>
                  <p className="text-xs mt-1">Type commands to execute</p>
                  <p className="text-xs mt-1 text-white/50">Sandbox will connect on first command</p>
                </div>
              ) : (
                terminal.outputs.map((output) => (
                  <div key={output.id} className="mb-1">
                    {output.type === 'command' && (
                      <div className="text-green-400">{output.content}</div>
                    )}
                    {output.type === 'output' && (
                      <div className="text-white/80 whitespace-pre-wrap">{output.content}</div>
                    )}
                    {output.type === 'error' && (
                      <div className="text-red-400 whitespace-pre-wrap">{output.content}</div>
                    )}
                    {output.type === 'system' && (
                      <div className="text-yellow-400/80 italic">{output.content}</div>
                    )}
                  </div>
                ))
              )}
              {terminal.isExecuting && (
                <div className="flex items-center gap-2 text-white/50 mt-2">
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                    className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full"
                  />
                  <span>Executing...</span>
                </div>
              )}
            </div>

            {/* Input */}
            <form
              onSubmit={(e) => handleSubmit(e, terminal.id)}
              className="p-3 bg-black/50 border-t border-white/10"
            >
              <div className="flex items-center gap-2 relative">
                <span className="text-green-400 font-mono shrink-0">$</span>
                <div className="relative flex-1 font-mono">
                  {/* Autocomplete suggestion (ghost text) - rendered behind input */}
                  {terminal.autocompleteSuggestion && (
                    <span className="absolute inset-0 text-white/40 pointer-events-none whitespace-pre overflow-hidden px-3" aria-hidden="true">
                      {terminal.input}{terminal.autocompleteSuggestion}
                    </span>
                  )}
                  <Input
                    ref={terminal.inputRef}
                    value={terminal.input}
                    onChange={(e) => handleInputChange(terminal.id, e.target.value)}
                    onKeyDown={(e) => handleInputKeyDown(e, terminal.id)}
                    placeholder={terminal.sandboxInfo.status === 'active' ? "Type a command..." :
                                 terminal.sandboxInfo.status === 'creating' ? "Connecting..." :
                                 "Type a command (sandbox will connect)..."}
                    disabled={terminal.isExecuting || terminal.sandboxInfo.status === 'error'}
                    className="flex-1 bg-transparent border-0 focus-visible:ring-0 text-white font-mono placeholder:text-white/30 relative z-10"
                    autoComplete="off"
                    spellCheck="false"
                    autoCorrect="off"
                    autoCapitalize="off"
                    data-terminal-input
                  />
                </div>
                <Button
                  type="submit"
                  size="sm"
                  disabled={terminal.isExecuting || !terminal.input.trim() || terminal.sandboxInfo.status === 'error'}
                  className="bg-green-600 hover:bg-green-700 shrink-0"
                >
                  {terminal.isExecuting ? (
                    <motion.div
                      animate={{ rotate: 360 }}
                      transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                      className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full"
                    />
                  ) : (
                    <Play className="w-4 h-4" />
                  )}
                </Button>
              </div>
              <div className="flex items-center justify-between mt-1 text-[10px] text-white/30">
                <span>↑↓ History • Tab/→ Complete • Enter Execute</span>
                {terminal.sandboxInfo.sandboxId && (
                  <span className="font-mono">{terminal.sandboxInfo.sandboxId.slice(0, 8)}...</span>
                )}
              </div>
            </form>
          </div>
        ))}
      </div>
    </motion.div>
  );
}
