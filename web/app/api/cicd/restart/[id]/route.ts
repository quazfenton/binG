import { NextRequest, NextResponse } from 'next/server';


import { resolveRequestAuth } from '@/lib/auth/request-auth';
import { createAuditLogger, type AuditLogger } from '@/lib/audit/audit-logger';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let auditLogger: AuditLogger | null = null;

  try {
    // SECURITY: Require authentication to prevent unauthorized pipeline restarts
    const authResult = await resolveRequestAuth(req, {
      allowAnonymous: false,
    });

    if (!authResult.success || !authResult.userId) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    auditLogger = createAuditLogger(req, authResult.userId);
    const { id } = await params;

    // AUDIT: Log restart attempt
    auditLogger.log({
      action: 'pipeline_restart_requested',
      resource: id,
      outcome: 'success',
      details: { source: 'api' },
    });

    const endpointBase = process.env.CICD_RESTART_API_BASE_URL;
    if (!endpointBase) {
      auditLogger.failure('pipeline_restart', { reason: 'CICD_RESTART_API_BASE_URL not configured' }, id);
      return NextResponse.json({ error: 'CICD_RESTART_API_BASE_URL is not configured' }, { status: 501 });
    }

    const token = process.env.CICD_API_TOKEN;
    const endpoint = `${endpointBase.replace(/\/$/, '')}/${encodeURIComponent(id)}`;
    const upstream = await fetch(endpoint, {
      method: 'POST',
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    let data;
    try {
      data = await upstream.json();
    } catch {
      data = {};
    }
    if (!upstream.ok) {
      auditLogger.failure('pipeline_restart', { upstreamStatus: upstream.status, error: data?.error }, id);
      return NextResponse.json({ error: data?.error || 'Failed to restart pipeline' }, { status: upstream.status });
    }

    // AUDIT: Log successful restart
    auditLogger.success('pipeline_restart', { upstreamResponse: data }, id);
    return NextResponse.json({ success: true, data });
  } catch (error) {
    // AUDIT: Log error
    if (auditLogger) {
      auditLogger.error('pipeline_restart', error, 'unknown');
    } else {
      const fallbackLogger = createAuditLogger(req, 'unknown');
      fallbackLogger.error('pipeline_restart', error, 'unknown');
    }
    console.error('Pipeline restart error:', error);
    return NextResponse.json({ error: 'Failed to restart pipeline' }, { status: 500 });
  }
}
