/**
 * Text Chunking
 * 
 * Splits text into overlapping chunks for embedding.
 * @module vector-memory/chunking
 */

import type { ChunkOptions } from './types';

const DEFAULT_CHUNK_SIZE = 3000;
const DEFAULT_OVERLAP = 1000;

export function chunkText(
  text: string,
  options: ChunkOptions = {}
): string[] {
  const size = options.size ?? DEFAULT_CHUNK_SIZE;
  const overlap = options.overlap ?? DEFAULT_OVERLAP;

  if (text.length <= size) {
    return [text];
  }

  const chunks: string[] = [];
  const step = size - overlap;

  for (let i = 0; i < text.length; i += step) {
    const chunk = text.slice(i, i + size);
    if (chunk.trim()) {
      chunks.push(chunk);
    }
    if (i + size >= text.length) break;
  }

  return chunks;
}

export function chunkByLines(
  text: string,
  maxLines: number = 30,
  overlapLines: number = 5
): string[] {
  const lines = text.split('\n');

  if (lines.length <= maxLines) {
    return [text];
  }

  const chunks: string[] = [];
  const step = maxLines - overlapLines;

  for (let i = 0; i < lines.length; i += step) {
    const chunk = lines.slice(i, i + maxLines).join('\n');
    if (chunk.trim()) {
      chunks.push(chunk);
    }
    if (i + maxLines >= lines.length) break;
  }

  return chunks;
}
