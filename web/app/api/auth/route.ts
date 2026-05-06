import { NextRequest, NextResponse } from 'next/server';

import { GET as arcadeAuthorizeGET } from './arcade/authorize/gateway';
import { GET as arcadeVerifierGET } from './arcade/custom-verifier/gateway';
import { POST as checkAuth0POST } from './check-auth0-session/gateway';
import { POST as checkEmailPOST } from './check-email/gateway';
import { GET as confirmResetGET, POST as confirmResetPOST } from './confirm-reset/gateway';
import { POST as loginPOST } from './login/gateway';
import { POST as logoutPOST } from './logout/gateway';
import { GET as meGET } from './me/gateway';
import { POST as mfaChallengePOST } from './mfa/challenge/gateway';
import { POST as mfaDisablePOST } from './mfa/disable/gateway';
import { POST as mfaSetupPOST } from './mfa/setup/gateway';
import { POST as mfaVerifyPOST } from './mfa/verify/gateway';
import { GET as nangoAuthorizeGET } from './nango/authorize/gateway';
import { GET as oauthCallbackGET } from './oauth/callback/gateway';
import { GET as oauthErrorGET } from './oauth/error/gateway';
import { GET as oauthInitiateGET } from './oauth/initiate/gateway';
import { GET as oauthSuccessGET } from './oauth/success/gateway';
import { POST as refreshPOST } from './refresh/gateway';
import { POST as resetPasswordPOST } from './reset-password/gateway';
import { POST as sendVerificationPOST } from './send-verification/gateway';
import { GET as sessionGET } from './session/gateway';
import { GET as validateGET, POST as validatePOST } from './validate/gateway';
import { GET as verifyEmailGET } from './verify-email/gateway';

// GET /api/auth/[section]
export async function GET(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const segments = path.split('/').filter(Boolean);

  if (segments.length !== 3) {
    return NextResponse.json(
      { error: 'Not found. Use /auth/arcade-authorize|/auth/arcade-verifier|/auth/confirm-reset|/auth/me|/auth/nango-authorize|/auth/oauth-callback|/auth/oauth-error|/auth/oauth-initiate|/auth/oauth-success|/auth/session|/auth/validate|/auth/verify-email' },
      { status: 404 }
    );
  }

  switch (segments[2]) {
    case 'arcade-authorize': return arcadeAuthorizeGET(request);
    case 'arcade-verifier': return arcadeVerifierGET(request);
    case 'confirm-reset': return confirmResetGET(request);
    case 'me': return meGET();
    case 'nango-authorize': return nangoAuthorizeGET(request);
    case 'oauth-callback': return oauthCallbackGET(request);
    case 'oauth-error': return oauthErrorGET(request);
    case 'oauth-initiate': return oauthInitiateGET(request);
    case 'oauth-success': return oauthSuccessGET(request);
    case 'session': return sessionGET(request);
    case 'validate': return validateGET(request);
    case 'verify-email': return verifyEmailGET(request);
    default:
      return NextResponse.json(
        { error: 'Not found. Use /auth/arcade-authorize|/auth/arcade-verifier|/auth/confirm-reset|/auth/me|/auth/nango-authorize|/auth/oauth-callback|/auth/oauth-error|/auth/oauth-initiate|/auth/oauth-success|/auth/session|/auth/validate|/auth/verify-email' },
        { status: 404 }
      );
  }
}

// POST /api/auth/[section]
export async function POST(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const segments = path.split('/').filter(Boolean);

  if (segments.length !== 3) {
    return NextResponse.json(
      { error: 'Not found. Use /auth/check-auth0|/auth/check-email|/auth/confirm-reset|/auth/login|/auth/logout|/auth/mfa-challenge|/auth/mfa-disable|/auth/mfa-setup|/auth/mfa-verify|/auth/refresh|/auth/reset-password|/auth/send-verification|/auth/validate' },
      { status: 404 }
    );
  }

  switch (segments[2]) {
    case 'check-auth0': return checkAuth0POST(request);
    case 'check-email': return checkEmailPOST(request);
    case 'confirm-reset': return confirmResetPOST(request);
    case 'login': return loginPOST(request);
    case 'logout': return logoutPOST(request);
    case 'mfa-challenge': return mfaChallengePOST(request);
    case 'mfa-disable': return mfaDisablePOST(request);
    case 'mfa-setup': return mfaSetupPOST(request);
    case 'mfa-verify': return mfaVerifyPOST(request);
    case 'refresh': return refreshPOST(request);
    case 'reset-password': return resetPasswordPOST(request);
    case 'send-verification': return sendVerificationPOST(request);
    case 'validate': return validatePOST(request);
    default:
      return NextResponse.json(
        { error: 'Not found. Use /auth/check-auth0|/auth/check-email|/auth/confirm-reset|/auth/login|/auth/logout|/auth/mfa-challenge|/auth/mfa-disable|/auth/mfa-setup|/auth/mfa-verify|/auth/refresh|/auth/reset-password|/auth/send-verification|/auth/validate' },
        { status: 404 }
      );
  }
}