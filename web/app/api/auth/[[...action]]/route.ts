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
  
  switch (action) {
    case 'me': return meGET(request);
    case 'session': return sessionGET(request);
    case 'verify-email': return verifyEmailGET(request);
    case 'confirm-reset': return confirmResetGET(request);
    case 'validate': return validateGET(request);
    case 'arcade-authorize': return arcadeAuthorizeGET(request);
    case 'arcade-custom-verifier': return arcadeVerifierGET(request);
    case 'nango-authorize': return nangoAuthorizeGET(request);
    case 'oauth-callback': return oauthCallbackGET(request);
    case 'oauth-error': return oauthErrorGET(request);
    case 'oauth-initiate': return oauthInitiateGET(request);
    case 'oauth-success': return oauthSuccessGET(request);
    default:
      return NextResponse.json({ error: `Action ${action} not found or method not allowed` }, { status: 404 });
  }
}

export async function POST(request: NextRequest) {
  const action = getAction(request);
  
  switch (action) {
    case 'login': return loginPOST(request);
    case 'logout': return logoutPOST(request);
    case 'register': return registerPOST(request);
    case 'refresh': return refreshPOST(request);
    case 'check-email': return checkEmailPOST(request);
    case 'check-auth0-session': return checkAuth0SessionPOST(request);
    case 'confirm-reset': return confirmResetPOST(request);
    case 'reset-password': return resetPasswordPOST(request);
    case 'send-verification': return sendVerificationPOST(request);
    case 'validate': return validatePOST(request);
    case 'mfa-challenge': return mfaChallengePOST(request);
    case 'mfa-disable': return mfaDisablePOST(request);
    case 'mfa-setup': return mfaSetupPOST(request);
    case 'mfa-verify': return mfaVerifyPOST(request);
    default:
      return NextResponse.json({ error: `Action ${action} not found or method not allowed` }, { status: 404 });
  }
}

export const dynamic = 'force-dynamic';
