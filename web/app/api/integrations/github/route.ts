/**
 * GitHub Integration API
 * 
 * Unified endpoint for all GitHub operations:
 * - GET /api/integrations/github - List authenticated user's repos
 * - GET /api/integrations/github?type=trending - Get trending repos (scraping, no API key)
 * - POST /api/integrations/github { action: 'clone', ... } - Clone repository (requires auth)
 * - POST /api/integrations/github { url, maxFiles } - Import files from repo (public or authenticated)
 * - POST /api/integrations/github { action: 'import', owner, repo, branch, maxFiles } - Import files
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveRequestAuth } from '@/lib/auth/request-auth';
import { auth0 } from '@/lib/auth0';
import path from 'path';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import { spawn } from 'child_process';
import { generateSecureId } from '@/lib/utils';
import { virtualFilesystem } from '@/lib/virtual-filesystem/virtual-filesystem-service';
import { resolveFilesystemOwnerWithFallback } from '@/app/api/filesystem/utils';
import { emitFilesystemUpdated } from '@/lib/virtual-filesystem/sync/sync-events';
import crypto from 'crypto';



const GITHUB_API = 'https://api.github.com';

// ============================================
// Simple in-memory cache with TTL
// ============================================

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

class SimpleCache {
  private store = new Map<string, CacheEntry<any>>();

  get<T>(key: string): T | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.data as T;
  }

  set<T>(key: string, data: T, ttlMs: number): void {
    this.store.set(key, { data, expiresAt: Date.now() + ttlMs });
  }

  clear(key: string): void {
    this.store.delete(key);
  }
}

// Shared cache instance (persists across requests in Node.js)
const cache = new SimpleCache();

// Cache TTLs
const TRENDING_CACHE_TTL = 15 * 60 * 1000; // 15 minutes (GitHub updates ~every 15 min)
const POPULAR_CACHE_TTL = 30 * 60 * 1000;  // 30 minutes (popular repos change slowly)

// ============================================
// Concurrency Control for Clone Operations
// ============================================

const MAX_CONCURRENT_CLONES = parseInt(process.env.MAX_CONCURRENT_CLONES || '3', 10);
let activeClones = 0;
const cloneQueue: Array<() => void> = [];

/**
 * Acquire a clone slot, waiting if at capacity
 */
async function acquireCloneSlot(): Promise<void> {
  if (activeClones < MAX_CONCURRENT_CLONES) {
    activeClones++;
    return;
  }

  // Wait for a slot to become available
  return new Promise<void>((resolve) => {
    cloneQueue.push(resolve);
  });
}

/**
 * Release a clone slot and process next in queue
 */
function releaseCloneSlot(): void {
  activeClones--;
  const next = cloneQueue.shift();
  if (next) {
    activeClones++;
    next();
  }
}

interface GitHubFile {
  name: string;
  path: string;
  type: 'file' | 'dir';
  download_url?: string;
}

interface ScrapedRepo {
  rank: number;
  name: string;
  full_name: string;
  owner: string;
  description: string;
  language: string;
  stars: number;
  forks: number;
  todayStars: number;
  url: string;
}

// ============================================
// GITHUB API HELPERS (for unauthenticated public repos)
// ============================================

async function fetchGitHubApi(url: string, token?: string): Promise<Response> {
  const headers: Record<string, string> = {
    'Accept': 'application/vnd.github.v3+json',
  };
  
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  return fetch(url, { headers });
}

async function getGitHubToken(): Promise<string | null> {
  try {
    const session = await auth0.getSession();
    if (session) {
      const token = await auth0.getAccessToken();
      if (token.token) {
        return token.token;
      }
    }
  } catch {
    // Not authenticated via Auth0
  }
  return null;
}

async function fetchRepoContents(
  owner: string,
  repo: string,
  repoPath: string = '',
  token?: string,
  branch?: string
): Promise<GitHubFile[]> {
  const encodedPath = encodeURIComponent(repoPath);
  let url = `${GITHUB_API}/repos/${owner}/${repo}/contents/${encodedPath}`;
  if (branch) {
    url += `?ref=${encodeURIComponent(branch)}`;
  }
  const response = await fetchGitHubApi(url, token);
  
  if (!response.ok) {
    throw new Error(`GitHub API error: ${response.status}`);
  }
  
  return response.json();
}

