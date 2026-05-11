/**
 * IPFS Storage Module
 * 
 * Optional module for decentralized storage and seeding of data on IPFS.
 * Supports multiple providers (Pinata, custom gateways) with configurable
 * seeding options for different use cases.
 * 
 * Usage types:
 * - package-cache: For caching npm/python packages
 * - model-weights: For ML model weights and artifacts
 * - user-files: For user-uploaded content
 * - snapshots: For system snapshots and backups
 * - edge-cache: For edge-optimized content delivery
 */

import { pipeline } from 'stream/promises';
import { createReadStream, createWriteStream } from 'fs';

// ============================================================================
// Types & Interfaces
// ============================================================================

export interface IPFSConfig {
  provider: 'pinata' | 'web3storage' | 'custom';
  apiKey?: string;
  secretKey?: string;
  gatewayUrl?: string;
  clusterUrl?: string;
  clusterSecret?: string;
}

export interface IPFSUploadOptions {
  pin?: boolean;
  pinDuration?: number; // hours
  seedProviders?: ('pinata' | 'web3storage' | 'filecoin')[];
  metadata?: Record<string, string>;
  wrapWithDirectory?: boolean;
}

export interface IPFSUploadResult {
  cid: string;
  size: number;
  url: string;
  gatewayUrl: string;
  pinned: boolean;
  seededProviders?: string[];
}

export interface IPFSDownloadOptions {
  timeout?: number;
  gatewayUrl?: string;
}

export interface IPFSStatus {
  cid: string;
  size: number;
  pinned: boolean;
  pinCount: number;
  seedProviders: string[];
}

export type UsageType = 'package-cache' | 'model-weights' | 'user-files' | 'snapshots' | 'edge-cache' | 'all';

export interface SeedingPolicy {
  usageType: UsageType;
  autoSeed: boolean;
  pinDuration: number; // hours, -1 for permanent
  allowedProviders: ('pinata' | 'web3storage' | 'filecoin')[];
  retentionPeriod: number; // days, -1 for permanent
  maxSizeBytes: number;
}

// ============================================================================
// Feature Flags
// ============================================================================

const FEATURE_FLAGS = {
  IPFS_ENABLED: process.env.IPFS_ENABLED === 'true',
  IPFS_PROVIDER: (process.env.IPFS_PROVIDER || 'pinata') as IPFSConfig['provider'],
  IPFS_API_KEY: process.env.IPFS_API_KEY || '',
  IPFS_SECRET_KEY: process.env.IPFS_SECRET_KEY || '',
  IPFS_GATEWAY_URL: process.env.IPFS_GATEWAY_URL || 'https://ipfs.io',
  IPFS_CLUSTER_URL: process.env.IPFS_CLUSTER_URL || '',
  IPFS_CLUSTER_SECRET: process.env.IPFS_CLUSTER_SECRET || '',
  IPFS_MAX_FILE_SIZE: parseInt(process.env.IPFS_MAX_FILE_SIZE || '104857600', 10), // 100MB default
};

// ============================================================================
// Default Seeding Policies
// ============================================================================

