import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';

import { getDatabase } from '@/lib/database/connection';
import { resolveRequestAuth } from '@/lib/auth/request-auth';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('Integrations:Connections');

/**
 * GET /api/integrations/connections
 * Returns all connected integrations for the authenticated user.
 * Also supports anonymous mode — returns empty connections list.
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await resolveRequestAuth(request, { allowAnonymous: true });
    const userId = authResult.success && authResult.userId ? Number(authResult.userId) : null;

    if (!userId) {
      // Anonymous — return empty connections
      return NextResponse.json({ connections: [] });
    }

    if (!Number.isFinite(userId)) {
      return NextResponse.json({ error: 'Invalid user' }, { status: 401 });
    }

    const db = getDatabase();
    if (!db) {
      return NextResponse.json({ connections: [] });
    }

    const connections = db.prepare(`
      SELECT
        provider,
        provider_account_id,
        provider_display_name,
        is_active,
        updated_at
      FROM external_connections
      WHERE user_id = ? AND is_active = TRUE
      ORDER BY updated_at DESC
    `).all(userId) as Array<{
      provider: string;
      provider_account_id: string;
      provider_display_name?: string;
      is_active: number;
      updated_at: string;
    }>;

    return NextResponse.json({
      connections: connections.map(c => ({
        provider: c.provider,
        isActive: c.is_active === 1,
        displayName: c.provider_display_name || c.provider,
        updatedAt: c.updated_at,
      })),
    });
  } catch (error: any) {
    logger.error('Failed to fetch connections', error);
    return NextResponse.json({ connections: [] });
  }
}
