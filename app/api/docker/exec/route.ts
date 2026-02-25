import { NextRequest, NextResponse } from 'next/server';
import { resolveRequestAuth } from '@/lib/auth/request-auth';

const loadDocker = async () => {
  // Standard dynamic import - no eval-like constructs
  const mod = await import('dockerode');
  return mod.default;
};

// Whitelist of allowed commands to prevent command injection
// Note: Network utilities (curl, wget) are excluded to prevent data exfiltration
const allowedCommands = ['ps', 'ls', 'df', 'top', 'free', 'uptime', 'whoami', 'pwd', 'cat', 'tail', 'head', 'grep', 'find', 'du', 'netstat', 'ss', 'ip', 'ifconfig', 'ping'];

/**
 * Validates container ID format.
 * Docker container IDs are 64-character hex strings (often truncated to 12).
 */
const validateContainerId = (id: string): boolean => {
  return /^[a-f0-9]{12,64}$/.test(id.toLowerCase());
};

/**
 * Validates and sanitizes the command to prevent command injection.
 * Only allows whitelisted base commands without shell metacharacters.
 */
const validateCommand = (command: string): { valid: boolean; sanitizedCmd?: string[] } => {
  if (!command || typeof command !== 'string') {
    return { valid: false };
  }

  // Block shell metacharacters that could enable injection
  const dangerousChars = /[$`;|&<>(){}[\]\\!#*?~]/;
  if (dangerousChars.test(command)) {
    return { valid: false };
  }

  // Extract base command (first word)
  const parts = command.trim().split(/\s+/);
  const baseCmd = parts[0];

  if (!allowedCommands.includes(baseCmd)) {
    return { valid: false };
  }

  return { valid: true, sanitizedCmd: parts };
};

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

    const { containerId, command } = await req.json();
    if (!containerId || !command) {
      return NextResponse.json({ error: 'containerId and command are required' }, { status: 400 });
    }

    // SECURITY: Validate containerId format to prevent targeting arbitrary containers
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
    // Respect DOCKER_SOCKET env var for custom socket paths, otherwise use dockerode defaults
    const docker = new Docker(
      process.env.DOCKER_SOCKET ? { socketPath: process.env.DOCKER_SOCKET } : undefined
    );
    const container = docker.getContainer(containerId);
    const exec = await container.exec({
      Cmd: validation.sanitizedCmd!,
      AttachStdout: true,
      AttachStderr: true,
    });

    const output = await new Promise<string>((resolve, reject) => {
      exec.start((err: Error, stream: any) => {
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
