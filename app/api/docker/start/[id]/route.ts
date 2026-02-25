import { NextRequest, NextResponse } from 'next/server';

const loadDocker = async () => {
  const importAny = (m: string) => new Function('moduleName', 'return import(moduleName)')(m) as Promise<any>;
  const mod = await importAny('dockerode');
  return mod.default;
};

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const Docker = await loadDocker();
    const docker = new Docker({ socketPath: process.env.DOCKER_SOCKET || '/var/run/docker.sock' });
    const container = docker.getContainer(id);
    await container.start();
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Docker start error:', error);
    return NextResponse.json({ error: 'Failed to start container' }, { status: 500 });
  }
}
