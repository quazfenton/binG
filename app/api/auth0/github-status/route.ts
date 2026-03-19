/**
 * GitHub Authentication Status Check
 * 
 * Returns whether the user is authenticated with GitHub via Auth0,
 * and their list of repositories if authenticated.
 */

import { NextResponse } from 'next/server';
import { isAuth0Authenticated, getGitHubToken, getGitHubRepos } from '@/lib/auth0';

export async function GET() {
  try {
    const isAuthenticated = await isAuth0Authenticated();
    
    if (!isAuthenticated) {
      return NextResponse.json({ authenticated: false, repos: [] });
    }
    
    // Try to get the GitHub token
    const token = await getGitHubToken();
    
    if (!token) {
      return NextResponse.json({ authenticated: false, repos: [] });
    }
    
    // Get repos using the token
    const repos = await getGitHubRepos();
    
    return NextResponse.json({
      authenticated: true,
      repos: repos.map((repo) => ({
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
    });
  } catch (error) {
    console.error('[GitHub Status] Error:', error);
    return NextResponse.json({ 
      authenticated: false, 
      repos: [],
      error: error instanceof Error ? error.message : 'Failed to check auth status' 
    });
  }
}
