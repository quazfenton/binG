/**
 * WebContainer API Endpoint
 * 
 * Creates a WebContainer sandbox for running Node.js in the browser.
 * Uses the WebContainerProvider which wraps @webcontainer/api SDK.
 * 
 * SDK Pattern:
 * - WebContainerProvider.createSandbox() → WebContainerSandboxHandle
 * - handle.writeFile() → instance.fs.writeFile()
 * - handle.executeCommand() → instance.spawn()
 * - handle.getPreviewLink(port) → server-ready event URL
 */

import { NextRequest, NextResponse } from 'next/server';
import { resolveRequestAuth } from '@/lib/auth/request-auth';
import { sandboxBridge } from '@/lib/sandbox/sandbox-service-bridge';
import { createLogger } from '@/lib/utils/logger';
import { generateSecureId } from '@/lib/utils';

const logger = createLogger('WebContainerAPI');

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    // Note: WebContainer runs in browser, but this endpoint supports both:
    // 1. Client-side: forwards request to browser WebContainer API
    // 2. Server-side: returns info needed to bootstrap WebContainer in browser
    // The window check was removed - it's a Next.js API route that provides metadata/config

    const authResult = await resolveRequestAuth(req, { allowAnonymous: true });
    const anonymousSessionId = req.headers.get('x-anonymous-session-id') || generateSecureId('anon');
    const userId = authResult.userId || `anonymous:${anonymousSessionId}`;

    const body = await req.json();
    const { files, startCommand, waitForPort } = body;

    if (!files || typeof files !== 'object') {
      return NextResponse.json(
        { error: 'Files are required' },
        { status: 400 }
      );
    }

    logger.info('Creating WebContainer', { userId, fileCount: Object.keys(files).length });

    // Create WebContainer sandbox via sandbox bridge
    // The provider internally uses: WebContainer.boot()
    const session = await sandboxBridge.getOrCreateSession(userId, {
      language: 'typescript',
      template: 'node',
    });

    logger.info('WebContainer created', { 
      sandboxId: session.sandboxId, 
      sessionId: session.sessionId 
    });

    // Get the WebContainer provider to access SDK methods
    const provider = await sandboxBridge.getProvider('webcontainer');
    const sandbox = await provider.getSandbox(session.sandboxId);

    // Write all files to WebContainer workspace using SDK's fs API
    logger.info('Writing files to WebContainer...');
    for (const [filePath, content] of Object.entries(files)) {
      try {
        const result = await sandbox.writeFile(filePath, content as string);
        logger.debug(`Written: ${filePath} - ${result.success ? 'OK' : 'FAILED'}`);
      } catch (err: any) {
        logger.warn(`Failed to write file ${filePath}:`, err.message);
      }
    }

    // Install dependencies if package.json exists
    if (files['package.json']) {
      logger.info('Installing dependencies...');
      try {
        await sandbox.executeCommand('npm install');
      } catch (err: any) {
        logger.warn('npm install failed:', err.message);
      }
    }

    // Start server and wait for preview URL
    const cmdToRun = startCommand || (files['package.json']?.includes('"start"') ? 'npm start' : 'node server.js');
    
    logger.info('Starting server:', cmdToRun);
    // Run server in background (don't wait for exit)
    sandbox.executeCommand(cmdToRun).catch(err => {
      logger.warn('Server command error:', err.message);
    });

    // Wait for server-ready event and get preview URL
    const targetPort = waitForPort || 3000;
    // Format: https://<sandboxId>-<port>.webcontainer.io
    const previewUrl = await Promise.race([
      new Promise<string>((resolve) => {
        // Poll for preview URL (WebContainer sets it via server-ready event)
        const checkInterval = setInterval(async () => {
          try {
            const preview = await sandbox.getPreviewLink(targetPort);
            if (preview.url && !preview.url.includes('localhost')) {
              clearInterval(checkInterval);
              resolve(preview.url);
            }
          } catch {
            // Ignore errors while polling
          }
        }, 500);
        
        // Timeout after 30 seconds (longer for Next.js first build)
        setTimeout(() => {
          clearInterval(checkInterval);
          resolve(`http://localhost:${targetPort}`);
        }, waitForPort ? 60000 : 30000);
      }),
    ]);

    logger.info('WebContainer ready', {
      sandboxId: session.sandboxId,
      url: previewUrl,
    });

    return NextResponse.json({
      success: true,
      sandboxId: session.sandboxId,
      sessionId: session.sessionId,
      url: previewUrl,
      provider: 'webcontainer',
    });
  } catch (error: any) {
    logger.error('Failed to create WebContainer:', error);
    
    return NextResponse.json(
      { 
        error: 'Failed to create WebContainer environment',
        details: error.message,
      },
      { status: 500 }
    );
  }
}
