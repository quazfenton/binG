// src/oauth-handler.ts

import axios from 'axios';
import open from 'open';
import http from 'http';
import url from 'url';
import readline from 'readline';
import chalk from 'chalk';

const COLORS = {
  primary: chalk.cyan, success: chalk.green, warning: chalk.yellow, error: chalk.red, info: chalk.blue,
};

// Configuration
const BING_AUTH_BASE = 'https://bing-app.com'; 
const OAUTH_CALLBACK_PORT = 3001;

const OAUTH_PROVIDERS_CONFIG: Record<string, {
  authStartUrlPath: string;
  tokenExchangeUrlPath: string;
  scopes: string[];
}> = {
  // PRODUCTION AUTH FLOW
  bing: {
    authStartUrlPath: `${BING_AUTH_BASE}/auth/cli-start`,
    tokenExchangeUrlPath: '/auth/cli-exchange', 
    scopes: ['cli-access'],
  },
  
  /* 
  // GITHUB FALLBACK (Disabled)
  github: {
    authStartUrlPath: '/oauth/authorize/start',
    tokenExchangeUrlPath: '/oauth/token/exchange',
    scopes: ['read:user', 'user:email'],
  },
  */
};

let oauthServer: http.Server | null = null;
let authCodeResolver: ((code: string) => void) | null = null;
let authCodeRejecter: ((error: Error) => void) | null = null;
let receivedAuthCode: string | null = null;

async function initiateOauthFlow(provider: string, authorizationUrl: string): Promise<string> {
  const providerConfig = OAUTH_PROVIDERS_CONFIG[provider];
  if (!providerConfig) throw new Error(`OAuth flow for provider "${provider}" is not implemented.`);

  console.log(COLORS.info(`[OAuth] Starting flow for ${provider}...`));

  const serverPromise = new Promise<void>((resolve, reject) => {
    oauthServer = http.createServer(async (req, res) => {
      const parsedUrl = url.parse(req.url!, true);
      if (parsedUrl.pathname === '/callback') {
        receivedAuthCode = parsedUrl.query.code as string;
        if (receivedAuthCode) {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end('<h1>Authentication Successful!</h1><p>Return to your terminal.</p>');
          if (authCodeResolver) authCodeResolver(receivedAuthCode);
          oauthServer!.close();
        } else {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end('<h1>Authentication Failed</h1>');
          if (authCodeRejecter) authCodeRejecter(new Error('Authorization code missing.'));
          oauthServer!.close();
        }
      }
    });

    oauthServer.listen(OAUTH_CALLBACK_PORT, () => resolve());
  });

  try {
    await open(authorizationUrl);
  } catch (err: any) {
    console.log(COLORS.info(`Please navigate to: ${authorizationUrl}`));
  }

  await serverPromise;

  return new Promise<string>((resolve, reject) => {
    authCodeResolver = resolve;
    authCodeRejecter = reject;
    setTimeout(() => {
      if (!receivedAuthCode) {
        reject(new Error('OAuth callback timed out.'));
        oauthServer?.close();
      }
    }, 300000);
  });
}

export async function performOauthLogin(provider: string): Promise<any> {
  const providerConfig = OAUTH_PROVIDERS_CONFIG[provider];
  if (!providerConfig) throw new Error(`Provider ${provider} not supported.`);

  // Note: These helpers are now expected to be imported or available globally
  const authUrlResponse = await (global as any).apiRequest(providerConfig.authStartUrlPath, {
    method: 'POST',
    data: { provider, scopes: providerConfig.scopes },
  });

  const authCode = await initiateOauthFlow(provider, authUrlResponse.url);

  const tokenExchangeResponse = await (global as any).apiRequest(providerConfig.tokenExchangeUrlPath, {
    method: 'POST',
    data: { provider, code: authCode },
  });

  return tokenExchangeResponse;
}
