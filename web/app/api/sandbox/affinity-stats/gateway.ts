import { NextRequest, NextResponse } from 'next/server';
import { sandboxOrchestrator } from '@/lib/sandbox/sandbox-orchestrator';
import { workspaceFSSnapshotService } from '@/lib/sandbox/workspacefs-snapshot-service';
import { resolveRequestAuth } from '@/lib/auth/request-auth';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('AffinityStatsAPI');

/**
 * GET /api/sandbox/affinity-stats
 *
 * Exposes workspace affinity and FS snapshot statistics for dashboard monitoring.
 * Shows cache warmth efficiency: how many workspaces are pinned to providers,
 * per-provider distribution, total commands routed via affinity, and snapshot health.
 *
 * SECURITY: Requires authentication. Stats are not user-specific — they show
 * server-wide aggregate metrics for operators and dashboards.
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

    const affinityStats = sandboxOrchestrator.getAffinityStats();
    const snapshotStats = workspaceFSSnapshotService.getStats();

    const affinityConfig = sandboxOrchestrator.getAffinityConfig();
    const snapshotConfig = workspaceFSSnapshotService.getConfig();

    // Compute cache warmth efficiency: how many active bindings exist
    // vs total unique workspaces (approximated by affinity + snapshot counts)
    const totalTrackedWorkspaces = Math.max(
      affinityStats.activeBindings + snapshotStats.activeSnapshots,
      1,
    );
    const cacheWarmthPercent = Math.round(
      (affinityStats.activeBindings / totalTrackedWorkspaces) * 100,
    );

    const response = {
      affinity: {
        activeBindings: affinityStats.activeBindings,
        providers: affinityStats.providers,
        totalCommands: affinityStats.totalCommands,
        cacheWarmthPercent,
      },
      snapshots: {
        activeSnapshots: snapshotStats.activeSnapshots,
        withCheckpoints: snapshotStats.withCheckpoints,
        totalEstimatedCacheMb: snapshotStats.totalEstimatedCacheMb,
      },
      config: {
        affinityEnabled: affinityConfig.enabled,
        affinityTtlMs: affinityConfig.ttlMs,
        snapshotEnabled: snapshotConfig.enabled,
        snapshotTtlMs: snapshotConfig.ttlMs,
        installTimeoutMs: snapshotConfig.installTimeoutMs,
      },
    };

    return NextResponse.json(response);
  } catch (error: any) {
    logger.error('Failed to fetch affinity stats:', error);
    return NextResponse.json(
      { error: 'Failed to fetch affinity statistics' },
      { status: 500 },
    );
  }
}
