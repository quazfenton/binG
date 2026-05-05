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
import { sandboxFilesystemSync } from '@/lib/virtual-filesystem/sync/sandbox-filesystem-sync';
import { createLogger } from '@/lib/utils/logger';
import { SandboxSecurityManager } from '@/lib/sandbox/security-manager';

const logger = createLogger('DevBoxAPI');

export const runtime = 'edge';

// SECURITY: O(1) body size guard — checked BEFORE req.json() buffers into memory
const MAX_DEVBOX_BODY_BYTES = 120 * 1024 * 1024; // 120MB
const MAX_DEVBOX_FILE_SIZE = 100 * 1024 * 1024; // 100MB per file

// Rate limiting: track sandbox creations per user (simple in-memory, use Redis for production)
// Disable in development for easier testing
const MAX_SANDBOXES_PER_USER = process.env.NODE_ENV === 'development' 
  ? 1000 
  : parseInt(process.env.MAX_SANDBOXES_PER_USER || '5', 10);
const RATE_LIMIT_WINDOW_MS = parseInt(process.env.SANDBOX_RATE_LIMIT_WINDOW_MS || '3600000', 10); // 1 hour default
const userSandboxCreations = new Map<string, { count: number; resetAt: number }>();

// Track active DevBox sessions per user
const activeDevboxSessions = new Map<string, { sandboxId: string; createdAt: number; template: string }>();

/**
 * Check rate limit for sandbox creation
 * Skip in development
 */