// SECURITY: Max file size for GitHub import (matches VFS MAX_FILE_SIZE)
const MAX_GITHUB_IMPORT_FILE_SIZE = 100 * 1024 * 1024; // 100MB

async function fetchFileContent(url: string, token?: string): Promise<string> {
  const response = await fetchGitHubApi(url, token);

  if (!response.ok) {
    throw new Error(`Failed to fetch file: ${response.status}`);
  }

  // SECURITY: O(1) content-length check BEFORE buffering into memory
  const contentLength = response.headers.get('content-length');
  if (contentLength && parseInt(contentLength, 10) > MAX_GITHUB_IMPORT_FILE_SIZE) {
    throw new Error(`File too large: ${(parseInt(contentLength, 10) / (1024 * 1024)).toFixed(1)}MB exceeds ${(MAX_GITHUB_IMPORT_FILE_SIZE / (1024 * 1024))}MB limit`);
  }

  return response.text();
}

async function recursivelyFetchDirectory(
  owner: string,
  repo: string,
  repoPath: string,
  token?: string,
  maxFiles: number = 100,
  existingFiles: Map<string, string> = new Map(),
  branch?: string
): Promise<Map<string, string>> {
  if (existingFiles.size >= maxFiles) return existingFiles;
  
  const contents = await fetchRepoContents(owner, repo, repoPath, token, branch);
  
  for (const item of contents) {
    if (existingFiles.size >= maxFiles) break;
    
    if (item.type === 'file' && item.download_url) {
      const content = await fetchFileContent(item.download_url, token);
      existingFiles.set(item.path, content);
    } else if (item.type === 'dir') {
      await recursivelyFetchDirectory(owner, repo, item.path, token, maxFiles, existingFiles, branch);
    }
  }
  
  return existingFiles;
}

function parseGitHubUrl(url: string): { owner: string; repo: string; branch?: string } | null {
  const patterns = [
    /^https?:\/\/github\.com\/([^\/]+)\/([^\/]+?)(?:\/(?:tree|blob)\/([^\/]+))?(?:\/.*)?$/,
    /^([^\/]+)\/([^\/]+?)(?:\/(?:tree|blob)\/([^\/]+))?(?:\/.*)?$/,
  ];
  
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) {
      return {
        owner: match[1],
        repo: match[2].replace(/\.git$/, ''),
        branch: match[3],
      };
    }
  }
  
  return null;
}

// ============================================
// TRENDING REPOS (Scraping - no API key needed)
// ============================================

