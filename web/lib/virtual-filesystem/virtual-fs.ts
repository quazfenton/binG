/**
 * Virtual Filesystem
 * Provides path resolution with mount points and traversal protection
 * Migrated from ephemeral/serverless_workers_sdk/virtual_fs.py
 */

import { EventEmitter } from 'node:events';
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, statSync } from 'fs';
import { join, resolve, normalize } from 'path';

export interface MountPoint {
  alias: string;
  target: string;
}

export class VirtualFS extends EventEmitter {
  public readonly root: string;
  private mounts: Map<string, string> = new Map();

  constructor(root: string) {
    super();
    this.root = resolve(root);
    
    // Ensure root directory exists
    if (!existsSync(this.root)) {
      mkdirSync(this.root, { recursive: true });
    }
  }

  /**
   * Resolve a virtual filesystem path against the instance root
   * Prevents directory traversal attacks
   */
  resolve(path: string): string {
    // Remove leading slash
    const cleanPath = path.startsWith('/') ? path.substring(1) : path;
    
    // Check if the first component is a registered mount alias
    const parts = cleanPath.split('/');
    if (parts.length > 0 && this.mounts.has(parts[0])) {
      // Resolve mounted path
      const targetPath = this.mounts.get(parts[0])!;
      const remainingParts = parts.slice(1);
      
      if (remainingParts.length > 0) {
        // Validate remaining parts for directory traversal
        const normalized = this.normalizePathParts(remainingParts);
        const result = join(targetPath, ...normalized);
        
        // Verify result is still under target
        const realTarget = resolve(targetPath);
        const realResult = resolve(result);
        if (!realResult.startsWith(realTarget)) {
          throw new Error('Directory traversal prevented');
        }
        return result;
      }
      
      return targetPath;
    }
    
    // Normalize path and check for directory traversal
    const normalizedParts = this.normalizePathParts(parts);
    const resultPath = join(this.root, ...normalizedParts);
    
    // Verify that the resolved path is still under the root
    const realRoot = resolve(this.root);
    const realResult = resolve(resultPath);
    if (!realResult.startsWith(realRoot)) {
      throw new Error('Directory traversal prevented');
    }
    
    return resultPath;
  }

  /**
   * Normalize path parts, removing '.' and handling '..'
   */
  private normalizePathParts(parts: string[]): string[] {
    const normalized: string[] = [];
    
    for (const part of parts) {
      if (part === '..') {
        if (normalized.length === 0) {
          throw new Error('Directory traversal prevented');
        }
        normalized.pop();
      } else if (part !== '.' && part !== '') {
        normalized.push(part);
      }
    }
    
    return normalized;
  }

  /**
   * Write bytes to a virtual file path
   */
  write(path: string, data: Buffer | string): void {
    const target = this.resolve(path);
    
    // Ensure parent directory exists
    const parentDir = join(target, '..');
    if (!existsSync(parentDir)) {
      mkdirSync(parentDir, { recursive: true });
    }
    
    // Write data
    if (typeof data === 'string') {
      writeFileSync(target, data);
    } else {
      writeFileSync(target, data);
    }
    
    this.emit('write', { path, size: data.length });
  }

  /**
   * Read file contents
   */
  read(path: string): Buffer {
    const target = this.resolve(path);
    
    if (!existsSync(target)) {
      throw new Error(`File not found: ${path}`);
    }
    
    const data = readFileSync(target);
    this.emit('read', { path, size: data.length });
    
    return data;
  }

  /**
   * Read file as string
   */
  readString(path: string): string {
    return this.read(path).toString('utf8');
  }

  /**
   * List directory entries
   */
  listDir(path: string = ''): string[] {
    const target = this.resolve(path);
    
    if (!existsSync(target)) {
      return [];
    }
    
    const stat = statSync(target);
    if (!stat.isDirectory()) {
      throw new Error(`Not a directory: ${path}`);
    }
    
    const entries = readdirSync(target, { withFileTypes: true });
    return entries.map(entry => {
      const fullPath = join(target, entry.name);
      const relativePath = fullPath.replace(this.root, '').replace(/^[/\\]/, '');
      return relativePath;
    });
  }

