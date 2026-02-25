import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  try {
    const endpoint = process.env.CLOUD_RESOURCES_API_URL;
    if (!endpoint) {
      return NextResponse.json(
        { error: 'CLOUD_RESOURCES_API_URL is not configured' },
        { status: 501 }
      );
    }

    const token = process.env.CLOUD_RESOURCES_API_TOKEN;
    const upstream = await fetch(endpoint, {
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      cache: 'no-store',
    });
    const data = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      return NextResponse.json({ error: data?.error || 'Failed to fetch cloud resources' }, { status: upstream.status });
    }
    return NextResponse.json(Array.isArray(data) ? data : data?.resources || []);
  } catch (error) {
    console.error('Cloud resources error:', error);
    return NextResponse.json({ error: 'Failed to fetch cloud resources' }, { status: 500 });
  }
}