async function scrapeTrendingReposForTimeframe(timeframe: 'weekly' | 'monthly'): Promise<ScrapedRepo[]> {
  const url = `https://github.com/trending?since=${timeframe}`;

  const response = await fetch(url, {
    headers: {
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch trending page: ${response.statusText}`);
  }

  const html = await response.text();
  const repos: ScrapedRepo[] = [];

  // Split HTML into article blocks
  const articleRegex = /<article[^>]*>([\s\S]*?)<\/article>/gi;
  let articleMatch;
  let rank = 1;

  while ((articleMatch = articleRegex.exec(html)) !== null) {
    const articleHtml = articleMatch[1];

    // Find repo link - look for /owner/repo pattern in href
    const linkRegex = /href="\/([^\/]+)\/([^\/"]+)"/g;
    let linkMatch;
    let fullName = '';
    let owner = '';
    let name = '';

    // Find the first valid repo link (skip sponsor, orgs, etc.)
    while ((linkMatch = linkRegex.exec(articleHtml)) !== null) {
      const potentialOwner = linkMatch[1];
      const potentialName = linkMatch[2];

      // Skip invalid patterns
      if (potentialOwner.toLowerCase() === 'sponsors' ||
          potentialOwner.toLowerCase() === 'orgs' ||
          potentialOwner.toLowerCase() === 'trending' ||
          potentialOwner.toLowerCase() === 'collections' ||
          potentialOwner.toLowerCase() === 'features' ||
          potentialOwner.toLowerCase() === 'security' ||
          potentialOwner.toLowerCase() === 'customer-stories' ||
          potentialOwner.toLowerCase() === 'enterprise' ||
          potentialOwner.toLowerCase() === 'explore' ||
          potentialOwner.toLowerCase() === 'topics' ||
          potentialOwner.toLowerCase() === 'marketplace' ||
          potentialOwner.toLowerCase() === 'settings' ||
          potentialOwner.toLowerCase() === 'notifications' ||
          potentialOwner.toLowerCase() === 'issues' ||
          potentialOwner.toLowerCase() === 'pulls' ||
          potentialName.toLowerCase() === 'sponsors' ||
          potentialName.toLowerCase() === 'followers' ||
          potentialName.toLowerCase() === 'following') {
        continue;
      }

      // Valid repo link found
      owner = potentialOwner;
      name = potentialName;
      fullName = `${owner}/${name}`;
      break;
    }

    if (!fullName) continue;

    // Extract description
    const descMatch = articleHtml.match(/<p[^>]*>([\s\S]*?)<\/p>/);
    const description = descMatch
      ? descMatch[1].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()
      : '';

    // Extract language
    const langMatch = articleHtml.match(/class="repo-language-color"[^>]*>[^<]*<[^>]*>([^<]+)<\/span>/i) ||
                      articleHtml.match(/<span[^>]*>([^<]+)<\/span>[^<]*<span[^>]*>stars<\/span>/i);
    const language = langMatch ? langMatch[1].trim() : '';

    // Extract total stars
    const starsMatch = articleHtml.match(/(\d[\d,\.]*[kKmM]?)\s*stars?/i) ||
                       articleHtml.match(/href="\/[^"]+\/stargazers"[^>]*>.*?(\d[\d,\.]*[kKmM]?)/i);
    const stars = starsMatch ? parseNumber(starsMatch[1]) : 0;

    // Extract forks
    const forksMatch = articleHtml.match(/(\d[\d,\.]*[kKmM]?)\s*forks?/i) ||
                       articleHtml.match(/href="\/[^"]+\/forks"[^>]*>.*?(\d[\d,\.]*[kKmM]?)/i);
    const forks = forksMatch ? parseNumber(forksMatch[1]) : 0;

    repos.push({
      rank,
      name,
      full_name: fullName,
      owner,
      description,
      language,
      stars,
      forks,
      todayStars: 0,
      url: `https://github.com/${fullName}`,
    });

    rank++;
  }

  console.log(`[GitHub Trending] Scraped ${repos.length} repos from ${url}`);
  return repos;
}

async function scrapeTrendingRepos(): Promise<ScrapedRepo[]> {
  // Fetch both weekly and monthly trending
  const [weeklyRepos, monthlyRepos] = await Promise.allSettled([
    scrapeTrendingReposForTimeframe('weekly'),
    scrapeTrendingReposForTimeframe('monthly'),
  ]);

  let results: ScrapedRepo[] = [];

  if (weeklyRepos.status === 'fulfilled') {
    results = results.concat(weeklyRepos.value);
  } else {
    console.warn('[GitHub Trending] Weekly scraping failed:', weeklyRepos.reason);
  }

  if (monthlyRepos.status === 'fulfilled') {
    results = results.concat(monthlyRepos.value);
  } else {
    console.warn('[GitHub Trending] Monthly scraping failed:', monthlyRepos.reason);
  }

  // Deduplicate by full_name (repo URL hash)
  const seen = new Set<string>();
  const deduped: ScrapedRepo[] = [];
  for (const repo of results) {
    const key = repo.full_name.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(repo);
    }
  }

  // Re-rank after deduplication
  return deduped.map((repo, idx) => ({ ...repo, rank: idx + 1 }));
}

async function fetchPopularReposFallback(): Promise<ScrapedRepo[]> {
  const response = await fetch(
    'https://api.github.com/search/repositories?q=stars:>1000&sort=stars&order=desc&per_page=50',
    {
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'GitHub-Trending-Explorer',
      },
    }
  );

  if (!response.ok) {
    throw new Error('Failed to fetch popular repositories from GitHub API');
  }

  const data = await response.json();

  return (data.items || []).map((repo: any, idx: number) => ({
    rank: idx + 1,
    name: repo.name,
    full_name: repo.full_name,
    owner: repo.owner.login,
    description: repo.description || '',
    language: repo.language || '',
    stars: repo.stargazers_count,
    forks: repo.forks_count,
    todayStars: 0,
    url: repo.html_url,
  }));
}

