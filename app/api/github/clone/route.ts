import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import path from 'path';
import fs from 'fs/promises';
import { spawn } from 'child_process';

export const runtime = 'nodejs';

const cloneRequestSchema = z.object({
  repoUrl: z.string().min(1, 'Repository URL is required').max(1000, 'Repository URL is too long'),
  destinationPath: z.string().min(1, 'Destination path is required').max(300, 'Destination path is too long').optional().default('repos'),
});

function normalizeRepoUrl(repoUrl: string): string {
  const trimmed = repoUrl.trim();

  if (/^[\w.-]+\/[\w.-]+$/.test(trimmed)) {
    return `https://github.com/${trimmed}.git`;
  }

  if (/^https?:\/\//i.test(trimmed) || /^git@/i.test(trimmed)) {
    return trimmed;
  }

  throw new Error('Invalid repository URL format. Use owner/repo, https URL, or git@ URL.');
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
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to clone repository';
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
