import { NextRequest, NextResponse } from 'next/server';
import { resolveRequestAuth } from '@/lib/auth/request-auth';

export async function GET(req: NextRequest) {
  try {
    // SECURITY: Require authentication to prevent unauthorized access to CI/CD data
    const authResult = await resolveRequestAuth(req, {
      allowAnonymous: false,
    });

    if (!authResult.success || !authResult.userId) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const endpoint = process.env.CICD_PIPELINES_API_URL;
    if (!endpoint) {
      return NextResponse.json({ error: 'CICD_PIPELINES_API_URL is not configured' }, { status: 501 });
    }

    const token = process.env.CICD_API_TOKEN;
    const upstream = await fetch(endpoint, {
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      cache: 'no-store',
    });
    const data = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      return NextResponse.json({ error: data?.error || 'Failed to fetch pipelines' }, { status: upstream.status });
    }
    return NextResponse.json(Array.isArray(data) ? data : data?.pipelines || []);
  } catch (error) {
    console.error('Pipelines error:', error);
    return NextResponse.json({ error: 'Failed to fetch pipelines' }, { status: 500 });
  }
}
