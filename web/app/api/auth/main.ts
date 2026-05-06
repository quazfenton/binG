import { NextRequest } from 'next/server';

// Import all existing handlers
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

/**
 * Consolidated auth route
 * Dispatches to individual handlers based on action query param
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');

  switch (action) {
    case 'arcade-authorize':
      return arcadeAuthorizeGET(request);
    case 'arcade-verifier':
      return arcadeVerifierGET(request);
    case 'confirm-reset':
      return confirmResetGET(request);
    case 'me':
      return meGET();
    case 'nango-authorize':
      return nangoAuthorizeGET(request);
    case 'oauth-callback':
      return oauthCallbackGET(request);
    case 'oauth-error':
      return oauthErrorGET(request);
    case 'oauth-initiate':
      return oauthInitiateGET(request);
    case 'oauth-success':
      return oauthSuccessGET(request);
    case 'session':
      return sessionGET(request);
    case 'validate':
      return validateGET(request);
    case 'verify-email':
      return verifyEmailGET(request);
    default:
      return new Response(
        JSON.stringify({ error: 'Invalid action. Use ?action=arcade-authorize|arcade-verifier|confirm-reset|me|nango-authorize|oauth-callback|oauth-error|oauth-initiate|oauth-success|session|validate|verify-email' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
  }
}

export async function POST(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');

  switch (action) {
    case 'check-auth0':
      return checkAuth0POST(request);
    case 'check-email':
      return checkEmailPOST(request);
    case 'confirm-reset':
      return confirmResetPOST(request);
    case 'login':
      return loginPOST(request);
    case 'logout':
      return logoutPOST(request);
    case 'mfa-challenge':
      return mfaChallengePOST(request);
    case 'mfa-disable':
      return mfaDisablePOST(request);
    case 'mfa-setup':
      return mfaSetupPOST(request);
    case 'mfa-verify':
      return mfaVerifyPOST(request);
    case 'refresh':
      return refreshPOST(request);
    case 'reset-password':
      return resetPasswordPOST(request);
    case 'send-verification':
      return sendVerificationPOST(request);
    case 'validate':
      return validatePOST(request);
    default:
      return new Response(
        JSON.stringify({ error: 'Invalid action. Use ?action=check-auth0|check-email|confirm-reset|login|logout|mfa-challenge|mfa-disable|mfa-setup|mfa-verify|refresh|reset-password|send-verification|validate' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
  }
}