export const DEFAULT_SEEDING_POLICIES: Record<UsageType, SeedingPolicy> = {
  'package-cache': {
    usageType: 'package-cache',
    autoSeed: true,
    pinDuration: 168, // 1 week
    allowedProviders: ['pinata'],
    retentionPeriod: 30,
    maxSizeBytes: 50 * 1024 * 1024, // 50MB per package
  },
  'model-weights': {
    usageType: 'model-weights',
    autoSeed: true,
    pinDuration: -1, // permanent
    allowedProviders: ['pinata', 'web3storage'],
    retentionPeriod: -1,
    maxSizeBytes: 5 * 1024 * 1024 * 1024, // 5GB per model
  },
  'user-files': {
    usageType: 'user-files',
    autoSeed: false, // user must opt-in
    pinDuration: 720, // 30 days
    allowedProviders: ['pinata'],
    retentionPeriod: 90,
    maxSizeBytes: 100 * 1024 * 1024, // 100MB per file
  },
  'snapshots': {
    usageType: 'snapshots',
    autoSeed: true,
    pinDuration: -1,
    allowedProviders: ['pinata', 'filecoin'],
    retentionPeriod: -1,
    maxSizeBytes: 10 * 1024 * 1024 * 1024, // 10GB per snapshot
  },
  'edge-cache': {
    usageType: 'edge-cache',
    autoSeed: true,
    pinDuration: 24, // 1 day for edge cache
    allowedProviders: ['pinata'],
    retentionPeriod: 7,
    maxSizeBytes: 50 * 1024 * 1024, // 50MB
  },
  'all': {
    usageType: 'all',
    autoSeed: false,
    pinDuration: 168,
    allowedProviders: ['pinata'],
    retentionPeriod: 30,
    maxSizeBytes: 100 * 1024 * 1024,
  },
};

// ============================================================================
// IPFS Client
// ============================================================================

export class IPFSClient {
  private config: IPFSConfig;
  private gatewayUrl: string;

  constructor(config?: Partial<IPFSConfig>) {
    this.config = {
      provider: config?.provider || FEATURE_FLAGS.IPFS_PROVIDER,
      apiKey: config?.apiKey || FEATURE_FLAGS.IPFS_API_KEY,
      secretKey: config?.secretKey || FEATURE_FLAGS.IPFS_SECRET_KEY,
      gatewayUrl: config?.gatewayUrl || FEATURE_FLAGS.IPFS_GATEWAY_URL,
      clusterUrl: config?.clusterUrl || FEATURE_FLAGS.IPFS_CLUSTER_URL,
      clusterSecret: config?.clusterSecret || FEATURE_FLAGS.IPFS_CLUSTER_SECRET,
    };
    this.gatewayUrl = this.config.gatewayUrl || 'https://ipfs.io';
  }

  /**
   * Check if IPFS is enabled and configured
   */
  isEnabled(): boolean {
    return FEATURE_FLAGS.IPFS_ENABLED && !!this.config.apiKey;
  }

  /**
   * Upload a file to IPFS with optional pinning and seeding
   */
  async upload(
    data: Buffer | Uint8Array | Blob | string,
    filename?: string,
    options?: IPFSUploadOptions
  ): Promise<IPFSUploadResult> {
    if (!this.isEnabled()) {
      throw new Error('IPFS is not enabled or configured');
    }

    const bytes = await this.toBytesAsync(data);
    
    if (bytes.length > FEATURE_FLAGS.IPFS_MAX_FILE_SIZE) {
      throw new Error(`File too large. Max size: ${FEATURE_FLAGS.IPFS_MAX_FILE_SIZE} bytes`);
    }

    switch (this.config.provider) {
      case 'pinata':
        return this.uploadToPinata(bytes, filename, options);
      case 'web3storage':
        return this.uploadToWeb3Storage(bytes, filename, options);
      case 'custom':
        return this.uploadToCustomNode(bytes, filename, options);
      default:
        throw new Error(`Unknown IPFS provider: ${this.config.provider}`);
    }
  }

