"use client";

import { useEffect, useState } from 'react';
import { AuthProvider } from '@/contexts/auth-context';
import { TamboContextProvider } from '@/contexts/tambo-context';
import { PanelProvider } from '@/contexts/panel-context';
import { OrchestrationModeProvider } from '@/contexts/orchestration-mode-context';
import { ThemeProvider } from './theme-provider';
import { initializeMCPForArchitecture1, initializeDesktopMCP, desktopMCPPresets } from '@/lib/mcp';
import { isDesktopMode } from '@bing/platform/env';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('Providers:Init');

/**
 * Initialize MCP services on app startup
 * - Desktop mode: Spawn local MCP server processes
 * - Web mode: Connect to remote MCP servers via stdio/SSE
 */
async function initializeMCPServices() {
  try {
    // Check if we're in desktop mode
    if (isDesktopMode()) {
      logger.info('Desktop mode detected, initializing local MCP servers...');
      
      // Create desktop MCP server configurations for local tools
      // Use the user's home directory for filesystem access
      const homeDir = typeof process !== 'undefined' 
        ? (process.env.HOME || process.env.USERPROFILE || '/tmp') 
        : '/tmp';
      
      const desktopConfigs = [
        // Filesystem server for local file access
        desktopMCPPresets.filesystem(homeDir),
        // Memory server for session context
        desktopMCPPresets.memory(),
      ].filter(config => config.enabled);
      
      // Initialize desktop MCP manager with local servers
      await initializeDesktopMCP(desktopConfigs);
      logger.info('Desktop MCP servers initialized', { count: desktopConfigs.length });
    } else {
      logger.info('Web mode detected, initializing remote MCP servers...');
    }
    
    // Initialize MCP for Architecture 1 (Main LLM with AI SDK)
    // This connects to MCP servers and loads tool definitions
    await initializeMCPForArchitecture1();
    
    logger.info('MCP services initialized successfully');
  } catch (error: any) {
    logger.error('Failed to initialize MCP services', { error: error.message });
    // Don't fail the app - MCP is optional
  }
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [mcpInitialized, setMcpInitialized] = useState(false);

  useEffect(() => {
    // Initialize MCP services on mount (client-side only)
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
