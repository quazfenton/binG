import { NextRequest, NextResponse } from 'next/server';
import { resolveRequestAuth } from '@/lib/auth/request-auth';

const loadDocker = async () => {
  const importAny = (m: string) => new Function('moduleName', 'return import(moduleName)')(m) as Promise<any>;
  const mod = await importAny('dockerode');
  return mod.default;
};

export async function POST(req: NextRequest) {
  try {
    const authResult = await resolveRequestAuth(req, { allowAnonymous: false });
    if (!authResult.success || !authResult.userId) {
      return NextResponse.json(
        { error: 'Unauthorized: valid authentication token required' },
        { status: 401 }
      );
    }

    const { containerId, command } = await req.json();
    if (!containerId || !command) {
      return NextResponse.json({ error: 'containerId and command are required' }, { status: 400 });
    }

    const Docker = await loadDocker();
    const docker = new Docker({ socketPath: process.env.DOCKER_SOCKET || '/var/run/docker.sock' });
    const container = docker.getContainer(containerId);
    const exec = await container.exec({
      Cmd: ['sh', '-lc', String(command)],
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
