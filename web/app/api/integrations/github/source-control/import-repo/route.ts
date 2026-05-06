/**
 * Import Repository
 * 
 * Import files from a GitHub repository to the workspace.
 * This is a wrapper around the existing /api/integrations/github import action.
 */

import { NextRequest, NextResponse } from 'next/server';


import { auth0 } from '@/lib/auth0';
import { getGitHubToken } from '@/lib/github/github-oauth';
import { getLocalUserIdFromAuth0 } from '@/lib/oauth/connections';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const session = await auth0.getSession(request);
    
    if (!session?.user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }
    
    const body = await request.json();
    const { owner, repo, branch } = body;
    
    if (!owner || !repo) {
      return NextResponse.json({ error: 'Owner and repo are required' }, { status: 400 });
    }
    
    // Get local user ID
    const auth0UserId = session.user.sub;
    const localUserId = await getLocalUserIdFromAuth0(auth0UserId);
    
    if (!localUserId) {
      return NextResponse.json({ error: 'Local user not found' }, { status: 404 });
    }
    
    // Get GitHub token (optional for public repos)
    let token: string | null = null;
    try {
      token = await getGitHubToken(localUserId);
    } catch {
      // Token not required for public repos
    }
    
    // Fetch repository info
    const repoResponse = await fetch(
      `https://api.github.com/repos/${owner}/${repo}`,
      token ? {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.github.v3+json',
        },
      } : undefined
    );
    
    if (!repoResponse.ok) {
      if (repoResponse.status === 404) {
        return NextResponse.json({ 
          error: 'Repository not found. It may be private and requires GitHub authentication.' 
        }, { status: 404 });
      }
      throw new Error('Failed to fetch repository info');
    }
    
    const repoInfo = await repoResponse.json();
    
    // Get files from repository
    const treeResponse = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch || repoInfo.default_branch}?recursive=1`,
      token ? {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.github.v3+json',
        },
      } : undefined
    );
    
    if (!treeResponse.ok) {
      throw new Error('Failed to fetch repository tree');
    }
    
    const tree = await treeResponse.json();

    // Validate tree response structure
    if (!tree || !Array.isArray(tree.tree)) {
      console.error('[GitHub Import] Malformed tree response:', tree);
      return NextResponse.json({ 
        error: 'Failed to fetch repository structure',
        details: 'Repository tree response is malformed'
      }, { status: 500 });
    }

    // Filter to files only (not directories)
    const files = tree.tree.filter((item: any) => item.type === 'blob');
    
    // Fetch file contents in parallel with concurrency limit (batch of 10)
    // This improves performance while avoiding GitHub API rate limits
    const CONCURRENCY_LIMIT = 10;
    const fileContents: Record<string, string> = {};
    const errors: string[] = [];
    
    // Process files in batches
    for (let i = 0; i < Math.min(files.length, 100); i += CONCURRENCY_LIMIT) {
      const batch = files.slice(i, i + CONCURRENCY_LIMIT);
      
      const batchPromises = batch.map(async (file) => {
        try {
          // URL-encode file path and branch/ref to handle special characters
          const encodedPath = encodeURIComponent(file.path);
          const encodedRef = encodeURIComponent(branch || repoInfo.default_branch);
          
          const contentResponse = await fetch(
            `https://api.github.com/repos/${owner}/${repo}/contents/${encodedPath}?ref=${encodedRef}`,
            token ? {
              headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/vnd.github.v3+json',
              },
            } : undefined
          );
          
          if (contentResponse.ok) {
            const contentData = await contentResponse.json();
            if (contentData.content && contentData.encoding === 'base64') {
              // Skip binary files - check by extension
              const binaryExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.ico', '.svg', '.pdf', '.zip', '.tar', '.gz', '.exe', '.dll', '.so', '.dylib', '.bin', '.dat', '.db', '.sqlite', '.class', '.jar', '.war', '.ear'];
              const fileExt = file.path.toLowerCase().substring(file.path.lastIndexOf('.'));

              if (binaryExtensions.includes(fileExt)) {
                // Store binary files as base64 with proper MIME type
                fileContents[file.path] = `data:application/octet-stream;base64,${contentData.content}`;
              } else {
                // Decode text files
                try {
                  fileContents[file.path] = Buffer.from(contentData.content, 'base64').toString('utf-8');
                } catch (decodeError) {
                  console.warn(`Failed to decode ${file.path} as UTF-8, storing as base64:`, decodeError);
                  fileContents[file.path] = `data:application/octet-stream;base64,${contentData.content}`;
                }
              }
            }
          } else {
            // Handle non-OK responses (rate limit, not found, etc.)
            console.warn(`Failed to fetch ${file.path}: HTTP ${contentResponse.status}`);
            errors.push(file.path);
          }
        } catch (error) {
          console.warn(`Failed to fetch ${file.path}:`, error);
          errors.push(file.path);
        }
      });
      
      // Wait for batch to complete before processing next batch
      await Promise.all(batchPromises);
    }
    
    return NextResponse.json({
      success: true,
      repo: {
        name: repoInfo.name,
        full_name: repoInfo.full_name,
        description: repoInfo.description,
        html_url: repoInfo.html_url,
        default_branch: repoInfo.default_branch,
        stargazers_count: repoInfo.stargazers_count,
        forks_count: repoInfo.forks_count,
        language: repoInfo.language,
      },
      files: fileContents,
      filesCount: Object.keys(fileContents).length,
      totalFiles: files.length,
      errors: errors.length > 0 ? errors : undefined,
      message: errors.length > 0 
        ? `Imported ${Object.keys(fileContents).length} files (${errors.length} failed)`
        : `Imported ${Object.keys(fileContents).length} files`,
    });
  } catch (error: any) {
    // Log full error details server-side
    console.error('[GitHub Import] Error:', error);

    // Determine safe error message + HTTP status for client
    let safeMessage = 'Failed to import repository';
    let status = 500;

    // Only include error message if it's a known, safe error type
    if (error instanceof SyntaxError) {
      safeMessage = 'Invalid request body';
      status = 400;
    } else if (error.name === 'AbortError') {
      safeMessage = 'Request timed out';
      status = 504;
    } else if (error.message && error.message.includes('not found')) {
      safeMessage = 'Repository not found';
      status = 404;
    } else if (error.message && error.message.includes('required')) {
      safeMessage = 'Missing required parameter';
      status = 400;
    } else if (error.message && error.message.includes('authentication')) {
      safeMessage = 'Authentication failed';
      status = 401;
    }
    // For all other errors, use generic message to avoid leaking internal details

    return NextResponse.json({
      error: safeMessage,
      // Only include details in development mode
      ...(process.env.NODE_ENV === 'development' && {
        details: error.toString(),
        stack: error.stack,
      }),
    }, { status });
  }
}
