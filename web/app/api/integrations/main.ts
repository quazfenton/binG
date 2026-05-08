import { NextRequest, NextResponse } from 'next/server';

import { GET as arcadeAuthGET, POST as arcadeAuthPOST } from './arcade/auth/gateway';
import { POST as arcadeTokenPOST } from './arcade/token/gateway';
import { GET as auditGET } from './audit/gateway';
import { GET as connectionsGET } from './connections/gateway';
import { GET as executeGET, POST as executePOST } from './execute/gateway';
import { GET as figmaCallbackGET } from './figma/callback/gateway';
import { GET as figmaGET, POST as figmaPOST } from './figma/gateway';
import { GET as githubOauthAuthorizeGET } from './github/oauth/authorize/gateway';
import { GET as githubOauthCallbackGET } from './github/oauth/callback/gateway';
import { POST as githubOauthDisconnectPOST } from './github/oauth/disconnect/gateway';
import { GET as githubOauthStatusGET } from './github/oauth/status/gateway';
import { GET as githubGET, POST as githubPOST } from './github/gateway';
import { POST as githubBranchPOST } from './github/source-control/branch/gateway';
import { GET as githubBranchesGET } from './github/source-control/branches/gateway';
import { POST as githubCommitPOST } from './github/source-control/commit/gateway';
import { GET as githubCommitsGET } from './github/source-control/commits/gateway';
import { POST as githubImportRepoPOST } from './github/source-control/import-repo/gateway';
import { POST as githubPrPOST } from './github/source-control/pr/gateway';
import { POST as githubPullPOST } from './github/source-control/pull/gateway';
import { POST as githubPushPOST } from './github/source-control/push/gateway';
import { GET as googleGET } from './google/gateway';
import { GET as linkedinGET, POST as linkedinPOST } from './linkedin/gateway';
import { GET as twitterGET, POST as twitterPOST } from './twitter/gateway';

export async function GET(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const segments = path.split('/').filter(Boolean);

  if (segments.length !== 3) {
    return NextResponse.json(
      { error: 'Not found. Use /integrations/arcade-auth|...' },
      { status: 404 }
    );
  }

  switch (segments[2]) {
    case 'arcade-auth':
      return arcadeAuthGET(request);
    case 'audit':
      return auditGET(request);
    case 'connections':
      return connectionsGET(request);
    case 'execute':
      return executeGET(request);
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
      return NextResponse.json(
        { error: 'Not found. Use /integrations/arcade-auth|...' },
        { status: 404 }
      );
  }
}

export async function POST(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const segments = path.split('/').filter(Boolean);

  if (segments.length !== 3) {
    return NextResponse.json(
      { error: 'Not found. Use /integrations/arcade-auth|...' },
      { status: 404 }
    );
  }

  switch (segments[2]) {
    case 'arcade-auth':
      return arcadeAuthPOST(request);
    case 'arcade-token':
      return arcadeTokenPOST(request);
    case 'execute':
      return executePOST(request);
    case 'figma':
      return figmaPOST(request);
    case 'github':
      return githubPOST(request);
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
    case 'linkedin':
      return linkedinPOST(request);
    case 'twitter':
      return twitterPOST(request);
    default:
      return NextResponse.json(
        { error: 'Not found. Use /integrations/arcade-auth|...' },
        { status: 404 }
      );
  }
}