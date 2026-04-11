/**
 * Provider PTY Endpoints
 *
 * Backend endpoints for provider-specific PTY connections.
 * Routes to appropriate provider based on sandbox ID.
 */

import { NextRequest, NextResponse } from 'next/server';
import { resolveRequestAuth } from '@/lib/auth/request-auth';
import { getSandboxProvider } from '@/lib/sandbox/providers';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('ProviderPTY');

/**
 * Detect provider type from sandbox ID
 */
function detectProviderType(sandboxId: string): string | null {
  if (!sandboxId) return null;
  
  const lowerId = sandboxId.toLowerCase();
  
  if (lowerId.startsWith('e2b-') || lowerId.startsWith('e2b_')) return 'e2b';
  if (lowerId.startsWith('daytona-') || lowerId.startsWith('daytona_')) return 'daytona';
  if (lowerId.startsWith('sprite-') || lowerId.startsWith('sprite_') || lowerId.startsWith('bing-')) return 'sprites';
  if (lowerId.startsWith('codesandbox-') || lowerId.startsWith('csb-')) return 'codesandbox';
  if (lowerId.startsWith('vercel-') || lowerId.startsWith('vc-')) return 'vercel-sandbox';
  if (lowerId.startsWith('mistral-agent-')) return 'mistral-agent';
  if (lowerId.startsWith('blaxel-')) return 'blaxel';
  if (lowerId.startsWith('micro-')) return 'microsandbox';
  
  return null;
}

/**
 * Get E2B PTY URL
 */
async function getE2BPTYUrl(sandboxId: string, sessionId: string): Promise<{ ptyUrl: string }> {
  try {
    const provider = await getSandboxProvider('e2b');
    const handle = await provider.getSandbox(sandboxId);
    
    // E2B provides PTY URL via environment connection
    if ('getPtyUrl' in handle) {
      const ptyUrl = await (handle as any).getPtyUrl();
      return { ptyUrl };
    }
    
    // Fallback: construct from environment ID
    if ('environmentId' in handle) {
      const envId = (handle as any).environmentId;
      const ptyUrl = `wss://pty.e2b.dev/${envId}`;
      return { ptyUrl };
    }
    
    throw new Error('E2B handle does not support PTY');
  } catch (error: any) {
    logger.error('Failed to get E2B PTY URL', error);
    throw error;
  }
}

/**
 * Get Daytona PTY URL
 */
async function getDaytonaPTYUrl(sandboxId: string, sessionId: string): Promise<{ wsUrl: string }> {
  try {
    const provider = await getSandboxProvider('daytona');
    const handle = await provider.getSandbox(sandboxId);
    
    // Daytona provides WebSocket URL directly
    if ('wsUrl' in handle) {
      return { wsUrl: (handle as any).wsUrl };
    }
    
    // Fallback: construct from sandbox ID
    const wsUrl = `wss://pty.daytona.io/${sandboxId}`;
    return { wsUrl };
  } catch (error: any) {
    logger.error('Failed to get Daytona PTY URL', error);
    throw error;
  }
}

/**
 * Get Sprites PTY URL
 */
async function getSpritesPTYUrl(sandboxId: string, sessionId: string): Promise<{ ptyUrl: string; workspaceUrl?: string }> {
  try {
    const provider = await getSandboxProvider('sprites');
    const handle = await provider.getSandbox(sandboxId);
    
    // Sprites provides workspace and PTY URLs
    if ('getPtyUrl' in handle) {
      const ptyUrl = await (handle as any).getPtyUrl();
      const workspaceUrl = (handle as any).workspaceUrl || ptyUrl.replace('ws', 'https');
      return { ptyUrl, workspaceUrl };
    }
    
    // Fallback: construct from workspace ID
    const ptyUrl = `wss://pty.sprites.dev/${sandboxId}`;
    const workspaceUrl = `https://workspace.sprites.dev/${sandboxId}`;
    return { ptyUrl, workspaceUrl };
  } catch (error: any) {
    logger.error('Failed to get Sprites PTY URL', error);
    throw error;
  }
}

/**
 * Get CodeSandbox PTY URL
 */
