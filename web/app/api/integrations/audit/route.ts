import { NextRequest, NextResponse } from 'next/server';
import { resolveRequestAuth } from '@/lib/auth/request-auth';
import { getUserAuditTrail, getUserExecutionStats } from '@/lib/integrations/execution-audit';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('Integrations:Audit');

/**
 * GET /api/integrations/audit
 *
 * Returns the authenticated user's execution audit trail.
 *
 * Query params:
 * - limit (default: 50) — number of recent entries to return
 * - stats=true — return aggregated statistics instead of individual entries
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await resolveRequestAuth(request, { allowAnonymous: false });

    if (!authResult.success || !authResult.userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const userId = String(authResult.userId);
    const { searchParams } = new URL(request.url);
    const limit = Math.min(Math.max(1, parseInt(searchParams.get('limit') ?? '50', 10)), 200);

    if (searchParams.get('stats') === 'true') {
      const stats = getUserExecutionStats(userId);
      return NextResponse.json({ stats });
    }

    const entries = getUserAuditTrail(userId, limit);
    return NextResponse.json({ entries, limit, total: entries.length });

  } catch (error: any) {
    logger.error('Failed to fetch audit trail', error);
    return NextResponse.json({ error: 'Failed to fetch audit trail' }, { status: 500 });
  }
}
