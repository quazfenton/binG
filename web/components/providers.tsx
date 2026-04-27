"use client";

import { useEffect, useState } from 'react';
import { AuthProvider } from '@/contexts/auth-context';
import { TamboContextProvider } from '@/contexts/tambo-context';
import { PanelProvider } from '@/contexts/panel-context';
import { OrchestrationModeProvider } from '@/contexts/orchestration-mode-context';
import { SpecEnhancementModeProvider } from '@/contexts/spec-enhancement-mode-context';
import { ThemeProvider } from './theme-provider';
import { createLogger } from '@/lib/utils/logger';
import { tauriFetch } from '@/lib/tauri-api-adapter';

const logger = createLogger('Providers:Init');

async function initializeMCPServices() {
  try {
    const res = await tauriFetch('/api/mcp/init', { method: 'POST' });
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
    if (typeof window !== 'undefined' && process.env.DESKTOP_MODE === 'true') {
      initializeMCPServices().then(() => {
        setMcpInitialized(true);
      }).catch((error) => {
        logger.warn('Failed to initialize MCP services', { error: error?.message || String(error) });
        setMcpInitialized(true); // Continue anyway
      });
    } else {
      setMcpInitialized(true);
    }
  }, []);

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
