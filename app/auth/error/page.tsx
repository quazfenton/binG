function ErrorCard({ error, error_description }: { error?: string; error_description?: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-black/50 p-4">
      <div className="max-w-md w-full bg-red-950/50 border border-red-800 rounded-xl p-6 text-center">
        <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-red-900/50 flex items-center justify-center">
          <svg className="w-6 h-6 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <h1 className="text-xl font-semibold text-red-300 mb-2">Authentication Error</h1>
        {error && (
          <p className="text-red-400/80 text-sm font-mono mb-2">
            {error}
          </p>
        )}
        {error_description ? (
          <p className="text-white/70 text-sm mb-4">{error_description}</p>
        ) : (
          <p className="text-white/70 text-sm mb-4">
            An error occurred during the authentication flow.
          </p>
        )}
        <a
          href="/auth/login"
          className="inline-block px-4 py-2 bg-red-800 hover:bg-red-700 text-white text-sm font-medium rounded-lg transition-colors"
        >
          Try Again
        </a>
      </div>
    </div>
  );
}

export default async function AuthErrorPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; error_description?: string }>;
}) {
  let params: { error?: string; error_description?: string };
  try {
    params = await searchParams;
  } catch {
    params = { error: 'Unknown error', error_description: 'Failed to load error details.' };
  }
  return (
    <ErrorCard error={params?.error} error_description={params?.error_description} />
  );
}

// Force dynamic rendering - this page depends on URL search params
export const dynamic = 'force-dynamic';
