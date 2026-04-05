"use client";

import { useEffect, useState } from 'react';
import { AuthProvider } from '@/contexts/auth-context';
import { TamboContextProvider } from '@/contexts/tambo-context';
import { PanelProvider } from '@/contexts/panel-context';
import { OrchestrationModeProvider } from '@/contexts/orchestration-mode-context';
import { ThemeProvider } from './theme-provider';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('Providers:Init');

/**
 * Initialize MCP services on app startup via server-side API route.
 * MCP code uses Node.js APIs (fs, child_process, database) that cannot
 * be bundled into the client — even dynamic imports get traced by Next.js.
 * The API route handles both desktop (Tauri) and web modes server-side.
 */
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
    initializeMCPServices().then(() => {
      setMcpInitialized(true);
    }).catch(() => {
      setMcpInitialized(true); // Continue anyway
    });
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
              {children}
            </OrchestrationModeProvider>
          </PanelProvider>
        </TamboContextProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
