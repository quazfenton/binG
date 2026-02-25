import { NextRequest, NextResponse } from 'next/server';
import { resolveRequestAuth } from '@/lib/auth/request-auth';

const loadDocker = async () => {
  // Standard dynamic import - no eval-like constructs
  const mod = await import('dockerode');
  return mod.default;
};

/**
 * Validates container ID format.
 * Docker container IDs are 64-character hex strings (often truncated to 12).
 */
const validateContainerId = (id: string): boolean => {
  return /^[a-f0-9]{12,64}$/.test(id.toLowerCase());
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

    // SECURITY: Validate container ID format
    if (!validateContainerId(id)) {
      return NextResponse.json(
        { error: 'Invalid container ID format. Must be a 12-64 character hex string.' },
        { status: 400 }
      );
    }

    const Docker = await loadDocker();
    // Let dockerode use its default socket detection (handles DOCKER_HOST, Windows pipes, etc.)
    const docker = new Docker();
    const container = docker.getContainer(id);
    await container.start();
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Docker start error:', error);
    return NextResponse.json({ error: 'Failed to start container' }, { status: 500 });
  }
}
