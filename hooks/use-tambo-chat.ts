"use client";

import { useState, useCallback } from 'react';
import { useTamboContext } from '@/contexts/tambo-context';

export function useTamboChat() {
  const { enabled, apiKey } = useTamboContext();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Send a message with optional Tambo enhancement
   * Falls back to standard chat if Tambo is disabled or fails
   */
  const sendMessage = useCallback(async (message: string, options?: {
    useTambo?: boolean;
    tamboComponents?: string[];
    [key: string]: any;
  }) => {
    setIsLoading(true);
    setError(null);

    try {
      // If Tambo enabled and requested, use Tambo-enhanced request
      if (enabled && apiKey && options?.useTambo) {
        return await sendTamboMessage(message, apiKey, options);
      }
      
      // Otherwise use standard chat
      return await sendStandardMessage(message, options);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setError(errorMessage);
      
      // Fallback to standard chat if Tambo fails
      if (enabled && options?.useTambo) {
        console.warn('Tambo failed, falling back to standard chat:', errorMessage);
        return await sendStandardMessage(message, options);
      }
      
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [enabled, apiKey]);

  return {
    sendMessage,
    isLoading,
    error,
    isTamboEnabled: enabled,
  };
}

/**
 * Standard chat message (existing /api/chat endpoint)
 */
async function sendStandardMessage(message: string, options?: any) {
  const token = localStorage.getItem('token');
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      messages: [{ role: 'user', content: message }],
      ...options,
    }),
  });

  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }

  return await response.json();
}

/**
 * Tambo-enhanced message with component/tool support
 */
async function sendTamboMessage(message: string, apiKey: string, options?: any) {
  const token = localStorage.getItem('token');
  
  // Add Tambo-specific metadata
  const tamboOptions = {
    ...options,
    metadata: {
      ...options?.metadata,
      useTambo: true,
      tamboComponents: options?.tamboComponents || [],
    },
  };
  
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      messages: [{ role: 'user', content: message }],
      ...tamboOptions,
    }),
  });

  if (!response.ok) {
    throw new Error(`Tambo API error: ${response.status}`);
  }

  return await response.json();
}
