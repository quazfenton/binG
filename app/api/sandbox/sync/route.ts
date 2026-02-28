/**
 * VFS Sync API Route
 *
 * Universal virtual filesystem synchronization endpoint.
 * Syncs files from virtual filesystem to sandbox using provider-specific optimizations.
 *
 * Features:
 * - Full sync (all files)
 * - Incremental sync (changed files only)
 * - Bootstrap mode (initial sync with workspace setup)
 * - Provider-specific optimizations (Tar-Pipe for Sprites, batch for Blaxel)
 *
 * API Reference: /api/sandbox/sync
 */

import { NextRequest, NextResponse } from 'next/server';
import { UniversalVfsSync, type VfsFile, type SyncOptions } from '@/lib/sandbox/providers/universal-vfs-sync';
import { getSandboxProvider } from '@/lib/sandbox/providers';
import type { SandboxProviderType } from '@/lib/sandbox/providers';

export interface SyncRequest {
  sandboxId: string;
  provider: string;
  mode: 'full' | 'incremental' | 'bootstrap';
  files?: VfsFile[];
  lastSyncTime?: number;
  workspaceDir?: string;
  timeout?: number;
}

export interface SyncResponse {
  success: boolean;
  message?: string;
  filesSynced?: number;
  bytesTransferred?: number;
  duration?: number;
  method?: string;
  changedFiles?: number;
  error?: string;
}

/**
 * POST /api/sandbox/sync
 *
 * Sync virtual filesystem to sandbox
 */
export async function POST(req: NextRequest): Promise<NextResponse<SyncResponse>> {
  try {
    const body: SyncRequest = await req.json();
    const {
      sandboxId,
      provider,
      mode,
      files,
      lastSyncTime,
      workspaceDir,
      timeout,
    } = body;

    // Validate required fields
    if (!sandboxId || !provider) {
      return NextResponse.json(
        {
          success: false,
          error: 'sandboxId and provider are required',
        },
        { status: 400 }
      );
    }

    if (!files || files.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'No files to sync',
        },
        { status: 400 }
      );
    }

    // Validate mode
    if (mode === 'incremental' && !lastSyncTime) {
      return NextResponse.json(
        {
          success: false,
          error: 'lastSyncTime required for incremental sync',
        },
        { status: 400 }
      );
    }

    // Get sandbox provider
    const sandboxProvider = getSandboxProvider(provider as SandboxProviderType);
    if (!sandboxProvider) {
      return NextResponse.json(
        {
          success: false,
          error: `Unknown provider: ${provider}`,
        },
        { status: 400 }
      );
    }

    // Get or create sandbox handle
    let handle;
    try {
      handle = await sandboxProvider.getSandbox(sandboxId);
    } catch (error: any) {
      return NextResponse.json(
        {
          success: false,
          error: `Failed to get sandbox: ${error.message}`,
        },
        { status: 500 }
      );
    }

    // Prepare sync options
    const syncOptions: SyncOptions = {
      workspaceDir: workspaceDir || getDefaultWorkspaceDir(provider),
      timeout: timeout || 60000,
      incremental: mode === 'incremental',
      lastSyncTime,
    };

    // Perform sync
    const result = await UniversalVfsSync.sync(handle, provider, files, syncOptions);

    if (result.success) {
      return NextResponse.json({
        success: true,
        message: 'VFS sync completed successfully',
        filesSynced: result.filesSynced,
        bytesTransferred: result.bytesTransferred,
        duration: result.duration,
        method: result.method,
        changedFiles: result.changedFiles,
      });
    } else {
      return NextResponse.json(
        {
          success: false,
          error: result.error || 'Sync failed',
        },
        { status: 500 }
      );
    }
  } catch (error: any) {
    console.error('[VFS Sync API] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Sync failed',
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/sandbox/sync
 *
 * Get sync status and capabilities
 */
export async function GET(req: NextRequest): Promise<NextResponse<any>> {
  try {
    const { searchParams } = new URL(req.url);
    const sandboxId = searchParams.get('sandboxId');
    const provider = searchParams.get('provider');

    if (!sandboxId || !provider) {
      return NextResponse.json({
        message: 'VFS Sync API',
        endpoints: {
          POST: 'Sync files to sandbox',
          GET: 'Get sync status',
        },
        modes: ['full', 'incremental', 'bootstrap'],
        supportedProviders: ['sprites', 'blaxel', 'daytona', 'e2b', 'microsandbox'],
      });
    }

    // Get sandbox info
    const sandboxProvider = getSandboxProvider(provider as SandboxProviderType);
    if (!sandboxProvider) {
      return NextResponse.json({
        error: `Unknown provider: ${provider}`,
      });
    }

    return NextResponse.json({
      sandboxId,
      provider,
      status: 'active',
      capabilities: {
        batch: true,
        incremental: true,
        tarPipe: provider === 'sprites',
      },
    });
  } catch (error: any) {
    return NextResponse.json({
      error: error.message,
    });
  }
}

/**
 * Get default workspace directory for provider
 */
function getDefaultWorkspaceDir(provider: string): string {
  const workspaceDirs: Record<string, string> = {
    sprites: '/home/sprite/workspace',
    blaxel: '/workspace',
    daytona: '/workspace',
    e2b: '/home/user',
    microsandbox: '/workspace',
  };

  return workspaceDirs[provider] || '/workspace';
}
