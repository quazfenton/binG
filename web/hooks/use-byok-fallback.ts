use client;

import { useState, useEffect } from 'react';
import { useApiKeys } from './use-api-keys';

/**
 * Hook for managing BYOK (Bring Your Own Key) fallback UX
 * Tracks consecutive failures and shows BYOK input when appropriate
 */
export function useBYOKFallback() {
  const [failureCount, setFailureCount] = useState<Record<string, number>>({});
  const [showBYOKInput, setShowBYOKInput] = useState(false);
  const [byokError, setByokError] = useState<{
    providerId: string;
    providerName: string;
    errorMessage: string;
  } | null>(null);
  
  const { apiKeys, saveApiKey, getApiKey, hasApiKey } = useApiKeys();
  
  // Reset failure count when keys change (user added a key)
  useEffect(() => {
    // Listen for key changes
    const handleKeyChange = () => {
      setFailureCount({});
    };
    
    window.addEventListener('user-api-keys-changed', handleKeyChange);
    return () => {
      window.removeEventListener('user-api-keys-changed', handleKeyChange);
    };
  }, []);
  
  // Handle API key save from BYOK input
  const handleApiKeySave = async (providerId: string, apiKey: string) => {
    const success = await saveApiKey(providerId, apiKey);
    if (success) {
      setShowBYOKInput(false);
      setByokError(null);
      setFailureCount({}); // Reset failure count
      // Refresh the page to use the new key
      window.location.reload();
    }
  };
  
  // Handle retry with same key
  const handleRetry = () => {
    setShowBYOKInput(false);
    setByokError(null);
    // Re-attempt the generation with the existing key
    // The calling component should trigger the retry
  };
  
  // Record a failure for a specific provider
  const recordFailure = (providerId: string, error: Error) => {
    const providerName = getProviderName(providerId);
    const errorMessage = error.message;
    
    // Check if this is a key-related error
    const isKeyError = isKeyRelatedError(errorMessage);
    
    if (isKeyError) {
      setFailureCount(prev => ({
        ...prev,
        [providerId]: (prev[providerId] || 0) + 1
      }));
      
      // For LLM chat, require 3 consecutive failures
      // For image/video, show on first failure
      const requiredFailures = isLLMProvider(providerId) ? 3 : 1;
      
      if ((failureCount[providerId] || 0) + 1 >= requiredFailures) {
        // Check if user already has a key for this provider
        const existingKey = getApiKey(providerId);
        let customErrorMessage = errorMessage;
        
        if (existingKey) {
          customErrorMessage = `Request failed with your ${providerName} API key. The key may be invalid, expired, or have insufficient credits.`;
        } else {
          customErrorMessage = `No ${providerName} API key configured. Please enter your API key to use this provider.`;
        }
        
        setByokError({
          providerId,
          providerName,
          errorMessage: customErrorMessage
        });
        setShowBYOKInput(true);
      }
    }
  };
  
  // Reset failure count for a provider
  const resetFailureCount = (providerId: string) => {
    setFailureCount(prev => {
      const newCount = { ...prev };
      delete newCount[providerId];
      return newCount;
    });
  };
  
  return {
    showBYOKInput,
    byokError,
    setShowBYOKInput,
    setByokError,
    recordFailure,
    resetFailureCount,
    handleApiKeySave,
    handleRetry,
    failureCount,
  };
}

// Helper function to check if error is key-related
function isKeyRelatedError(errorMessage: string): boolean {
  const lowerCase = errorMessage.toLowerCase();
  return lowerCase.includes('api key') ||
         lowerCase.includes('not configured') ||
         lowerCase.includes('authentication failed') ||
         lowerCase.includes('authentication required') ||
         lowerCase.includes('unauthorized') ||
         lowerCase.includes('401') ||
         lowerCase.includes('quota exceeded') ||
         lowerCase.includes('rate limit') ||
         lowerCase.includes('insufficient credits');
}

// Helper function to get provider name
function getProviderName(providerId: string): string {
  const providerNames: Record<string, string> = {
    openai: 'OpenAI',
    anthropic: 'Anthropic',
    google: 'Google',
    mistral: 'Mistral',
    openrouter: 'OpenRouter',
    chutes: 'Chutes',
    github: 'GitHub',
    nvidia: 'NVIDIA',
    groq: 'Groq',
    together: 'Together AI',
    fireworks: 'Fireworks AI',
    deepinfra: 'DeepInfra',
    anyscale: 'Anyscale',
    lepton: 'Lepton AI',
    zen: 'Zen',
    portkey: 'Portkey',
    replicate: 'Replicate',
    vercel: 'Vercel',
  };
  return providerNames[providerId.toLowerCase()] || providerId;
}

// Helper function to check if provider is LLM (vs image/video)
function isLLMProvider(providerId: string): boolean {
  // Image/video providers
  const imageVideoProviders = ['mistral', 'google', 'vercel', 'replicate', 'cloudflare'];
  return !imageVideoProviders.includes(providerId.toLowerCase());
}