function checkRateLimit(userId: string): { allowed: boolean; remaining: number; resetAt: number } {
  // Skip rate limiting in development
  if (process.env.NODE_ENV === 'development') {
    return { allowed: true, remaining: 999, resetAt: Date.now() + 3600000 };
  }
  
  const now = Date.now();
  const userRecord = userSandboxCreations.get(userId);

  if (!userRecord || now > userRecord.resetAt) {
    userSandboxCreations.set(userId, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return { allowed: true, remaining: MAX_SANDBOXES_PER_USER - 1, resetAt: now + RATE_LIMIT_WINDOW_MS };
  }

  if (userRecord.count >= MAX_SANDBOXES_PER_USER) {
    return { allowed: false, remaining: 0, resetAt: userRecord.resetAt };
  }

  userRecord.count++;
  return { allowed: true, remaining: MAX_SANDBOXES_PER_USER - userRecord.count, resetAt: userRecord.resetAt };
}

export async function POST(req: NextRequest) {
  // Initialize variables that need to be accessed in catch block
  let authResult: Awaited<ReturnType<typeof resolveRequestAuth>> | null = null;
  let template: string = 'node';
  let validTemplates: string[] = [];
  let detail = '';

  try {
    // SECURITY: Require authentication - no anonymous sandbox creation allowed
    authResult = await resolveRequestAuth(req, { allowAnonymous: false });
    if (!authResult.success || !authResult.userId) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const userId = authResult.userId;

    // SECURITY: Rate limiting to prevent resource abuse/DoS
    const rateLimit = checkRateLimit(userId);
    if (!rateLimit.allowed) {
      const resetMinutes = Math.ceil((rateLimit.resetAt - Date.now()) / 60000);
      logger.warn('Sandbox creation rate limit exceeded', { userId });
      return NextResponse.json(
        { error: `Rate limit exceeded. Maximum ${MAX_SANDBOXES_PER_USER} sandboxes per ${RATE_LIMIT_WINDOW_MS / 60000} minutes. Try again in ${resetMinutes} minutes.` },
        { status: 429 }
      );
    }

    // SECURITY: O(1) body size check BEFORE buffering into memory via req.json()
    const contentLength = req.headers.get('content-length');
    if (contentLength && parseInt(contentLength, 10) > MAX_DEVBOX_BODY_BYTES) {
      return NextResponse.json(
        { error: `Request body too large (max ${MAX_DEVBOX_BODY_BYTES / (1024 * 1024)}MB)` },
        { status: 413 },
      );
    }

    const body = await req.json();
    const { files } = body;

    // Handle template with explicit default (don't use destructuring default)
    let templateFromBody = body.template;
    if (typeof templateFromBody !== 'string' || !templateFromBody.trim()) {
      templateFromBody = 'node';
    }

    // Assign to outer-scoped template variable (don't shadow)
    template = templateFromBody;

    if (!files || typeof files !== 'object' || Array.isArray(files) || Object.keys(files).length === 0 || !Object.values(files).every(v => typeof v === 'string')) {
      return NextResponse.json(
        { error: 'Files must be a non-empty object with string values' },
        { status: 400 }
      );
    }

    // SECURITY: Per-file content size validation BEFORE buffering to sandbox
    for (const [filePath, content] of Object.entries(files)) {
      if (typeof content === 'string' && content.length > MAX_DEVBOX_FILE_SIZE) {
        return NextResponse.json(
          { error: `File '${filePath}' exceeds size limit (${(content.length / (1024 * 1024)).toFixed(1)}MB > ${MAX_DEVBOX_FILE_SIZE / (1024 * 1024)}MB)` },
          { status: 400 },
        );
      }
    }

    logger.info('Creating DevBox', { userId, template, fileCount: Object.keys(files).length, rateLimitRemaining: rateLimit.remaining });

    // Pre-flight: require CSB_API_KEY before attempting provider initialisation so
    // the 500 carries a meaningful message rather than an opaque SDK error.
    if (!process.env.CSB_API_KEY) {
      logger.error('CSB_API_KEY is not set in the server environment');
      return NextResponse.json(
        { error: 'CodeSandbox is not configured. Set the CSB_API_KEY environment variable.' },
        { status: 503 }
      );
    }

    // Validate template
    validTemplates = ['node', 'typescript', 'javascript', 'python', 'docker', 'react', 'nextjs', 'vue', 'svelte'];
    if (!validTemplates.includes(template)) {
      return NextResponse.json(
        { error: `Invalid template '${template}'. Valid templates: ${validTemplates.join(', ')}` },
        { status: 400 }
      );
    }

    // Map request template to valid CodeSandbox template IDs
    // These are the official CodeSandbox template IDs from their SDK
    const csbTemplateMap: Record<string, string> = {
      'node': 'node',
      'typescript': 'node',
      'javascript': 'node',
      'python': 'in2qez',           // Python template
      'docker': 'hsd8ke',
      'react': 'kd848j',            // React (JS)
      'nextjs': 'fxis37',           // Next.js
      'vue': 'pb6sit',              // Vue 3
      'svelte': 'd2kl21',           // Solid (Vite) - or use svelteKit
      'sveltekit': 'q6j99z',         // SvelteKit
      'angular': 'angular',         // Angular
      'gatsby': '4drgwm',           // Gatsby
      'astro': 'j1qiqf',            // Astro
      'flask': '4gppm4',            // Python Flask Server
      'fastapi': 'in2qez',          // Use Python base
      'django': 'in2qez',           // Use Python base
      'express': '3mk9y8',           // Node Express Server
      'nest': '4fqzwq',             // NestJS
      'nuxt': 'b0tq18',             // Nuxt
      'deno': 'kc6kgh',             // Deno
      'rust': 'rk69p3',             // Rust
      'go': 'ej14tt',               // Go
      'ruby': 'n92lr8',            // Ruby on Rails
      'php': 'ygkev0',              // PHP
      'universal': 'pcz35m',       // Universal (all languages)
    };
    
    const csbTemplate = csbTemplateMap[template.toLowerCase()] || 'node';

    // Get CodeSandbox provider directly - DevBox is specifically for CodeSandbox
    const provider = await sandboxBridge.getProvider('codesandbox');

    // Create a new CodeSandbox sandbox with proper config
    const sandboxHandle = await provider.createSandbox({
      language: csbTemplate,
      labels: { userId: authResult.userId },
    });

    const sandboxId = (sandboxHandle as any).sandboxId || sandboxHandle.id;

    logger.info('CodeSandbox created', {
      sandboxId,
      template,
      userId: authResult.userId,
    });

    // Get the sandbox instance for file operations
    const sandbox = await provider.getSandbox(sandboxId);

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

    // Detect and run appropriate package manager based on template
    const templateLower = template.toLowerCase();
    
    // Determine default port based on template type
    const defaultPorts: Record<string, number> = {
      node: 3000,
      javascript: 3000,
      typescript: 3000,
      react: 3000,
      nextjs: 3000,
      vue: 3000,
      svelte: 5173,
      python: 3000,
      flask: 5000,
      fastapi: 8000,
      django: 8000,
    };
    const targetPort = defaultPorts[templateLower] || 3000;
    
    // Node.js/JavaScript projects (including React, Vue, Svelte, Next.js)
    if (['node', 'javascript', 'typescript', 'react', 'nextjs', 'vue', 'svelte'].includes(templateLower)) {
      if (files['package.json']) {
        logger.info('Running npm install...');
        try {
          const installResult = await sandbox.executeCommand('npm install', '/workspace');
          logger.debug('npm install output:', installResult.output || 'completed');
        } catch (err: any) {
          logger.warn('npm install warning:', err.message);
        }

        // Run start command in background
        const packageJson = JSON.parse(files['package.json']);
        const startCommand = packageJson?.scripts?.start || packageJson?.scripts?.dev;
        if (startCommand) {
          logger.info(`Starting server: ${startCommand}...`);
          try {
            const codeSandboxHandle = sandbox as any;
            if (codeSandboxHandle.executeCommandBackground) {
              await codeSandboxHandle.executeCommandBackground(startCommand, (output: string) => {
                logger.debug('Server output:', output);
              }, '/workspace');
              logger.info('Server started');
            }
          } catch (err: any) {
            logger.warn('Start command warning:', err.message);
          }
        }
      }
    }
    
    // Python projects
    else if (templateLower === 'python' || templateLower === 'flask' || templateLower === 'fastapi' || templateLower === 'django') {
      if (files['requirements.txt']) {
        logger.info('Running pip install...');
        try {
          await sandbox.executeCommand('pip install -r requirements.txt', '/workspace');
        } catch (err: any) {
          logger.warn('pip install warning:', err.message);
        }
      }
      
      // Find and run Python main file
      const pythonFiles = Object.keys(files).filter(f => f.endsWith('.py'));
      if (pythonFiles.length > 0) {
        const mainFile = pythonFiles.find(f => f.includes('main') || f.includes('app') || f.includes('server')) || pythonFiles[0];
        logger.info(`Starting Python server: python ${mainFile}...`);
        try {
          const codeSandboxHandle = sandbox as any;
          if (codeSandboxHandle.executeCommandBackground) {
            await codeSandboxHandle.executeCommandBackground(`python ${mainFile}`, (output: string) => {
              logger.debug('Server output:', output);
            }, '/workspace');
            logger.info('Server started');
          }
        } catch (err: any) {
          logger.warn('Python start warning:', err.message);
        }
      }
    }

    // Wait for the port to be ready using CodeSandbox Ports API
    let previewUrl = `https://${sandboxId}.csb.app`;
    let actualPort = targetPort;
    
    logger.info(`Waiting for port ${targetPort} to be ready...`);
    try {
      const codeSandboxHandle = sandbox as any;
      if (codeSandboxHandle.waitForPort) {
        const portInfo = await codeSandboxHandle.waitForPort(targetPort, 30000);
        previewUrl = portInfo.url;
        actualPort = portInfo.port;
        logger.info(`Port ready: ${actualPort} at ${previewUrl}`);
      }
    } catch (err: any) {
      logger.warn(`Port wait failed, using default URL:`, err.message);
    }

    logger.info('DevBox created successfully', {
      sandboxId,
      url: previewUrl,
      port: actualPort,
    });

    // Start VFS sync - sync files between VFS database and CodeSandbox
    // This enables bidirectional sync: VFS → Sandbox and Sandbox → VFS
    try {
      sandboxFilesystemSync.startSync(sandboxId, authResult.userId);
      logger.info('VFS sync started for DevBox', { sandboxId, userId: authResult.userId });
    } catch (syncErr: any) {
      logger.warn('Failed to start VFS sync for DevBox:', syncErr.message);
    }

    return NextResponse.json({
      success: true,
      sandboxId,
      url: previewUrl,
      port: actualPort,
      template,
      provider: 'codesandbox',
    });
  } catch (error: any) {
    logger.error('Failed to create DevBox:', error);

    // Surface the underlying SDK / provider error so the client can display a
    // meaningful message rather than the generic "Failed to create..." string.
    const detail = error?.message || String(error);
    
    // Map common error patterns to user-friendly messages
    const errorMessages: Record<string, { message: string; status: number; code: string }> = {
      'unauthorized': { 
        message: 'CodeSandbox authentication failed. Check that CSB_API_KEY is correct.', 
        status: 401, 
        code: 'AUTH_FAILED' 
      },
      'forbidden': { 
        message: 'API key lacks permissions. Check CSB_API_KEY scopes.', 
        status: 403, 
        code: 'PERMISSION_DENIED' 
      },
      'api key': { 
        message: 'Invalid API key format. CSB_API_KEY should be a valid CodeSandbox API key.', 
        status: 401, 
        code: 'INVALID_API_KEY' 
      },
      'quota': { 
        message: 'CodeSandbox quota exceeded. Try again later.', 
        status: 429, 
        code: 'QUOTA_EXCEEDED' 
      },
      'template': { 
        message: `Invalid template '${template}'. Use: ${validTemplates.join(', ')}.`, 
        status: 400, 
        code: 'INVALID_TEMPLATE' 
      },
      'rate limit': { 
        message: 'Too many requests. Please wait before creating another sandbox.', 
        status: 429, 
        code: 'RATE_LIMITED' 
      },
      'timeout': { 
        message: 'Sandbox creation timed out. Please try again.', 
        status: 504, 
        code: 'TIMEOUT' 
      },
    };

    // Find matching error pattern
    const detailLower = detail.toLowerCase();
    const matchedKey = Object.keys(errorMessages).find(k => detailLower.includes(k));
    
    if (matchedKey) {
      const errorConfig = errorMessages[matchedKey];
      logger.error(`DevBox error: ${errorConfig.code}`, { detail, userId: authResult?.userId || 'unknown' });

      return NextResponse.json(
        {
          error: errorConfig.message,
          code: errorConfig.code,
          details: process.env.NODE_ENV === 'development' ? detail : undefined,
        },
        { status: errorConfig.status }
      );
    }

    // Generic error with detail for debugging
    logger.error('DevBox creation failed', { detail, userId: authResult?.userId || 'unknown' });
    
    return NextResponse.json(
      {
        error: `Failed to create cloud development environment: ${detail}`,
        code: 'SANDBOX_CREATE_FAILED',
        details: process.env.NODE_ENV === 'development' ? detail : undefined,
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/sandbox/devbox
 * Get active DevBox session info
 */
export async function GET(req: NextRequest) {
  try {
    const authResult = await resolveRequestAuth(req, { allowAnonymous: false });
    if (!authResult.success || !authResult.userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const userId = authResult.userId;
    const session = activeDevboxSessions.get(userId);

    if (!session) {
      return NextResponse.json({ 
        success: true, 
        hasActiveSession: false,
        message: 'No active DevBox session'
      });
    }

    // Check if session is stale (older than 30 minutes)
    const isStale = Date.now() - session.createdAt > 30 * 60 * 1000;

    return NextResponse.json({
      success: true,
      hasActiveSession: true,
      session: {
        sandboxId: session.sandboxId,
        template: session.template,
        createdAt: new Date(session.createdAt).toISOString(),
        isStale,
      },
    });
  } catch (error: any) {
    logger.error('Failed to get DevBox session:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * DELETE /api/sandbox/devbox
 * Clean up/hibernate active DevBox session
 */
export async function DELETE(req: NextRequest) {
  let authResult: Awaited<ReturnType<typeof resolveRequestAuth>> | null = null;
  
  try {
    const url = new URL(req.nextUrl);
    const sandboxId = url.searchParams.get('sandboxId');

    authResult = await resolveRequestAuth(req, { allowAnonymous: false });
    if (!authResult.success || !authResult.userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const userId = authResult.userId;
    const session = activeDevboxSessions.get(userId);

    // If specific sandboxId provided, use it; otherwise use stored session
    const targetSandboxId = sandboxId || session?.sandboxId;
    
    if (!targetSandboxId) {
      return NextResponse.json({ 
        error: 'No active DevBox session to clean up',
        code: 'NO_SESSION'
      }, { status: 400 });
    }

    // Try to hibernate the sandbox via provider
    try {
      const provider = await sandboxBridge.getProvider('codesandbox');
      // Use the hibernate method from the sandbox handle (CodeSandbox-specific)
      const sandbox = await provider.getSandbox(targetSandboxId);
      const csSandbox = sandbox as any;
      if (csSandbox.hibernate) {
        await csSandbox.hibernate();
        logger.info(`Hibernated sandbox ${targetSandboxId}`);
      } else if (csSandbox.shutdown) {
        // Fallback to shutdown if hibernate not available
        await csSandbox.shutdown();
        logger.info(`Shutdown sandbox ${targetSandboxId}`);
      }
    } catch (err: any) {
      logger.warn(`Failed to hibernate sandbox ${targetSandboxId}:`, err.message);
    }

    // Clear the session from tracking
    activeDevboxSessions.delete(userId);

    logger.info('DevBox session cleaned up', { userId, sandboxId: targetSandboxId });

    return NextResponse.json({
      success: true,
      message: 'DevBox session cleaned up',
      sandboxId: targetSandboxId,
    });
  } catch (error: any) {
    logger.error('Failed to cleanup DevBox session:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
