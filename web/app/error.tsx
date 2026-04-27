'use client';

export default function Error({
  error,
}: {
  error: Error & { digest?: string } | null;
}) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#09090b', color: '#fafafa', padding: 24 }}>
      <div style={{ maxWidth: 720, width: '100%', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, padding: 24, background: 'rgba(24,24,27,0.9)' }}>
        <h1 style={{ fontSize: 18, margin: '0 0 12px 0' }}>Application error</h1>
        <p style={{ margin: 0, color: '#a1a1aa', lineHeight: 1.5 }}>
          {error?.message || 'The desktop UI failed to render.'}
        </p>
        {error?.digest ? (
          <p style={{ margin: '12px 0 0 0', fontSize: 12, color: '#71717a' }}>Reference: {error.digest}</p>
        ) : null}
      </div>
    </div>
  );
}
