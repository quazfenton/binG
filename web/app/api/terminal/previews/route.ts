import { NextRequest, NextResponse } from 'next/server';
import { resolveRequestAuth } from '@/lib/auth/request-auth';
import { workspacePreviewRegistry } from '@/lib/terminal/workspace-preview-registry';
import { workspaceServiceManager } from '@/lib/terminal/workspace-service-manager';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('PreviewRegistryAPI');

/**
 * GET /api/terminal/previews?workspaceId=<id>
 *
 * Phase 8: Workspace Preview Registry API.
 * Returns active preview URLs for daemon services (npm run dev, flask run, etc.)
 * so AI agents can inspect workspace state in real-time.
 *
 * Query params:
 *   workspaceId - filter previews to a specific workspace (required)
 *
 * Response:
 *   { previews: [{ id, serviceName, url, port, status, framework, provider }], activeCount, totalCount }
 */
export async function GET(req: NextRequest) {
  try {
    // Require authentication
    const authResult = await resolveRequestAuth(req, { allowAnonymous: false });
    if (!authResult.success || !authResult.userId) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 },
      );
    }

    const workspaceId = req.nextUrl.searchParams.get('workspaceId');

    if (!workspaceId) {
      // Return all workspaces' preview stats (aggregated)
      const stats = workspacePreviewRegistry.getStats();
      return NextResponse.json({
        previews: [],
        stats,
        hint: 'Pass ?workspaceId=<id> to get previews for a specific workspace',
      });
    }

    const previews = workspacePreviewRegistry.getWorkspacePreviews(workspaceId);
    const services = workspaceServiceManager.listServices(workspaceId);

    const response = {
      workspaceId,
      previews: previews.map(p => ({
        id: p.id,
        serviceName: p.serviceName,
        serviceId: p.serviceId,
        url: p.url,
        port: p.port,
        protocol: p.protocol,
        status: p.status,
        framework: p.framework,
        provider: p.provider,
        confidence: p.confidence,
        registeredAt: p.registeredAt,
        lastReachableAt: p.lastReachableAt,
      })),
      activeCount: previews.filter(p => p.status === 'active').length,
      totalCount: previews.length,
      services: services.map(s => ({
        id: s.id,
        name: s.name,
        status: s.status,
        ports: s.ports.map(p => p.port),
      })),
    };

    return NextResponse.json(response);
  } catch (error: any) {
    logger.error('Failed to fetch previews:', error);
    return NextResponse.json(
      { error: 'Failed to fetch workspace previews' },
      { status: 500 },
    );
  }
}
