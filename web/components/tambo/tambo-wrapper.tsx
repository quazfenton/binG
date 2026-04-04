"use client";

import { ReactNode, useState, useEffect } from 'react';
import { EnhancedTamboProvider } from '@/lib/tambo/tambo-provider';
import { useTamboContext } from '@/contexts/tambo-context';
import { getTamboToolRegistry, initializeDefaultTools } from '@/lib/tambo/tambo-tool-registry';
import { getTamboComponentRegistry, initializeDefaultComponents } from '@/lib/tambo/tambo-component-registry';
import { tamboErrorHandler, withTamboErrorHandling } from '@/lib/tambo/tambo-error-handler';

interface TamboWrapperProps {
  children: ReactNode;
}

/**
 * Enhanced Tambo Wrapper
 * 
 * Now uses:
 * - OAuth token exchange for security
 * - Unified tool and component registries
 * - Context helpers and attachments
 * - Error handling with retry
 */
export function TamboWrapper({ children }: TamboWrapperProps) {
  const { enabled, apiKey } = useTamboContext();
  const [isClient, setIsClient] = useState(false);
  const [userToken, setUserToken] = useState<string | null>(null);

  useEffect(() => {
    setIsClient(true);
    
    // Initialize registries
    initializeDefaultTools();
    initializeDefaultComponents();
    
    // Get user token for OAuth exchange
    async function getUserToken() {
      try {
        // Try to get auth token from session
        const response = await fetch('/api/auth/session');
        if (response.ok) {
          const session = await response.json();
          if (session.user?.token) {
            setUserToken(session.user.token);
          }
        }
      } catch (error) {
        console.warn('[TamboWrapper] Failed to get user token:', error);
      }
    }
    
    getUserToken();
  }, []);

  // If Tambo is not enabled or not client-side, render children without Tambo
  if (!enabled || !isClient) {
    return <>{children}</>;
  }

  // Wrap with EnhancedTamboProvider for full feature support
  return (
    <EnhancedTamboProvider
      apiKey={apiKey || undefined}
      userToken={userToken || undefined}
      enabled={enabled}
      contextHelpers={{
        // Custom context helpers can be added here
      }}
      mcpServers={[]} // MCP servers can be configured via env
    >
      {children}
    </EnhancedTamboProvider>
  );
}
