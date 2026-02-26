import { NextRequest } from 'next/server';
import { resolveRequestAuth } from '@/lib/auth/request-auth';

export interface FilesystemOwnerResolution {
  ownerId: string;
  source: 'jwt' | 'session' | 'anonymous' | 'fallback';
  isAuthenticated: boolean;
}

export async function resolveFilesystemOwner(req: NextRequest): Promise<FilesystemOwnerResolution> {
  const auth = await resolveRequestAuth(req, { allowAnonymous: true });
  if (auth.success && auth.userId) {
    return {
      ownerId: auth.userId,
      source: auth.source || 'fallback',
      isAuthenticated: auth.source === 'jwt' || auth.source === 'session',
    };
  }

  return {
    ownerId: 'anon:public',
    source: 'fallback',
    isAuthenticated: false,
  };
}
