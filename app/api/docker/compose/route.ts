import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const { compose } = await req.json();
    if (!compose || typeof compose !== 'string') {
      return NextResponse.json({ error: 'compose yaml is required' }, { status: 400 });
    }

    const deployEndpoint = process.env.DOCKER_COMPOSE_DEPLOY_URL;
    if (!deployEndpoint) {
      return NextResponse.json(
        { error: 'Set DOCKER_COMPOSE_DEPLOY_URL to enable compose deployments' },
        { status: 501 }
      );
    }

    const token = process.env.DOCKER_COMPOSE_DEPLOY_TOKEN;
    const upstream = await fetch(deployEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ compose }),
    });
    const data = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      return NextResponse.json({ error: data?.error || 'Compose deploy failed' }, { status: upstream.status });
    }
    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('Docker compose error:', error);
    return NextResponse.json({ error: 'Failed to deploy compose' }, { status: 500 });
  }
}
