'use client';

// Minimal global-error boundary. We deliberately avoid using any React
// context, hooks, or providers here so this page can be prerendered cleanly
// during the desktop standalone build (where Next.js auto-generates one
// otherwise and crashes with `Cannot read properties of null (reading 'useContext')`).
export default function GlobalError({
  error,
}: {
  error: (Error & { digest?: string }) | null;
}) {
  return (
    <html lang="en">
      <body>
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, background: '#09090b', color: '#fafafa', fontFamily: 'system-ui, sans-serif' }}>
          <div style={{ maxWidth: 720, width: '100%', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, padding: 24, background: 'rgba(24,24,27,0.9)' }}>
            <h1 style={{ fontSize: 18, margin: '0 0 12px 0' }}>Something went wrong</h1>
            <p style={{ margin: 0, color: '#a1a1aa', lineHeight: 1.5 }}>
              {error?.message || 'The desktop app could not finish loading.'}
            </p>
            {error?.digest ? (
              <p style={{ fontSize: 12, color: '#71717a', margin: '12px 0 0 0' }}>Reference: {error.digest}</p>
            ) : null}
          </div>
        </div>
      </body>
    </html>
  );
}
