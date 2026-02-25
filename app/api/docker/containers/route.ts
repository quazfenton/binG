import { NextResponse } from 'next/server';

const loadDocker = async () => {
  const importAny = (m: string) => new Function('moduleName', 'return import(moduleName)')(m) as Promise<any>;
  const mod = await importAny('dockerode');
  return mod.default;
};

export async function GET() {
  try {
    const Docker = await loadDocker();
    const docker = new Docker({
      socketPath: process.env.DOCKER_SOCKET || '/var/run/docker.sock',
    });
    const containers = await docker.listContainers({ all: true });
    const formatted = containers.map((c: any) => ({
      id: String(c.Id || '').slice(0, 12),
      name: (c.Names?.[0] || '').replace('/', ''),
      image: c.Image,
      status: c.State,
      state: c.Status,
      ports: (c.Ports || []).map((p: any) => `${p.PublicPort || ''}:${p.PrivatePort || ''}`.replace(/^:/, '')),
      created: new Date((c.Created || 0) * 1000).toISOString(),
    }));
    return NextResponse.json(formatted);
  } catch (error) {
    console.error('Docker containers error:', error);
    return NextResponse.json({ error: 'Failed to list containers' }, { status: 500 });
  }
}