async function getCodeSandboxPTYUrl(sandboxId: string, sessionId: string): Promise<{ wsUrl: string }> {
  try {
    const provider = await getSandboxProvider('codesandbox');
    const handle = await provider.getSandbox(sandboxId);
    
    // CodeSandbox DevBox provides WebSocket URL
    if ('getDevBoxWsUrl' in handle) {
      const wsUrl = await (handle as any).getDevBoxWsUrl();
      return { wsUrl };
    }
    
    // Fallback: construct from sandbox ID
    const wsUrl = `wss://pty.csb.dev/${sandboxId}`;
    return { wsUrl };
  } catch (error: any) {
    logger.error('Failed to get CodeSandbox PTY URL', error);
    throw error;
  }
}

/**
 * Get Vercel Sandbox PTY URL
 */
async function getVercelSandboxPTYUrl(sandboxId: string, sessionId: string): Promise<{ wsUrl: string }> {
  try {
    const provider = await getSandboxProvider('vercel-sandbox');
    const handle = await provider.getSandbox(sandboxId);
    
    // Vercel provides isolated VM WebSocket URL
    if ('getVmWsUrl' in handle) {
      const wsUrl = await (handle as any).getVmWsUrl();
      return { wsUrl };
    }
    
    // Fallback: construct from sandbox ID
    const wsUrl = `wss://pty.vercel-sandbox.io/${sandboxId}`;
    return { wsUrl };
  } catch (error: any) {
    logger.error('Failed to get Vercel Sandbox PTY URL', error);
    throw error;
  }
}

/**
 * Generic handler for provider PTY requests
 */
async function handleProviderPTYRequest(
  sandboxId: string,
  sessionId: string,
  providerType: string
): Promise<{ ptyUrl?: string; wsUrl?: string; workspaceUrl?: string }> {
  switch (providerType) {
    case 'e2b':
      return getE2BPTYUrl(sandboxId, sessionId);
    case 'daytona':
      return getDaytonaPTYUrl(sandboxId, sessionId);
    case 'sprites':
      return getSpritesPTYUrl(sandboxId, sessionId);
    case 'codesandbox':
      return getCodeSandboxPTYUrl(sandboxId, sessionId);
    case 'vercel-sandbox':
      return getVercelSandboxPTYUrl(sandboxId, sessionId);
    default:
      throw new Error(`Unsupported provider type: ${providerType}`);
  }
}

/**
 * POST /api/sandbox/provider/pty
 * 
 * Get provider-specific PTY connection URL.
 * Auto-detects provider from sandbox ID.
 */
