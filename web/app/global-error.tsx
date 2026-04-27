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
        <div style={{ padding: 24, fontFamily: 'system-ui, sans-serif' }}>
          <h1 style={{ fontSize: 18, marginBottom: 8 }}>Something went wrong</h1>
          {error?.digest ? (
            <p style={{ fontSize: 12, color: '#666' }}>Reference: {error.digest}</p>
          ) : null}
        </div>
      </body>
    </html>
  );
}
