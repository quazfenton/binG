/**
 * CodeSandbox DevBox API Endpoint
 * 
 * Creates a cloud development environment using the CodeSandbox SDK.
 * 
 * SDK Pattern:
 * - import { createSandbox } from '@codesandbox/sdk'
 * - sandbox.fs.writeFile() for files
 * - sandbox.run() for commands
 * - sandbox.getPreviewUrl(port) for preview URLs
 * - sandbox.exposePort(port) for dev servers
 */

import { NextRequest, NextResponse } from 'next/server';
import { resolveRequestAuth } from '@/lib/auth/request-auth';
import { sandboxBridge } from '@/lib/sandbox/sandbox-service-bridge';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('DevBoxAPI');

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const authResult = await resolveRequestAuth(req, { allowAnonymous: true });
    const userId = authResult.userId || 'anonymous';

    const body = await req.json();
    const { files, template = 'node' } = body;

    if (!files || typeof files !== 'object') {
      return NextResponse.json(
        { error: 'Files are required' },
        { status: 400 }
      );
    }

    logger.info('Creating DevBox', { userId, template, fileCount: Object.keys(files).length });

    // Create sandbox via sandbox bridge (uses CodeSandbox provider)
    // The provider internally uses: createSandbox({ template, ephemeral: true })
    const session = await sandboxBridge.getOrCreateSession(userId, {
      language: template === 'docker' ? 'docker' : 'typescript',
      template: template === 'docker' ? 'docker' : 'node',
    });

    logger.info('Sandbox created', { 
      sandboxId: session.sandboxId, 
      sessionId: session.sessionId 
    });

    // Get the CodeSandbox provider to access SDK methods
    const provider = await sandboxBridge.getProvider('codesandbox');
    const sandbox = await provider.getSandbox(session.sandboxId);

    // Write all files to sandbox workspace using SDK's fs API
    logger.info('Writing files to sandbox...');
    for (const [filePath, content] of Object.entries(files)) {
      try {
        await sandbox.writeFile(filePath, content as string);
        logger.debug(`Written: ${filePath}`);
      } catch (err: any) {
        logger.warn(`Failed to write file ${filePath}:`, err.message);
      }
    }

    // Get preview URL using SDK's getPreviewUrl or hosts.getUrl
    // Format: https://{sandboxId}.csb.app
    const previewUrl = `https://${session.sandboxId}.csb.app`;

    logger.info('DevBox created successfully', {
      sandboxId: session.sandboxId,
      url: previewUrl,
    });

    return NextResponse.json({
      success: true,
      sandboxId: session.sandboxId,
      sessionId: session.sessionId,
      url: previewUrl,
      template,
      provider: 'codesandbox',
    });
  } catch (error: any) {
    logger.error('Failed to create DevBox:', error);
    
    return NextResponse.json(
      { 
        error: 'Failed to create cloud development environment',
        details: error.message,
      },
      { status: 500 }
    );
  }
}
