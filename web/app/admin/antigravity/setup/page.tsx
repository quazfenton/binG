'use client';

/**
 * Admin Antigravity Setup Page
 *
 * GET /admin/antigravity/setup
 *
 * Static-export compatible: runs entirely client-side. Auth + admin check
 * happen via /api/antigravity/admin/status (the browser forwards cookies
 * automatically), which also surfaces the HttpOnly antigravity-admin-tokens
 * cookie content so we can display the refresh token after OAuth.
 *
 * The previous server component used `cookies()` from `next/headers`, which
 * is incompatible with `output: 'export'`.
 */

import { useEffect, useState } from 'react';
import { CopyButton } from './CopyButton';

type Tokens = { email: string; refreshToken: string; projectId: string };

type StatusResponse = {
  pendingTokens: Tokens | null;
  masterAccount: { configured: boolean; email?: string; projectId?: string };
};

type LoadState =
  | { kind: 'loading' }
  | { kind: 'unauthorized' }
  | { kind: 'forbidden'; message?: string }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; data: StatusResponse };

export default function AntigravitySetupPage() {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/antigravity/admin/status', {
          credentials: 'include',
          cache: 'no-store',
        });

        if (cancelled) return;

        if (res.status === 401) {
          setState({ kind: 'unauthorized' });
          return;
        }
        if (res.status === 403) {
          let msg: string | undefined;
          try { msg = (await res.json())?.error; } catch { /* ignore */ }
          setState({ kind: 'forbidden', message: msg });
          return;
        }
        if (!res.ok) {
          setState({ kind: 'error', message: `Status ${res.status}` });
          return;
        }

        const data = (await res.json()) as StatusResponse;
        setState({ kind: 'ready', data });
      } catch (err: any) {
        if (!cancelled) {
          setState({ kind: 'error', message: err?.message || 'Network error' });
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (state.kind === 'loading') {
    return (
      <div className="max-w-2xl mx-auto p-8">
        <p className="text-gray-500">Loading…</p>
      </div>
    );
  }

  if (state.kind === 'unauthorized') {
    return (
      <div className="max-w-2xl mx-auto p-8">
        <h1 className="text-2xl font-bold mb-4">Unauthorized</h1>
        <p className="text-gray-600 mb-4">You must be logged in as an admin to access this page.</p>
        <a
          href="/login"
          className="inline-block px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors"
        >
          Login →
        </a>
      </div>
    );
  }

  if (state.kind === 'forbidden') {
    return (
      <div className="max-w-2xl mx-auto p-8">
        <h1 className="text-2xl font-bold mb-4">Access Denied</h1>
        <p className="text-red-600">{state.message ?? 'You do not have admin privileges.'}</p>
      </div>
    );
  }

  if (state.kind === 'error') {
    return (
      <div className="max-w-2xl mx-auto p-8">
        <h1 className="text-2xl font-bold mb-4">Error</h1>
        <p className="text-red-600">{state.message}</p>
      </div>
    );
  }

  const tokens = state.data.pendingTokens;

  return (
    <div className="max-w-2xl mx-auto p-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Antigravity Master Account Setup</h1>
        <span className="text-xs bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded text-gray-500">
          Admin
        </span>
      </div>

      {tokens ? (
        <div className="space-y-6">
          <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4">
            <p className="text-green-800 dark:text-green-200 font-medium">
              ✅ OAuth successful!
            </p>
            <p className="text-green-600 dark:text-green-400 text-sm mt-1">
              Connected as: <strong>{tokens.email}</strong>
            </p>
            <p className="text-green-600 dark:text-green-400 text-sm">
              Workspace ID: <strong>{tokens.projectId}</strong>
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-2">Step 1: Copy this refresh token</h2>
            <div className="relative">
              <pre className="bg-gray-900 text-green-400 p-4 rounded-lg text-sm overflow-x-auto break-all font-mono">
                {tokens.refreshToken}
              </pre>
              <CopyButton text={tokens.refreshToken} />
            </div>
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-2">Step 2: Add to your .env file</h2>
            <pre className="bg-gray-100 dark:bg-gray-800 p-4 rounded-lg text-sm overflow-x-auto">
{`ANTIGRAVITY_REFRESH_TOKEN=${tokens.refreshToken}
ANTIGRAVITY_MASTER_EMAIL=${tokens.email}
ANTIGRAVITY_DEFAULT_PROJECT_ID=${tokens.projectId}`}
            </pre>
          </div>

          <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
            <p className="text-yellow-800 dark:text-yellow-200 text-sm">
              ⚠️ <strong>Security note:</strong> This token will disappear after you leave this page.
              Copy it now and restart your server after updating .env.
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-6">
            <h2 className="text-lg font-semibold mb-3">Connect a Master Account</h2>
            <p className="text-gray-600 dark:text-gray-400 mb-4">
              A master account provides a shared Antigravity quota that all users on this server can fall back to
              when their personal accounts are rate limited.
            </p>
            <ol className="list-decimal list-inside space-y-2 text-gray-600 dark:text-gray-400">
              <li>Click the button below to start Google OAuth</li>
              <li>Sign in with the Google account you want to use as the shared account</li>
              <li>Copy the refresh token from the next page</li>
              <li>Add it to your server's <code className="bg-gray-200 dark:bg-gray-700 px-1 rounded">.env</code> file</li>
              <li>Restart your server</li>
            </ol>
          </div>

          <a
            href="/api/antigravity/admin/connect"
            className="inline-block px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors"
          >
            Connect Google Account →
          </a>

          <div className="border-t pt-6">
            <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 mb-2 uppercase tracking-wide">
              Manual Setup (Alternative)
            </h3>
            <p className="text-gray-600 dark:text-gray-400 text-sm">
              If you already have a refresh token from another source, you can set it directly:
            </p>
            <pre className="bg-gray-100 dark:bg-gray-800 p-3 rounded-lg text-sm mt-2">
{`ANTIGRAVITY_REFRESH_TOKEN=your_refresh_token_here
ANTIGRAVITY_MASTER_EMAIL=admin@yourdomain.com`}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
