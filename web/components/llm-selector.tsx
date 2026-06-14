import React, { useEffect, useState } from 'react'
import { SUBPROVIDER_LABELS, fuzzyMatchModel } from '@/lib/providers/subprovider-labels'
import Search from 'lucide-react/dist/esm/icons/search'
import X from 'lucide-react/dist/esm/icons/x'

interface ProviderModel {
  id: string;
  name: string;
  models: string[];
  supportsStreaming: boolean;
  description: string;
}

interface ProviderWithModels {
  id: string;
  name: string;
  models: string[];
  supportsStreaming: boolean;
  description: string;
  subProviders?: string[];
}

export const LLMSelector: React.FC<{ 
  defaultKey?: string; 
  onSelect?: (modelId: string, providerId: string) => void 
}> = ({ defaultKey, onSelect }) => {
  const [providers, setProviders] = useState<ProviderWithModels[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<string>('');
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [models, setModels] = useState<string[]>([]);
  const [modelSearch, setModelSearch] = useState('');

  useEffect(() => {
    const fetchProviders = async () => {
      try {
        const response = await fetch('/api/providers', { credentials: 'include' });
        if (response.ok) {
          const data = await response.json();
          if (data.success) {
            setProviders(data.data.providers);
            
            // Set default provider if available
            if (data.data.providers.length > 0) {
              const defaultProvider = data.data.providers.find(
                p => p.id === data.data.defaultProvider
              ) || data.data.providers[0];
              
              setSelectedProvider(defaultProvider.id);
              
              // Set models for the selected provider
              setModels(defaultProvider.models);
              if (defaultProvider.models.length > 0) {
                const defaultModel = defaultProvider.models.find(
                  m => m === data.data.defaultModel
                ) || defaultProvider.models[0];
                setSelectedModel(defaultModel);
              }
            }
          }
        }
      } catch (error) {
        console.error('Error fetching providers:', error);
      }
    };

    fetchProviders();
  }, []);

  useEffect(() => {
    // Update models when selected provider changes
    const provider = providers.find(p => p.id === selectedProvider);
    if (provider) {
      // Filter models by subProviders if available (for ninerouter provider)
      const subFiltered = provider.subProviders?.length
        ? provider.models.filter((model: string) => {
            const [prefix] = model.split('/');
            return provider.subProviders!.includes(prefix);
          })
        : provider.models;
      setModels(subFiltered);
      if (subFiltered.length > 0) {
        setSelectedModel(subFiltered[0]);
      } else {
        setSelectedModel('');
      }
    } else {
      setModels([]);
      setSelectedModel('');
    }
  }, [selectedProvider, providers]);

  const handleProviderChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const providerId = e.target.value;
    setSelectedProvider(providerId);
  };

  const handleModelChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const modelId = e.target.value;
    setSelectedModel(modelId);
    onSelect?.(modelId, selectedProvider);
  };

  return (
    <div className="space-y-2">
      <div>
        <label className="block text-sm font-medium mb-1">Provider</label>
        <select 
          value={selectedProvider} 
          onChange={handleProviderChange}
          className="w-full p-2 border rounded"
        >
          {providers.map((provider) => (
            <option key={provider.id} value={provider.id}>
              {provider.name}
            </option>
          ))}
        </select>
      </div>
      
      <div>
        <label className="block text-sm font-medium mb-1">Model</label>
        {/* Search filter input */}
        <div className="relative mb-1.5">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/30" />
          <input
            type="text"
            placeholder="Filter models..."
            value={modelSearch}
            onChange={(e) => setModelSearch(e.target.value)}
            className="w-full pl-7 pr-7 py-1.5 text-xs bg-white/5 border border-white/10 rounded outline-none focus:border-white/20 text-white/80 placeholder:text-white/30"
          />
          {modelSearch && (
            <button
              type="button"
              onClick={() => setModelSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
        <select 
          value={selectedModel} 
          onChange={handleModelChange}
          className="w-full p-2 border rounded"
        >
          {(() => {
            const searchTerm = modelSearch.toLowerCase().trim();
            const provider = providers.find(p => p.id === selectedProvider);
            // Filter models by search term
            const visibleModels = searchTerm
              ? models.filter((m) => fuzzyMatchModel(m, searchTerm))
              : models;
            // When searching, show a flat list without optgroup for easy scanning
            if (searchTerm) {
              if (visibleModels.length === 0) {
                return <option disabled>No models found</option>;
              }
              return visibleModels.map((model) => (
                <option key={model} value={model}>{model}</option>
              ));
            }
            if (provider?.subProviders?.length) {
              // Group models by sub-provider prefix
              const grouped = new Map<string, string[]>();
              for (const model of visibleModels) {
                const [prefix] = model.split('/');
                if (!grouped.has(prefix)) grouped.set(prefix, []);
                grouped.get(prefix)!.push(model);
              }
              return Array.from(grouped.entries()).map(([prefix, groupModels]) => (
                <optgroup key={prefix} label={SUBPROVIDER_LABELS[prefix] || prefix}>
                  {groupModels.map((model) => (
                    <option key={model} value={model}>{model}</option>
                  ))}
                </optgroup>
              ));
            }
            return visibleModels.map((model) => (
              <option key={model} value={model}>{model}</option>
            ));
          })()}
        </select>
      </div>
    </div>
  )
}
