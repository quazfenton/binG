"use client";


import { useState, useEffect } from 'react';
import { toast } from 'sonner';

/**
 * Hook for managing user API keys with persistence
 * Integrates with the existing secrets system used in Settings.tsx
 */
export function useApiKeys() {
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  // Load API keys from secrets storage
  useEffect(() => {
    let cancelled = false;
    
    const loadKeys = async () => {
      try {
        if (typeof window === 'undefined') return;
        
        const { secrets } = await import('@bing/platform/secrets');
        const saved = await secrets.get('user-api-keys');
        
        if (!cancelled && saved) {
          setApiKeys(JSON.parse(saved));
        }
      } catch (e) {
        console.error('Failed to load API keys:', e);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };
    
    loadKeys();
    return () => { cancelled = true; };
  }, []);

  // Save API keys to secrets storage
  const saveApiKey = async (providerId: string, apiKey: string) => {
    try {
      if (typeof window === 'undefined') return;
      
      const { secrets } = await import('@bing/platform/secrets');
      const updatedKeys = { ...apiKeys, [providerId]: apiKey };
      
      await secrets.set('user-api-keys', JSON.stringify(updatedKeys));
      setApiKeys(updatedKeys);
      
      // Notify other components to refresh provider availability
      window.dispatchEvent(new CustomEvent('user-api-keys-changed'));
      
      return true;
    } catch (error) {
      toast.error(`Failed to save API key: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  };

  // Get API key for a specific provider
  const getApiKey = (providerId: string): string => {
    return apiKeys[providerId] || '';
  };

  // Check if API key exists for a provider
  const hasApiKey = (providerId: string): boolean => {
    return !!apiKeys[providerId];
  };

  return {
    apiKeys,
    loading,
    saveApiKey,
    getApiKey,
    hasApiKey,
  };
}