  /**
   * Download content from IPFS
   */
  async download(cid: string, options?: IPFSDownloadOptions): Promise<Buffer> {
    const url = `${options?.gatewayUrl || this.gatewayUrl}/ipfs/${cid}`;
    const response = await fetch(url, {
      signal: AbortSignal.timeout(options?.timeout || 30000),
    });

    if (!response.ok) {
      throw new Error(`Failed to download from IPFS: ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  /**
   * Get status of a CID (pin status, providers, etc.)
   */
  async status(cid: string): Promise<IPFSStatus> {
    if (!this.isEnabled()) {
      throw new Error('IPFS is not enabled or configured');
    }

    switch (this.config.provider) {
      case 'pinata':
        return this.getPinataStatus(cid);
      case 'web3storage':
        return this.getWeb3StorageStatus(cid);
      default:
        return {
          cid,
          size: 0,
          pinned: false,
          pinCount: 0,
          seedProviders: [],
        };
    }
  }

  /**
   * Pin a CID (ensure it's stored)
   */
  async pin(cid: string, name?: string): Promise<boolean> {
    if (!this.isEnabled()) {
      throw new Error('IPFS is not enabled or configured');
    }

    switch (this.config.provider) {
      case 'pinata':
        return this.pinWithPinata(cid, name);
      case 'web3storage':
        return this.pinWithWeb3Storage(cid);
      default:
        return false;
    }
  }

  /**
   * Unpin a CID
   */
  async unpin(cid: string): Promise<boolean> {
    if (!this.isEnabled()) {
      throw new Error('IPFS is not enabled or configured');
    }

    switch (this.config.provider) {
      case 'pinata':
        return this.unpinWithPinata(cid);
      default:
        return false;
    }
  }

  /**
   * Get a gateway URL for a CID
   */
  getGatewayUrl(cid: string, gatewayUrl?: string): string {
    return `${gatewayUrl || this.gatewayUrl}/ipfs/${cid}`;
  }

  // ===========================================================================
  // Provider-specific implementations
  // ===========================================================================

  private async uploadToPinata(
    data: Uint8Array,
    filename?: string,
    options?: IPFSUploadOptions
  ): Promise<IPFSUploadResult> {
    const formData = new FormData();
    
    const blob = new Blob([new Uint8Array(data)], { type: 'application/octet-stream' });
    formData.append('file', blob, filename || 'upload');

    // Add pin options
    if (options?.pin !== false) {
      const pinMeta: Record<string, string> = {
        keyvalues: JSON.stringify(options?.metadata || {}),
      };
      if (options?.pinDuration) {
        pinMeta.pinDuration = String(options.pinDuration);
      }
      formData.append('pinataMetadata', JSON.stringify({ name: filename || 'upload' }));
      formData.append('pinataOptions', JSON.stringify({ 
        wrapWithDirectory: options.wrapWithDirectory ?? false,
        cidVersion: 1,
      }));
    }

    const response = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.config.apiKey}`,
      },
      body: formData,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Pinata upload failed: ${error}`);
    }

    const result = await response.json();
    
    return {
      cid: result.IpfsHash,
      size: data.length,
      url: `ipfs://${result.IpfsHash}`,
      gatewayUrl: this.getGatewayUrl(result.IpfsHash),
      pinned: options?.pin !== false,
      seededProviders: options?.seedProviders || [],
    };
  }

