/**
 * Background Worker Service
 * 
 * Handles repo indexing, embeddings generation, and file watching.
 * Integrates with Qdrant for vector storage.
 * 
 * Features:
 * - Periodic repo indexing
 * - Code embedding generation
 * - File system watching for changes
 * - Vector database synchronization
 * - Background job processing
 */

import { createServer } from 'http';
import { createLogger } from '@/lib/utils/logger';
import { watch } from 'chokidar';
import { readdir, readFile, stat } from 'fs/promises';
import { join, relative } from 'path';
import { existsSync } from 'fs';
import Redis from 'ioredis';

const logger = createLogger('BackgroundWorker');

// Configuration from environment
const PORT = parseInt(process.env.PORT || '3006', 10);
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const QDRANT_URL = process.env.QDRANT_URL || 'http://qdrant:6333';
const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT || '/workspace';
const INDEX_INTERVAL_MS = parseInt(process.env.INDEX_INTERVAL_MS || '300000', 10); // 5 minutes
const INDEX_PATH = process.env.INDEX_PATH || '/index';

// File extensions to index
const INDEXABLE_EXTENSIONS = [
  '.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.java', '.cpp', '.c', '.h',
  '.md', '.json', '.yaml', '.yml', '.toml', '.sql', '.graphql',
];

// Patterns to ignore
const IGNORE_PATTERNS = [
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  'coverage',
  '*.min.js',
  '*.bundle.js',
  'package-lock.json',
  'pnpm-lock.yaml',
];

interface IndexedFile {
  path: string;
  content: string;
  embedding?: number[];
  indexedAt: number;
  size: number;
}

class BackgroundWorkerService {
  private qdrantAvailable = false;
  private redisClient?: any;
  private indexedFiles: Map<string, IndexedFile> = new Map();
  private watcher?: any;
  private indexInterval?: NodeJS.Timeout;
  private isIndexing = false;

  async initialize(): Promise<void> {
    logger.info('Initializing background worker service...', {
      workspaceRoot: WORKSPACE_ROOT,
      indexInterval: INDEX_INTERVAL_MS / 1000,
      qdrantUrl: QDRANT_URL,
    });

    // Initialize Redis
    try {
      if (REDIS_URL) {
        this.redisClient = new Redis(REDIS_URL);
        this.redisClient.on('error', (err) => logger.error('Redis error:', err));
        await this.redisClient.ping();
        logger.info('Connected to Redis');
      }
    } catch (error: any) {
      logger.warn('Redis not available:', error.message);
    }

    // Check Qdrant availability
    try {
      const response = await fetch(`${QDRANT_URL}/`);
      if (response.ok) {
        this.qdrantAvailable = true;
        logger.info('Qdrant vector database available');

        // Create collection if not exists
        await this.ensureCollection();
      }
    } catch (error: any) {
      logger.warn('Qdrant not available, vector indexing disabled:', error.message);
    }

    // Start file watcher
    this.startFileWatcher();

    // Start periodic indexing
    this.startPeriodicIndexing();

    // Initial indexing
    this.indexWorkspace().catch(err => logger.error('Initial indexing failed:', err));
  }

