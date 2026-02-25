import { NextRequest, NextResponse } from 'next/server';
import { resolveRequestAuth } from '@/lib/auth/request-auth';

const loadDocker = async () => {
  // Standard dynamic import - no eval-like constructs
  const mod = await import('dockerode');
  return mod.default;
};

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // SECURITY: Require authentication to prevent unauthorized container manipulation
    const authResult = await resolveRequestAuth(req, {
      allowAnonymous: false,
    });

    if (!authResult.success || !authResult.userId) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const { id } = await params;
    const Docker = await loadDocker();
    // Respect DOCKER_SOCKET env var for custom socket paths, otherwise use dockerode defaults
    const docker = new Docker(
      process.env.DOCKER_SOCKET ? { socketPath: process.env.DOCKER_SOCKET } : undefined
    );
    const container = docker.getContainer(id);
    await container.stop();
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Docker stop error:', error);
    return NextResponse.json({ error: 'Failed to stop container' }, { status: 500 });
  }
}