function parseNumber(str: string): number {
  if (!str) return 0;
  const clean = str.toLowerCase().trim();
  if (clean.includes('k')) return Math.round(parseFloat(clean.replace('k', '')) * 1000);
  if (clean.includes('m')) return Math.round(parseFloat(clean.replace('m', '')) * 1000000);
  return parseInt(clean.replace(/,/g, ''), 10) || 0;
}

// ============================================
// GIT CLONE (with security validation)
// ============================================

const ALLOWED_GIT_HOSTS = ['github.com', 'gitlab.com', 'bitbucket.org'];
const EXTRA_ALLOWED_HOSTS = process.env.GIT_ALLOWED_HOSTS?.split(',').map(h => h.trim()) || [];
const FULL_ALLOWED_HOSTS = [...ALLOWED_GIT_HOSTS, ...EXTRA_ALLOWED_HOSTS];

const cloneRequestSchema = z.object({
  repoUrl: z.string().min(1, 'Repository URL is required').max(1000, 'Repository URL is too long'),
  destinationPath: z.string().min(1, 'Destination path is required').max(300, 'Destination path is too long').optional().default('repos'),
});

function normalizeRepoUrl(repoUrl: string): string {
  const trimmed = repoUrl.trim();
  if (/^[\w.-]+\/[\w.-]+$/.test(trimmed)) {
    return `https://github.com/${trimmed}.git`;
  }
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^git@/i.test(trimmed)) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('SSH git URLs are not allowed in production. Use HTTPS URLs.');
    }
    return trimmed;
  }
  throw new Error('Invalid repository URL format. Use owner/repo or https URL.');
}

function validateRepoUrl(repoUrl: string): { valid: boolean; error?: string; hostname?: string } {
  try {
    if (repoUrl.startsWith('git@')) {
      const match = repoUrl.match(/^git@([^:]+):(.+)$/);
      if (!match) return { valid: false, error: 'Invalid SSH URL format' };
      const host = match[1];
      if (!FULL_ALLOWED_HOSTS.includes(host)) {
        return { valid: false, error: `Git host "${host}" is not allowed` };
      }
      return { valid: true, hostname: host };
    }
    const url = new URL(repoUrl);
    if (!['http:', 'https:'].includes(url.protocol)) {
      return { valid: false, error: 'Only HTTP and HTTPS protocols are allowed' };
    }
    if (!FULL_ALLOWED_HOSTS.includes(url.hostname)) {
      return { valid: false, error: `Git host "${url.hostname}" is not allowed. Allowed: ${FULL_ALLOWED_HOSTS.join(', ')}` };
    }
    if (url.username || url.password) {
      return { valid: false, error: 'Credentials in URL are not allowed' };
    }
    const ipPattern = /^(10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.|127\.|169\.254\.)/;
    if (ipPattern.test(url.hostname)) {
      return { valid: false, error: 'Private/internal IP addresses are not allowed' };
    }
    return { valid: true, hostname: url.hostname };
  } catch {
    return { valid: false, error: 'Invalid URL format' };
  }
}

function extractRepoName(repoUrl: string): string {
  const cleaned = repoUrl.replace(/\.git$/i, '').replace(/\/+$/, '');
  const parts = cleaned.split('/').filter(Boolean);
  const repoName = parts[parts.length - 1];
  if (!repoName || !/^[a-zA-Z0-9._-]+$/.test(repoName)) {
    throw new Error('Could not determine a safe repository name from the URL.');
  }
  return repoName;
}

function validateDestinationPath(destinationPath: string): string {
  const normalized = destinationPath.replace(/\\/g, '/').trim();
  if (!normalized) throw new Error('Destination path is required.');
  if (normalized.includes('..') || normalized.includes('\0')) {
    throw new Error('Destination path contains invalid characters.');
  }
  if (path.isAbsolute(normalized)) {
    throw new Error('Destination path must be relative to the application root.');
  }
  if (!/^[a-zA-Z0-9._\-/ ]+$/.test(normalized)) {
    throw new Error('Destination path contains unsupported characters.');
  }
  return normalized;
}

