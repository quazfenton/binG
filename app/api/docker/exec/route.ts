import { NextRequest, NextResponse } from 'next/server';

const loadDocker = async () => {
  const importAny = (m: string) => new Function('moduleName', 'return import(moduleName)')(m) as Promise<any>;
  const mod = await importAny('dockerode');
  return mod.default;
};

export async function POST(req: NextRequest) {
  try {
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
