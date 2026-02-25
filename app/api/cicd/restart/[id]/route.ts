import { NextRequest, NextResponse } from 'next/server';

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const endpointBase = process.env.CICD_RESTART_API_BASE_URL;
    if (!endpointBase) {
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
    const data = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      return NextResponse.json({ error: data?.error || 'Failed to restart pipeline' }, { status: upstream.status });
    }
    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('Pipeline restart error:', error);
    return NextResponse.json({ error: 'Failed to restart pipeline' }, { status: 500 });
  }
}
