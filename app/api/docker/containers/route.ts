import { NextRequest, NextResponse } from 'next/server';
import { resolveRequestAuth } from '@/lib/auth/request-auth';

const loadDocker = async () => {
  // Standard dynamic import - no eval-like constructs
  const mod = await import('dockerode');
  return mod.default;
};

export async function GET(req: NextRequest) {
  try {
    const authResult = await resolveRequestAuth(req, { allowAnonymous: false });
    if (!authResult.success || !authResult.userId) {
      return NextResponse.json(
        { error: 'Unauthorized: valid authentication token required' },
        { status: 401 }
      );
    }

    const Docker = await loadDocker();
    // Let dockerode use its default socket detection (handles DOCKER_HOST, Windows pipes, etc.)
    const docker = new Docker();
    const containers = await docker.listContainers({ all: true });
    const formatted = containers.map((c: any) => ({
      id: String(c.Id || '').slice(0, 12),
      name: (c.Names?.[0] || '').replace('/', ''),
      image: c.Image,
      state: c.State,
      status: c.Status,
      ports: (c.Ports || []).map((p: any) => `${p.PublicPort || ''}:${p.PrivatePort || ''}`.replace(/^:/, '')),
      created: new Date((c.Created || 0) * 1000).toISOString(),
    }));
    return NextResponse.json(formatted);
  } catch (error) {
    console.error('Docker containers error:', error);
    return NextResponse.json({ error: 'Failed to list containers' }, { status: 500 });
  }
}
