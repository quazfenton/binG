/**
 * File Indexing Pipeline
 *
 * Connects file-change events to the vector memory pipeline:
 *   file changed → hash check → chunk → embed → store
 *
 * Works with VFSFileWatcher (web/polling) and can be swapped
 * to a native FS watcher on desktop via the same interface.
 *
 * @module vector-memory/file-indexing
 */

import { contentHash } from '@/lib/cache';
import { chunkText } from './chunking';
import { getEmbeddingProvider } from './embeddings';
import type { VectorEntry, VectorStore } from './types';
import { createLogger } from '@/lib/utils/logger';
import type { FileEvent } from '@/lib/virtual-filesystem/vfs-file-watcher';

const logger = createLogger('FileIndexing');

/** Tracks content hashes so unchanged files are skipped. */
const hashCache = new Map<string, string>();

// Paths that should never be indexed
const IGNORE_PATTERNS = [
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  '.cache',
  'pnpm-lock.yaml',
  'package-lock.json',
];

function shouldIgnore(path: string): boolean {
  return IGNORE_PATTERNS.some((p) => path.includes(p));
}

/**
 * Detect language from file path extension.
 */
function detectLanguage(path: string): string | undefined {
  const ext = path.split('.').pop()?.toLowerCase();
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
    py: 'python', rs: 'rust', go: 'go', java: 'java', rb: 'ruby',
    css: 'css', html: 'html', json: 'json', md: 'markdown',
  };
  return ext ? map[ext] : undefined;
}

/**
 * Index a single file's content into a vector store.
 * Skips unchanged content (hash-based dedup).
 *
 * @returns number of new entries added (0 if skipped)
 */
export async function indexFileContent(
  store: VectorStore,
  filePath: string,
  content: string,
  projectId?: string
): Promise<number> {
  if (shouldIgnore(filePath)) return 0;

  const hash = contentHash(content);
  const cachedHash = hashCache.get(filePath);

  if (cachedHash === hash) {
    logger.debug('Skipping unchanged file', { filePath });
    return 0;
  }

  // Remove old entries for this file before re-indexing
  await store.removeByFilter({ filePath });

  const chunks = chunkText(content, { size: 600, overlap: 80 });
  const embedder = getEmbeddingProvider();
  const language = detectLanguage(filePath);

  const entries: VectorEntry[] = [];

  for (let i = 0; i < chunks.length; i++) {
    const embedding = await embedder.embed(chunks[i]);
    entries.push({
      id: `${filePath}::chunk-${i}`,
      text: chunks[i],
      embedding,
      metadata: {
        source: 'file-indexing',
        filePath,
        language,
        projectId,
        hash,
        indexedAt: Date.now(),
      },
    });
  }

  if (entries.length > 0) {
    await store.addBatch(entries);
  }

  hashCache.set(filePath, hash);
  logger.debug('Indexed file', { filePath, chunks: entries.length });
  return entries.length;
}

/**
 * Handle a VFSFileWatcher event and update the vector store.
 */
export async function handleFileEvent(
  store: VectorStore,
  event: FileEvent,
  projectId?: string
): Promise<void> {
  if (shouldIgnore(event.path)) return;

  switch (event.type) {
    case 'create':
    case 'update':
      if (event.content) {
        await indexFileContent(store, event.path, event.content, projectId);
      }
      break;

    case 'delete':
      await store.removeByFilter({ filePath: event.path });
      hashCache.delete(event.path);
      logger.debug('Removed index entries for deleted file', { path: event.path });
      break;
  }
}

/**
 * Wire a VFSFileWatcher to a project's vector store so every
 * file change automatically re-indexes.
 *
 * @example
 * ```ts
 * import { watchFiles } from '@/lib/virtual-filesystem/vfs-file-watcher';
 * import { getProjectServices } from '@/lib/project-context';
 * import { wireWatcherToIndex } from '@/lib/vector-memory/file-indexing';
 *
 * const project = getProjectServices({ id: 'proj-1', name: 'my-app' });
 * const watcher = createFileWatcher(userId, { exclude: ['node_modules/*'] });
 * wireWatcherToIndex(watcher, project.vectorStore, project.context.id);
 * watcher.start();
 * ```
 */
export function wireWatcherToIndex(
  watcher: { on: (event: string, cb: (e: FileEvent) => void) => void },
  store: VectorStore,
  projectId?: string
): void {
  watcher.on('change', (event: FileEvent) => {
    handleFileEvent(store, event, projectId).catch((err) => {
      logger.error('File indexing failed', err);
    });
  });
}

/**
 * Clear the content-hash cache (useful for tests or full re-index).
 */
export function clearHashCache(): void {
  hashCache.clear();
}
