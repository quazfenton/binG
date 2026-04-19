/**
 * Fast Compression Utilities
 *
 * Uses Node.js native zlib (gzip) for compression.
 * Zero dependencies.
 */

import * as zlib from 'node:zlib';

export interface CompressionResult {
  data: Buffer;
  originalSize: number;
  compressedSize: number;
  ratio: number;
}

export interface CompressionOptions {
  threshold?: number;
  level?: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
}

const DEFAULT_OPTIONS: Required<CompressionOptions> = {
  threshold: 512,
  level: 3,
};

export function getVersion(): string {
  return '1.0.0';
}

/**
 * Compress data using gzip
 */
export function compress(
  data: string | Buffer,
  options: CompressionOptions = {}
): Buffer {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  if (typeof data === 'string') {
    data = Buffer.from(data, 'utf-8');
  }

  // Skip compression for small data
  if (data.length < opts.threshold) {
    return data;
  }

  try {
    return zlib.gzipSync(data, { level: opts.level });
  } catch (error) {
    console.error('[compression] Compress failed:', error);
    return data;
  }
}

/**
 * Decompress gzip data
 * Automatically detects gzip format and decompresses
 */
export function decompress(
  data: Buffer | Uint8Array,
  options: CompressionOptions = {}
): Buffer {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);

  // Check for gzip magic number (0x1f 0x8b)
  // Don't skip based on size - compressed data is always smaller!
  if (buf[0] !== 0x1f || buf[1] !== 0x8b) {
    return buf;
  }

  try {
    return zlib.gunzipSync(buf);
  } catch (error) {
    console.error('[compression] Decompress failed:', error);
    return buf;
  }
}

/**
 * Sync versions (same as async since zlib.sync is blocking)
 */
export const compressSync = compress;
export const decompressSync = decompress;

/**
 * Get compression stats
 */
export function getCompressionStats(
  original: Buffer | string,
  compressed: Buffer | string
): CompressionResult {
  const originalSize = typeof original === 'string'
    ? Buffer.byteLength(original, 'utf-8')
    : original.length;
  const compressedSize = typeof compressed === 'string'
    ? Buffer.byteLength(compressed, 'utf-8')
    : compressed.length;

  return {
    data: Buffer.isBuffer(compressed) ? compressed : Buffer.from(compressed),
    originalSize,
    compressedSize,
    ratio: compressedSize / originalSize,
  };
}

/**
 * Check if data appears to be compressed (gzip format)
 */
export function isCompressed(data: Buffer): boolean {
  if (data.length < 2) return false;
  return data[0] === 0x1f && data[1] === 0x8b;
}
