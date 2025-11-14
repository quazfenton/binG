import React, { useEffect, useState } from 'react'

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
}

export const LLMSelector: React.FC<{ 
  defaultKey?: string; 
  onSelect?: (modelId: string, providerId: string) => void 
}> = ({ defaultKey, onSelect }) => {
  const [providers, setProviders] = useState<ProviderWithModels[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<string>('');
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [models, setModels] = useState<string[]>([]);

  useEffect(() => {
    const fetchProviders = async () => {
      try {
        const response = await fetch('/api/providers');
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
      setModels(provider.models);
      if (provider.models.length > 0) {
        setSelectedModel(provider.models[0]);
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
        <select 
          value={selectedModel} 
          onChange={handleModelChange}
          className="w-full p-2 border rounded"
        >
          {models.map((model) => (
            <option key={model} value={model}>
              {model}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}