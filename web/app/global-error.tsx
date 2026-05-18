'use client';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body>
        <div
          style={{
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
            background: '#09090b',
            color: '#fafafa',
            fontFamily: 'system-ui, sans-serif',
          }}
        >
          <div
            style={{
              maxWidth: 720,
              width: '100%',
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: 8,
              padding: 24,
              background: 'rgba(24,24,27,0.9)',
            }}
          >
            <h1 style={{ fontSize: 18, margin: '0 0 12px 0' }}>
              Something went wrong
            </h1>
            <p style={{ margin: 0, color: '#a1a1aa', lineHeight: 1.5 }}>
              {error?.message || 'The application encountered an unexpected error.'}
            </p>
            {error?.digest && (
              <p style={{ fontSize: 12, color: '#71717a', margin: '12px 0 0 0' }}>
                Reference: {error.digest}
              </p>
            )}
            <button
              onClick={() => reset()}
              style={{
                marginTop: 16,
                padding: '8px 16px',
                background: '#2563eb',
                color: '#fff',
                border: 'none',
                borderRadius: 6,
                cursor: 'pointer',
                fontSize: 14,
              }}
            >
              Try again
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