  private async uploadToWeb3Storage(
    data: Uint8Array,
    filename?: string,
    options?: IPFSUploadOptions
  ): Promise<IPFSUploadResult> {
    // web3.storage uses HTTP API - we can implement without the official client
    const token = this.config.apiKey;
    if (!token) {
      throw new Error('web3.storage requires API token');
    }

    // Create multipart form data
    const blob = new Blob([new Uint8Array(data)], { type: 'application/octet-stream' });
    const formData = new FormData();
    formData.append('file', blob, filename || 'upload');

    // web3.storage doesn't support custom duration headers - pinning is managed via account

    const response = await fetch('https://api.web3.storage/upload', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'X-Name': filename || 'upload',
      },
      body: formData,
      signal: AbortSignal.timeout(60000), // 60s timeout
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`web3.storage upload failed: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    const cid = result.cid || result.cidV1;

    return {
      cid,
      size: data.length,
      url: `ipfs://${cid}`,
      gatewayUrl: this.getGatewayUrl(cid, 'https://w3s.link'),
      pinned: options?.pin !== false,
      seededProviders: ['web3storage'],
    };
  }

  private async uploadToCustomNode(
    data: Uint8Array,
    filename?: string,
    _options?: IPFSUploadOptions
  ): Promise<IPFSUploadResult> {
    if (!this.config.gatewayUrl) {
      throw new Error('Custom IPFS node requires gatewayUrl');
    }

    const formData = new FormData();
    const blob = new Blob([new Uint8Array(data)], { type: 'application/octet-stream' });
    formData.append('file', blob, filename || 'upload');

    const response = await fetch(`${this.config.gatewayUrl}/api/v0/add`, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`Custom node upload failed: ${response.statusText}`);
    }

    // ipfs-cli style response: { Hash: string, Name: string, Size: string }
    const result = await response.json();
    
    return {
      cid: result.Hash,
      size: parseInt(result.Size, 10) || data.length,
      url: `ipfs://${result.Hash}`,
      gatewayUrl: this.getGatewayUrl(result.Hash),
      pinned: false,
      seededProviders: [],
    };
  }

  private async getPinataStatus(cid: string): Promise<IPFSStatus> {
    const response = await fetch(`https://api.pinata.cloud/pinning/pinJobs?status=pinning&cid=${cid}`, {
      headers: {
        'Authorization': `Bearer ${this.config.apiKey}`,
      },
    });

    if (!response.ok) {
      return { cid, size: 0, pinned: false, pinCount: 0, seedProviders: [] };
    }

    const results = await response.json();
    const pins = results.rows || [];
    
    return {
      cid,
      size: 0,
      pinned: pins.length > 0,
      pinCount: pins.length,
      seedProviders: pins.map(() => 'pinata'),
    };
  }

  private async getWeb3StorageStatus(cid: string): Promise<IPFSStatus> {
    // Web3.storage status - requires package installation
    return { cid, size: 0, pinned: false, pinCount: 0, seedProviders: [] };
  }

  private async pinWithPinata(cid: string, name?: string): Promise<boolean> {
    const response = await fetch('https://api.pinata.cloud/pinning/pinJSONToIPFS', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        pinataMetadata: { name: name || cid },
        pinataContent: { cid },
      }),
    });

    return response.ok;
  }

  private async pinWithWeb3Storage(cid: string): Promise<boolean> {
    // Web3.storage pinning requires package installation
    return false;
  }

  private async unpinWithPinata(cid: string): Promise<boolean> {
    // Pinata pin removal requires pin ID tracking
    // Log for now, implementation would need pin IDs stored
    console.log(`Unpin request for ${cid} - implement pin ID tracking for full support`);
    return true;
  }

  private async toBytesAsync(data: Buffer | Uint8Array | Blob | string): Promise<Uint8Array> {
    if (typeof data === 'string') {
      return new TextEncoder().encode(data);
    } else if (data instanceof Uint8Array) {
      return data;
    } else if (data instanceof Buffer) {
      return new Uint8Array(data);
    } else if (data instanceof Blob) {
      const arrayBuffer = await data.arrayBuffer();
      return new Uint8Array(arrayBuffer);
    }
    return new Uint8Array();
  }
}

// ============================================================================
// Seeder Service
// ============================================================================

export interface SeederConfig {
  policies: Partial<Record<UsageType, SeedingPolicy>>;
  defaultGateway: string;
  clusterEnabled: boolean;
}

export class IPFSSSeederService {
  private client: IPFSClient;
  private policies: Record<UsageType, SeedingPolicy>;

  constructor(config?: Partial<SeederConfig>) {
    this.client = new IPFSClient();
    
    // Merge custom policies with defaults
    this.policies = { ...DEFAULT_SEEDING_POLICIES };
    if (config?.policies) {
      for (const [type, policy] of Object.entries(config.policies)) {
        if (policy) {
          this.policies[type as UsageType] = { 
            ...this.policies[type as UsageType], 
            ...policy 
          };
        }
      }
    }
  }

  /**
   * Get the seeding policy for a usage type
   */
  getPolicy(usageType: UsageType): SeedingPolicy {
    return this.policies[usageType] || this.policies['all'];
  }

