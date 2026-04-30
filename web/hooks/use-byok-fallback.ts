"use client";

import { useState, useEffect } from 'react';
import { useApiKeys } from './use-api-keys';

/**
 * Hook for managing BYOK (Bring Your Own Key) fallback UX
 * Tracks consecutive total failures and shows BYOK input when appropriate
 */
export function useBYOKFallback() {
  const [totalFailureCount, setTotalFailureCount] = useState(0);
  const [showBYOKInput, setShowBYOKInput] = useState(false);
  const [byokError, setByokError] = useState<{
    providerId: string;
    providerName: string;
    errorMessage: string;
    onRetry?: () => void;
  } | null>(null);
  
  const { apiKeys, saveApiKey, getApiKey, hasApiKey } = useApiKeys();
  
  // Reset failure count when keys change (user added a key)
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleKeyChange = () => {
      setTotalFailureCount(0);
    };
    
    window.addEventListener('user-api-keys-changed', handleKeyChange);
    return () => {
      window.removeEventListener('user-api-keys-changed', handleKeyChange);
    };
  }, []);
  
  // Handle API key save from BYOK input
  const handleApiKeySave = async (providerId: string, apiKey: string, options?: { onSuccess?: () => void }) => {
    const success = await saveApiKey(providerId, apiKey);
    if (success) {
      setShowBYOKInput(false);
      const retryFn = byokError?.onRetry;
      setByokError(null);
      setTotalFailureCount(0); // Reset failure count
      
      if (options?.onSuccess) {
        options.onSuccess();
      } else if (retryFn) {
        // Automatically retry if no explicit onSuccess provided
        retryFn();
      }
    } else {
      // Provide user feedback on failure
      setByokError(prev => prev ? {
        ...prev,
        errorMessage: 'Failed to save API key. Please check your key format and try again.'
      } : null);
    }
  };
  
  // Handle retry with same key
  const handleRetry = () => {
    const retryFn = byokError?.onRetry;
    setShowBYOKInput(false);
    setByokError(null);
    if (retryFn) {
      retryFn();
    }
  };
  
  /**
   * Record a total failure (after all internal fallbacks failed)
   * @param providerId Primary provider that was being used
   * @param error The final error received
   * @param type The type of generation ('chat', 'image', 'video')
   * @param onRetry Callback to retry the operation
   */
  const recordTotalFailure = (providerId: string, error: Error, type: 'chat' | 'image' | 'video', onRetry?: () => void) => {
    const providerName = getProviderName(providerId);
    const errorMessage = error.message;
    
    if (type === 'chat') {
      const newCount = totalFailureCount + 1;
      setTotalFailureCount(newCount);
      
      // For LLM chat, require 3 consecutive BACK-TO-BACK total failures
      if (newCount >= 3) {
        triggerBYOK(providerId, providerName, errorMessage, onRetry);
      }
    } else {
      // For image/video, show immediately on any total failure
      triggerBYOK(providerId, providerName, errorMessage, onRetry);
    }
  };

  const triggerBYOK = (providerId: string, providerName: string, errorMessage: string, onRetry?: () => void) => {
    const existingKey = getApiKey(providerId);
    let customErrorMessage = errorMessage;
    
    if (existingKey) {
      customErrorMessage = `Request failed even with your custom ${providerName} key. The key might be invalid, expired, or rate-limited. You can update it below.`;
    } else {
      customErrorMessage = `All server-side fallbacks failed for ${providerName}. You can continue by providing your own API key.`;
    }
    
    setByokError({
      providerId,
      providerName,
      errorMessage: customErrorMessage,
      onRetry
    });
    setShowBYOKInput(true);
  };
  
  const resetFailureCount = () => {
    setTotalFailureCount(0);
  };
  
  return {
    showBYOKInput,
    byokError,
    setShowBYOKInput,
    recordTotalFailure,
    resetFailureCount,
    handleApiKeySave,
    handleRetry,
    totalFailureCount,
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