async function runGitClone(repoUrl: string, destinationDir: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['clone', repoUrl, destinationDir], { shell: false });
    let output = '';
    let completed = false;
    const timeout = setTimeout(() => {
      if (!completed) {
        child.kill();
        reject(new Error('git clone timed out after 10 minutes.'));
      }
    }, 10 * 60 * 1000);

    child.stdout.on('data', (data: Buffer) => { output += data.toString(); });
    child.stderr.on('data', (data: Buffer) => { output += data.toString(); });
    child.on('error', (error) => {
      clearTimeout(timeout);
      completed = true;
      reject(new Error(`Failed to run git clone: ${error.message}`));
    });
    child.on('close', (code) => {
      clearTimeout(timeout);
      completed = true;
      if (code !== 0) {
        reject(new Error(output || `git clone failed with exit code ${code}`));
        return;
      }
      resolve(output);
    });
  });
}

/**
 * Walk a cloned repo directory and write all files to the user's VFS
 * Security: skips .git directory, binary files, and files > 5MB
 */
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const SKIP_DIRS = ['.git', 'node_modules', '.next', 'dist', 'build', '__pycache__', '.venv', 'venv'];
const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.webp', '.svg',
  '.woff', '.woff2', '.ttf', '.eot', '.otf',
  '.zip', '.tar', '.gz', '.rar', '.7z', '.bz2',
  '.exe', '.dll', '.so', '.dylib', '.a', '.lib',
  '.pyc', '.pyo', '.class', '.o', '.obj',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx',
  '.mp3', '.mp4', '.avi', '.mov', '.webm',
  '.wasm', '.bin', '.dat',
]);

function detectLanguage(filePath: string): string | undefined {
  const ext = path.extname(filePath).toLowerCase();
  const langMap: Record<string, string> = {
    '.ts': 'typescript', '.tsx': 'typescript', '.js': 'javascript', '.jsx': 'javascript',
    '.py': 'python', '.rs': 'rust', '.go': 'go', '.java': 'java',
    '.rb': 'ruby', '.php': 'php', '.cs': 'csharp', '.cpp': 'cpp', '.c': 'c',
    '.h': 'c', '.hpp': 'cpp', '.swift': 'swift', '.kt': 'kotlin',
    '.html': 'html', '.css': 'css', '.scss': 'scss', '.sass': 'sass',
    '.json': 'json', '.xml': 'xml', '.yaml': 'yaml', '.yml': 'yaml',
    '.md': 'markdown', '.txt': 'text', '.sh': 'shell', '.bash': 'shell',
    '.sql': 'sql', '.graphql': 'graphql', '.toml': 'toml',
  };
  return langMap[ext];
}

async function cloneRepoToVFS(
  cloneDir: string,
  ownerId: string,
  vfsBasePath: string,
  repoName: string
): Promise<{ filesWritten: number; filesSkipped: number; writtenPaths: string[] }> {
  let filesWritten = 0;
  let filesSkipped = 0;
  const writtenPaths: string[] = [];

  async function walkDir(dir: string, relativePath: string) {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      // Security: reject symlinks to prevent reading files outside tmpDir
      if (entry.isSymbolicLink()) {
        filesSkipped++;
        continue;
      }

      // Security: skip hidden/system dirs and known large dirs
      if (entry.isDirectory() && (entry.name.startsWith('.') || SKIP_DIRS.includes(entry.name))) {
        continue;
      }

      const fullPath = path.join(dir, entry.name);
      const relPath = path.join(relativePath, entry.name);
      const vfsPath = path.posix.join(vfsBasePath, repoName, relPath.replace(/\\/g, '/'));

      if (entry.isDirectory()) {
        await walkDir(fullPath, relPath);
      } else {
        // Skip binary/large files
        const ext = path.extname(entry.name).toLowerCase();
        if (BINARY_EXTENSIONS.has(ext)) continue;

        const stat = await fs.stat(fullPath);
        if (stat.size > MAX_FILE_SIZE) continue;

        try {
          // Atomic write with failIfExists to prevent TOCTOU race conditions
          const content = await fs.readFile(fullPath, 'utf-8');
          const language = detectLanguage(entry.name);
          await virtualFilesystem.writeFile(ownerId, vfsPath, content, language, { failIfExists: true });
          filesWritten++;
          writtenPaths.push(vfsPath);
        } catch (err) {
          // Skip files that can't be read as UTF-8 or already exist (atomic check prevented race)
          const errMsg = (err as Error).message;
          if (!errMsg.startsWith('File already exists:')) {
            console.warn(`[GitHub Clone] Skipping file ${vfsPath}:`, errMsg);
          }
          filesSkipped++;
        }
      }
    }
  }

  await walkDir(cloneDir, '');

  // Emit filesystem update event for UI refresh
  if (writtenPaths.length > 0) {
    const scopePath = path.posix.join(vfsBasePath, repoName);
    emitFilesystemUpdated({
      path: scopePath,
      paths: writtenPaths,
      scopePath,
      type: 'create',
      workspaceVersion: Date.now(),
      applied: writtenPaths.map(p => ({
        path: p,
        operation: 'write' as const,
        timestamp: Date.now(),
      })),
      source: 'github-clone',
    });
  }

  return { filesWritten, filesSkipped, writtenPaths };
}

