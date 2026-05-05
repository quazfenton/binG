// Server-only module - do not import directly in Client Components
export const runtime = 'nodejs';

import { isDesktopMode } from '@bing/platform/env';
import { isUsingLocalFS } from '@bing/shared/FS/fs-bridge';
import { ripgrep, type RipgrepOptions, type RipgrepResult } from './ripgrep';
import { virtualFilesystem } from '@/lib/virtual-filesystem/virtual-filesystem-service';
import * as path from 'node:path';

export interface VFSRipgrepOptions {
  query: string;
  ownerId: string;
  path?: string;
  glob?: string | string[];
  fixedString?: boolean;
  caseInsensitive?: boolean;
  wordRegexp?: boolean;
  maxResults?: number;
  maxCountPerFile?: number;
  contextLines?: number;
  timeoutMs?: number;
}

export interface VFSRipgrepMatch {
  path: string;
  lineNumber: number;
  content: string;
  contextBefore?: string[];
  contextAfter?: string[];
}

export interface VFSRipgrepResult {
  matches: VFSRipgrepMatch[];
  stats: {
    searches: number;
    matches: number;
    filesWithMatches: number;
    filesSearched: number;
    elapsedMs: number;
  };
  errors: string[];
  usedRipgrep: boolean;
  usedVFS: boolean;
}

/**
 * Ripgrep adapter that works with both local filesystem (desktop) and VFS (web).
 * 
 * - Desktop mode: Uses native ripgrep binary on user's local files
 * - Web mode: Searches VFS in-memory/database storage
 */
export async function ripgrepVFS(opts: VFSRipgrepOptions): Promise<VFSRipgrepResult> {
  const startTime = Date.now();
  
  // Desktop mode: Use native ripgrep on local filesystem
  if (isDesktopMode() && isUsingLocalFS()) {
    try {
      const rgOpts: RipgrepOptions = {
        query: opts.query,
        path: opts.path,
        glob: opts.glob,
        fixedString: opts.fixedString,
        caseInsensitive: opts.caseInsensitive,
        wordRegexp: opts.wordRegexp,
        maxResults: opts.maxResults,
        maxCountPerFile: opts.maxCountPerFile,
        contextLines: opts.contextLines,
        timeoutMs: opts.timeoutMs,
      };
      
      const result = await ripgrep(rgOpts);
      
      return {
        matches: result.matches.map(m => ({
          path: m.path,
          lineNumber: m.lineNumber,
          content: m.lines,
          contextBefore: m.contextBefore,
          contextAfter: m.contextAfter,
        })),
        stats: result.stats,
        errors: result.errors,
        usedRipgrep: result.usedRipgrep,
        usedVFS: false,
      };
    } catch (error: any) {
      return {
        matches: [],
        stats: { searches: 0, matches: 0, filesWithMatches: 0, filesSearched: 0, elapsedMs: Date.now() - startTime },
        errors: [error.message || 'Ripgrep failed'],
        usedRipgrep: false,
        usedVFS: false,
      };
    }
  }
  
  // Web mode: Search VFS in-memory/database storage
  return await searchVFS(opts, startTime);
}

/**
 * Search VFS storage (in-memory + database) for web mode
 */
async function searchVFS(opts: VFSRipgrepOptions, startTime: number): Promise<VFSRipgrepResult> {
  try {
    const workspace = await (virtualFilesystem as any).vfs.ensureWorkspace(opts.ownerId);
    const matches: VFSRipgrepMatch[] = [];
    const maxResults = opts.maxResults ?? 100;
    const maxPerFile = opts.maxCountPerFile ?? 50;
    const contextLines = opts.contextLines ?? 0;
    
    // Build regex pattern
    let pattern = opts.query;
    if (opts.fixedString) {
      // Escape special regex chars for literal string matching
      pattern = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    if (opts.wordRegexp) {
      pattern = `\\b(?:${pattern})\\b`;
    }
    
    const flags = opts.caseInsensitive ? 'i' : '';
    let regex: RegExp;
    try {
      regex = new RegExp(pattern, flags);
    } catch {
      return {
        matches: [],
        stats: { searches: 0, matches: 0, filesWithMatches: 0, filesSearched: 0, elapsedMs: Date.now() - startTime },
        errors: ['Invalid regex pattern'],
        usedRipgrep: false,
        usedVFS: true,
      };
    }
    
    // Build glob regex if provided
    const globRegexes = opts.glob
      ? (Array.isArray(opts.glob) ? opts.glob : [opts.glob]).map(globToRegex)
      : [];
    
    // Search base path
    const searchBasePath = opts.path || 'project';
    const normalizedBasePath = searchBasePath.replace(/\\/g, '/').trim();
    
    let filesSearched = 0;
    const filesWithMatches = new Set<string>();
    
    for (const file of workspace.files.values()) {
      if (matches.length >= maxResults) break;
      
      // Skip files outside search path
      if (normalizedBasePath && normalizedBasePath !== 'project') {
        if (!file.path.startsWith(normalizedBasePath + '/') && file.path !== normalizedBasePath) {
          continue;
        }
      }
      
      // Apply glob filter
      if (globRegexes.length > 0) {
        const basename = path.posix.basename(file.path);
        const matchesGlob = globRegexes.some(r => r.test(file.path) || r.test(basename));
        if (!matchesGlob) continue;
      }
      
      filesSearched++;
      
      // Search file content
      const lines = file.content.split('\n');
      let fileMatches = 0;
      
      for (let i = 0; i < lines.length; i++) {
        if (fileMatches >= maxPerFile || matches.length >= maxResults) break;
        
        const line = lines[i];
        if (regex.test(line)) {
          filesWithMatches.add(file.path);
          
          const match: VFSRipgrepMatch = {
            path: file.path,
            lineNumber: i + 1,
            content: line,
          };
          
          // Add context lines if requested
          if (contextLines > 0) {
            match.contextBefore = lines.slice(Math.max(0, i - contextLines), i);
            match.contextAfter = lines.slice(i + 1, Math.min(lines.length, i + 1 + contextLines));
          }
          
          matches.push(match);
          fileMatches++;
        }
      }
    }
    
    return {
      matches,
      stats: {
        searches: 1,
        matches: matches.length,
        filesWithMatches: filesWithMatches.size,
        filesSearched,
        elapsedMs: Date.now() - startTime,
      },
      errors: [],
      usedRipgrep: false,
      usedVFS: true,
    };
  } catch (error: any) {
    return {
      matches: [],
      stats: { searches: 0, matches: 0, filesWithMatches: 0, filesSearched: 0, elapsedMs: Date.now() - startTime },
      errors: [error.message || 'VFS search failed'],
      usedRipgrep: false,
      usedVFS: true,
    };
  }
}

/**
 * Convert a basic glob pattern to regex
 */
function globToRegex(glob: string): RegExp {
  let re = '';
  let i = 0;
  while (i < glob.length) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        re += '.*';
        i += 2;
        continue;
      }
      re += '[^/\\\\]*';
    } else if (c === '?') {
      re += '[^/\\\\]';
    } else if (c === '{') {
      const end = glob.indexOf('}', i);
      if (end === -1) {
        re += '\\{';
      } else {
        const parts = glob.slice(i + 1, end).split(',');
        re += '(?:' + parts.map(p => p.replace(/[.+^${}()|[\]\\]/g, '\\$&')).join('|') + ')';
        i = end + 1;
        continue;
      }
    } else if (/[.+^${}()|[\]\\]/.test(c)) {
      re += '\\' + c;
    } else {
      re += c;
    }
    i++;
  }
  return new RegExp(re + '$');
}
