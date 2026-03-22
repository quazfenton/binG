"use client";

import React, { useState, useEffect } from 'react';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Textarea } from './ui/textarea';
import { 
  X, 
  Copy, 
  RefreshCw, 
  Zap,
  Clock,
  CheckCircle,
  AlertCircle,
  Loader2,
  Sparkles
} from 'lucide-react';
import type { LLMProvider } from '../lib/chat/llm-providers';

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
  availableProviders: LLMProvider[];
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

  // Get only available providers (filtered by API key configuration)
  const availableOnly = availableProviders.filter(p => p.isAvailable !== false);

  // Get failed slots that can be retried
  const failedSlots = responses.filter(r => r.status === 'error');

  const handleModelToggle = (provider: string, model: string) => {
    const existsInResponses = responses.some(r => r.provider === provider && r.model === model);
    
    if (existsInResponses) {
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

  const handleRetryFailed = async () => {
    const toRetry = responses.filter(r => r.status === 'error' || r.status === 'pending');
    if (toRetry.length === 0 || !prompt.trim()) return;
    
    setIsComparing(true);
    
    const promises = toRetry.map(async (slot, idx) => {
      const actualIndex = responses.findIndex(r => r.provider === slot.provider && r.model === slot.model);
      try {
        setResponses(prev => prev.map((r, i) => 
          i === actualIndex ? { ...r, status: 'streaming' } : r
        ));
        
        const token = localStorage.getItem('token');
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
            stream: false,
            agentMode: 'v1'
          }),
        });

        const data = await response.json();
        const endTime = Date.now();
        
        const content = data.success 
          ? (data.data?.content || data.content || data.response || data.message || JSON.stringify(data, null, 2))
          : (data.error?.message || JSON.stringify(data));
        
        setResponses(prev => prev.map((r, i) =>
          i === actualIndex ? {
            ...r,
            response: content,
            status: data.success ? 'complete' : 'error',
            endTime
          } : r
        ));
        
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
    if (toRun.length === 0 || !prompt.trim()) return;
    
    setIsComparing(true);
    
    const promises = toRun.map(async (slot) => {
      const actualIndex = responses.findIndex(r => r.provider === slot.provider && r.model === slot.model);
      try {
        setResponses(prev => prev.map((r, i) => 
          i === actualIndex ? { ...r, status: 'streaming' } : r
        ));
        
        const token = localStorage.getItem('token');
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
            stream: false,
            agentMode: 'v1'
          }),
        });

        const data = await response.json();
        const endTime = Date.now();
        
        const content = data.success 
          ? (data.data?.content || data.content || data.response || data.message || JSON.stringify(data, null, 2))
          : (data.error?.message || JSON.stringify(data));
        
        setResponses(prev => prev.map((r, i) =>
          i === actualIndex ? {
            ...r,
            response: content,
            status: data.success ? 'complete' : 'error',
            endTime
          } : r
        ));
        
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
    navigator.clipboard.writeText(text);
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
                {responses.length} panel{responses.length !== 1 ? 's' : ''} · {responses.filter(r => r.status === 'complete').length} succeeded · {responses.filter(r => r.status === 'error').length} failed
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
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Running
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
          <div className="mt-3 flex flex-wrap gap-2">
            {availableOnly.map(provider => (
              <div key={provider.id} className="flex flex-wrap gap-1">
                {provider.models.slice(0, 5).map(model => {
                  const isSelected = responses.some(r => r.provider === provider.id && r.model === model);
                  const isDisabled = !isSelected && responses.length >= 3;
                  return (
                    <button
                      key={`${provider.id}-${model}`}
                      onClick={() => handleModelToggle(provider.id, model)}
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
                      {model}
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
                      className="flex-1 p-4 overflow-auto"
                      style={{ color: 'rgba(255,255,255,0.8)' }}
                    >
                      {response.status === 'error' ? (
                        <div className="flex items-start gap-2 text-red-400 text-sm">
                          <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                          {response.error}
                        </div>
                      ) : response.status === 'pending' ? (
                        <div className="flex items-center gap-2 text-white/40 text-sm">
                          <Clock className="h-4 w-4" />
                          Waiting...
                        </div>
                      ) : response.status === 'streaming' ? (
                        <div className="flex items-center gap-2 text-purple-400 text-sm">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Generating...
                        </div>
                      ) : (
                        <pre className="whitespace-pre-wrap text-sm font-sans" style={{ color: 'rgba(255,255,255,0.85)' }}>
                          {response.response}
                        </pre>
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
