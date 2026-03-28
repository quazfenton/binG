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
import { spawn } from 'child_process';

export const runtime = 'nodejs';

const GITHUB_API = 'https://api.github.com';

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

async function fetchFileContent(url: string, token?: string): Promise<string> {
  const response = await fetchGitHubApi(url, token);
  
  if (!response.ok) {
    throw new Error(`Failed to fetch file: ${response.status}`);
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

async function scrapeTrendingRepos(timeframe: 'daily' | 'weekly' | 'monthly' = 'daily'): Promise<ScrapedRepo[]> {
  const url = `https://github.com/trending?since=${timeframe}`;
  
  const response = await fetch(url, {
    headers: {
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch trending page: ${response.statusText}`);
  }

  const html = await response.text();
  const repos: ScrapedRepo[] = [];

  const articleRegex = /<article[^>]*class="Box-row"[^>]*>([\s\S]*?)<\/article>/g;
  let articleMatch;
  let rank = 1;

  while ((articleMatch = articleRegex.exec(html)) !== null) {
    const articleHtml = articleMatch[1];
    
    const nameMatch = articleHtml.match(/href="\/([^"]+\/[^"]+)"[^>]*>\s*([\s\S]*?)<\//);
    if (!nameMatch) continue;

    const fullName = nameMatch[1].replace(/"/g, '').trim();
    const [owner, name] = fullName.split('/');
    
    const descMatch = articleHtml.match(/<p[^>]*class="col-9 color-fg-muted text-sm mt-1"[^>]*>\s*([\s\S]*?)\s*<\/p>/);
    const description = descMatch 
      ? descMatch[1].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim() 
      : '';

    const langMatch = articleHtml.match(/<span[^>]*class="color-fg-default text-sm ml-2"[^>]*>([^<]+)<\/span>/);
    const language = langMatch ? langMatch[1].trim() : '';

    const starsMatch = articleHtml.match(/href="\/[^"]+\/stargazers"[^>]*>\s*([\d,\.]+[kKmM]?)\s*<\//);
    const stars = parseNumber(starsMatch ? starsMatch[1] : '0');

    const forksMatch = articleHtml.match(/href="\/[^"]+\/forks"[^>]*>\s*([\d,\.]+[kKmM]?)\s*<\//);
    const forks = parseNumber(forksMatch ? forksMatch[1] : '0');

    let todayStars = 0;
    if (timeframe === 'daily') {
      const todayStarsMatch = articleHtml.match(/<svg[^>]*class="octicon octicon-star"[^>]*<\/svg>[^<]*([\d,\.]+[kKmM]?)/);
      if (todayStarsMatch) {
        todayStars = parseNumber(todayStarsMatch[1]);
      }
    }

    repos.push({
      rank,
      name,
      full_name: fullName,
      owner,
      description,
      language,
      stars,
      forks,
      todayStars,
      url: `https://github.com/${fullName}`,
    });

    rank++;
  }

  return repos;
}

async function fetchPopularReposFallback(): Promise<ScrapedRepo[]> {
  const response = await fetch(
    'https://api.github.com/search/repositories?q=stars:>10000&sort=stars&order=desc&per_page=25',
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
  const timeframe = searchParams.get('timeframe') as 'daily' | 'weekly' | 'monthly' || 'daily';

  // GET /api/integrations/github?type=trending
  if (type === 'trending') {
    try {
      let repos: ScrapedRepo[];
      try {
        repos = await scrapeTrendingRepos(timeframe);
      } catch (scrapeError) {
        console.warn('Scraping failed, using API fallback:', scrapeError);
        repos = await fetchPopularReposFallback();
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
          source: 'github-trending',
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
  try {
    const body = await request.json();
    const { action } = body;

    // POST /api/integrations/github { action: 'clone', repoUrl, destinationPath }
    if (action === 'clone') {
      const authResult = await resolveRequestAuth(request, { allowAnonymous: false });
      if (!authResult.success || !authResult.userId) {
        return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
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

      const safeDestinationPath = validateDestinationPath(validation.data.destinationPath);
      const repoName = extractRepoName(normalizedRepoUrl);

      const workspaceRoot = process.cwd();
      const destinationBase = path.resolve(workspaceRoot, safeDestinationPath);
      const workspaceRootWithSep = workspaceRoot.endsWith(path.sep) ? workspaceRoot : `${workspaceRoot}${path.sep}`;

      if (destinationBase !== workspaceRoot && !destinationBase.startsWith(workspaceRootWithSep)) {
        return NextResponse.json(
          { success: false, error: 'Destination path must stay inside the application workspace.' },
          { status: 400 },
        );
      }

      await fs.mkdir(destinationBase, { recursive: true });

      const destinationDir = path.join(destinationBase, repoName);
      const destinationExists = await fs.stat(destinationDir).then(() => true).catch(() => false);
      if (destinationExists) {
        const entries = await fs.readdir(destinationDir);
        if (entries.length > 0) {
          return NextResponse.json(
            { success: false, error: `Destination already exists and is not empty: ${destinationDir}` },
            { status: 400 },
          );
        }
      }

      const output = await runGitClone(normalizedRepoUrl, destinationDir);

      return NextResponse.json({
        success: true,
        data: {
          repoUrl: normalizedRepoUrl,
          destinationPath: destinationDir,
          output,
          terminalCommand: `git clone ${normalizedRepoUrl} ${destinationDir}`,
          validatedHost: urlValidation.hostname,
        },
      });
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
