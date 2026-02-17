'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { 
  Terminal, X, Minimize2, Maximize2, Play, Square, 
  Trash2, Copy, ChevronUp, ChevronDown, Command,
  Cpu, MemoryStick, HardDrive
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

export default function TerminalPanel({
  userId,
  isOpen,
  onClose,
  onMinimize,
  isMinimized = false
}: TerminalPanelProps) {
  const [outputs, setOutputs] = useState<TerminalOutput[]>([]);
  const [input, setInput] = useState('');
  const [isExecuting, setIsExecuting] = useState(false);
  const [sandboxInfo, setSandboxInfo] = useState<SandboxInfo>({ status: 'none' });
  const [isExpanded, setIsExpanded] = useState(false);
  const [outputCounter, setOutputCounter] = useState(0);
  const terminalRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Initialize sandbox session when panel opens
  useEffect(() => {
    if (isOpen && userId && sandboxInfo.status === 'none') {
      initializeSandbox();
    }
  }, [isOpen, userId]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [outputs]);

  // Focus input when opened
  useEffect(() => {
    if (isOpen && !isMinimized && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen, isMinimized]);

  const initializeSandbox = async () => {
    if (!userId) {
      addOutput('system', 'Please sign in to use the terminal');
      return;
    }

    setSandboxInfo({ status: 'creating' });
    addOutput('system', 'Initializing sandbox environment...');

    try {
      const response = await fetch('/api/sandbox/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId })
      });

      if (response.ok) {
        const data = await response.json();
        setSandboxInfo({
          sessionId: data.session.sessionId,
          sandboxId: data.session.sandboxId,
          status: 'active',
          resources: data.session.resources
        });
        addOutput('system', `✓ Sandbox ready (${data.session.sandboxId})`);
        addOutput('system', 'Type commands to execute in the sandbox environment');
      } else {
        throw new Error('Failed to create sandbox');
      }
    } catch (error) {
      setSandboxInfo({ status: 'error' });
      addOutput('error', 'Failed to initialize sandbox. Please try again.');
    }
  };

  const addOutput = (type: TerminalOutput['type'], content: string) => {
    setOutputs(prev => [...prev, {
      id: `output-${Date.now()}-${prev.length}`,
      type,
      content,
      timestamp: new Date()
    }]);
  };

  const executeCommand = async (command: string) => {
    if (!command.trim() || isExecuting) return;
    if (!userId || !sandboxInfo.sandboxId) {
      addOutput('error', 'Sandbox not initialized');
      return;
    }

    setIsExecuting(true);
    addOutput('command', `$ ${command}`);

    try {
      const response = await fetch('/api/sandbox/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          command,
          sandboxId: sandboxInfo.sandboxId
        })
      });

      if (response.ok) {
        const data = await response.json();
        if (data.stdout) addOutput('output', data.stdout);
        if (data.stderr) addOutput('error', data.stderr);
        if (!data.stdout && !data.stderr) addOutput('output', '(no output)');
      } else {
        throw new Error('Execution failed');
      }
    } catch (error) {
      addOutput('error', `Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsExecuting(false);
      setInput('');
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    executeCommand(input);
  };

  const clearTerminal = () => {
    setOutputs([]);
    toast.info('Terminal cleared');
  };

  const copyOutput = async () => {
    const text = outputs.map(o => o.content).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Copied to clipboard');
    } catch {
      toast.error('Failed to copy to clipboard');
    }
  };

  const killSandbox = async () => {
    if (!sandboxInfo.sessionId || !sandboxInfo.sandboxId) return;

    try {
      await fetch('/api/sandbox/session', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: sandboxInfo.sessionId,
          sandboxId: sandboxInfo.sandboxId
        })
      });
      setSandboxInfo({ status: 'none' });
      setOutputs([]);
      toast.success('Sandbox terminated');
    } catch (error) {
      toast.error('Failed to terminate sandbox');
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
            {sandboxInfo.status === 'active' && (
              <span className="text-xs text-green-400 flex items-center gap-1">
                <span className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse" />
                Active
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
      className={`fixed bottom-0 left-0 right-0 z-50 bg-black/95 border-t border-white/10 backdrop-blur-sm ${
        isExpanded ? 'h-[80vh]' : 'h-[400px]'
      }`}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-white/10 bg-black/50">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Terminal className="w-4 h-4 text-green-400" />
            <span className="text-sm font-medium text-white">Terminal</span>
          </div>
          
          {sandboxInfo.status === 'active' && (
            <div className="flex items-center gap-2 text-xs">
              <span className="flex items-center gap-1 text-green-400">
                <span className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse" />
                Active
              </span>
              {sandboxInfo.resources && (
                <>
                  <span className="text-white/30">|</span>
                  <span className="text-white/50 flex items-center gap-1">
                    <Cpu className="w-3 h-3" />
                    {sandboxInfo.resources.cpu || '1 vCPU'}
                  </span>
                  <span className="text-white/50 flex items-center gap-1">
                    <MemoryStick className="w-3 h-3" />
                    {sandboxInfo.resources.memory || '2 GB'}
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
            onClick={copyOutput}
            className="text-white/60 hover:text-white"
          >
            <Copy className="w-4 h-4" />
          </Button>
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={clearTerminal}
            className="text-white/60 hover:text-white"
          >
            <Trash2 className="w-4 h-4" />
          </Button>
          {sandboxInfo.status === 'active' && (
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={killSandbox}
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

      {/* Terminal Output */}
      <div 
        ref={terminalRef}
        className="flex-1 overflow-y-auto p-4 font-mono text-sm"
        style={{ height: isExpanded ? 'calc(80vh - 120px)' : 'calc(400px - 120px)' }}
      >
        {outputs.length === 0 ? (
          <div className="text-white/30 text-center py-8">
            <Command className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p>Welcome to the sandbox terminal</p>
            <p className="text-xs mt-1">Type commands to execute in an isolated environment</p>
            {!userId && (
              <p className="text-yellow-400/60 text-xs mt-4">Please sign in to use the terminal</p>
            )}
          </div>
        ) : (
          outputs.map((output) => (
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
        {isExecuting && (
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
      <form onSubmit={handleSubmit} className="absolute bottom-0 left-0 right-0 p-3 bg-black/50 border-t border-white/10">
        <div className="flex items-center gap-2">
          <span className="text-green-400 font-mono">$</span>
          <Input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={sandboxInfo.status === 'active' ? "Type a command..." : "Initializing..."}
            disabled={isExecuting || sandboxInfo.status !== 'active'}
            className="flex-1 bg-transparent border-0 focus-visible:ring-0 text-white font-mono placeholder:text-white/30"
            autoComplete="off"
            spellCheck="false"
          />
          <Button 
            type="submit" 
            size="sm"
            disabled={isExecuting || !input.trim() || sandboxInfo.status !== 'active'}
            className="bg-green-600 hover:bg-green-700"
          >
            {isExecuting ? (
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
          <span>Press Enter to execute • Ctrl+C to cancel</span>
          {sandboxInfo.sandboxId && (
            <span className="font-mono">{sandboxInfo.sandboxId.slice(0, 8)}...</span>
          )}
        </div>
      </form>
    </motion.div>
  );
}