  /**
   * List directory entries with metadata
   */
  listDirDetailed(path: string = ''): Array<{ name: string; type: 'file' | 'directory'; size?: number }> {
    const target = this.resolve(path);
    
    if (!existsSync(target)) {
      return [];
    }
    
    const stat = statSync(target);
    if (!stat.isDirectory()) {
      throw new Error(`Not a directory: ${path}`);
    }
    
    const entries = readdirSync(target, { withFileTypes: true });
    return entries.map(entry => {
      const fullPath = join(target, entry.name);
      const entryStat = statSync(fullPath);
      
      return {
        name: entry.name,
        type: entry.isDirectory() ? 'directory' : 'file',
        size: entry.isFile() ? entryStat.size : undefined,
      };
    });
  }

  /**
   * Check if path exists
   */
  exists(path: string): boolean {
    try {
      const target = this.resolve(path);
      return existsSync(target);
    } catch {
      return false;
    }
  }

  /**
   * Check if path is a directory
   */
  isDirectory(path: string): boolean {
    try {
      const target = this.resolve(path);
      return existsSync(target) && statSync(target).isDirectory();
    } catch {
      return false;
    }
  }

  /**
   * Check if path is a file
   */
  isFile(path: string): boolean {
    try {
      const target = this.resolve(path);
      return existsSync(target) && statSync(target).isFile();
    } catch {
      return false;
    }
  }

  /**
   * Mount a host filesystem path at a virtual alias
   */
  mount(alias: string, target: string): void {
    if (!existsSync(target)) {
      throw new Error(`Mount target does not exist: ${target}`);
    }
    
    const realTarget = resolve(target);
    this.mounts.set(alias, realTarget);
    
    this.emit('mount', { alias, target: realTarget });
  }

  /**
   * Unmount a virtual alias
   */
  unmount(alias: string): boolean {
    const existed = this.mounts.delete(alias);
    
    if (existed) {
      this.emit('unmount', { alias });
    }
    
    return existed;
  }

  /**
   * Get all mount points
   */
  getMounts(): MountPoint[] {
    return Array.from(this.mounts.entries()).map(([alias, target]) => ({
      alias,
      target,
    }));
  }

  /**
   * Get file size
   */
  getSize(path: string): number {
    const target = this.resolve(path);
    
    if (!existsSync(target)) {
      throw new Error(`File not found: ${path}`);
    }
    
    return statSync(target).size;
  }

  /**
   * Get file modification time
   */
  getMtime(path: string): Date {
    const target = this.resolve(path);
    
    if (!existsSync(target)) {
      throw new Error(`File not found: ${path}`);
    }
    
    return statSync(target).mtime;
  }

  /**
   * Delete a file
   */
  delete(path: string): void {
    const target = this.resolve(path);
    
    if (!existsSync(target)) {
      throw new Error(`File not found: ${path}`);
    }
    
    const { unlinkSync } = require('fs');
    unlinkSync(target);
    
    this.emit('delete', { path });
  }

  /**
   * Create a directory
   */
  mkdir(path: string): void {
    const target = this.resolve(path);
    mkdirSync(target, { recursive: true });
    
    this.emit('mkdir', { path });
  }

  /**
   * Get relative path from root
   */
  relativePath(absolutePath: string): string {
    return absolutePath.replace(this.root, '').replace(/^[/\\]/, '');
  }

  /**
   * Get full stats for a path
   */
  stat(path: string) {
    const target = this.resolve(path);
    
    if (!existsSync(target)) {
      throw new Error(`Path not found: ${path}`);
    }
    
    return statSync(target);
  }
}

// Singleton instance
export const virtualFS = new VirtualFS('/tmp/vfs');
