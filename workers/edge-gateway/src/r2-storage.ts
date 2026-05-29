/**
 * Cloudflare R2 Storage Adapter
 *
 * Provides file storage via R2 (S3-compatible) for the edge gateway.
 * Replaces MinIO for production deployments on Cloudflare.
 */
import type { Env } from './env';

export interface FileMetadata {
  key: string;
  size: number;
  etag: string;
  uploaded: Date;
  contentType?: string;
}

export interface FileListResult {
  files: FileMetadata[];
  truncated: boolean;
  cursor?: string;
}

/**
 * R2 Storage — file operations backed by Cloudflare R2
 */
export class R2Storage {
  private bucket: R2Bucket | null;

  constructor(env: Env) {
    this.bucket = env.BING_STORAGE ?? null;
  }

  async upload(
    key: string,
    body: ArrayBuffer | ReadableStream | string,
    options?: { contentType?: string; customMetadata?: Record<string, string> },
  ): Promise<FileMetadata> {
    if (!this.bucket) throw new Error('R2 storage not configured');
    const object = await this.bucket.put(key, body, {
      httpMetadata: options?.contentType ? { contentType: options.contentType } : undefined,
      customMetadata: options?.customMetadata,
    });
    return {
      key, size: object.size, etag: object.etag,
      uploaded: new Date(object.uploaded),
      contentType: object.httpMetadata?.contentType,
    };
  }

  async download(key: string): Promise<{ data: ReadableStream; metadata: FileMetadata } | null> {
    if (!this.bucket) return null;
    const object = await this.bucket.get(key);
    if (!object) return null;
    return {
      data: object.body,
      metadata: {
        key, size: object.size, etag: object.etag,
        uploaded: new Date(object.uploaded),
        contentType: object.httpMetadata?.contentType,
      },
    };
  }

  async delete(key: string): Promise<boolean> {
    if (!this.bucket) return false;
    await this.bucket.delete(key);
    return true;
  }

  async exists(key: string): Promise<boolean> {
    if (!this.bucket) return false;
    const head = await this.bucket.head(key);
    return head !== null;
  }

  async list(prefix?: string, cursor?: string, limit: number = 100): Promise<FileListResult> {
    if (!this.bucket) return { files: [], truncated: false };
    const result = await this.bucket.list({ prefix, cursor, limit });
    return {
      files: result.objects.map((obj) => ({
        key: obj.key, size: obj.size, etag: obj.etag,
        uploaded: new Date(obj.uploaded),
        contentType: obj.httpMetadata?.contentType,
      })),
      truncated: result.truncated,
      cursor: result.truncated ? result.cursor : undefined,
    };
  }
}

/**
 * Fetch handler for file operations through the edge gateway.
 * Requires authentication — only authenticated users can upload/delete.
 */
export async function handleFileRequest(
  request: Request,
  env: Env,
  path: string,
  userId: string | null,
): Promise<Response> {
  const storage = new R2Storage(env);

  // POST /api/files/upload
  if (request.method === 'POST' && path === '/api/files/upload') {
    if (!userId) {
      return new Response(JSON.stringify({ error: 'Authentication required' }), { status: 401 });
    }
    const formData = await request.formData();
    const fileEntry = formData.get('file');
    if (!fileEntry || typeof fileEntry === 'string') {
      return new Response(JSON.stringify({ error: 'No file provided' }), { status: 400 });
    }
    const file = fileEntry as File;
    const key = `uploads/${userId}/${Date.now()}-${file.name}`;
    const buffer = await file.arrayBuffer();
    const result = await storage.upload(key, buffer, { contentType: file.type });
    return new Response(JSON.stringify(result), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // GET /api/files/:key
  const match = path.match(/^\/api\/files\/(.+)$/);
  if (request.method === 'GET' && match) {
    const key = match[1];
    const result = await storage.download(key);
    if (!result) {
      return new Response(JSON.stringify({ error: 'File not found' }), { status: 404 });
    }
    return new Response(result.data, {
      headers: {
        'Content-Type': result.metadata.contentType ?? 'application/octet-stream',
        'Content-Length': String(result.metadata.size),
        'Cache-Control': 'public, max-age=31536000',
      },
    });
  }

  // DELETE /api/files/:key
  if (request.method === 'DELETE' && match) {
    if (!userId) {
      return new Response(JSON.stringify({ error: 'Authentication required' }), { status: 401 });
    }
    const key = match[1];
    await storage.delete(key);
    return new Response(JSON.stringify({ deleted: true }), { status: 200 });
  }

  return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
}
