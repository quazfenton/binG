/**
 * IPFS Package Cache Integration
 * 
 * Optional integration that seeds package cache entries to IPFS for
 * decentralized caching and edge optimization.
 * 
 * OFF BY DEFAULT - Enable with IPFS_PACKAGE_SEEDING=true
 * 
 * Usage types:
 * - npm packages: Cached .tgz files from npm
 * - pypi packages: Python packages from PyPI
 * - pip cache: pip download cache
 */

import { getIPFSClient, getSeederService, type UsageType } from './client';

// ============================================================================
// Feature Flags
// ============================================================================

const FEATURE_FLAGS = {
  IPFS_PACKAGE_SEEDING_ENABLED: process.env.IPFS_PACKAGE_SEEDING === 'true',
  IPFS_PACKAGE_SEED_PROVIDERS: process.env.IPFS_PACKAGE_SEED_PROVIDERS || 'pinata',
  IPFS_PACKAGE_MIN_SIZE: parseInt(process.env.IPFS_PACKAGE_MIN_SIZE || '1024', 10), // Seed packages > 1KB
  IPFS_PACKAGE_MAX_SIZE: parseInt(process.env.IPFS_PACKAGE_MAX_SIZE || '52428800', 10), // 50MB max
  IPFS_PACKAGE_CONTENT_TYPES: process.env.IPFS_PACKAGE_CONTENT_TYPES || '.tgz,.whl,.tar.gz,.zip',
};

// ============================================================================
// Types
// ============================================================================

export interface PackageCacheEntry {
  name: string;
  version: string;
  url: string;
  size: number;
  checksum?: string;
  contentType: string;
  timestamp: number;
  source: 'npm' | 'pypi' | 'pip' | 'other';
}

export interface IPFSPackageSeedingResult {
  success: boolean;
  cid?: string;
  gatewayUrl?: string;
  seeded: boolean;
  skipped: boolean;
  reason?: string;
}

export interface PackageCacheIPFSOptions {
  autoSeed?: boolean;
  providers?: string[];
  minSize?: number;
  maxSize?: number;
  contentTypes?: string[];
}

// ============================================================================
// Package Cache IPFS Service
// ============================================================================

export class PackageCacheIPFSService {
  private seeder = getSeederService();
  private client = getIPFSClient();
  private enabled: boolean;
  private options: Required<PackageCacheIPFSOptions>;

  constructor(options: PackageCacheIPFSOptions = {}) {
    this.enabled = FEATURE_FLAGS.IPFS_PACKAGE_SEEDING_ENABLED && options.autoSeed !== false;
    this.options = {
      autoSeed: options.autoSeed ?? FEATURE_FLAGS.IPFS_PACKAGE_SEEDING_ENABLED,
      providers: options.providers ?? FEATURE_FLAGS.IPFS_PACKAGE_SEED_PROVIDERS.split(','),
      minSize: options.minSize ?? FEATURE_FLAGS.IPFS_PACKAGE_MIN_SIZE,
      maxSize: options.maxSize ?? FEATURE_FLAGS.IPFS_PACKAGE_MAX_SIZE,
      contentTypes: options.contentTypes ?? FEATURE_FLAGS.IPFS_PACKAGE_CONTENT_TYPES.split(','),
    };
  }

  /**
   * Check if IPFS package seeding is enabled
   */
  isEnabled(): boolean {
    return this.enabled && this.client.isEnabled();
  }

  /**
   * Get the usage type for a package source
   */
  private getUsageType(_source: PackageCacheEntry['source']): UsageType {
    // All package sources use package-cache type for now
    return 'package-cache';
  }

  /**
   * Check if a package should be seeded based on content type
   */
  private shouldSeedByContentType(contentType: string): boolean {
    const ext = contentType.toLowerCase();
    return this.options.contentTypes.some(ct => 
      ext.endsWith(ct.toLowerCase()) || ext.includes(ct.toLowerCase())
    );
  }

  /**
   * Check if a package meets size requirements for seeding
   */
  private meetsSizeRequirements(entrySize: number): boolean {
    return entrySize >= this.options.minSize && entrySize <= this.options.maxSize;
  }

  /**
   * Generate a filename for the package
   */
  private generateFilename(entry: PackageCacheEntry): string {
    const ext = entry.contentType.startsWith('.') 
      ? entry.contentType 
      : `.${entry.contentType}`;
    return `${entry.name}-${entry.version}${ext}`;
  }

  /**
   * Seed a package to IPFS
   */
  async seedPackage(
    entry: PackageCacheEntry,
    data: Buffer | Uint8Array | Blob | string
  ): Promise<IPFSPackageSeedingResult> {
    // Check if seeding is enabled
    if (!this.isEnabled()) {
      return { success: false, seeded: false, skipped: true, reason: 'IPFS seeding disabled' };
    }

    // Check size requirements (use entry.size as the authoritative size)
    if (!this.meetsSizeRequirements(entry.size)) {
      return { 
        success: false, 
        seeded: false, 
        skipped: true, 
        reason: `Size ${entry.size} outside range [${this.options.minSize}, ${this.options.maxSize}]` 
      };
    }

    // Check content type
    if (!this.shouldSeedByContentType(entry.contentType)) {
      return { 
        success: false, 
        seeded: false, 
        skipped: true, 
        reason: `Content type ${entry.contentType} not in seeding list` 
      };
    }

    const filename = this.generateFilename(entry);
    const usageType = this.getUsageType(entry.source);

    try {
      const result = await this.seeder.seed(data, filename, usageType, {
        metadata: {
          'package-name': entry.name,
          'package-version': entry.version,
          'package-source': entry.source,
          'original-url': entry.url,
          'seeded-at': new Date().toISOString(),
        },
      });

      if (result) {
        console.log(`[PackageCacheIPFS] Seeded ${filename} -> ${result.cid}`);
        return {
          success: true,
          cid: result.cid,
          gatewayUrl: result.gatewayUrl,
          seeded: true,
          skipped: false,
        };
      } else {
        return { success: false, seeded: false, skipped: true, reason: 'Seeding returned null' };
      }
    } catch (error) {
      console.error(`[PackageCacheIPFS] Failed to seed ${filename}:`, error);
      return { 
        success: false, 
        seeded: false, 
        skipped: false, 
        reason: `Error: ${(error as Error).message}` 
      };
    }
  }

