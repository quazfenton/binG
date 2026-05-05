import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';

import { resolveRequestAuth } from '@/lib/auth/request-auth';
import { verifyContainerOwnership, validateContainerId } from '@/lib/docker/docker-security';
import { loadDocker, validateCommand } from '@/lib/docker/docker-commands';

export async function POST(req: NextRequest) {
  try {
    // SECURITY: Require authentication to prevent unauthorized Docker command execution
    const authResult = await resolveRequestAuth(req, {
      allowAnonymous: false,
    });

    if (!authResult.success || !authResult.userId) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const userId = authResult.userId;

    const { containerId, command } = await req.json();
    if (!containerId || !command) {
      return NextResponse.json({ error: 'containerId and command are required' }, { status: 400 });
    }

    // SECURITY: Validate containerId format
    if (!validateContainerId(containerId)) {
      return NextResponse.json(
        { error: 'Invalid containerId format. Must be a 12-64 character hex string.' },
        { status: 400 }
      );
    }

    // Validate command against whitelist
    const validation = validateCommand(command);
    if (!validation.valid) {
      return NextResponse.json(
        { error: 'Command not allowed or contains invalid characters' },
        { status: 403 }
      );
    }

    const Docker = await loadDocker();
    const docker = new Docker(
      process.env.DOCKER_SOCKET ? { socketPath: process.env.DOCKER_SOCKET } : undefined
    );
    const container = docker.getContainer(containerId);
    
    // SECURITY: Verify container ownership via Docker labels
    const ownershipCheck = await verifyContainerOwnership(container, userId);
    if (!ownershipCheck.authorized) {
      return NextResponse.json(
        { error: ownershipCheck.error || 'Unauthorized' },
        { status: ownershipCheck.error?.includes('not found') ? 404 : 403 }
      );
    }
    
    const exec = await container.exec({
      Cmd: validation.sanitizedCmd!,
      AttachStdout: true,
      AttachStderr: true,
    });

    const output = await new Promise<string>((resolve, reject) => {
      exec.start({}, (err: any, stream: any) => {
        if (err) {
          reject(err);
          return;
        }
        let buff = '';
        stream.on('data', (chunk: Buffer) => {
          buff += chunk.toString('utf8');
        });
        stream.on('end', () => resolve(buff));
        stream.on('error', reject);
      });
    });

    return NextResponse.json({ success: true, output });
  } catch (error) {
    console.error('Docker exec error:', error);
    return NextResponse.json({ error: 'Failed to execute command' }, { status: 500 });
  }
}
