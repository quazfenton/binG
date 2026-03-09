import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveRequestAuth } from '@/lib/auth/request-auth';
import path from 'path';
import fs from 'fs/promises';
import { spawn } from 'child_process';

export const runtime = 'nodejs';

// SECURITY: Allowlist of permitted Git hosts to prevent SSRF
const ALLOWED_GIT_HOSTS = [
  'github.com',
  'gitlab.com',
  'bitbucket.org',
];

// Allow additional hosts from environment variable (comma-separated)
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

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  // SECURITY: Reject SSH/git@ URLs in production (can bypass host restrictions)
  if (/^git@/i.test(trimmed)) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('SSH git URLs are not allowed in production. Use HTTPS URLs.');
    }
    return trimmed;
  }

  throw new Error('Invalid repository URL format. Use owner/repo or https URL.');
}

/**
 * SECURITY: Validate repository URL against allowlist to prevent SSRF
 */
function validateRepoUrl(repoUrl: string): { valid: boolean; error?: string; hostname?: string } {
  try {
    // Handle SSH URLs (git@host:repo)
    if (repoUrl.startsWith('git@')) {
      const match = repoUrl.match(/^git@([^:]+):(.+)$/);
      if (!match) {
        return { valid: false, error: 'Invalid SSH URL format' };
      }
      const host = match[1];
      if (!FULL_ALLOWED_HOSTS.includes(host)) {
        return { valid: false, error: `Git host "${host}" is not allowed` };
      }
      return { valid: true, hostname: host };
    }

    // Parse HTTPS URLs
    const url = new URL(repoUrl);
    if (!['http:', 'https:'].includes(url.protocol)) {
      return { valid: false, error: 'Only HTTP and HTTPS protocols are allowed' };
    }

    if (!FULL_ALLOWED_HOSTS.includes(url.hostname)) {
      return { valid: false, error: `Git host "${url.hostname}" is not allowed. Allowed: ${FULL_ALLOWED_HOSTS.join(', ')}` };
    }

    // Block private IP ranges to prevent SSRF
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

  if (!normalized) {
    throw new Error('Destination path is required.');
  }

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

    child.stdout.on('data', (data: Buffer) => {
      output += data.toString();
    });

    child.stderr.on('data', (data: Buffer) => {
      output += data.toString();
    });

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

export async function POST(req: NextRequest) {
  // SECURITY: Require authentication to prevent SSRF abuse
  const authResult = await resolveRequestAuth(req, { allowAnonymous: false });
  if (!authResult.success || !authResult.userId) {
    return NextResponse.json(
      { error: 'Authentication required' },
      { status: 401 }
    );
  }

  try {
    const body = await req.json();
    const validation = cloneRequestSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid request',
          details: validation.error.errors.map((e) => ({
            field: e.path.join('.'),
            message: e.message,
          })),
        },
        { status: 400 },
      );
    }

    const normalizedRepoUrl = normalizeRepoUrl(validation.data.repoUrl);
    // SECURITY: Validate repository URL against allowlist
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

    // Build terminal command for direct terminal integration
    const terminalCommand = `git clone ${normalizedRepoUrl} ${destinationDir}`;

    return NextResponse.json({
      success: true,
      data: {
        repoUrl: normalizedRepoUrl,
        destinationPath: destinationDir,
        output,
        terminalCommand,
        validatedHost: urlValidation.hostname,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to clone repository';
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