export async function POST(req: NextRequest) {
  let body: { sandboxId?: string; sessionId?: string } = {};
  let sandboxId: string | undefined;
  let sessionId: string | undefined;
  
  try {
    // Authenticate request
    const authResult = await resolveRequestAuth(req, { allowAnonymous: true });
    if (!authResult.success || !authResult.userId) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    // Parse request body
    body = await req.json();
    sandboxId = body.sandboxId;
    sessionId = body.sessionId;

    if (!sandboxId || !sessionId) {
      return NextResponse.json(
        { error: 'sandboxId and sessionId are required', received: Object.keys(body) },
        { status: 400 }
      );
    }

    // Detect provider type
    const providerType = detectProviderType(sandboxId);
    
    logger.debug('Provider type detection', {
      sandboxId,
      detectedType: providerType,
      prefixes: ['e2b-', 'daytona-', 'sprite-', 'codesandbox-', 'csb-', 'vercel-', 'mistral-agent-', 'blaxel-', 'micro-']
    });

    if (!providerType) {
      logger.warn('Unknown provider type for PTY request', {
        sandboxId,
        sessionId,
        hint: 'Sandbox ID must start with one of: e2b-, daytona-, sprite-, csb-, codesandbox-, vercel-, mistral-agent-, blaxel-, micro-'
      });
      return NextResponse.json(
        { 
          error: 'Unknown provider type. Sandbox ID must have provider prefix (e2b-, daytona-, sprite-, csb-, vercel-, etc.)',
          providedSandboxId: sandboxId,
          supportedPrefixes: ['e2b-', 'daytona-', 'sprite-', 'csb-', 'codesandbox-', 'vercel-', 'mistral-agent-', 'blaxel-', 'micro-']
        },
        { status: 400 }
      );
    }

    // SECURITY: Verify sandbox ownership before returning PTY URL (IDOR fix)
    const { sandboxBridge } = await import('@/lib/sandbox/sandbox-service-bridge');
    const session = sandboxBridge.getSessionBySandboxId(sandboxId);
    
    logger.debug('Session lookup for PTY', {
      sandboxId,
      sessionFound: !!session,
      sessionUserId: session?.userId,
      sessionStatus: session?.status,
    });

    if (!session) {
      logger.warn('Sandbox session not found for PTY', {
        sandboxId,
        sessionId,
        providerType,
        possibleCauses: ['sandbox destroyed', 'session expired', 'invalid sandbox ID']
      });
      return NextResponse.json(
        { 
          error: 'Sandbox not found or has been terminated',
          sandboxId,
          suggestion: 'Create a new sandbox or verify the sandbox ID is correct'
        },
        { status: 404 }
      );
    }
    
    // Verify the authenticated user owns this sandbox
    if (session.userId !== authResult.userId) {
      logger.warn('PTY IDOR attempt', {
        requestingUser: authResult.userId,
        sandboxOwner: session.userId,
        sandboxId,
      });
      return NextResponse.json(
        { error: 'You do not have access to this sandbox' },
        { status: 403 }
      );
    }

    logger.debug('Provider PTY request', {
      sandboxId,
      sessionId,
      providerType,
      userId: authResult.userId,
    });

    // Get provider-specific PTY URL
    logger.debug('Fetching PTY URL from provider', {
      providerType,
      sandboxId,
      sessionId
    });

    const ptyInfo = await handleProviderPTYRequest(sandboxId, sessionId, providerType);

    logger.info('Provider PTY URL obtained', {
      providerType,
      sandboxId,
      hasPtyUrl: !!ptyInfo.ptyUrl,
      hasWsUrl: !!ptyInfo.wsUrl,
      hasWorkspaceUrl: !!ptyInfo.workspaceUrl,
      urlPreview: ptyInfo.ptyUrl || ptyInfo.wsUrl || ptyInfo.workspaceUrl 
        ? (ptyInfo.ptyUrl || ptyInfo.wsUrl || ptyInfo.workspaceUrl).replace(/\/\/[^/]+\//, '//[host]/') 
        : null
    });

    return NextResponse.json(ptyInfo);
  } catch (error: any) {
    logger.error('Provider PTY request failed', {
      error: error.message,
      stack: error.stack,
      sandboxId,
      sessionId,
      providerType: detectProviderType(sandboxId || '')
    });

    const isAuthError = error.message?.includes('permission') || error.message?.includes('unauthorized');
    const isNotFoundError = error.message?.includes('not found') || error.message?.includes('does not exist');
    
    return NextResponse.json(
      { 
        error: error.message || 'Failed to get provider PTY URL',
        providerType: detectProviderType(sandboxId || ''),
        suggestion: isAuthError 
          ? 'Check sandbox ownership and permissions'
          : isNotFoundError 
            ? 'Verify sandbox exists and is running'
            : 'Use generic WebSocket endpoint as fallback: /api/sandbox/terminal/ws',
        fallback: 'Use generic WebSocket endpoint: /api/sandbox/terminal/ws'
      },
      { status: isAuthError ? 403 : isNotFoundError ? 404 : 500 }
    );
  }
}

/**
 * GET /api/sandbox/provider/pty
 * 
 * Health check endpoint.
 */
export async function GET() {
  return NextResponse.json({
    status: 'ok',
    endpoints: {
      e2b: '/api/sandbox/provider/pty (sandboxId: e2b-*)',
      daytona: '/api/sandbox/provider/pty (sandboxId: daytona-*)',
      sprites: '/api/sandbox/provider/pty (sandboxId: sprite-*)',
      codesandbox: '/api/sandbox/provider/pty (sandboxId: codesandbox-*)',
      'vercel-sandbox': '/api/sandbox/provider/pty (sandboxId: vercel-*)',
    },
  });
}
