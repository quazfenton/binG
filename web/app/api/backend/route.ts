/**
 * Backend API Router
 * Main entry point for all backend operations
 * Routes requests to appropriate backend modules
 */

import { NextRequest, NextResponse } from 'next/server';


import {
  sandboxManager,
  previewRouter,
  getS3Backend,
  getLocalBackend,
  getFirecrackerRuntime,
  getProcessRuntime,
  sandboxMetrics,
  quotaManager,
  workspaceManager,
  snapshotManager,
} from '@/lib/backend';

// Lazy import WebSocket terminal server to avoid constructor issues
let _webSocketTerminalServer: any = null;

async function getWebSocketTerminalServer() {
  if (!_webSocketTerminalServer) {
    try {
      const { webSocketTerminalServer } = await import('@/lib/terminal/websocket-terminal');
      _webSocketTerminalServer = webSocketTerminalServer;
    } catch (error) {
      console.warn('[Backend] Failed to load WebSocket terminal server:', (error as Error).message);
      return null;
    }
  }
  return _webSocketTerminalServer;
}

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

    // Start WebSocket terminal server (lazy load)
    const wsPort = parseInt(process.env.WEBSOCKET_PORT || '8080');
    const wsServer = await getWebSocketTerminalServer();
    if (wsServer) {
      try {
        await wsServer.start(wsPort);
      } catch (error: any) {
        console.warn('[Backend] WebSocket server unavailable, continuing without internal WS:', error.message);
      }
    }

    initialized = true;
    console.log('[Backend] Initialized successfully');
  } catch (error: any) {
    console.error('[Backend] Initialization failed:', error.message);
    throw error;
  }
}

// POST /api/backend - Initialize backend and WebSocket server
export async function POST(request: NextRequest) {
  try {
    await initializeBackend();
    
    const wsServer = await getWebSocketTerminalServer();
    const result = {
      success: true,
      initialized: true,
      websocket: !!wsServer,
      activeSessions: wsServer ? wsServer.getActiveSessions() : 0,
      timestamp: new Date().toISOString(),
    };
    
    sandboxMetrics.httpRequestsTotal.inc({ method: 'POST', path: '/api/backend', status: '200' });
    return NextResponse.json(result);
  } catch (error: any) {
    sandboxMetrics.httpRequestsTotal.inc({ method: 'POST', path: '/api/backend', status: '500' });
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// GET /api/backend/health - Health check endpoint
export async function GET(request: NextRequest) {
  try {
    await initializeBackend();

    // Check if it's a health check or a search/list request
    const url = new URL(request.url);
    const path = url.pathname;

    if (path.endsWith('/health')) {
      const wsServer = await getWebSocketTerminalServer();
      const health = {
        status: 'healthy',
        version: '1.0.0',
        services: {
          websocket: !!wsServer,
          storage: true,
          runtime: true,
          metrics: true,
        },
        activeSessions: wsServer ? wsServer.getActiveSessions() : 0,
        timestamp: new Date().toISOString(),
      };
      sandboxMetrics.httpRequestsTotal.inc({ method: 'GET', path: '/api/backend/health', status: '200' });
      return NextResponse.json(health);
    }

    return NextResponse.json({ error: 'Not Found' }, { status: 404 });
  } catch (error: any) {
    sandboxMetrics.httpRequestsTotal.inc({ method: 'GET', path: '/api/backend/health', status: '500' });
    return NextResponse.json({ status: 'unhealthy', error: error.message }, { status: 500 });
  }
}

