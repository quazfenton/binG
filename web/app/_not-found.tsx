'use client';

// Prevent static prerendering
export const dynamic = 'force-dynamic';

export default function NotFound() {
  return (
    <div style={{
      padding: '40px',
      textAlign: 'center',
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#0a0a0a',
      color: '#fff',
      margin: 0,
    }}>
      <h1 style={{ fontSize: '24px', marginBottom: '16px' }}>Page Not Found</h1>
      <p style={{ marginBottom: '24px', color: '#888' }}>The page you're looking for doesn't exist.</p>
      <a
        href="/"
        style={{
          padding: '12px 24px',
          background: '#3B82F6',
          color: 'white',
          border: 'none',
          borderRadius: '8px',
          cursor: 'pointer',
          fontSize: '14px',
          textDecoration: 'none'
        }}
      >
        Go back home
      </a>
    </div>
  );
}
