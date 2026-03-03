/**
 * Backend API Router
 * Main entry point for all backend operations
 * Routes requests to appropriate backend modules
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  sandboxManager,
  previewRouter,
  webSocketTerminalServer,
  getS3Backend,
  getLocalBackend,
  getFirecrackerRuntime,
  getProcessRuntime,
  sandboxMetrics,
  quotaManager,
  workspaceManager,
  snapshotManager,
} from '@/lib/backend';

// Initialize backend services
let initialized = false;

async function initializeBackend() {
  if (initialized) return;
  
  try {
    // Initialize storage backend
    const storageType = process.env.STORAGE_TYPE || 'local';
    if (storageType === 's3') {
      getS3Backend({
        endpointUrl: process.env.S3_ENDPOINT,
        accessKey: process.env.S3_ACCESS_KEY || '',
        secretKey: process.env.S3_SECRET_KEY || '',
        bucket: process.env.S3_BUCKET || 'ephemeral-snapshots',
        region: process.env.S3_REGION || 'us-east-1',
        prefix: 'snapshots/',
      });
    } else {
      getLocalBackend(process.env.LOCAL_SNAPSHOT_DIR || '/tmp/snapshots');
    }

    // Initialize runtime
    const runtimeType = process.env.RUNTIME_TYPE || 'auto';
    if (runtimeType === 'firecracker') {
      getFirecrackerRuntime({
        firecrackerBin: process.env.FIRECRACKER_BIN,
        jailerBin: process.env.JAILER_BIN,
        baseDir: process.env.FIRECRACKER_BASE_DIR || '/tmp/firecracker',
      });
    } else {
      getProcessRuntime(process.env.WORKSPACE_DIR || '/tmp/workspaces');
    }

    // Start WebSocket terminal server
    const wsPort = parseInt(process.env.WEBSOCKET_PORT || '8080');
    await webSocketTerminalServer.start(wsPort);

    initialized = true;
    console.log('[Backend] Initialized successfully');
  } catch (error: any) {
    console.error('[Backend] Initialization failed:', error.message);
    throw error;
  }
}

// GET /api/backend/health - Health check endpoint
export async function GET(request: NextRequest) {
  try {
    const health = {
      status: 'healthy',
      version: '1.0.0',
      services: {
        websocket: webSocketTerminalServer.getActiveSessions() >= 0,
        storage: true,
        runtime: true,
        metrics: true,
      },
      activeSessions: webSocketTerminalServer.getActiveSessions(),
      timestamp: new Date().toISOString(),
    };

    sandboxMetrics.httpRequestsTotal.inc({ method: 'GET', path: '/api/backend/health', status: '200' });

    return NextResponse.json(health);
  } catch (error: any) {
    sandboxMetrics.httpRequestsTotal.inc({ method: 'GET', path: '/api/backend/health', status: '500' });
    return NextResponse.json({ status: 'unhealthy', error: error.message }, { status: 500 });
  }
}

// POST /api/backend/sandbox/create - Create a new sandbox
export async function POST(request: NextRequest) {
  try {
    await initializeBackend();

    const body = await request.json();
    const { sandboxId } = body;

    // Check quota
    if (!quotaManager.allowExecution(sandboxId || 'anonymous')) {
      return NextResponse.json({ error: 'quota_exceeded' }, { status: 429 });
    }

    const sandbox = await sandboxManager.createSandbox(sandboxId);
    
    sandboxMetrics.sandboxCreatedTotal.inc();
    sandboxMetrics.sandboxActive.inc();

    return NextResponse.json({
      sandboxId: sandbox.sandboxId,
      workspace: sandbox.workspace,
      status: 'created',
    }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// DELETE /api/backend/sandbox/:id - Delete a sandbox
export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    await initializeBackend();

    const sandboxId = params.id;
    await sandboxManager.deleteSandbox(sandboxId);
    
    sandboxMetrics.sandboxActive.dec();

    return NextResponse.json({ success: true, message: 'Sandbox deleted' });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST /api/backend/sandbox/:id/exec - Execute command in sandbox
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    await initializeBackend();

    const sandboxId = params.id;
    const body = await request.json();
    const { command, args, code, timeout } = body;

    // Check quota
    if (!quotaManager.allowExecution(sandboxId)) {
      return NextResponse.json({ error: 'quota_exceeded' }, { status: 429 });
    }

    const result = await sandboxManager.execCommand(sandboxId, command, args, code, timeout);
    
    sandboxMetrics.sandboxExecTotal.inc({ sandbox_id: sandboxId, command: command });

    return NextResponse.json(result);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST /api/backend/sandbox/:id/files - Write file to sandbox
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    await initializeBackend();

    const sandboxId = params.id;
    const body = await request.json();
    const { path, data } = body;

    await sandboxManager.writeFile(sandboxId, path, data);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// GET /api/backend/sandbox/:id/files - List files in sandbox
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    await initializeBackend();

    const sandboxId = params.id;
    const url = new URL(request.url);
    const path = url.searchParams.get('path') || '';

    const files = await sandboxManager.listFiles(sandboxId, path);

    return NextResponse.json({ files });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// GET /api/backend/sandbox/:id/files/:path - Read file from sandbox
export async function GET(request: NextRequest, { params }: { params: { id: string; path: string } }) {
  try {
    await initializeBackend();

    const sandboxId = params.id;
    const filePath = decodeURIComponent(params.path);

    const content = await sandboxManager.readFile(sandboxId, filePath);

    return NextResponse.json({ content });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST /api/backend/snapshot/create - Create snapshot
export async function POST(request: NextRequest) {
  try {
    await initializeBackend();

    const body = await request.json();
    const { sandboxId, snapshotId } = body;

    // Use sandboxId as userId for snapshot management
    const userId = sandboxId;
    
    const result = await snapshotManager.createSnapshot(userId, snapshotId);
    await snapshotManager.enforceRetention(userId, 5);

    sandboxMetrics.snapshotCreatedTotal.inc();

    return NextResponse.json({
      success: true,
      snapshotId: result.snapshotId,
      size: `${(result.sizeBytes / 1024 / 1024).toFixed(1)}MB`,
      location: result.path,
    }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST /api/backend/snapshot/restore - Restore snapshot
export async function POST(request: NextRequest) {
  try {
    await initializeBackend();

    const body = await request.json();
    const { sandboxId, snapshotId } = body;

    // Use sandboxId as userId for snapshot management
    const userId = sandboxId;
    
    await snapshotManager.restoreSnapshot(userId, snapshotId);

    sandboxMetrics.snapshotRestoredTotal.inc();

    return NextResponse.json({
      success: true,
      snapshotId,
      message: 'Snapshot restored successfully',
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// GET /api/backend/snapshot/list - List snapshots
export async function GET(request: NextRequest) {
  try {
    await initializeBackend();

    const url = new URL(request.url);
    const sandboxId = url.searchParams.get('sandboxId');

    if (!sandboxId) {
      return NextResponse.json({ error: 'sandboxId required' }, { status: 400 });
    }

    const snapshots = await snapshotManager.listSnapshots(sandboxId);

    return NextResponse.json({
      snapshots: snapshots.map(s => ({
        id: s.snapshotId,
        size: `${(s.sizeBytes / 1024 / 1024).toFixed(1)}MB`,
        date: s.createdAt.toISOString(),
        path: s.path,
      })),
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// DELETE /api/backend/snapshot/:id - Delete snapshot
export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    await initializeBackend();

    const url = new URL(request.url);
    const sandboxId = url.searchParams.get('sandboxId');
    
    if (!sandboxId) {
      return NextResponse.json({ error: 'sandboxId required' }, { status: 400 });
    }

    const snapshotId = params.id;
    const deleted = await snapshotManager.deleteSnapshot(sandboxId, snapshotId);

    if (!deleted) {
      return NextResponse.json({ error: 'Snapshot not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, snapshotId });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST /api/backend/workspace - Create workspace
export async function POST(request: NextRequest) {
  try {
    await initializeBackend();

    const body = await request.json();
    const { agentId, name, description, tags } = body;

    const workspace = await workspaceManager.createWorkspace(agentId, name, description, tags);

    return NextResponse.json(workspace, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// GET /api/backend/workspace - List workspaces
export async function GET(request: NextRequest) {
  try {
    await initializeBackend();

    const url = new URL(request.url);
    const agentId = url.searchParams.get('agentId');

    if (!agentId) {
      return NextResponse.json({ error: 'agentId required' }, { status: 400 });
    }

    const workspaces = await workspaceManager.listWorkspaces(agentId);

    return NextResponse.json({ workspaces });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// GET /api/backend/marketplace - Search marketplace
export async function GET(request: NextRequest) {
  try {
    await initializeBackend();

    const url = new URL(request.url);
    const query = url.searchParams.get('q');
    const tags = url.searchParams.get('tags')?.split(',');

    const workers = await workspaceManager.searchMarketplace(query, tags);

    return NextResponse.json({ workers });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST /api/backend/marketplace/publish - Publish worker
export async function POST(request: NextRequest) {
  try {
    await initializeBackend();

    const body = await request.json();
    const { author, name, description, tags, endpointUrl, pricing } = body;

    const worker = await workspaceManager.publishWorker(author, {
      name,
      description,
      tags,
      endpointUrl,
      pricing,
    });

    return NextResponse.json(worker, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
