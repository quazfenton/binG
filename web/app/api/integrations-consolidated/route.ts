import { NextRequest } from 'next/server';

// Import all existing handlers
import { POST as arcadeAuthPOST } from './arcade/auth/route';
import { POST as arcadeTokenPOST } from './arcade/token/route';
import { GET as auditGET } from './audit/route';
import { GET as connectionsGET, POST as connectionsPOST, DELETE as connectionsDELETE } from './connections/route';
import { POST as executePOST } from './execute/route';
import { GET as figmaCallbackGET } from './figma/callback/route';
import { GET as figmaGET, POST as figmaPOST } from './figma/route';
import { GET as githubOauthAuthorizeGET } from './github/oauth/authorize/route';
import { GET as githubOauthCallbackGET } from './github/oauth/callback/route';
import { POST as githubOauthDisconnectPOST } from './github/oauth/disconnect/route';
import { GET as githubOauthStatusGET } from './github/oauth/status/route';
import { GET as githubGET } from './github/route';
import { POST as githubBranchPOST } from './github/source-control/branch/route';
import { GET as githubBranchesGET } from './github/source-control/branches/route';
import { POST as githubCommitPOST } from './github/source-control/commit/route';
import { GET as githubCommitsGET } from './github/source-control/commits/route';
import { POST as githubImportRepoPOST } from './github/source-control/import-repo/route';
import { POST as githubPrPOST } from './github/source-control/pr/route';
import { POST as githubPullPOST } from './github/source-control/pull/route';
import { POST as githubPushPOST } from './github/source-control/push/route';
import { GET as googleGET } from './google/route';
import { GET as linkedinGET } from './linkedin/route';
import { GET as twitterGET } from './twitter/route';

/**
 * Consolidated integrations route
 * Dispatches to individual handlers based on action query param
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');

  switch (action) {
    case 'audit':
      return auditGET(request);
    case 'connections':
      return connectionsGET(request);
    case 'figma':
      return figmaGET(request);
    case 'figma-callback':
      return figmaCallbackGET(request);
    case 'github':
      return githubGET(request);
    case 'github-oauth-authorize':
      return githubOauthAuthorizeGET(request);
    case 'github-oauth-callback':
      return githubOauthCallbackGET(request);
    case 'github-oauth-status':
      return githubOauthStatusGET(request);
    case 'github-branches':
      return githubBranchesGET(request);
    case 'github-commits':
      return githubCommitsGET(request);
    case 'google':
      return googleGET(request);
    case 'linkedin':
      return linkedinGET(request);
    case 'twitter':
      return twitterGET(request);
    default:
      return new Response(
        JSON.stringify({ error: 'Invalid action. Use ?action=audit|connections|figma|figma-callback|github|github-oauth-authorize|github-oauth-callback|github-oauth-status|github-branches|github-commits|google|linkedin|twitter' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
  }
}

export async function POST(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');

  switch (action) {
    case 'arcade-auth':
      return arcadeAuthPOST(request);
    case 'arcade-token':
      return arcadeTokenPOST(request);
    case 'connections':
      return connectionsPOST(request);
    case 'execute':
      return executePOST(request);
    case 'figma':
      return figmaPOST(request);
    case 'github-oauth-disconnect':
      return githubOauthDisconnectPOST(request);
    case 'github-branch':
      return githubBranchPOST(request);
    case 'github-commit':
      return githubCommitPOST(request);
    case 'github-import-repo':
      return githubImportRepoPOST(request);
    case 'github-pr':
      return githubPrPOST(request);
    case 'github-pull':
      return githubPullPOST(request);
    case 'github-push':
      return githubPushPOST(request);
    default:
      return new Response(
        JSON.stringify({ error: 'Invalid action. Use ?action=arcade-auth|arcade-token|connections|execute|figma|github-oauth-disconnect|github-branch|github-commit|github-import-repo|github-pr|github-pull|github-push' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
  }
}

export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');

  switch (action) {
    case 'connections':
      return connectionsDELETE(request);
    default:
      return new Response(
        JSON.stringify({ error: 'Invalid action. Use ?action=connections' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
  }
}