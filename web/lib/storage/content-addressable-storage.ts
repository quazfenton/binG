/**
 * Content-Addressable Storage (CAS)
 *
 * Phase 5 of the cloudworkstationS plan: Split SQL metadata from blob storage.
 *
 * Stores file content by SHA256(content) hash, enabling:
 * - Deduplication: identical content across files stores only once
 * - Cheap snapshots: snapshots reference existing hashes rather than copying content
 * - Cheap cloning: fork workspace by copying hash references, not file bytes
 * - R2 backing: large/cold blobs live in R2, hot blobs in local LRU cache
 *
 * Architecture:
 *   store(content) → SHA256 hash
 *     ├─ Compute SHA256 of content
 *     ├─ Check if hash already known (dedup)
 *     ├─ Write to local LRU cache
 *     ├─ Async write to R2 (fire-and-forget for hot path, or await for first write)
 *     └─ Return hash
 *
 *   retrieve(hash) → content
 *     ├─ Check local LRU cache (fast path)
 *     ├─ Check local R2 fetch cache (warm path)
 *     ├─ Fetch from R2 (cold path)
 *     ├─ Write to local cache
 *     └─ Return content
 *
 *   delete(hash) → void
 *     ├─ Decrement ref_count in SQL
 *     └─ If ref_count reaches 0, mark for GC (async cleanup)
 *
 * Dependencies:
 *   - @aws-sdk/client-s3 (optional, for R2 backing)
 *   - Node.js crypto (SHA256)
 *   - Node.js fs (local disk cache)
 *   - SQLite via getDatabase() (blob registry)
 *
 * Environment variables:
 *   - R2_ACCESS_KEY_ID       — R2 API token access key (optional — local-only if absent)
 *   - R2_SECRET_ACCESS_KEY   — R2 API token secret
 *   - R2_ENDPOINT            — R2 endpoint URL
 *   - R2_BUCKET              — R2 bucket name
 *   - R2_PUBLIC_URL          — Optional public URL prefix
 *   - CAS_CACHE_DIR          — Local cache directory (default: /tmp/cas-cache)
 *   - CAS_CACHE_SIZE_MB      — Max local cache size in MB (default: 512)
 *   - ENABLE_CLOUD_STORAGE   — Must be 'true' to enable R2 backing
 */

import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, existsSync, readFileSync, writeFileSync, unlinkSync, readdirSync, statSync, renameSync, promises as fsp } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { getDatabase } from '@/lib/database/connection-shim';
import { execSchemaFile } from '@/lib/database/schema';
import { compress, decompress, isCompressed } from '@/lib/utils/compression';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('ContentAddressableStorage');

// ============================================================================
// Configuration
// ============================================================================

interface CASConfig {
  /** Local cache directory (default: /tmp/cas-cache) */
  cacheDir: string;
  /** Max local cache size in MB (default: 512) */
  cacheSizeMb: number;
  /** R2 endpoint (undefined = local-only mode) */
  r2Endpoint?: string;
  /** R2 bucket name */
  r2Bucket?: string;
  /** R2 credentials */
  r2AccessKey?: string;
  r2SecretKey?: string;
  /** Public URL prefix for direct R2 access */
  r2PublicUrl?: string;
  /** Whether R2 is enabled */
  r2Enabled: boolean;
  /** Whether to compress blobs before storage (default: true) */
  compressBlobs: boolean;
  /** Compression threshold in bytes (default: 512 — same as compression.ts) */
  compressThreshold: number;
  /** GC interval in ms (default: 10 minutes). Set to 0 to disable periodic GC. */
  gcIntervalMs: number;
  /** Initial delay before first GC run in ms (default: 5 minutes — lets app stabilize) */
  gcInitialDelayMs: number;    /** Max age in hours before an unreferenced blob is eligible for GC (default: 24) */
  gcMaxAgeHours: number;
    /** Memory pressure threshold: cache usage % that triggers an immediate GC (default: 80) */
  gcMemoryPressureThreshold: number;
}

