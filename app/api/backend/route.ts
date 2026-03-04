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
    await initializeBackend();
    
    // Check if it's a health check or a search/list request
    const url = new URL(request.url);
    const path = url.pathname;

    if (path.endsWith('/health')) {
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
    }

    return NextResponse.json({ error: 'Not Found' }, { status: 404 });
  } catch (error: any) {
    sandboxMetrics.httpRequestsTotal.inc({ method: 'GET', path: '/api/backend/health', status: '500' });
    return NextResponse.json({ status: 'unhealthy', error: error.message }, { status: 500 });
  }
}

