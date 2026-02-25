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
    // Let dockerode use its default socket detection (handles DOCKER_HOST, Windows pipes, etc.)
    const docker = new Docker();
    const container = docker.getContainer(id);
    const logBuffer = await container.logs({
      stdout: true,
      stderr: true,
      timestamps: true,
      tail: Number.isFinite(limit) ? limit : 200,
    });

    // Docker logs have an 8-byte header per message: [stream(1), reserved(3), length(4)]
    // We need to strip these headers to get clean log output
    const parseDockerLog = (buffer: Buffer): string[] => {
      const lines: string[] = [];
      let offset = 0;
      
      while (offset < buffer.length) {
        // Skip 8-byte header: stream type (1) + reserved (3) + payload length (4)
        if (offset + 8 > buffer.length) break;
        const payloadLength = buffer.readUInt32BE(offset + 4);
        if (offset + 8 + payloadLength > buffer.length) break;
        
        const line = buffer.slice(offset + 8, offset + 8 + payloadLength).toString('utf8').trim();
        if (line) lines.push(line);
        offset += 8 + payloadLength;
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