function loadConfig(): CASConfig {
  const r2AccessKey = process.env.R2_ACCESS_KEY_ID || '';
  const r2SecretKey = process.env.R2_SECRET_ACCESS_KEY || '';
  const r2Endpoint = process.env.R2_ENDPOINT || '';
  const r2Bucket = process.env.R2_BUCKET || '';
  const cloudStorageEnabled = process.env.ENABLE_CLOUD_STORAGE === 'true';

  const r2Enabled = cloudStorageEnabled && !!(r2AccessKey && r2SecretKey && r2Endpoint && r2Bucket);

  return {
    cacheDir: process.env.CAS_CACHE_DIR || join(tmpdir(), 'cas-cache'),
    cacheSizeMb: parseInt(process.env.CAS_CACHE_SIZE_MB || '512', 10),
    r2Endpoint: r2Endpoint || undefined,
    r2Bucket: r2Bucket || undefined,
    r2AccessKey: r2AccessKey || undefined,
    r2SecretKey: r2SecretKey || undefined,
    r2PublicUrl: process.env.R2_PUBLIC_URL || undefined,
    r2Enabled,
    compressBlobs: true,
    compressThreshold: 512,
    gcIntervalMs: parseInt(process.env.CAS_GC_INTERVAL_MS || '600000', 10),
    gcInitialDelayMs: parseInt(process.env.CAS_GC_INITIAL_DELAY_MS || '300000', 10),
    gcMaxAgeHours: parseInt(process.env.CAS_GC_MAX_AGE_HOURS || '24', 10),
    gcMemoryPressureThreshold: parseInt(process.env.CAS_GC_MEMORY_PRESSURE_PCT || '80', 10),
  };
}

// ============================================================================
// Content-Addressable Storage Service
// ============================================================================

export class ContentAddressableStorage {
  private config: CASConfig;
  private r2Client: any = null;
  private initialized = false;
  private initPromise: Promise<void> | null = null;

  // Cache tracking
  private currentCacheSize = 0;
  // Bug #4 followup: file count maintained incrementally on every write/unlink,
  // so getStats() (and any other count-based surface) can read the count
  // from memory in O(1) without re-scanning the cache dir.
  private currentCacheCount = 0;
  private cacheSizeValid = false;
  // Bug #4 fix: debounce flag for the async disk-aware enforcement task.
  // Coalesces multiple writes in the same event-loop tick into a single
  // enforcement pass, and lets the write hot path return immediately
  // without waiting for fs operations.
  private enforcementScheduled = false;

