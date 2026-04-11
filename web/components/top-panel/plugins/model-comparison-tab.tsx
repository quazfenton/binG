import React, { useState, useEffect } from "react";
import { toast } from "sonner";

interface ModelProvider {
  id: string;
  name: string;
  model: string;
  provider: string;
  costPer1k: number;
  contextWindow: number;
  speed: 'fast' | 'medium' | 'slow';
}

interface ModelOutput {
  providerId: string;
  output: string;
  tokens: number;
  latency: number;
  cost: number;
}

export default function ModelComparisonTab() {
  const [models, setModels] = useState<ModelProvider[]>([]);
  const [selectedModels, setSelectedModels] = useState<string[]>([]);
  const [input, setInput] = useState('');
  const [outputs, setOutputs] = useState<ModelOutput[]>([]);
  const [loading, setLoading] = useState(false);
  const [benchmarks, setBenchmarks] = useState<any[]>([]);

  // Load available models
  useEffect(() => {
    loadModels();
    loadBenchmarks();
  }, []);

  const loadModels = async () => {
    try {
      const response = await fetch('/api/models/compare');
      const data = await response.json();
      
      if (data.success) {
        setModels(data.models || []);
      }
    } catch (err: any) {
      console.error('[ModelComparison] Failed to load models:', err);
    }
  };

  const loadBenchmarks = async () => {
    try {
      const response = await fetch('/api/models/benchmarks');
      const data = await response.json();
      
      if (data.success) {
        setBenchmarks(data.benchmarks || []);
      }
    } catch (err: any) {
      console.error('[ModelComparison] Failed to load benchmarks:', err);
    }
  };

  const handleCompare = async () => {
    if (selectedModels.length < 2) {
      toast.error('Select at least 2 models');
      return;
    }

    if (!input.trim()) {
      toast.error('Enter input text');
      return;
    }

    try {
      setLoading(true);
      
      const response = await fetch('/api/models/compare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          modelIds: selectedModels,
          input,
        }),
      });

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'Comparison failed');
      }

      setOutputs(result.outputs || []);
      toast.success('Comparison complete');
    } catch (err: any) {
      console.error('[ModelComparison] Comparison failed:', err);
      toast.error(err.message || 'Comparison failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-white/10 bg-gradient-to-r from-blue-500/10 to-purple-500/10">
        <h3 className="text-lg font-semibold text-white">Model Comparison</h3>
        <p className="text-xs text-white/60">Compare outputs from multiple LLM providers</p>
      </div>

      {/* Model Selection */}
      <div className="p-4 border-b border-white/10">
        <label className="text-sm text-white/80 mb-2 block">Select Models (min 2)</label>
        <div className="flex flex-wrap gap-2">
          {models.map(model => (
            <button
              key={model.id}
              onClick={() => {
                setSelectedModels(prev =>
                  prev.includes(model.id)
                    ? prev.filter(id => id !== model.id)
                    : [...prev, model.id]
                );
              }}
              className={`px-3 py-1.5 rounded-lg text-sm border transition-all ${
                selectedModels.includes(model.id)
                  ? 'bg-blue-500/20 border-blue-400 text-white'
                  : 'bg-white/5 border-white/10 text-white/60 hover:border-white/20'
              }`}
            >
              {model.name}
            </button>
          ))}
        </div>
        <p className="text-xs text-white/40 mt-2">{selectedModels.length} selected</p>
      </div>

      {/* Input */}
      <div className="p-4 border-b border-white/10">
        <label className="text-sm text-white/80 mb-2 block">Input Prompt</label>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Enter your prompt here..."
          className="w-full h-24 bg-white/5 border border-white/20 rounded-lg p-3 text-white text-sm focus:outline-none focus:border-blue-400"
        />
        <button
          onClick={handleCompare}
          disabled={loading || selectedModels.length < 2 || !input.trim()}
          className="mt-2 px-4 py-2 bg-blue-500 hover:bg-blue-600 disabled:bg-white/10 disabled:text-white/40 rounded-lg text-sm font-medium transition-all"
        >
          {loading ? 'Comparing...' : 'Compare Models'}
        </button>
      </div>

      {/* Outputs */}
      <div className="flex-1 overflow-auto p-4">
        {outputs.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {outputs.map((output, i) => {
              const model = models.find(m => m.id === output.providerId);
              return (
                <div
                  key={output.providerId}
                  className="bg-white/5 border border-white/10 rounded-lg p-4"
                >
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-sm font-semibold text-white">{model?.name || 'Unknown'}</h4>
                    <span className="text-xs text-white/40">{output.latency}ms</span>
                  </div>
                  <p className="text-xs text-white/80 whitespace-pre-wrap">{output.output}</p>
                  <div className="flex items-center gap-3 mt-3 text-xs text-white/40">
                    <span>{output.tokens} tokens</span>
                    <span>${output.cost.toFixed(4)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {outputs.length === 0 && !loading && (
          <div className="text-center text-white/40 py-12">
            <p>Select models and enter a prompt to compare</p>
          </div>
        )}
      </div>

      {/* Benchmarks */}
      {benchmarks.length > 0 && (
        <div className="p-4 border-t border-white/10">
          <h4 className="text-sm font-semibold text-white mb-3">Model Benchmarks</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            {benchmarks.map((benchmark, i) => (
              <div key={i} className="bg-white/5 border border-white/10 rounded-lg p-3">
                <h5 className="text-xs font-medium text-white mb-2">{benchmark.model}</h5>
                <div className="space-y-1 text-xs text-white/60">
                  <div className="flex justify-between">
                    <span>Latency:</span>
                    <span>{benchmark.avgLatency}ms</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Tokens:</span>
                    <span>{benchmark.avgTokens}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Success:</span>
                    <span>{benchmark.successRate}%</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
