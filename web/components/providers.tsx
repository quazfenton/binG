"use client";

import { useEffect, useState } from 'react';
import { AuthProvider } from '@/contexts/auth-context';
import { TamboContextProvider } from '@/contexts/tambo-context';
import { PanelProvider } from '@/contexts/panel-context';
import { OrchestrationModeProvider } from '@/contexts/orchestration-mode-context';
import { SpecEnhancementModeProvider } from '@/contexts/spec-enhancement-mode-context';
import { ThemeProvider } from './theme-provider';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('Providers:Init');

async function initializeMCPServices() {
  try {
    const res = await fetch('/api/mcp/init', { method: 'POST' });
    if (!res.ok) {
      logger.error('MCP init API failed', { status: res.status });
    } else {
      logger.info('MCP services initialized successfully');
    }
  } catch (error: any) {
    logger.error('Failed to initialize MCP services', { error: error.message });
  }
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [mcpInitialized, setMcpInitialized] = useState(false);

  useEffect(() => {
    // Ensure this runs only on the client side and only once on mount
    // Also, conditionally initialize MCP services only if in desktop mode.
    if (typeof window !== 'undefined' && process.env.DESKTOP_MODE === 'true') {
      initializeMCPServices().then(() => {
        setMcpInitialized(true);
      }).catch((error) => {
        logger.error('Failed to initialize MCP services', { error: error.message });
        setMcpInitialized(true); // Continue anyway
      });
    } else {
      // If not in desktop mode or window is not defined, we can still set initialized to true
      // to prevent potential UI blocking if initialization is a prerequisite for something.
      // Or, if MCP services are truly only for desktop, this component might need to be structured differently.
      // For now, we assume initialization is a client-side task but might not be needed for web.
      setMcpInitialized(true);
    }
  }, []); // Empty dependency array ensures this runs only once on mount

  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="dark"
      themes={["dark", "light", "ocean", "forest", "sepia", "midnight", "rose", "desert", "lavender", "slate"]}
      enableSystem={false}
      disableTransitionOnChange
    >
      <AuthProvider>
        <TamboContextProvider>
          <PanelProvider>
            <OrchestrationModeProvider>
              <SpecEnhancementModeProvider>
                {children}
              </SpecEnhancementModeProvider>
            </OrchestrationModeProvider>
          </PanelProvider>
        </TamboContextProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