  /**
   * Seed a package from a URL (fetch first, then seed)
   */
  async seedPackageFromURL(
    entry: PackageCacheEntry
  ): Promise<IPFSPackageSeedingResult> {
    if (!this.isEnabled()) {
      return { success: false, seeded: false, skipped: true, reason: 'IPFS seeding disabled' };
    }

    try {
      const response = await fetch(entry.url, {
        signal: AbortSignal.timeout(30000), // 30s timeout
      });
      
      if (!response.ok) {
        return { 
          success: false, 
          seeded: false, 
          skipped: false, 
          reason: `Failed to fetch: ${response.statusText}` 
        };
      }

      const arrayBuffer = await response.arrayBuffer();
      const data = Buffer.from(arrayBuffer);

      return this.seedPackage(entry, data);
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') {
        return { 
          success: false, 
          seeded: false, 
          skipped: false, 
          reason: 'Fetch timeout (30s)' 
        };
      }
      return { 
        success: false, 
        seeded: false, 
        skipped: false, 
        reason: `Fetch error: ${(error as Error).message}` 
      };
    }
  }

  /**
   * Get IPFS gateway URL for a cached CID
   */
  getGatewayUrl(cid: string, customGateway?: string): string {
    return this.client.getGatewayUrl(cid, customGateway);
  }

  /**
   * Check if a CID exists on IPFS
   */
  async checkStatus(cid: string): Promise<{ exists: boolean; pinned: boolean }> {
    if (!this.isEnabled()) {
      return { exists: false, pinned: false };
    }

    try {
      const status = await this.client.status(cid);
      return { exists: true, pinned: status.pinned };
    } catch {
      return { exists: false, pinned: false };
    }
  }
}

// ============================================================================
// Integration Hooks for Package Cache System
// ============================================================================

let packageCacheIPFSInstance: PackageCacheIPFSService | null = null;

export function getPackageCacheIPFS(): PackageCacheIPFSService {
  if (!packageCacheIPFSInstance) {
    packageCacheIPFSInstance = new PackageCacheIPFSService();
  }
  return packageCacheIPFSInstance;
}

/**
 * Wrapper function to integrate with existing package cache
 * Use this when caching a package to automatically seed to IPFS
 */
export async function cacheAndSeedPackage(
  entry: PackageCacheEntry,
  data: Buffer | Uint8Array | Blob | string
): Promise<{ cached: boolean; seeded: boolean; cid?: string; gatewayUrl?: string }> {
  const ipfs = getPackageCacheIPFS();
  
  if (!ipfs.isEnabled()) {
    // IPFS disabled, just return cached status
    return { cached: true, seeded: false };
  }

  // Seed to IPFS
  const result = await ipfs.seedPackage(entry, data);
  
  return {
    cached: true,
    seeded: result.seeded,
    cid: result.cid,
    gatewayUrl: result.gatewayUrl,
  };
}

/**
 * Batch seed multiple packages
 */
export async function seedPackageBatch(
  entries: Array<{ entry: PackageCacheEntry; data: Buffer | Uint8Array | Blob | string }>
): Promise<Array<IPFSPackageSeedingResult>> {
  const ipfs = getPackageCacheIPFS();
  
  if (!ipfs.isEnabled()) {
    return entries.map(() => ({ success: false, seeded: false, skipped: true, reason: 'Disabled' }));
  }

  return Promise.all(
    entries.map(({ entry, data }) => ipfs.seedPackage(entry, data))
  );
}

// ============================================================================
// Environment Configuration
// ============================================================================

/**
 * Environment variables for IPFS Package Cache Integration:
 * 
 * IPFS_PACKAGE_SEEDING=true           # Enable automatic package seeding (default: false)
 * IPFS_PACKAGE_SEED_PROVIDERS=pinata  # Comma-separated: pinata,web3storage,filecoin
 * IPFS_PACKAGE_MIN_SIZE=1024          # Minimum size in bytes to seed (default: 1024)
 * IPFS_PACKAGE_MAX_SIZE=52428800      # Maximum size in bytes to seed (default: 50MB)
 * IPFS_PACKAGE_CONTENT_TYPES=.tgz,.whl,.tar.gz,.zip  # Allowed content types
 */

// ============================================================================
// Example Usage
// ============================================================================

/**
 * // Enable in environment:
 * IPFS_ENABLED=true
 * IPFS_PROVIDER=pinata
 * IPFS_API_KEY=your_pinata_key
 * IPFS_PACKAGE_SEEDING=true
 * 
 * // In code:
 * import { cacheAndSeedPackage, getPackageCacheIPFS } from '@/lib/ipfs/package-cache-integration';
 * 
 * // When caching a package:
 * const result = await cacheAndSeedPackage(
 *   { name: 'lodash', version: '4.17.21', url: '...', size: 12345, contentType: '.tgz', timestamp: Date.now(), source: 'npm' },
 *   packageData
 * );
 * 
 * if (result.seeded) {
 *   console.log(`Package seeded to IPFS: ${result.cid}`);
 * }
 */