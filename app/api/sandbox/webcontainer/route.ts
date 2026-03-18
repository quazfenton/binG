/**
 * WebContainer API Endpoint
 * 
 * Returns configuration and metadata needed for the client to bootstrap
 * WebContainer in the browser. The actual WebContainer API runs client-side.
 * 
 * Client-side flow:
 * 1. Client calls this endpoint to get config (clientId, etc.)
 * 2. Client uses WebContainerProvider directly in browser to boot and use WebContainer
 */

import { NextRequest, NextResponse } from 'next/server';
import { resolveRequestAuth } from '@/lib/auth/request-auth';
import { createLogger } from '@/lib/utils/logger';
import { generateSecureId } from '@/lib/utils';

const logger = createLogger('WebContainerAPI');

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
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

    logger.info('WebContainer config requested', { userId, fileCount: Object.keys(files).length });

    // Get WebContainer configuration from environment
    const clientId = (process.env.NEXT_PUBLIC_WEBCONTAINER_CLIENT_ID || 'wc_api_____').trim();
    const scope = (process.env.NEXT_PUBLIC_WEBCONTAINER_SCOPE || '').trim();
    
    // Generate a unique session ID for this WebContainer instance
    const sandboxId = `webcontainer-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const sessionId = generateSecureId('wc sess');
    
    // Determine start command
    const hasPackageJson = files['package.json'] !== undefined;
    const hasStartScript = hasPackageJson && files['package.json'].includes('"start"');
    const cmdToRun = startCommand || (hasStartScript ? 'npm start' : 'node server.js');
    
    const targetPort = waitForPort || 3000;

    // Return configuration for client-side WebContainer bootstrapping
    // The client will use WebContainerProvider directly in the browser
    return NextResponse.json({
      success: true,
      sandboxId,
      sessionId,
      config: {
        clientId,
        scope: scope || undefined,
        workspaceDir: '/workspace',
        startCommand: cmdToRun,
        waitForPort: targetPort,
        hasPackageJson,
        hasStartScript,
      },
      // Include files in response so client can write them directly
      files,
      message: 'WebContainer runs in browser. Use WebContainerProvider client-side to boot.',
    });
  } catch (error: any) {
    logger.error('Failed to generate WebContainer config:', error);
    
    return NextResponse.json(
      { 
        error: 'Failed to create WebContainer environment',
        details: error.message,
      },
      { status: 500 }
    );
  }
}