  // GC scheduling
  private gcTimer: ReturnType<typeof setInterval> | null = null;
  private gcInitialTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.config = loadConfig();
  }

  // ==========================================================================
  // Initialization
  // ==========================================================================

  /**
   * Initialize the CAS service — ensure local cache dir + DB schema exist.
   * Safe to call multiple times.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = this.initializeInternal();
    return this.initPromise;
  }

  private async initializeInternal(): Promise<void> {
    try {
      // 1. Ensure local cache directory
      if (!existsSync(this.config.cacheDir)) {
        mkdirSync(this.config.cacheDir, { recursive: true, mode: 0o700 });
      }

      // 2. Ensure DB schema
      const db = getDatabase();
      if (db) {
        execSchemaFile(db, 'cas-schema');
      }

      // 3. Initialize R2 client if configured
      if (this.config.r2Enabled) {
        await this.initializeR2Client();
      }

      // Start periodic GC schedule if enabled
      if (this.config.gcIntervalMs > 0 && process.env.NODE_ENV !== 'test') {
        this.startGCSchedule();
      }

      this.initialized = true;
      logger.info('ContentAddressableStorage initialized', {
        cacheDir: this.config.cacheDir,
        cacheSizeMb: this.config.cacheSizeMb,
        r2Enabled: this.config.r2Enabled,
        gcIntervalMs: this.config.gcIntervalMs,
        gcInitialDelayMs: this.config.gcInitialDelayMs,
        gcMaxAgeHours: this.config.gcMaxAgeHours,
      });
    } catch (error: any) {
      logger.error('Failed to initialize ContentAddressableStorage', error);
      // Don't throw — operate in degraded mode
      this.initialized = true;
    }
  }

  /**
   * Initialize the R2 S3-compatible client (lazy).
   */
  private async initializeR2Client(): Promise<void> {
    try {
      const { S3Client } = await import('@aws-sdk/client-s3');
      this.r2Client = new S3Client({
        region: 'auto',
        endpoint: this.config.r2Endpoint,
        forcePathStyle: true,
        credentials: {
          accessKeyId: this.config.r2AccessKey!,
          secretAccessKey: this.config.r2SecretKey!,
        },
      });
      logger.info('R2 client initialized');
    } catch (error: any) {
      logger.warn('R2 client initialization failed — operating in local-only mode', error);
      this.config.r2Enabled = false;
    }
  }

  // ==========================================================================
  // Core CAS Operations
  // ==========================================================================

  /**
   * Compute SHA256 hash of content.
   */
  hashContent(content: string | Buffer): string {
    const buf = typeof content === 'string' ? Buffer.from(content, 'utf-8') : content;
    return createHash('sha256').update(buf).digest('hex');
  }

  /**
   * Store content and return its SHA256 hash.
   * - Returns hash immediately if content is already stored (dedup)
   * - Writes to local cache + async to R2
   */
  async store(content: string | Buffer): Promise<string> {
    const contentBuf = typeof content === 'string' ? Buffer.from(content, 'utf-8') : content;
    const hash = this.hashContent(contentBuf);

    await this.initialize();

    // Check if already stored in SQL registry
    if (await this.isHashKnown(hash)) {
      return hash;
    }

    // Write to local cache
    this.writeToLocalCache(hash, contentBuf);

    // Register in SQL
    await this.registerBlob(hash, contentBuf);

    // Async write to R2 if enabled
    if (this.config.r2Enabled) {
      this.writeToR2Async(hash, contentBuf).catch(err => {
        logger.warn('Async R2 write failed for blob', { hash, error: err.message });
      });
    }

    return hash;
  }

  /**
   * Store content and return hash — synchronous variant for hot paths.
   * Only guarantees local cache; R2 write is fire-and-forget.
   */
  storeSync(content: string | Buffer): string {
    const contentBuf = typeof content === 'string' ? Buffer.from(content, 'utf-8') : content;
    const hash = this.hashContent(contentBuf);

    // Check local cache
    if (existsSync(join(this.config.cacheDir, hash))) {
      return hash;
    }

    // Write to local cache
    this.writeToLocalCache(hash, contentBuf);

    // Sync DB register
    try {
      const db = getDatabase();
      if (db) {
        this.registerBlobSync(hash, contentBuf, db);
      }
    } catch {
      // Non-fatal — blob is in local cache, will be registered async
    }

    return hash;
  }

  /**
   * Retrieve content by its SHA256 hash.
   * Checks: local cache → R2 → error
   */
  async retrieve(hash: string): Promise<Buffer | null> {
    await this.initialize();

    // 1. Check local cache
    const localPath = join(this.config.cacheDir, hash);
    if (existsSync(localPath)) {
      const data = readFileSync(localPath);
      // Touch access time
      this.touchAccessTime(hash);
      return this.decompressIfNeeded(data);
    }

    // 2. Fetch from R2
    if (this.config.r2Enabled && this.r2Client) {
      try {
        const { GetObjectCommand } = await import('@aws-sdk/client-s3');
        const response = await this.r2Client.send(new GetObjectCommand({
          Bucket: this.config.r2Bucket,
          Key: `blobs/${hash}`,
        }));

        if (response.Body) {
          // Read stream into buffer
          const chunks: Buffer[] = [];
          for await (const chunk of response.Body as AsyncIterable<Buffer>) {
            chunks.push(chunk);
          }
          const data = Buffer.concat(chunks);

          // Write to local cache for next time
          this.writeToLocalCache(hash, data);

          // Touch access time
          this.touchAccessTime(hash);

          return this.decompressIfNeeded(data);
        }
      } catch (error: any) {
        logger.warn('R2 retrieve failed for blob', { hash, error: error.message });
      }
    }

    return null;
  }

  /**
   * Check if a blob hash is known (exists in local cache or R2).
   */
  async exists(hash: string): Promise<boolean> {
    // Check local cache first
    if (existsSync(join(this.config.cacheDir, hash))) {
      return true;
    }

    // Check SQL registry
    try {
      const db = getDatabase();
      if (db) {
        const row = db.prepare(
          'SELECT hash FROM file_content_blobs WHERE hash = ?'
        ).get(hash);
        if (row) return true;
      }
    } catch {
      // Table may not exist
    }

    // Check R2
    if (this.config.r2Enabled && this.r2Client) {
      try {
        const { HeadObjectCommand } = await import('@aws-sdk/client-s3');
        await this.r2Client.send(new HeadObjectCommand({
          Bucket: this.config.r2Bucket,
          Key: `blobs/${hash}`,
        }));
        return true;
      } catch {
        return false;
      }
    }

    return false;
  }

  // ==========================================================================
  // Reference Counting
  // ==========================================================================

  /**
   * Increment the reference count for a blob hash.
   */
  async addReference(hash: string): Promise<void> {
    try {
      const db = getDatabase();
      if (!db) return;
      db.prepare(
        `UPDATE file_content_blobs SET ref_count = ref_count + 1, last_accessed_at = datetime('now') WHERE hash = ?`
      ).run(hash);
    } catch (error: any) {
      logger.warn('Failed to increment ref_count for blob', { hash, error: error.message });
    }
  }

  /**
   * Decrement the reference count for a blob hash.
   * If ref_count reaches 0, the blob may be garbage collected later.
   */
  async removeReference(hash: string): Promise<void> {
    try {
      const db = getDatabase();
      if (!db) return;

      const result = db.prepare(
        `UPDATE file_content_blobs SET ref_count = MAX(ref_count - 1, 0), last_accessed_at = datetime('now') WHERE hash = ?`
      ).run(hash);
    } catch (error: any) {
      logger.warn('Failed to decrement ref_count for blob', { hash, error: error.message });
    }
  }

  /**
   * Get unreferenced blobs eligible for garbage collection.
   */
  async getGCCandidates(maxAgeHours: number = 24): Promise<string[]> {
    try {
      const db = getDatabase();
      if (!db) return [];

      const rows = db.prepare(
        `SELECT hash FROM file_content_blobs
         WHERE ref_count <= 0
           AND last_accessed_at < datetime('now', '-' || ? || ' hours')
         LIMIT 1000`
      ).all(maxAgeHours) as Array<{ hash: string }>;

      return rows.map(r => r.hash);
    } catch {
      return [];
    }
  }

  // ==========================================================================
  // GC / Cleanup
  // ==========================================================================

  /**
   * Garbage collect unreferenced blobs.
   * Removes from local cache and R2.
   */
  async garbageCollect(maxAgeHours: number = 24): Promise<{ removed: number; freedBytes: number }> {
    const candidates = await this.getGCCandidates(maxAgeHours);
    let removed = 0;
    let freedBytes = 0;

    for (const hash of candidates) {
      // Remove from local cache
      const localPath = join(this.config.cacheDir, hash);
      if (existsSync(localPath)) {
        const size = statSync(localPath).size;
        try {
          unlinkSync(localPath);
          freedBytes += size;
          // Bug #4 fix: decrement the in-memory counter to keep it in sync.
          // The statSync cost is acceptable here because GC is the slow
          // path (not the write hot path).
          this.currentCacheSize = Math.max(0, this.currentCacheSize - size);
          this.currentCacheCount = Math.max(0, this.currentCacheCount - 1);
        } catch {
          // May be in use
        }
      }

      // Remove from R2
      if (this.config.r2Enabled && this.r2Client) {
        try {
          const { DeleteObjectCommand } = await import('@aws-sdk/client-s3');
          await this.r2Client.send(new DeleteObjectCommand({
            Bucket: this.config.r2Bucket,
            Key: `blobs/${hash}`,
          }));
        } catch {
          // May not exist in R2
        }
      }

      // Remove from SQL registry
      try {
        const db = getDatabase();
        if (db) {
          db.prepare('DELETE FROM file_content_blobs WHERE hash = ?').run(hash);
        }
      } catch {
        // Non-fatal
      }

      removed++;
    }

    if (removed > 0) {
      logger.info('Garbage collected blobs', { removed, freedBytes, maxAgeHours });
    }

    return { removed, freedBytes };
  }

  // ==========================================================================
  // GC Scheduling
  // ==========================================================================

  /**
   * Start the periodic GC schedule.
   * Runs garbageCollect() on a configurable interval after an initial delay.
   * Safe to call multiple times — stops any existing schedule first.
   *
   * @param intervalMs - Override the default GC interval. Defaults to config.gcIntervalMs (1 hour).
   * @param initialDelayMs - Delay before the first GC run. Defaults to config.gcInitialDelayMs (5 min).
   */
  startGCSchedule(intervalMs?: number, initialDelayMs?: number): void {
    this.stopGCSchedule();

    const interval = intervalMs ?? this.config.gcIntervalMs;
    const delay = initialDelayMs ?? this.config.gcInitialDelayMs;

    if (interval <= 0) {
      logger.debug('Periodic GC is disabled (interval <= 0)');
      return;
    }

    logger.info('Periodic GC scheduled', {
      intervalMs: interval,
      initialDelayMs: delay,
      maxAgeHours: this.config.gcMaxAgeHours,
    });

    // Schedule the first run after the initial delay
    this.gcInitialTimer = setTimeout(() => {
      this.gcInitialTimer = null;
      // Set up the recurring interval
      this.gcTimer = setInterval(() => {
        this.runGarbageCollect();
      }, interval);

      // Run the first GC immediately after the delay
      this.runGarbageCollect();
    }, delay);
  }

  /**
   * Stop the periodic GC schedule.
   * Safe to call multiple times — no-op if no schedule is active.
   */
  stopGCSchedule(): void {
    if (this.gcInitialTimer) {
      clearTimeout(this.gcInitialTimer);
      this.gcInitialTimer = null;
    }
    if (this.gcTimer) {
      clearInterval(this.gcTimer);
      this.gcTimer = null;
    }
    logger.debug('Periodic GC stopped');
  }

  /**
   * Wrapper around garbageCollect that logs errors but never throws,
   * suitable for use in a scheduled timer callback.
   */
  private runGarbageCollect(): void {
    this.garbageCollect(this.config.gcMaxAgeHours).catch((error: any) => {
      logger.error('Scheduled GC run failed', { error: error.message });
    });
  }

  // ==========================================================================
  // Local Cache Management
  // ==========================================================================

  /**
   * Write content to local disk cache.
   */
  private writeToLocalCache(hash: string, content: Buffer): void {
    const cachePath = join(this.config.cacheDir, hash);
    try {
      // Ensure cache dir exists
      if (!existsSync(this.config.cacheDir)) {
        mkdirSync(this.config.cacheDir, { recursive: true, mode: 0o700 });
      }

      // Compress if beneficial
      const dataToWrite = this.shouldCompress(content) ? compress(content) : content;
      writeFileSync(cachePath, dataToWrite);

      // Bug #4 fix: maintain the size counter incrementally so the hot
      // path doesn't need a sync readdirSync+statSync over the entire
      // cache dir. The actual disk-aware enforcement runs in a debounced
      // async task (see scheduleAsyncEnforcement below).
      this.currentCacheSize += dataToWrite.length;
      this.currentCacheCount++;

      // Schedule the async enforcement (debounced via setImmediate). Multiple
      // writes in the same tick coalesce into a single enforcement pass and
      // the hot path returns immediately without waiting for fs operations.
      this.scheduleAsyncEnforcement();
    } catch (error: any) {
      logger.warn('Failed to write to local cache', { hash, error: error.message });
    }
  }

  /**
   * Bug #4 fix: schedule the async disk-aware enforcement task. Debounced
   * via `setImmediate` so multiple writes in the same event-loop tick
   * coalesce into a single enforcement pass, and the write hot path returns
   * immediately without waiting for fs operations. Errors are logged but
   * never thrown (best-effort enforcement).
   */
  private scheduleAsyncEnforcement(): void {
    if (this.enforcementScheduled) return;
    this.enforcementScheduled = true;
    setImmediate(() => {
      this.enforcementScheduled = false;
      this.enforceCacheSizeAsync().catch((error: any) => {
        logger.warn('Async cache enforcement failed', { error: error?.message });
      });
    });
  }

  /**
   * Bug #4 fix: async replacement for the old sync `enforceCacheSize`.
   * Uses the in-memory `currentCacheSize` counter for the size check (no
   * disk scan on the hot path); only does the readdirSync+statSync disk
   * scan when the counter actually exceeds the limit. Triggered via
   * `scheduleAsyncEnforcement()` (debounced) from `writeToLocalCache`.
   */
  private async enforceCacheSizeAsync(): Promise<void> {
    const maxBytes = this.config.cacheSizeMb * 1024 * 1024;

    // Hot path: in-memory check, no disk I/O
    if (this.currentCacheSize > maxBytes) {
      // Over limit — need to do the disk scan to find oldest files
      await this.evictOldestFilesAsync();
    }

    // Memory-pressure check (cheap, uses the in-memory counter)
    this.maybeTriggerMemoryPressureGC();
  }

  /**
   * Bug #4 fix: the old sync eviction logic, moved to async + decrementing
   * the in-memory counter as files are unlinked. Only called when the
   * in-memory counter exceeds the configured size limit, so the disk scan
   * is the slow path (not the hot path).
   */
  private async evictOldestFilesAsync(): Promise<void> {
    try {
      const entries = await fsp.readdir(this.config.cacheDir);
      const statEntries: Array<{ name: string; size: number; atimeMs: number }> = [];
      for (const name of entries) {
        try {
          const fullPath = join(this.config.cacheDir, name);
          const stat = await fsp.stat(fullPath);
          statEntries.push({ name, size: stat.size, atimeMs: stat.atimeMs });
        } catch {
          // File disappeared or inaccessible — skip
        }
      }

      // Sort by access time (oldest first) and evict until under limit (with 10% headroom)
      const ordered = statEntries.sort((a, b) => a.atimeMs - b.atimeMs);
      const targetSize = Math.floor((this.config.cacheSizeMb * 1024 * 1024) * 0.9);

      for (const entry of ordered) {
        if (this.currentCacheSize <= targetSize) break;
        try {
          await fsp.unlink(join(this.config.cacheDir, entry.name));
          // Decrement the in-memory counter to match the actual unlink.
          // Clamp at 0 to defend against transient drift (e.g. external
          // file deletion without going through the API).
          this.currentCacheSize = Math.max(0, this.currentCacheSize - entry.size);
        } catch {
          // Concurrent access — skip
        }
      }
    } catch (error: any) {
      logger.warn('Async cache eviction failed', { error: error?.message });
    }
  }

  /**
   * Bug #4 fix: extracted from the old `enforceCacheSize` so the async
   * version can call it without duplicating logic. Uses the in-memory
   * counter — no disk scan needed. Fire-and-forget `garbageCollect(1)`
   * with a 1-hour cutoff for memory pressure.
   */
  private maybeTriggerMemoryPressureGC(): void {
    const maxBytes = this.config.cacheSizeMb * 1024 * 1024;
    const thresholdPct = this.config.gcMemoryPressureThreshold;
    if (thresholdPct <= 0 || maxBytes <= 0) return;

    const usagePct = (this.currentCacheSize / maxBytes) * 100;
    if (usagePct >= thresholdPct) {
      // Fire-and-forget async GC with a shorter maxAge (1h) for pressure.
      this.garbageCollect(1).then((result) => {
        if (result.removed > 0) {
          logger.info('Memory-pressure GC triggered', {
            usagePct: Math.round(usagePct),
            thresholdPct,
            removed: result.removed,
            freedBytes: result.freedBytes,
          });
        }
      }).catch((error: any) => {
        logger.warn('Memory-pressure GC failed', { error: error?.message });
      });
    }
  }

  /**
   * Should content be compressed before caching?
   */
  private shouldCompress(content: Buffer): boolean {
    return this.config.compressBlobs && content.length >= this.config.compressThreshold;
  }

  /**
   * Decompress data if it was stored compressed.
   */
  private decompressIfNeeded(data: Buffer): Buffer {
    if (isCompressed(data)) {
      return decompress(data);
    }
    return data;
  }

  // ==========================================================================
  // R2 Operations
  // ==========================================================================

  /**
   * Maximum number of retry attempts for R2 writes.
   * Configurable via CAS_R2_RETRY_MAX_ATTEMPTS (default: 3).
   */
  private readonly R2_RETRY_MAX_ATTEMPTS = (() => {
    const raw = process.env.CAS_R2_RETRY_MAX_ATTEMPTS;
    if (!raw) return 3;
    const val = parseInt(raw, 10);
    return isNaN(val) || val < 1 ? 3 : val;
  })();

  /**
   * Base delay for exponential backoff in ms.
   * Configurable via CAS_R2_RETRY_BASE_DELAY_MS (default: 1000 = 1s).
   */
  private readonly R2_RETRY_BASE_DELAY_MS = (() => {
    const raw = process.env.CAS_R2_RETRY_BASE_DELAY_MS;
    if (!raw) return 1000;
    const val = parseInt(raw, 10);
    return isNaN(val) || val < 100 ? 1000 : val;
  })();

  /**
   * Async write to R2 with exponential backoff retry.
   * On failure, retries up to R2_RETRY_MAX_ATTEMPTS times with
   * exponentially increasing delay (base * 2^attempt).
   */
  private async writeToR2WithRetry(hash: string, content: Buffer): Promise<void> {
    if (!this.r2Client || !this.config.r2Bucket) {
      return;
    }

    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this.R2_RETRY_MAX_ATTEMPTS; attempt++) {
      try {
        const { PutObjectCommand } = await import('@aws-sdk/client-s3');
        const dataToStore = this.shouldCompress(content) ? compress(content) : content;

        await this.r2Client.send(new PutObjectCommand({
          Bucket: this.config.r2Bucket,
          Key: `blobs/${hash}`,
          Body: dataToStore,
          ContentType: 'application/octet-stream',
          Metadata: {
            originalHash: hash,
            compressed: dataToStore.length < content.length ? 'true' : 'false',
          },
        }));

        // Success — log retries if any occurred
        if (attempt > 0) {
          logger.info('R2 write succeeded after retry', {
            hash,
            attempt: attempt + 1,
            totalAttempts: attempt + 1,
          });
        }
        return;
      } catch (error: any) {
        lastError = error;

        // Don't retry on permanent errors (auth, bucket not found, quota exceeded)
        const statusCode = error?.$metadata?.httpStatusCode;
        if (statusCode === 403 || statusCode === 404 || statusCode === 402) {
          logger.error('R2 write failed with permanent error (not retrying)', {
            hash,
            statusCode,
            error: error.message,
          });
          throw error;
        }

        if (attempt < this.R2_RETRY_MAX_ATTEMPTS - 1) {
          const delayMs = this.R2_RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
          logger.warn('R2 write failed, retrying with backoff', {
            hash,
            attempt: attempt + 1,
            maxAttempts: this.R2_RETRY_MAX_ATTEMPTS,
            delayMs,
            error: error.message,
          });
          await new Promise(resolve => setTimeout(resolve, delayMs));
        }
      }
    }

    // All retries exhausted
    logger.error('R2 write failed after all retries', {
      hash,
      attempts: this.R2_RETRY_MAX_ATTEMPTS,
      error: lastError?.message,
    });
    throw lastError || new Error('R2 write failed');
  }

  /**
   * Async write to R2 (fire-and-forget for hot path).
   * Now uses exponential backoff retry via writeToR2WithRetry.
   */
  private async writeToR2Async(hash: string, content: Buffer): Promise<void> {
    await this.writeToR2WithRetry(hash, content);
  }

  // ==========================================================================
  // SQL Registry
  // ==========================================================================

  /**
   * Check if a hash is known in the SQL registry.
   */
  private async isHashKnown(hash: string): Promise<boolean> {
    try {
      const db = getDatabase();
      if (!db) return false;
      const row = db.prepare(
        'SELECT hash FROM file_content_blobs WHERE hash = ?'
      ).get(hash);
      return !!row;
    } catch {
      return false;
    }
  }

  /**
   * Register a blob in the SQL table.
   */
  private async registerBlob(hash: string, content: Buffer): Promise<void> {
    try {
      const db = getDatabase();
      if (!db) return;

      const compressed = this.shouldCompress(content) ? compress(content) : null;
      const compressedSize = compressed && compressed.length < content.length
        ? compressed.length
        : null;

      db.prepare(
        `INSERT OR IGNORE INTO file_content_blobs (hash, size, compressed_size, ref_count, created_at, last_accessed_at)
         VALUES (?, ?, ?, 1, datetime('now'), datetime('now'))`
      ).run(hash, content.length, compressedSize);
    } catch (error: any) {
      // If table doesn't exist, silently skip — CAS still works through local cache
      if (error.message?.includes('no such table')) {
        return;
      }
      logger.warn('Failed to register blob in SQL', { hash, error: error.message });
    }
  }

  /**
   * Synchronous variant of registerBlob for hot paths.
   */
  private registerBlobSync(hash: string, content: Buffer, db: any): void {
    try {
      const compressed = this.shouldCompress(content) ? compress(content) : null;
      const compressedSize = compressed && compressed.length < content.length
        ? compressed.length
        : null;

      db.prepare(
        `INSERT OR IGNORE INTO file_content_blobs (hash, size, compressed_size, ref_count, created_at, last_accessed_at)
         VALUES (?, ?, ?, 1, datetime('now'), datetime('now'))`
      ).run(hash, content.length, compressedSize);
    } catch {
      // Non-fatal
    }
  }

  /**
   * Touch the last_accessed_at timestamp for a blob.
   */
  private touchAccessTime(hash: string): void {
    try {
      const db = getDatabase();
      if (!db) return;
      db.prepare(
        `UPDATE file_content_blobs SET last_accessed_at = datetime('now') WHERE hash = ?`
      ).run(hash);
    } catch {
      // Non-fatal
    }
  }

  // ==========================================================================
  // Utility / Stats
  // ==========================================================================

  /**
   * Get storage statistics.
   */
  async getStats(): Promise<{
    totalBlobs: number;
    totalSize: number;
    totalCompressedSize: number | null;
    totalRefs: number;
    unreferencedBlobs: number;
    localCacheSize: number;
    localCacheCount: number;
    r2Enabled: boolean;
  }> {
    await this.initialize();

    let totalBlobs = 0;
    let totalSize = 0;
    let totalCompressedSize: number | null = 0;
    let totalRefs = 0;
    let unreferencedBlobs = 0;

    try {
      const db = getDatabase();
      if (db) {
        const stats = db.prepare(
          `SELECT COUNT(*) as count, COALESCE(SUM(size), 0) as total_size,
                  COALESCE(SUM(compressed_size), 0) as total_compressed,
                  COALESCE(SUM(ref_count), 0) as total_refs
           FROM file_content_blobs`
        ).get() as any;

        totalBlobs = stats?.count || 0;
        totalSize = stats?.total_size || 0;
        totalCompressedSize = stats?.total_compressed || 0;
        totalRefs = stats?.total_refs || 0;

        const unreferenced = db.prepare(
          'SELECT COUNT(*) as count FROM file_content_blobs WHERE ref_count <= 0'
        ).get() as any;
        unreferencedBlobs = unreferenced?.count || 0;
      }
    } catch {
      totalCompressedSize = null;
    }

    // Local cache stats — Bug #4 followup: read from the in-memory counters
    // maintained incrementally on every write/unlink. The fallback to an
    // async readdir only fires on a fresh instance (before the first write
    // has populated the counter) or after a process restart that loses the
    // in-memory state. In steady state this is O(1) with zero disk I/O.
    let localCacheSize = this.currentCacheSize;
    let localCacheCount = this.currentCacheCount;
    if (!this.cacheSizeValid) {
      try {
        const entries = await fsp.readdir(this.config.cacheDir);
        let seededSize = 0;
        for (const entry of entries) {
          try {
            const st = await fsp.stat(join(this.config.cacheDir, entry));
            seededSize += st.size;
          } catch { /* skip */ }
        }
        localCacheSize = seededSize;
        localCacheCount = entries.length;
        // Seed the in-memory counters so subsequent getStats() calls are
        // O(1) without re-scanning. From this point the write/unlink paths
        // maintain them incrementally.
        this.currentCacheSize = seededSize;
        this.currentCacheCount = entries.length;
        this.cacheSizeValid = true;
      } catch {
        // Cache dir doesn't exist or unreadable — leave defaults at 0.
      }
    }

    return {
      totalBlobs,
      totalSize,
      totalCompressedSize: totalCompressedSize && totalCompressedSize > 0 ? totalCompressedSize : null,
      totalRefs,
      unreferencedBlobs,
      localCacheSize,
      localCacheCount,
      r2Enabled: this.config.r2Enabled,
    };
  }

  /**
   * Get the current in-memory cache size in bytes. O(1) read, no disk I/O.
   * Maintained incrementally on every write/unlink since the Bug #4 fix
   * (see scheduleAsyncEnforcement for the disk-aware eviction path). May
   * drift on a fresh instance or after a process restart that hasn't yet
   * called getStats() to seed the counter — that's an accepted followup.
   */
  getCurrentCacheSize(): number {
    return this.currentCacheSize;
  }

  /**
   * Get the R2 public URL for a blob (if configured).
   */
  getPublicUrl(hash: string): string | null {
    if (this.config.r2PublicUrl) {
      return `${this.config.r2PublicUrl.replace(/\/+$/, '')}/blobs/${hash}`;
    }
    return null;
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let _instance: ContentAddressableStorage | null = null;

export function getContentAddressableStorage(): ContentAddressableStorage {
  if (!_instance) {
    _instance = new ContentAddressableStorage();
  }
  return _instance;
}

export const cas = getContentAddressableStorage();