// ============================================
// API ROUTES
// ============================================

/**
 * GET /api/integrations/github - Multiple options:
 * - ?type=trending&timeframe=daily|weekly|monthly - Get trending repos (scraping, no auth)
 * - ?type=repos - Get authenticated user's repos (requires Auth0 GitHub connection)
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const type = searchParams.get('type') || 'repos';

  // GET /api/integrations/github?type=trending
  if (type === 'trending') {
    try {
      // Check cache first
      const cached = cache.get<{ repos: ScrapedRepo[]; source: string }>('trending-repos');
      if (cached) {
        return NextResponse.json({
          success: true,
          data: {
            repos: cached.repos,
            fetchedAt: new Date().toISOString(),
            source: cached.source,
            cached: true,
          },
        });
      }

      let repos: ScrapedRepo[];
      let source = 'github-trending';
      try {
        repos = await scrapeTrendingRepos();
        console.log(`[GitHub Trending] Scraping returned ${repos.length} repos`);

        // If scraping returned too few results, use API fallback
        if (repos.length < 5) {
          console.warn('[GitHub Trending] Too few repos from scraping, using API fallback');
          repos = await fetchPopularReposFallback();
          source = 'github-api-popular';
          cache.set('trending-repos', { repos, source }, POPULAR_CACHE_TTL);
        } else {
          cache.set('trending-repos', { repos, source }, TRENDING_CACHE_TTL);
        }
      } catch (scrapeError) {
        console.warn('Scraping failed, using API fallback:', scrapeError);
        repos = await fetchPopularReposFallback();
        source = 'github-api-popular';
        cache.set('trending-repos', { repos, source }, POPULAR_CACHE_TTL);
      }

      if (repos.length === 0) {
        return NextResponse.json(
          { success: false, error: 'No repositories found' },
          { status: 404 }
        );
      }

      return NextResponse.json({
        success: true,
        data: {
          repos,
          fetchedAt: new Date().toISOString(),
          source,
          cached: false,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch trending repositories';
      return NextResponse.json({ success: false, error: message }, { status: 500 });
    }
  }

  // GET /api/integrations/github (default: list authenticated user's repos)
  try {
    const token = await getGitHubToken();
    
    if (!token) {
      return NextResponse.json({
        error: 'GitHub not connected',
        requiresAuth: true,
        connection: 'github',
        connectUrl: '/auth/connect?connection=github',
      }, { status: 401 });
    }
    
    const response = await fetchGitHubApi(`${GITHUB_API}/user/repos?sort=updated&per_page=30`, token);
    
    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status}`);
    }
    
    const repos = await response.json();
    
    return NextResponse.json({
      success: true,
      repos: repos.map((repo: any) => ({
        id: repo.id,
        name: repo.name,
        fullName: repo.full_name,
        description: repo.description,
        private: repo.private,
        url: repo.html_url,
        defaultBranch: repo.default_branch,
        stars: repo.stargazers_count,
        language: repo.language,
      })),
      authSource: 'auth0',
    });
  } catch (error) {
    console.error('[GitHub Integration] Error listing repos:', error);
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Failed to list GitHub repos' 
    }, { status: 500 });
  }
}

/**
 * POST /api/integrations/github - Multiple operations:
 * - { action: 'clone', repoUrl, destinationPath } - Clone repo (requires auth, git)
 * - { action: 'import', owner, repo, branch, maxFiles } - Import files (via Auth0 token or public)
 * - { url, maxFiles } - Import from URL (legacy support, uses token for private or scraping for public)
 */
