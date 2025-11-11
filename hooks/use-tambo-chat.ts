"use client";

import { useState, useCallback } from 'react';
import { useTamboContext } from '@/contexts/tambo-context';

export function useTamboChat() {
  const { enabled, apiKey } = useTamboContext();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sendMessage = useCallback(async (message: string, options?: any) => {
    if (!enabled || !apiKey) {
      return sendStandardMessage(message, options);
    }

    setIsLoading(true);
    setError(null);

    try {
      return await sendStandardMessage(message, options);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setError(errorMessage);
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

async function sendStandardMessage(message: string, options?: any) {
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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
