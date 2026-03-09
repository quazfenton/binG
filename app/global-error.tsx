"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // Don't expose raw error messages in production
  // Show generic message to avoid leaking internal details
  const isDevelopment = process.env.NODE_ENV === 'development';
  
  return (
    <html lang="en">
      <body style={{ margin: 0, padding: 0, background: '#0a0a0a', color: '#fff' }}>
        <div style={{
          padding: '40px',
          textAlign: 'center',
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center'
        }}>
          <h1 style={{ fontSize: '24px', marginBottom: '16px' }}>Something went wrong</h1>
          <p style={{ marginBottom: '24px', color: '#888' }}>
            {isDevelopment ? error.message : 'An unexpected error occurred. Please try again.'}
          </p>
          {isDevelopment && error.digest && (
            <p style={{ marginBottom: '24px', color: '#666', fontSize: '12px' }}>
              Error ID: {error.digest}
            </p>
          )}
          <button
            onClick={() => typeof reset === 'function' && reset()}
            style={{
              padding: '12px 24px',
              background: '#3B82F6',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer',
              fontSize: '14px'
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
