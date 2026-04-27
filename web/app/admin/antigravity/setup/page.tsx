/**
 * Admin Antigravity Setup Page
 *
 * GET /admin/antigravity/setup
 * Requires authentication + admin check.
 * Displays the master account refresh token securely after OAuth,
 * or shows connection instructions if no token is pending.
 */

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { requireAdminPage } from '@/lib/auth/admin';
import { CopyButton } from './CopyButton';

export default async function AntigravitySetupPage() {
  const cookieStore = await cookies();
  
  // Check auth directly - if no auth token, show unauthorized page
  const authToken = cookieStore.get('auth-token')?.value
    || cookieStore.get('token')?.value
    || cookieStore.get('next-auth.session-token')?.value
    || cookieStore.get('session_id')?.value;

  if (!authToken) {
    return (
      <div className="max-w-2xl mx-auto p-8">
        <h1 className="text-2xl font-bold mb-4">Unauthorized</h1>
        <p className="text-gray-600 mb-4">You must be logged in as an admin to access this page.</p>
        <a href="/login" className="inline-block px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors">
          Login →
        </a>
      </div>
    );
  }

  // Require admin access
  let admin: Awaited<ReturnType<typeof requireAdminPage>> | null = null;
  try {
    admin = await requireAdminPage();
    const isAdmin = !!admin;

    if (!isAdmin) {
      return (
        <div className="max-w-2xl mx-auto p-8">
          <h1 className="text-2xl font-bold mb-4">Access Denied</h1>
          <p className="text-red-600">You do not have admin privileges.</p>
        </div>
      );
    }
  } catch (err: any) {
    // If redirect is thrown, re-throw it
    if (err?.digest?.includes('NEXT_REDIRECT')) throw err;
    return (
      <div className="max-w-2xl mx-auto p-8">
        <h1 className="text-2xl font-bold mb-4">Access Denied</h1>
        <p className="text-red-600">An error occurred: {err?.message || 'Unknown error'}</p>
      </div>
    );
  }

  const tokensCookie = cookieStore.get('antigravity-admin-tokens');

  let tokens: { email: string; refreshToken: string; projectId: string } | null = null;

  if (tokensCookie?.value) {
    try {
      tokens = JSON.parse(tokensCookie.value);
    } catch {
      // Invalid cookie, ignore
    }
  }

  return (
    <div className="max-w-2xl mx-auto p-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Antigravity Master Account Setup</h1>
        <span className="text-xs bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded text-gray-500">
          Admin · {admin.email}
        </span>
      </div>

      {tokens ? (
        // Token received — display for copying
        <div className="space-y-6">
          <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4">
            <p className="text-green-800 dark:text-green-200 font-medium">
              ✅ OAuth successful!
            </p>
            <p className="text-green-600 dark:text-green-400 text-sm mt-1">
              Connected as: <strong>{tokens.email}</strong>
            </p>
            <p className="text-green-600 dark:text-green-400 text-sm">
              Project ID: <strong>{tokens.projectId}</strong>
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
        // No token pending — show instructions
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