export async function POST(request: NextRequest) {
  // Handle malformed JSON separately
  let body: any;
  try {
    body = await request.json();
  } catch (error: any) {
    console.warn('[GitHub Integration] Malformed JSON:', error.message);
    return NextResponse.json(
      { 
        error: 'Invalid JSON in request body',
        details: error.message 
      }, 
      { status: 400 }
    );
  }

  try {
    const { action } = body;

    // POST /api/integrations/github { action: 'clone', repoUrl, destinationPath }
    if (action === 'clone') {
      // Allow anonymous cloning for public repos
      const authResult = await resolveRequestAuth(request, { allowAnonymous: true });
      let anonSessionId: string | null = null;

      // Resolve VFS owner for writing files first, so we can use consistent anonymous IDs
      let ownerId: string;
      if (authResult.success && authResult.userId) {
        ownerId = authResult.userId;
      } else {
        const fsOwner = await resolveFilesystemOwnerWithFallback(request, { route: 'clone', requestId: crypto.randomUUID() });
        if (fsOwner.ownerId) {
          ownerId = fsOwner.ownerId;
          // Use the same anonSessionId from fsOwner resolution for cookie consistency
          if (!authResult.success && fsOwner.anonSessionId) {
            anonSessionId = fsOwner.anonSessionId;
          }
        } else {
          // Generate anonymous owner - reuse the same ID for both owner and cookie
          const generatedAnonId = generateSecureId('anon');
          ownerId = `anon:${generatedAnonId}`;
          anonSessionId = generatedAnonId;
        }
      }

      const validation = cloneRequestSchema.safeParse(body);
      if (!validation.success) {
        return NextResponse.json({
          success: false,
          error: 'Invalid request',
          details: validation.error.errors.map((e) => ({
            field: e.path.join('.'),
            message: e.message,
          })),
        }, { status: 400 });
      }

      const normalizedRepoUrl = normalizeRepoUrl(validation.data.repoUrl);
      const urlValidation = validateRepoUrl(normalizedRepoUrl);
      if (!urlValidation.valid) {
        return NextResponse.json(
          { error: urlValidation.error, allowedHosts: FULL_ALLOWED_HOSTS },
          { status: 400 }
        );
      }

      const repoName = extractRepoName(normalizedRepoUrl);
      // Treat 'repos' as omitted value and default to project/sessions/{repoName}
      const vfsDestinationPath =
        !validation.data.destinationPath || validation.data.destinationPath === 'repos'
          ? `project/sessions/${repoName}`
          : validation.data.destinationPath;

      // Security: validate VFS destination path
      const normalizedVfsPath = vfsDestinationPath.replace(/\\/g, '/').replace(/^\/+/, '');
      // Ensure path starts with project/sessions for security isolation
      if (!normalizedVfsPath.startsWith('project/sessions') || normalizedVfsPath.includes('..') || normalizedVfsPath.includes('\0')) {
        return NextResponse.json(
          { success: false, error: 'Destination path must be within project/sessions/' },
          { status: 400 }
        );
      }

      // Clone to a temp directory inside the app (isolated, auto-cleaned)
      const appRoot = process.cwd();
      const tmpBase = path.join(appRoot, '.tmp');
      // Ensure .tmp directory exists
      await fs.mkdir(tmpBase, { recursive: true });
      const tmpDir = path.join(tmpBase, `clone-${crypto.randomUUID()}`);

      // Acquire concurrency slot (waits if at capacity)
      await acquireCloneSlot();

      try {
        // Clone repo to temp dir
        await runGitClone(normalizedRepoUrl, tmpDir);

        // Walk cloned repo and write files to VFS
        const cloneResult = await cloneRepoToVFS(tmpDir, ownerId, normalizedVfsPath, repoName);

        const init: ResponseInit = { status: 200 };
        if (anonSessionId) {
          const isSecure = process.env.NODE_ENV === 'production';
          init.headers = {
            'Set-Cookie': `anon-session-id=${anonSessionId}; Path=/; Max-Age=31536000; SameSite=Lax; HttpOnly${isSecure ? '; Secure' : ''}`,
          };
        }

        return NextResponse.json({
          success: true,
          data: {
            repoUrl: normalizedRepoUrl,
            vfsPath: `${normalizedVfsPath}/${repoName}`,
            filesWritten: cloneResult.filesWritten,
            filesSkipped: cloneResult.filesSkipped,
            terminalCommand: `git clone ${normalizedRepoUrl}`,
            validatedHost: urlValidation.hostname,
          },
        }, init);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Clone failed';
        return NextResponse.json({ success: false, error: message }, { status: 500 });
      } finally {
        // ALWAYS clean up temp directory (async to avoid blocking event loop)
        try {
          await fs.rm(tmpDir, { recursive: true, force: true });
        } catch (cleanupError) {
          console.error('[GitHub Clone] Failed to clean temp dir:', tmpDir, cleanupError);
        } finally {
          // Release concurrency slot
          releaseCloneSlot();
        }
      }
    }

    // POST /api/integrations/github { action: 'import', owner, repo, branch }
    if (action === 'import') {
      const { owner, repo, branch, maxFiles: rawMaxFiles = 50 } = body;
      
      if (!owner || !repo) {
        return NextResponse.json({ error: 'owner and repo are required for import action' }, { status: 400 });
      }
      
      const maxFiles = Math.min(Math.max(1, Number(rawMaxFiles) || 50), 500);
      
      const token = await getGitHubToken();
      
      // Fetch repo info
      const repoUrl = `${GITHUB_API}/repos/${owner}/${repo}`;
      const repoResponse = await fetchGitHubApi(repoUrl, token || undefined);
      
      if (!repoResponse.ok) {
        if (repoResponse.status === 404) {
          return NextResponse.json({ error: 'Repository not found' }, { status: 404 });
        }
        return NextResponse.json({ 
          error: `GitHub API error: ${repoResponse.status}` 
        }, { status: repoResponse.status });
      }
      
      const repoInfo = await repoResponse.json();
      const defaultBranch = repoInfo.default_branch;
      const repoBranch = branch || defaultBranch;
      
      // Recursively fetch all files
      const files = await recursivelyFetchDirectory(
        owner, 
        repo, 
        '', 
        token || undefined,
        maxFiles,
        new Map(),
        repoBranch
      );
      
      return NextResponse.json({
        success: true,
        repo: {
          owner,
          name: repo,
          branch: repoBranch,
          defaultBranch,
          fullName: `${owner}/${repo}`,
          description: repoInfo.description,
          stars: repoInfo.stargazers_count,
        },
        files: Object.fromEntries(files),
        fileCount: files.size,
        authSource: token ? 'auth0' : 'public',
      });
    }

    // POST /api/integrations/github { url, maxFiles } (legacy import from URL)
    const { url, maxFiles: rawMaxFiles = 50 } = body;
    if (!url) {
      return NextResponse.json({ error: 'URL, or action (import/clone) is required' }, { status: 400 });
    }
    
    const maxFiles = Math.min(Math.max(1, Number(rawMaxFiles) || 50), 500);
    
    const parsed = parseGitHubUrl(url);
    if (!parsed) {
      return NextResponse.json({ 
        error: 'Invalid GitHub URL. Use formats like: github.com/owner/repo or owner/repo' 
      }, { status: 400 });
    }
    
    const token = await getGitHubToken();
    
    // Fetch repository info
    const repoUrl = `${GITHUB_API}/repos/${parsed.owner}/${parsed.repo}`;
    const repoResponse = await fetchGitHubApi(repoUrl, token || undefined);
    
    if (!repoResponse.ok) {
      if (repoResponse.status === 404) {
        return NextResponse.json({ error: 'Repository not found' }, { status: 404 });
      }
      return NextResponse.json({ 
        error: `GitHub API error: ${repoResponse.status}` 
      }, { status: repoResponse.status });
    }
    
    const repoInfo = await repoResponse.json();
    const defaultBranch = repoInfo.default_branch;
    const branch = parsed.branch || defaultBranch;
    
    // Recursively fetch all files
    const files = await recursivelyFetchDirectory(
      parsed.owner, 
      parsed.repo, 
      '', 
      token || undefined,
      maxFiles,
      new Map(),
      branch
    );
    
    return NextResponse.json({
      success: true,
      repo: {
        owner: parsed.owner,
        name: parsed.repo,
        branch,
        defaultBranch,
        fullName: `${parsed.owner}/${parsed.repo}`,
        description: repoInfo.description,
        stars: repoInfo.stargazers_count,
      },
      files: Object.fromEntries(files),
      fileCount: files.size,
      authSource: token ? 'auth0' : 'public',
    });

  } catch (error) {
    console.error('[GitHub Integration] Error:', error);
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Failed to process GitHub request' 
    }, { status: 500 });
  }
}
