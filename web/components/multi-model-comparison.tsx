"use client";

import React, { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Textarea } from './ui/textarea';
import {
  X,
  Copy,
  RefreshCw,
  Zap,
  CheckCircle,
  AlertCircle,
  Loader2,
  Sparkles,
  Trash2
} from 'lucide-react';
import type { LLMProviderConfig } from '../lib/chat/llm-providers-types';
import { useMultiRotatingStatements } from '@/hooks/use-rotating-statements';
import { clipboard } from "@bing/platform/clipboard";

interface ModelResponse {
  provider: string;
  model: string;
  response: string;
  status: 'pending' | 'streaming' | 'complete' | 'error';
  startTime: number;
  endTime?: number;
  error?: string;
}

interface MultiModelComparisonProps {
  isOpen: boolean;
  onClose: () => void;
  availableProviders: LLMProviderConfig[];
}

function RunningButton() {
  const statement = useMultiRotatingStatements(['interesting', 'task', 'funny'], 2000);
  return <>{statement}</>;
}

function StreamingIndicator() {
  const statement = useMultiRotatingStatements(['task', 'interesting'], 1500);
  return (
    <div className="flex items-center gap-2 text-purple-400 text-sm">
      <Loader2 key="streaming-spinner" className="h-4 w-4 thinking-spinner" />
      {statement}
    </div>
  );
}

