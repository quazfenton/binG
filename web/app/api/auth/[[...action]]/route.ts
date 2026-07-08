import { NextRequest, NextResponse } from 'next/server';

// Individual action gateways
import { GET as arcadeAuthorizeGET } from '../arcade/authorize/gateway';
import { GET as arcadeVerifierGET } from '../arcade/custom-verifier/gateway';
import { POST as checkAuth0SessionPOST } from '../check-auth0-session/gateway';
import { POST as checkEmailPOST } from '../check-email/gateway';
import { GET as confirmResetGET, POST as confirmResetPOST } from '../confirm-reset/gateway';
import { POST as loginPOST } from '../login/gateway';
import { POST as logoutPOST } from '../logout/gateway';
import { GET as meGET } from '../me/gateway';
import { POST as mfaChallengePOST } from '../mfa/challenge/gateway';
import { POST as mfaDisablePOST } from '../mfa/disable/gateway';
import { POST as mfaSetupPOST } from '../mfa/setup/gateway';
import { POST as mfaVerifyPOST } from '../mfa/verify/gateway';
import { GET as nangoAuthorizeGET } from '../nango/authorize/gateway';
import { GET as oauthCallbackGET } from '../oauth/callback/gateway';
import { GET as oauthErrorGET } from '../oauth/error/gateway';
import { GET as oauthInitiateGET } from '../oauth/initiate/gateway';
import { GET as oauthSuccessGET } from '../oauth/success/gateway';
import { POST as refreshPOST } from '../refresh/gateway';
import { POST as registerPOST } from '../register/gateway';
import { POST as resetPasswordPOST } from '../reset-password/gateway';
import { POST as sendVerificationPOST } from '../send-verification/gateway';
import { GET as sessionGET } from '../session/gateway';
import { POST as transferVFSOnLoginPOST } from '../transfer-vfs-on-login/gateway';
import { GET as validateGET, POST as validatePOST } from '../validate/gateway';
import { GET as verifyEmailGET } from '../verify-email/gateway';

/**
 * Consolidated Auth Route Handler
 * Dispatches to specific action gateways based on the path segments
 */

function getAction(request: NextRequest): string {
  const path = request.nextUrl.pathname;
  const segments = path.split('/').filter(Boolean);
  
  // Segment analysis for /api/auth/...
  // /api/auth/login -> segments[2] = 'login'
  // /api/auth/arcade/authorize -> action = 'arcade-authorize'
  
  if (segments.length === 3) {
    return segments[2];
  }
  
  if (segments.length === 4) {
    return `${segments[2]}-${segments[3]}`;
  }
  
  return '';
}

export async function GET(request: NextRequest) {
  const action = getAction(request);

  try {
    switch (action) {
      case 'me': return await meGET(request);
      case 'session': return await sessionGET(request);
      case 'verify-email': return await verifyEmailGET(request);
      case 'confirm-reset': return await confirmResetGET(request);
      case 'validate': return await validateGET(request);
      case 'arcade-authorize': return await arcadeAuthorizeGET(request);
      case 'arcade-custom-verifier': return await arcadeVerifierGET(request);
      case 'nango-authorize': return await nangoAuthorizeGET(request);
      case 'oauth-callback': return await oauthCallbackGET(request);
      case 'oauth-error': return await oauthErrorGET(request);
      case 'oauth-initiate': return await oauthInitiateGET(request);
      case 'oauth-success': return await oauthSuccessGET(request);
      default:
        return NextResponse.json({ error: `Action ${action} not found or method not allowed` }, { status: 404 });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: `Auth dispatch failed: ${message}` },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const action = getAction(request);

  try {
    switch (action) {
      case 'login': return await loginPOST(request);
      case 'logout': return await logoutPOST(request);
      case 'register': return await registerPOST(request);
      case 'refresh': return await refreshPOST(request);
      case 'check-email': return await checkEmailPOST(request);
      case 'check-auth0-session': return await checkAuth0SessionPOST(request);
      case 'confirm-reset': return await confirmResetPOST(request);
      case 'reset-password': return await resetPasswordPOST(request);
      case 'send-verification': return await sendVerificationPOST(request);
      case 'transfer-vfs-on-login': return await transferVFSOnLoginPOST(request);
      case 'validate': return await validatePOST(request);
      case 'mfa-challenge': return await mfaChallengePOST(request);
      case 'mfa-disable': return await mfaDisablePOST(request);
      case 'mfa-setup': return await mfaSetupPOST(request);
      case 'mfa-verify': return await mfaVerifyPOST(request);
      default:
        return NextResponse.json({ error: `Action ${action} not found or method not allowed` }, { status: 404 });
    }
  } catch (error) {
    // Safety net: never let an upstream error bubble out as an HTML 500.
    // Surface it as JSON so the client `safeParseResponse` helper can show
    // a useful error message.
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: `Auth dispatch failed: ${message}` },
      { status: 500 }
    );
  }
}

export const dynamic = 'force-dynamic';
