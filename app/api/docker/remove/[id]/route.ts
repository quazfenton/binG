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
 * Also allows container names with hyphens, underscores, and dots.
 */
const validateContainerId = (id: string): boolean => {
  // Hex ID (12-64 chars) or valid container name
  return /^[a-f0-9]{12,64}$/.test(id.toLowerCase()) || /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(id);
};

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await resolveRequestAuth(req, { allowAnonymous: false });
    if (!authResult.success || !authResult.userId) {
      return NextResponse.json(
        { error: 'Unauthorized: valid authentication token required' },
        { status: 401 }
      );
    }

    const { id } = await params;

    // SECURITY: Validate container ID format
    if (!validateContainerId(id)) {
      return NextResponse.json(
        { error: 'Invalid container ID format' },
        { status: 400 }
      );
    }

    const Docker = await loadDocker();
    // Let dockerode use its default socket detection (handles DOCKER_HOST, Windows pipes, etc.)
    const docker = new Docker();
    const container = docker.getContainer(id);
    await container.remove({ force: true });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Docker remove error:', error);
    return NextResponse.json({ error: 'Failed to remove container' }, { status: 500 });
  }
}
