import { NextRequest, NextResponse } from 'next/server';
import { resolveRequestAuth } from '@/lib/auth/request-auth';

const loadDocker = async () => {
  // Standard dynamic import - no eval-like constructs
  const mod = await import('dockerode');
  return mod.default;
};

export async function GET(
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
    const limit = Number(new URL(req.url).searchParams.get('tail') || '200');
    const Docker = await loadDocker();
    // Respect DOCKER_SOCKET env var for custom socket paths, otherwise use dockerode defaults
    const docker = new Docker(
      process.env.DOCKER_SOCKET ? { socketPath: process.env.DOCKER_SOCKET } : undefined
    );
    const container = docker.getContainer(id);
    const logBuffer = await container.logs({
      stdout: true,
      stderr: true,
      timestamps: true,
      tail: Number.isFinite(limit) ? limit : 200,
    });

    // Docker logs have an 8-byte header per message when TTY is disabled:
    // [stream(1), reserved(3), length(4)]
    // For TTY-enabled containers, logs are raw text without headers.
    // Detect format by checking if first byte is a valid stream type (0=stdin, 1=stdout, 2=stderr)
    const parseDockerLog = (buffer: Buffer): string[] => {
      const lines: string[] = [];
      
      // Detect multiplexed format: first byte should be 0, 1, or 2 (stream type)
      // and bytes 5-8 should contain a reasonable payload length
      const isMultiplexed = buffer.length >= 8 &&
        (buffer[0] === 0 || buffer[0] === 1 || buffer[0] === 2) &&
        buffer.readUInt32BE(4) <= buffer.length - 8;

      if (isMultiplexed) {
        // Parse multiplexed format with 8-byte headers
        let offset = 0;
        while (offset < buffer.length) {
          if (offset + 8 > buffer.length) break;
          const payloadLength = buffer.readUInt32BE(offset + 4);
          if (offset + 8 + payloadLength > buffer.length) break;

          const line = buffer.slice(offset + 8, offset + 8 + payloadLength).toString('utf8').trim();
          if (line) lines.push(line);
          offset += 8 + payloadLength;
        }
      } else {
        // Raw text format (TTY mode) - split directly
        const text = buffer.toString('utf8');
        const rawLines = text.split('\n').filter(Boolean);
        lines.push(...rawLines);
      }

      return lines;
    };

    const lines = parseDockerLog(logBuffer);
    const entries = lines.map((line) => {
      const timestampMatch = line.match(/^(\d{4}-\d{2}-\d{2}T[^\s]+)\s(.*)$/);
      return {
        timestamp: timestampMatch?.[1] || new Date().toISOString(),
        level: /error|exception|fail/i.test(line) ? 'ERROR' : /warn/i.test(line) ? 'WARN' : 'INFO',
        message: timestampMatch?.[2] ?? line,
      };
    });

    return NextResponse.json(entries);
  } catch (error) {
    console.error('Docker logs error:', error);
    return NextResponse.json({ error: 'Failed to load logs' }, { status: 500 });
  }
}