export default function MultiModelComparison({
  isOpen,
  onClose,
  availableProviders,
}: MultiModelComparisonProps) {
  const [prompt, setPrompt] = useState('');
  const [selectedModels, setSelectedModels] = useState<Array<{provider: string, model: string}>>([]);
  const [responses, setResponses] = useState<ModelResponse[]>([]);
  const [isComparing, setIsComparing] = useState(false);
  const [modelToRemove, setModelToRemove] = useState<{provider: string, model: string} | null>(null);

  // Clear modelToRemove when modal closes to prevent stale state
  useEffect(() => {
    if (!isOpen) {
      setModelToRemove(null);
    }
  }, [isOpen]);

  // Get only available providers (filtered by API key configuration)
  const availableOnly = availableProviders.filter(p => p.isAvailable !== false);

  // Get failed slots that can be retried
  const failedSlots = responses.filter(r => r.status === 'error');

  const handleModelToggle = (provider: string, model: string) => {
    const existsInResponses = responses.some(r => r.provider === provider && r.model === model);

    if (existsInResponses) {
      // Show confirmation before removing a model with a complete response
      const response = responses.find(r => r.provider === provider && r.model === model);
      if (response?.status === 'complete' && response.response.trim().length > 0) {
        setModelToRemove({ provider, model });
        return;
      }
      
      // Remove without confirmation if response is empty or not complete
      setResponses(prev => prev.filter(r => !(r.provider === provider && r.model === model)));
      setSelectedModels(prev => prev.filter(m => !(m.provider === provider && m.model === model)));
    } else {
      if (responses.length < 3) {
        setResponses(prev => [...prev, {
          provider,
          model,
          response: '',
          status: 'pending',
          startTime: Date.now()
        }]);
        setSelectedModels(prev => [...prev, { provider, model }]);
      }
    }
  };

  const handleConfirmRemove = () => {
    if (modelToRemove) {
      setResponses(prev => prev.filter(r => !(r.provider === modelToRemove.provider && r.model === modelToRemove.model)));
      setSelectedModels(prev => prev.filter(m => !(m.provider === modelToRemove.provider && m.model === modelToRemove.model)));
      setModelToRemove(null);
    }
  };

  const handleCancelRemove = () => {
    setModelToRemove(null);
  };

  const handleRetryFailed = async () => {
    const toRetry = responses.filter(r => r.status === 'error' || r.status === 'pending');
    if (toRetry.length === 0 || !prompt.trim()) return;
    
    setIsComparing(true);

    const promises = toRetry.map(async (slot) => {
      const actualIndex = responses.findIndex(r => r.provider === slot.provider && r.model === slot.model);
      try {
        setResponses(prev => prev.map((r, i) => 
          i === actualIndex ? { ...r, status: 'streaming' } : r
        ));
        
        const token = (await import('@bing/platform/secrets')).secrets.get('auth-token');
        const { secrets } = await import('@bing/platform/secrets');
        const storedApiKeys = await secrets.get('user-api-keys');
        const apiKeys = storedApiKeys ? JSON.parse(storedApiKeys) : undefined;
        const response = await fetch('/api/chat', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            messages: [{ role: 'user', content: prompt }],
            provider: slot.provider,
            model: slot.model,
            temperature: 0.7,
            maxTokens: 4096,
            stream: true,
            agentMode: 'v1',
            apiKeys: Object.keys(apiKeys || {}).length > 0 ? apiKeys : undefined,
          }),
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        if (!response.body) {
          throw new Error('No response body');
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let accumulatedContent = '';
        let currentEventType = '';
        let buffer = ''; // Buffer for incomplete lines across chunks

        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            // Process any remaining buffered content
            if (buffer.trim()) {
              const trimmedLine = buffer.trim();
              if (trimmedLine.startsWith('event: ')) {
                currentEventType = trimmedLine.slice(7).trim();
              } else if (trimmedLine.startsWith('data: ')) {
                const dataStr = trimmedLine.slice(6).trim();
                if (dataStr) {
                  try {
                    const data = JSON.parse(dataStr);
                    if (currentEventType === 'token' || currentEventType === '') {
                      if (data.content) accumulatedContent += data.content;
                    } else if (currentEventType === 'done') {
                      const endTime = Date.now();
                      setResponses(prev => prev.map((r, i) =>
                        i === actualIndex ? { ...r, response: accumulatedContent || r.response, status: data.success !== false ? 'complete' : 'error', endTime } : r
                      ));
                    }
                  } catch (e) { /* Skip parse errors */ }
                }
              }
            }
            break;
          }

          const chunk = decoder.decode(value, { stream: true });
          // Prepend buffer and split by lines
          const content = buffer + chunk;
          const lines = content.split('\n');
          
          // Keep last incomplete line in buffer
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmedLine = line.trim();
            if (!trimmedLine) continue;
            
            if (trimmedLine.startsWith('event: ')) {
              currentEventType = trimmedLine.slice(7).trim();
              continue;
            }

            if (trimmedLine.startsWith('data: ')) {
              const dataStr = trimmedLine.slice(6).trim();
              if (!dataStr) continue;

              try {
                const data = JSON.parse(dataStr);
                if (currentEventType === 'token' || currentEventType === '') {
                  if (data.content) {
                    accumulatedContent += data.content;
                    setResponses(prev => prev.map((r, i) =>
                      i === actualIndex ? { ...r, response: accumulatedContent } : r
                    ));
                  }
                } else if (currentEventType === 'done') {
                  const endTime = Date.now();
                  setResponses(prev => prev.map((r, i) =>
                    i === actualIndex ? {
                      ...r,
                      response: accumulatedContent || r.response,
                      status: data.success !== false ? 'complete' : 'error',
                      endTime
                    } : r
                  ));
                }
              } catch (e) {
                // Skip parse errors for non-JSON lines
              }
            }
          }
        }

        const endTime = Date.now();
        if (accumulatedContent) {
          setResponses(prev => prev.map((r, i) =>
            i === actualIndex ? { ...r, status: 'complete', endTime } : r
          ));
        }
        
      } catch (error) {
        const endTime = Date.now();
        setResponses(prev => prev.map((r, i) => 
          i === actualIndex ? { 
            ...r, 
            status: 'error',
            error: error instanceof Error ? error.message : 'Unknown error',
            endTime
          } : r
        ));
      }
    });
    
    await Promise.all(promises);
    setIsComparing(false);
  };

  const handleCompare = async () => {
    const toRun = responses.filter(r => r.status !== 'complete');
    
    if (toRun.length === 0 && prompt.trim()) {
      setResponses(prev => prev.map(r => ({ ...r, status: 'pending', response: '', error: undefined })));
    }
    
    if ((toRun.length === 0 && responses.length === 0) || !prompt.trim()) return;

    setIsComparing(true);

    const slotsToRun = toRun.length > 0 ? toRun : responses;

    const promises = slotsToRun.map(async (slot) => {
      const actualIndex = responses.findIndex(r => r.provider === slot.provider && r.model === slot.model);
      try {
        setResponses(prev => prev.map((r, i) => 
          i === actualIndex ? { ...r, status: 'streaming' } : r
        ));
        
        const token = (await import('@bing/platform/secrets')).secrets.get('auth-token');
        const { secrets } = await import('@bing/platform/secrets');
        const storedApiKeys = await secrets.get('user-api-keys');
        const apiKeys = storedApiKeys ? JSON.parse(storedApiKeys) : undefined;
        const response = await fetch('/api/chat', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            messages: [{ role: 'user', content: prompt }],
            provider: slot.provider,
            model: slot.model,
            temperature: 0.7,
            maxTokens: 4096,
            stream: true,
            agentMode: 'v1',
            apiKeys: Object.keys(apiKeys || {}).length > 0 ? apiKeys : undefined,
          }),
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        if (!response.body) {
          throw new Error('No response body');
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let accumulatedContent = '';
        let currentEventType = '';
        let buffer = ''; // Buffer for incomplete lines across chunks

        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            // Process any remaining buffered content
            if (buffer.trim()) {
              const trimmedLine = buffer.trim();
              if (trimmedLine.startsWith('event: ')) {
                currentEventType = trimmedLine.slice(7).trim();
              } else if (trimmedLine.startsWith('data: ')) {
                const dataStr = trimmedLine.slice(6).trim();
                if (dataStr) {
                  try {
                    const data = JSON.parse(dataStr);
                    if (currentEventType === 'token' || currentEventType === '') {
                      if (data.content) accumulatedContent += data.content;
                    } else if (currentEventType === 'done') {
                      const endTime = Date.now();
                      setResponses(prev => prev.map((r, i) =>
                        i === actualIndex ? { ...r, response: accumulatedContent || r.response, status: data.success !== false ? 'complete' : 'error', endTime } : r
                      ));
                    }
                  } catch (e) { /* Skip parse errors */ }
                }
              }
            }
            break;
          }

          const chunk = decoder.decode(value, { stream: true });
          // Prepend buffer and split by lines
          const content = buffer + chunk;
          const lines = content.split('\n');
          
          // Keep last incomplete line in buffer
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmedLine = line.trim();
            if (!trimmedLine) continue;
            
            if (trimmedLine.startsWith('event: ')) {
              currentEventType = trimmedLine.slice(7).trim();
              continue;
            }

            if (trimmedLine.startsWith('data: ')) {
              const dataStr = trimmedLine.slice(6).trim();
              if (!dataStr) continue;

              try {
                const data = JSON.parse(dataStr);
                if (currentEventType === 'token' || currentEventType === '') {
                  if (data.content) {
                    accumulatedContent += data.content;
                    setResponses(prev => prev.map((r, i) =>
                      i === actualIndex ? { ...r, response: accumulatedContent } : r
                    ));
                  }
                } else if (currentEventType === 'done') {
                  const endTime = Date.now();
                  setResponses(prev => prev.map((r, i) =>
                    i === actualIndex ? {
                      ...r,
                      response: accumulatedContent || r.response,
                      status: data.success !== false ? 'complete' : 'error',
                      endTime
                    } : r
                  ));
                }
              } catch (e) {
                // Skip parse errors for non-JSON lines
              }
            }
          }
        }

        const endTime = Date.now();
        if (accumulatedContent) {
          setResponses(prev => prev.map((r, i) =>
            i === actualIndex ? { ...r, status: 'complete', endTime } : r
          ));
        }
        
      } catch (error) {
        const endTime = Date.now();
        setResponses(prev => prev.map((r, i) => 
          i === actualIndex ? { 
            ...r, 
            status: 'error',
            error: error instanceof Error ? error.message : 'Unknown error',
            endTime
          } : r
        ));
      }
    });
    
    await Promise.all(promises);
    setIsComparing(false);
  };

  const handleCopy = (text: string) => {
    clipboard.writeText(text);
  };

  const getResponseTime = (response: ModelResponse) => {
    if (response.endTime) {
      return `${response.endTime - response.startTime}ms`;
    }
    return '...';
  };

  const hasPendingOrError = responses.some(r => r.status === 'pending' || r.status === 'error');
  const hasComplete = responses.some(r => r.status === 'complete');

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.85)' }}
    >
      {/* Confirmation Dialog */}
      {modelToRemove && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/80"
            onClick={handleCancelRemove}
          />
          <div
            className="relative z-10 w-full max-w-md rounded-xl p-6"
            style={{
              background: 'linear-gradient(135deg, #1a1a1a 0%, #0a0a0a 100%)',
              border: '1px solid rgba(239,68,68,0.5)'
            }}
          >
            <div className="flex items-center gap-3 mb-4">
              <div
                className="p-2 rounded-lg"
                style={{ background: 'rgba(239,68,68,0.2)', border: '1px solid rgba(239,68,68,0.3)' }}
              >
                <Trash2 className="h-5 w-5 text-red-400" />
              </div>
              <h3 className="text-lg font-bold text-white">Remove Model Response?</h3>
            </div>
            
            <p className="text-sm text-white/70 mb-6">
              This will permanently delete the response from{' '}
              <span className="font-semibold text-white">{modelToRemove.provider}</span> ({modelToRemove.model}).
              This action cannot be undone.
            </p>
            
            <div className="flex gap-3 justify-end">
              <Button
                variant="outline"
                onClick={handleCancelRemove}
                className="border-white/20 text-white/70 hover:text-white hover:bg-white/5"
              >
                Cancel
              </Button>
              <Button
                onClick={handleConfirmRemove}
                className="bg-red-600 hover:bg-red-700 text-white"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Remove
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Main Container */}
      <div 
        className="relative w-[95vw] h-[90vh] flex flex-col rounded-2xl overflow-hidden"
        style={{ 
          background: 'linear-gradient(180deg, #0a0a0a 0%, #111111 50%, #0a0a0a 100%)',
          border: '1px solid #222'
        }}
      >
        {/* Header */}
        <div 
          className="flex items-center justify-between px-6 py-4 border-b"
          style={{ borderColor: '#222', background: 'rgba(0,0,0,0.5)' }}
        >
          <div className="flex items-center gap-3">
            <div 
              className="p-2 rounded-lg"
              style={{ background: 'linear-gradient(135deg, rgba(139,92,246,0.2) 0%, rgba(236,72,153,0.2) 100%)', border: '1px solid rgba(139,92,246,0.3)' }}
            >
              <Zap className="h-5 w-5 text-purple-400" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-purple-400" />
                Model Comparison
              </h2>
              <p className="text-xs" style={{ color: 'rgba(255,255,255,0.5)' }}>
                {responses.length} panel{responses.length !== 1 ? 's' : ''} Â· {responses.filter(r => r.status === 'complete').length} succeeded Â· {responses.filter(r => r.status === 'error').length} failed
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Badge 
              variant="outline" 
              style={{ background: 'rgba(139,92,246,0.1)', color: '#a78bfa', borderColor: 'rgba(139,92,246,0.3)' }}
            >
              {responses.length} / 3
            </Badge>
            <Button
              size="sm"
              variant="ghost"
              onClick={onClose}
              className="text-white/60 hover:text-white hover:bg-white/10"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Input Area */}
        <div className="px-6 py-4 border-b" style={{ borderColor: '#222' }}>
          <div className="flex gap-3">
            <Textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                  e.preventDefault();
                  if (prompt.trim() && responses.length > 0 && !isComparing) {
                    handleCompare();
                  }
                }
              }}
              placeholder="Enter your prompt... (Ctrl+Enter to run)"
              className="flex-1 bg-black/50 border-white/10 text-white placeholder:text-white/30 focus:border-purple-500/50 rounded-lg resize-none"
              style={{ minHeight: '80px' }}
            />
            <div className="flex flex-col gap-2">
              <Button
                onClick={handleCompare}
                disabled={!prompt.trim() || responses.length === 0 || isComparing}
                style={{ 
                  background: 'linear-gradient(135deg, #7c3aed 0%, #ec4899 100%)',
                  border: 'none'
                }}
                className="text-white gap-2 hover:opacity-90"
              >
                {isComparing ? (
                  <>
                    <Loader2 key="comparing-spinner" className="h-4 w-4 thinking-spinner" />
                    <RunningButton />
                  </>
                ) : (
                  <>
                    <Zap className="h-4 w-4" />
                    Run
                  </>
                )}
              </Button>
              {failedSlots.length > 0 && (
                <Button
                  variant="outline"
                  onClick={handleRetryFailed}
                  disabled={!prompt.trim() || isComparing}
                  style={{ 
                    borderColor: 'rgba(239,68,68,0.5)',
                    color: '#f87171',
                    background: 'rgba(239,68,68,0.1)'
                  }}
                  className="gap-2 hover:bg-red-500/20"
                >
                  <RefreshCw className="h-3 w-3" />
                  Retry Failed ({failedSlots.length})
                </Button>
              )}
              <Button
                variant="outline"
                onClick={() => {
                  setResponses([]);
                  setPrompt('');
                  setSelectedModels([]);
                }}
                disabled={responses.length === 0 || isComparing}
                className="border-white/10 text-white/60 hover:text-white hover:bg-white/5"
              >
                <RefreshCw className="h-3 w-3 mr-1" />
                Clear
              </Button>
            </div>
          </div>

          {/* Model Selection - Only show available providers */}
          <div className="mt-3 flex flex-wrap gap-2 max-h-48 overflow-y-auto">
            {availableOnly.map(provider => (
              <div key={provider.id} className="flex flex-wrap gap-1">
                {provider.models.map(model => {
                  const isSelected = responses.some(r => r.provider === provider.id && r.model === model);
                  const isDisabled = !isSelected && responses.length >= 3;
                  return (
                    <button
                      key={`${provider.id}-${model}`}
                      onClick={() => handleModelToggle(provider.id, typeof model === 'string' ? model : model.id)}
                      disabled={isDisabled}
                      className="px-3 py-1 rounded-full text-xs font-medium transition-all"
                      style={{
                        background: isSelected 
                          ? 'linear-gradient(135deg, #7c3aed 0%, #ec4899 100%)' 
                          : isDisabled 
                          ? 'rgba(255,255,255,0.05)' 
                          : 'rgba(255,255,255,0.1)',
                        color: isSelected ? 'white' : isDisabled ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.7)',
                        border: isSelected ? 'none' : '1px solid rgba(255,255,255,0.1)',
                        cursor: isDisabled ? 'not-allowed' : 'pointer'
                      }}
                    >
                      {typeof model === 'string' ? model : (model as any).name || model.id}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        {/* Response Grid */}
        <div className="flex-1 overflow-hidden p-4">
          {responses.length === 0 ? (
            <div className="h-full flex items-center justify-center">
              <div className="text-center">
                <div 
                  className="w-20 h-20 mx-auto mb-4 rounded-full flex items-center justify-center"
                  style={{ background: 'linear-gradient(135deg, rgba(139,92,246,0.2) 0%, rgba(236,72,153,0.2) 100%)', border: '1px solid rgba(139,92,246,0.2)' }}
                >
                  <Zap className="h-10 w-10 text-purple-400" />
                </div>
                <p className="text-white/50 text-sm">
                  Enter a prompt and select models to compare
                </p>
                <p className="text-white/30 text-xs mt-1">
                  Select up to 3 models
                </p>
              </div>
            </div>
          ) : (
            <div className="h-full grid" style={{ gridTemplateColumns: `repeat(${responses.length}, 1fr)`, gap: '12px' }}>
              {responses.map((response) => {
                const providerInfo = availableProviders.find(p => p.id === response.provider);
                return (
                  <div 
                    key={`${response.provider}-${response.model}`}
                    className="flex flex-col rounded-lg overflow-hidden"
                    style={{ 
                      background: 'rgba(0,0,0,0.5)',
                      border: `1px solid ${response.status === 'complete' ? 'rgba(34,197,94,0.3)' : response.status === 'error' ? 'rgba(239,68,68,0.3)' : 'rgba(255,255,255,0.1)'}`
                    }}
                  >
                    {/* Model Header */}
                    <div 
                      className="px-4 py-3 border-b flex items-center justify-between"
                      style={{ borderColor: 'rgba(255,255,255,0.05)', background: 'rgba(0,0,0,0.3)' }}
                    >
                      <div className="flex items-center gap-2">
                        <div 
                          className="w-2 h-2 rounded-full"
                          style={{
                            background: response.status === 'complete' ? '#22c55e' : 
                                       response.status === 'error' ? '#ef4444' : 
                                       response.status === 'streaming' ? '#a78bfa' : '#6b7280'
                          }}
                        />
                        <span className="text-sm font-medium text-white">
                          {providerInfo?.name || response.provider}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>
                          {getResponseTime(response)}
                        </span>
                        {response.status === 'complete' && (
                          <button
                            onClick={() => handleCopy(response.response)}
                            className="p-1 rounded hover:bg-white/10"
                            title="Copy"
                          >
                            <Copy className="h-3 w-3 text-white/50" />
                          </button>
                        )}
                      </div>
                    </div>
                    
                    {/* Model Name Subheader */}
                    <div 
                      className="px-4 py-2 border-b text-xs font-mono"
                      style={{ borderColor: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.4)' }}
                    >
                      {response.model}
                    </div>

                    {/* Response Content */}
                    <div
                      className="flex-1 p-4 overflow-auto prose prose-invert max-w-none"
                      style={{ color: 'rgba(255,255,255,0.8)' }}
                    >
                      {response.status === 'error' ? (
                        <div className="flex items-start gap-2 text-red-400 text-sm">
                          <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                          {response.error}
                        </div>
                      ) : response.status === 'pending' ? (
                        <div className="flex items-center gap-2 text-white/40 text-sm">
                          <Loader2 key={`pending-spinner-${response.provider}-${response.model}`} className="h-4 w-4 thinking-spinner" />
                          Waiting...
                        </div>
                      ) : response.status === 'streaming' ? (
                        <StreamingIndicator />
                      ) : (
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          className="text-sm font-sans"
                          components={{
                            // SSRF protection: Proxy all images through /api/image-proxy
                            img: ({ src, alt, title }) => {
                              if (!src || typeof src !== 'string') return null;

                              // Allow only http/https URLs
                              if (!/^https?:\/\//i.test(src)) {
                                return null;
                              }

                              // Proxy through image proxy for SSRF protection
                              const proxiedSrc = `/api/image-proxy?url=${encodeURIComponent(src)}`;

                              return (
                                <img
                                  src={proxiedSrc}
                                  alt={typeof alt === 'string' ? alt : ''}
                                  title={typeof title === 'string' ? title : undefined}
                                  className="max-w-full h-auto my-2 rounded border border-white/10"
                                  loading="lazy"
                                />
                              );
                            },
                            code: ({ className, children, ...props }) => {
                              const match = /language-(\w+)/.exec(className || "");
                              const isInline = Boolean((props as any).inline);
                              return !isInline && match ? (
                                <SyntaxHighlighter
                                  style={vscDarkPlus as any}
                                  language={match[1]}
                                  PreTag="div"
                                  customStyle={{
                                    fontSize: '11px',
                                    padding: '8px',
                                    borderRadius: '4px',
                                    margin: '8px 0',
                                    background: 'rgba(0,0,0,0.4)',
                                    border: '1px solid rgba(255,255,255,0.1)'
                                  }}
                                >
                                  {String(children).replace(/\n$/, "")}
                                </SyntaxHighlighter>
                              ) : (
                                <code className={`${className} bg-white/10 px-1.5 py-0.5 rounded text-xs font-mono`} {...props}>
                                  {children}
                                </code>
                              );
                            },
                            p: ({ children }) => (
                              <p className="mb-2 text-white/85 leading-relaxed">
                                {children}
                              </p>
                            ),
                            h1: ({ children }) => (
                              <h1 className="text-lg font-bold mb-3 pb-2 border-b border-white/20 text-white">
                                {children}
                              </h1>
                            ),
                            h2: ({ children }) => (
                              <h2 className="text-base font-semibold mb-2 text-white/90">
                                {children}
                              </h2>
                            ),
                            h3: ({ children }) => (
                              <h3 className="text-sm font-semibold mb-1 text-white/85">
                                {children}
                              </h3>
                            ),
                            ul: ({ children }) => (
                              <ul className="list-disc list-inside mb-2 space-y-1 text-white/85">
                                {children}
                              </ul>
                            ),
                            ol: ({ children }) => (
                              <ol className="list-decimal list-inside mb-2 space-y-1 text-white/85">
                                {children}
                              </ol>
                            ),
                            li: ({ children }) => (
                              <li className="text-white/85 pl-1">
                                {children}
                              </li>
                            ),
                            table: ({ children }) => (
                              <div className="overflow-x-auto my-3">
                                <table className="w-full border-collapse text-sm">
                                  {children}
                                </table>
                              </div>
                            ),
                            thead: ({ children }) => (
                              <thead>
                                {children}
                              </thead>
                            ),
                            tbody: ({ children }) => (
                              <tbody>
                                {children}
                              </tbody>
                            ),
                            tr: ({ children }) => (
                              <tr>
                                {children}
                              </tr>
                            ),
                            th: ({ children }) => (
                              <th className="text-left font-semibold py-2 px-3 border-b border-white/20 text-white/90 bg-white/5">
                                {children}
                              </th>
                            ),
                            td: ({ children }) => (
                              <td className="py-2 px-3 border-b border-white/10 text-white/85">
                                {children}
                              </td>
                            ),
                            blockquote: ({ children }) => (
                              <blockquote className="border-l-4 border-white/30 bg-white/5 pl-4 my-2 py-1 text-sm italic rounded-r">
                                {children}
                              </blockquote>
                            ),
                            strong: ({ children }) => (
                              <strong className="font-bold text-white/90">
                                {children}
                              </strong>
                            ),
                            em: ({ children }) => (
                              <em className="italic text-white/80">
                                {children}
                              </em>
                            ),
                          }}
                        >
                          {response.response}
                        </ReactMarkdown>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