  /**
   * Ensure Qdrant collection exists
   */
  private async ensureCollection(): Promise<void> {
    try {
      const response = await fetch(`${QDRANT_URL}/collections/code`);
      if (!response.ok) {
        // Create collection
        await fetch(`${QDRANT_URL}/collections/code`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            vectors: {
              size: 384, // all-MiniLM-L6-v2 embedding size
              distance: 'Cosine',
            },
          }),
        });
        logger.info('Created Qdrant collection: code');
      }
    } catch (error: any) {
      logger.error('Failed to ensure Qdrant collection:', error.message);
    }
  }

  /**
   * Start file system watcher
   */
  private startFileWatcher(): void {
    if (!existsSync(WORKSPACE_ROOT)) {
      logger.warn('Workspace root does not exist:', WORKSPACE_ROOT);
      return;
    }

    this.watcher = watch(WORKSPACE_ROOT, {
      ignored: [
        /(^|[\/\\])\../, // dotfiles
        /node_modules/,
        /\.git/,
        /dist/,
        /build/,
      ],
      persistent: true,
      ignoreInitial: true,
    });

    this.watcher
      .on('add', (path) => this.handleFileChange(path, 'added'))
      .on('change', (path) => this.handleFileChange(path, 'changed'))
      .on('unlink', (path) => this.handleFileChange(path, 'deleted'));

    logger.info(`File watcher started on ${WORKSPACE_ROOT}`);
  }

  /**
   * Handle file change events
   */
  private async handleFileChange(filePath: string, event: 'added' | 'changed' | 'deleted'): Promise<void> {
    // Check if file is indexable
    if (!this.isIndexable(filePath)) {
      return;
    }

    const relativePath = relative(WORKSPACE_ROOT, filePath);

    if (event === 'deleted') {
      this.indexedFiles.delete(relativePath);
      if (this.qdrantAvailable) {
        await this.removeFromIndex(relativePath);
      }
      logger.info(`Removed from index: ${relativePath}`);
      return;
    }

    // Re-index the file
    await this.indexFile(relativePath);
    logger.info(`${event === 'added' ? 'Indexed' : 'Updated'}: ${relativePath}`);
  }

  /**
   * Start periodic indexing
   */
  private startPeriodicIndexing(): void {
    this.indexInterval = setInterval(() => {
      if (!this.isIndexing) {
        this.indexWorkspace().catch(err => logger.error('Periodic indexing failed:', err));
      }
    }, INDEX_INTERVAL_MS);

    logger.info(`Periodic indexing started (every ${INDEX_INTERVAL_MS / 1000}s)`);
  }

  /**
   * Check if file should be indexed
   */
  private isIndexable(filePath: string): boolean {
    const ext = filePath.toLowerCase().slice(filePath.lastIndexOf('.'));
    return INDEXABLE_EXTENSIONS.includes(ext);
  }

  /**
   * Check if file should be ignored
   */
  private isIgnored(filePath: string): boolean {
    return IGNORE_PATTERNS.some(pattern => {
      if (pattern.includes('*')) {
        const regex = new RegExp(pattern.replace('*', '.*'));
        return regex.test(filePath);
      }
      return filePath.includes(pattern);
    });
  }

  /**
   * Index entire workspace
   */
  async indexWorkspace(): Promise<void> {
    if (this.isIndexing) {
      logger.info('Indexing already in progress, skipping...');
      return;
    }

    this.isIndexing = true;
    const startTime = Date.now();

    try {
      logger.info('Starting workspace indexing...');

      const files = await this.walkDirectory(WORKSPACE_ROOT);
      let indexed = 0;
      let errors = 0;

      for (const file of files) {
        try {
          await this.indexFile(file);
          indexed++;

          // Rate limit to avoid overwhelming Qdrant
          if (indexed % 10 === 0) {
            await new Promise(resolve => setTimeout(resolve, 100));
          }
        } catch (error: any) {
          errors++;
          logger.debug(`Failed to index ${file}:`, error.message);
        }
      }

      const duration = Date.now() - startTime;
      logger.info(`Indexing complete: ${indexed} files indexed, ${errors} errors (${duration}ms)`);

      // Store stats in Redis
      if (this.redisClient) {
        await this.redisClient.hSet('index:stats', {
          totalFiles: indexed.toString(),
          errors: errors.toString(),
          lastIndexed: Date.now().toString(),
          duration: duration.toString(),
        });
      }
    } catch (error: any) {
      logger.error('Workspace indexing failed:', error.message);
      throw error;
    } finally {
      this.isIndexing = false;
    }
  }

  /**
   * Walk directory recursively
   */
  private async walkDirectory(dir: string, files: string[] = []): Promise<string[]> {
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);

      if (this.isIgnored(fullPath)) {
        continue;
      }

      if (entry.isDirectory()) {
        await this.walkDirectory(fullPath, files);
      } else if (entry.isFile() && this.isIndexable(fullPath)) {
        files.push(fullPath);
      }
    }

    return files;
  }

  /**
   * Index a single file
   */
  private async indexFile(relativePath: string): Promise<void> {
    const fullPath = join(WORKSPACE_ROOT, relativePath);

    if (!existsSync(fullPath)) {
      return;
    }

    const content = await readFile(fullPath, 'utf-8');
    const stats = await stat(fullPath);

    const indexedFile: IndexedFile = {
      path: relativePath,
      content,
      indexedAt: Date.now(),
      size: stats.size,
    };

    // Generate embedding if Qdrant available
    if (this.qdrantAvailable) {
      indexedFile.embedding = await this.generateEmbedding(content);
      await this.addToQdrant(relativePath, content, indexedFile.embedding);
    }

    this.indexedFiles.set(relativePath, indexedFile);
  }

  /**
   * Generate embedding for text
   */
  private async generateEmbedding(text: string): Promise<number[]> {
    // Placeholder - in production use actual embedding model
    // Options:
    // 1. Use @xenova/transformers for local embedding
    // 2. Call external embedding API (OpenAI, Cohere, etc.)
    // 3. Use Qdrant's built-in embedding

    // Simple hash-based placeholder (384 dimensions for all-MiniLM-L6-v2 compatibility)
    const embedding = Array.from({ length: 384 }, (_, i) => {
      const h = this.hashString(text + i);
      return (h % 1000) / 1000;
    });

    return embedding;
  }

  /**
   * Simple string hash function
   */
  private hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash;
  }

  /**
   * Add document to Qdrant
   */
  private async addToQdrant(path: string, content: string, embedding: number[]): Promise<void> {
    try {
      const response = await fetch(`${QDRANT_URL}/collections/code/points`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          points: [
            {
              id: this.hashString(path),
              vector: embedding,
              payload: {
                path,
                content: content.substring(0, 1000), // Store preview
                indexedAt: Date.now(),
              },
            },
          ],
        }),
      });

      if (!response.ok) {
        throw new Error(`Qdrant error: ${response.statusText}`);
      }
    } catch (error: any) {
      logger.error(`Failed to add ${path} to Qdrant:`, error.message);
    }
  }

  /**
   * Remove document from Qdrant
   */
  private async removeFromIndex(path: string): Promise<void> {
    if (!this.qdrantAvailable) return;

    try {
      await fetch(`${QDRANT_URL}/collections/code/points/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          points: [this.hashString(path)],
        }),
      });
    } catch (error: any) {
      logger.error(`Failed to remove ${path} from Qdrant:`, error.message);
    }
  }

  /**
   * Search code using vector similarity
   */
  async searchCode(query: string, limit: number = 10): Promise<any[]> {
    if (!this.qdrantAvailable) {
      // Fallback to simple text search
      return this.textSearch(query, limit);
    }

    try {
      const embedding = await this.generateEmbedding(query);

      const response = await fetch(`${QDRANT_URL}/collections/code/points/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vector: embedding,
          limit,
          with_payload: true,
        }),
      });

      if (!response.ok) return [];

      const data = await response.json();
      return data.result?.map((r: any) => ({
        path: r.payload.path,
        content: r.payload.content,
        score: r.score,
      })) || [];
    } catch (error: any) {
      logger.error('Vector search failed:', error.message);
      return this.textSearch(query, limit);
    }
  }

  /**
   * Fallback text-based search
   */
  private textSearch(query: string, limit: number): any[] {
    const queryLower = query.toLowerCase();
    const results: any[] = [];

    for (const [path, file] of this.indexedFiles.entries()) {
      if (file.content.toLowerCase().includes(queryLower)) {
        results.push({
          path,
          content: file.content.substring(0, 500),
          score: 0.5, // Lower score than vector search
        });

        if (results.length >= limit) break;
      }
    }

    return results;
  }

  /**
   * Get indexing statistics
   */
  getStats(): {
    totalFiles: number;
    qdrantAvailable: boolean;
    isIndexing: boolean;
    lastIndexed?: number;
  } {
    return {
      totalFiles: this.indexedFiles.size,
      qdrantAvailable: this.qdrantAvailable,
      isIndexing: this.isIndexing,
      lastIndexed: this.indexedFiles.size > 0 ? Math.max(...Array.from(this.indexedFiles.values()).map(f => f.indexedAt)) : undefined,
    };
  }

  /**
   * Shutdown gracefully
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down background worker...');

    if (this.watcher) {
      await this.watcher.close();
    }

    if (this.indexInterval) {
      clearInterval(this.indexInterval);
    }

    if (this.redisClient) {
      await this.redisClient.disconnect();
    }

    logger.info('Background worker shutdown complete');
  }
}

// Singleton instance
const backgroundWorkerService = new BackgroundWorkerService();

// HTTP server for API
const server = createServer(async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'healthy',
      initialized: true,
      stats: backgroundWorkerService.getStats(),
    }));
    return;
  }

  if (req.url === '/stats') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(backgroundWorkerService.getStats()));
    return;
  }

  if (req.url === '/search' && req.method === 'GET') {
    const url = new URL(req.url || '', 'http://localhost');
    const query = url.searchParams.get('q') || '';
    const limit = parseInt(url.searchParams.get('limit') || '10', 10);

    if (!query) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Query parameter "q" is required' }));
      return;
    }

    const results = await backgroundWorkerService.searchCode(query, limit);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ query, results }));
    return;
  }

  if (req.url === '/index' && req.method === 'POST') {
    try {
      await backgroundWorkerService.indexWorkspace();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
    } catch (error: any) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error.message }));
    }
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not Found' }));
});

// Initialize and start server
async function main() {
  try {
    await backgroundWorkerService.initialize();

    server.listen(PORT, () => {
      logger.info(`Background worker service listening on port ${PORT}`);
    });

    // Graceful shutdown
    process.on('SIGTERM', async () => {
      await backgroundWorkerService.shutdown();
      server.close();
      process.exit(0);
    });

    process.on('SIGINT', async () => {
      await backgroundWorkerService.shutdown();
      server.close();
      process.exit(0);
    });
  } catch (error: any) {
    logger.error('Failed to start background worker service:', error.message);
    process.exit(1);
  }
}

main();

export { backgroundWorkerService };