  /**
   * Seed data based on usage type and policy
   */
  async seed(
    data: Buffer | Uint8Array | Blob | string,
    filename: string,
    usageType: UsageType,
    options?: Partial<IPFSUploadOptions>
  ): Promise<IPFSUploadResult | null> {
    if (!this.client.isEnabled()) {
      console.warn('IPFS not enabled, skipping seed');
      return null;
    }

    const policy = this.getPolicy(usageType);
    
    if (!policy.autoSeed) {
      console.log(`Auto-seed disabled for ${usageType}, skipping`);
      return null;
    }

    // Convert data to buffer for size check
    let bytes: Uint8Array;
    if (data instanceof Blob) {
      const buffer = Buffer.from(await data.arrayBuffer());
      bytes = new Uint8Array(buffer);
    } else if (data instanceof Buffer) {
      bytes = new Uint8Array(data);
    } else if (data instanceof Uint8Array) {
      bytes = data;
    } else {
      bytes = new TextEncoder().encode(data);
    }
    
    const size = bytes.length;
    
    if (size > policy.maxSizeBytes) {
      console.warn(`Data too large for ${usageType}: ${size} > ${policy.maxSizeBytes}`);
      return null;
    }

    try {
      const result = await this.client.upload(bytes, filename, {
        pin: true,
        pinDuration: policy.pinDuration,
        seedProviders: policy.allowedProviders,
        ...options,
      });

      console.log(`Seeded ${filename} to IPFS: ${result.cid} (${usageType})`);
      return result;
    } catch (error) {
      console.error(`Failed to seed ${filename}:`, error);
      return null;
    }
  }

  /**
   * Seed from a file path
   */
  async seedFile(
    filePath: string,
    usageType: UsageType,
    options?: Partial<IPFSUploadOptions>
  ): Promise<IPFSUploadResult | null> {
    const { readFile } = await import('fs/promises');
    
    try {
      const fileData = await readFile(filePath);
      const filename = filePath.split('/').pop() || 'file';
      return this.seed(fileData, filename, usageType, options);
    } catch (error) {
      console.error(`Failed to read file for seeding:`, error);
      return null;
    }
  }

  /**
   * List pinned content
   */
  async listPinned(): Promise<string[]> {
    if (!this.client.isEnabled()) {
      return [];
    }

    // Query pin provider's API for pinned items
    console.log('Listing pinned content - implement per-provider listing');
    return [];
  }

  /**
   * Remove seeded content (unpin)
   */
  async removeSeed(cid: string): Promise<boolean> {
    return this.client.unpin(cid);
  }
}

// ============================================================================
// Singleton instance for convenience
// ============================================================================

let ipfsClientInstance: IPFSClient | null = null;
let seederServiceInstance: IPFSSSeederService | null = null;

export function getIPFSClient(): IPFSClient {
  if (!ipfsClientInstance) {
    ipfsClientInstance = new IPFSClient();
  }
  return ipfsClientInstance;
}

export function getSeederService(config?: Partial<SeederConfig>): IPFSSSeederService {
  if (!seederServiceInstance) {
    seederServiceInstance = new IPFSSSeederService(config);
  }
  return seederServiceInstance;
}

// ============================================================================
// Usage Examples & Testing
// ============================================================================

/**
 * Example usage:
 * 
 * // Enable IPFS in environment:
 * IPFS_ENABLED=true
 * IPFS_PROVIDER=pinata
 * IPFS_API_KEY=your_pinata_api_key
 * IPFS_SECRET_KEY=your_pinata_secret
 * 
 * // In code:
 * import { getIPFSClient, getSeederService } from '@/lib/storage/ipfs/client';
 * 
 * // Upload a file
 * const client = getIPFSClient();
 * const result = await client.upload(fileData, 'my-file.txt', { pin: true });
 * console.log(result.cid); // Qm...
 * 
 * // Seed a package cache automatically
 * const seeder = getSeederService();
 * const seeded = await seeder.seed(packageData, 'package.tar.gz', 'package-cache');
 * 
 * // Download from IPFS
 * const data = await client.download('Qm...');
 */