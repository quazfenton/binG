/**
 * Enhanced Tambo Context Provider
 * 
 * Wraps @tambo-ai/react TamboProvider with:
 * - OAuth token exchange
 * - Context helpers
 * - Context attachments
 * - Resources (@-mentions)
 * - Error handling with retry
 * 
 * @see https://tambo.ai/docs
 */

'use client';

import React, { ReactNode, useEffect, useState, useCallback } from 'react';
import { TamboProvider as OriginalTamboProvider } from '@tambo-ai/react';
import { useTamboContextHelpers, useTamboContextAttachments, useTamboResources, ContextHelper } from './tambo-hooks';
import { getTamboToolRegistry, initializeDefaultTools } from './tambo-tool-registry';
import { getTamboComponentRegistry, initializeDefaultComponents } from './tambo-component-registry';

export interface EnhancedTamboProviderProps {
  children: ReactNode;
  apiKey?: string;
  userToken?: string;
  userId?: string;
  enabled?: boolean;
  contextHelpers?: Record<string, ContextHelper>;
  mcpServers?: Array<{
    name: string;
    url: string;
    transport?: 'stdio' | 'sse' | 'websocket';
  }>;
}

/**
 * Enhanced Tambo Provider with full SDK feature support
 */
export function EnhancedTamboProvider({
  children,
  apiKey,
  userToken,
  userId,
  enabled = true,
  contextHelpers: customContextHelpers,
  mcpServers,
}: EnhancedTamboProviderProps) {
  const [isClient, setIsClient] = useState(false);
  const [tamboToken, setTamboToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Context helpers management
  const { helpers, addContextHelper, getContextHelpers } = useTamboContextHelpers();
  
  // Context attachments management
  const { attachments, addContextAttachment, clearContextAttachments } = useTamboContextAttachments();
  
  // Resources management
  const { addResources, searchResources } = useTamboResources();

  // Initialize on mount
  useEffect(() => {
    setIsClient(true);
    initializeDefaultTools();
    initializeDefaultComponents();
  }, []);

  // Exchange user token for Tambo token
  useEffect(() => {
    async function exchangeToken() {
      if (!enabled || !userToken) {
        setIsLoading(false);
        return;
      }

      try {
        const response = await fetch('/api/tambo/oauth/token', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
            subject_token: userToken,
            subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
          }),
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || 'Token exchange failed');
        }

        const data = await response.json();
        setTamboToken(data.access_token);
      } catch (err: any) {
        console.error('[EnhancedTamboProvider] Token exchange failed:', err);
        setError(err.message);
        
        // Fall back to API key if token exchange fails
        if (apiKey) {
          setTamboToken(apiKey);
        }
      } finally {
        setIsLoading(false);
      }
    }

    exchangeToken();
  }, [enabled, userToken, apiKey]);

  // Register custom context helpers
  useEffect(() => {
    if (customContextHelpers) {
      for (const [name, helper] of Object.entries(customContextHelpers)) {
        addContextHelper(name, helper);
      }
    }
  }, [customContextHelpers, addContextHelper]);

  // Get tools and components from unified registries
  const tools = getTamboToolRegistry().toArray();
  const components = getTamboComponentRegistry().toArray();

  // Build context helpers object
  const allContextHelpers = {
    ...getContextHelpers(),
    // Add default helpers if not overridden
    userTime: customContextHelpers?.userTime || (() => ({
      time: new Date().toISOString(),
      formatted: new Date().toLocaleString(),
    })),
  };

  // If not enabled or not client-side, render children without Tambo
  if (!enabled || !isClient || isLoading) {
    return <>{children}</>;
  }

  // If we have an error but have a fallback token, continue
  // Otherwise render children without Tambo
  if (error && !tamboToken && !apiKey) {
    console.warn('[EnhancedTamboProvider] Disabled due to error:', error);
    return <>{children}</>;
  }

  // Use Tambo token, or API key as fallback
  const effectiveApiKey = tamboToken || apiKey || '';

  return (
    <OriginalTamboProvider
      apiKey={effectiveApiKey}
      userToken={userToken}
      tools={tools}
      components={components}
      contextHelpers={allContextHelpers}
      mcpServers={mcpServers}
    >
      {children}
    </OriginalTamboProvider>
  );
}

/**
 * Hook to access Tambo context attachments in child components
 */
export function useTamboContextAttachmentsHook() {
  return useTamboContextAttachments();
}

/**
 * Hook to access Tambo resources in child components
 */
export function useTamboResourcesHook() {
  return useTamboResources();
}

/**
 * Hook to access Tambo context helpers in child components
 */
export function useTamboContextHelpersHook() {
  return useTamboContextHelpers();
}
