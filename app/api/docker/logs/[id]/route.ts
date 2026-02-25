import { NextRequest, NextResponse } from 'next/server';
import { resolveRequestAuth } from '@/lib/auth/request-auth';

const loadDocker = async () => {
  const importAny = (m: string) => new Function('moduleName', 'return import(moduleName)')(m) as Promise<any>;
  const mod = await importAny('dockerode');
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
    const docker = new Docker({ socketPath: process.env.DOCKER_SOCKET || '/var/run/docker.sock' });
    const container = docker.getContainer(id);
    const logBuffer = await container.logs({
      stdout: true,
      stderr: true,
      timestamps: true,
      tail: Number.isFinite(limit) ? limit : 200,
    });

    const text = Buffer.isBuffer(logBuffer) ? logBuffer.toString('utf8') : String(logBuffer);
    const lines = text.split('\n').filter(Boolean);
    const entries = lines.map((line) => {
      const timestampMatch = line.match(/^(\d{4}-\d{2}-\d{2}T[^\s]+)\s(.*)$/);
      return {
        timestamp: timestampMatch?.[1] || new Date().toISOString(),
        level: /error|exception|fail/i.test(line) ? 'ERROR' : /warn/i.test(line) ? 'WARN' : 'INFO',
        message: timestampMatch?.[2] || line,
      };
    });

    return NextResponse.json(entries);
  } catch (error) {
    console.error('Docker logs error:', error);
    return NextResponse.json({ error: 'Failed to load logs' }, { status: 500 });
  }
}
