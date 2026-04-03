import Link from 'next/link';

// Prevent static prerendering
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default function NotFound() {
  return (
    <div style={{
      margin: 0,
      padding: 0,
      background: '#0a0a0a',
      color: '#fff',
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      textAlign: 'center'
    }}>
      <h1 style={{ fontSize: '48px', marginBottom: '16px' }}>404</h1>
      <p style={{ marginBottom: '24px', color: '#888' }}>Page not found</p>
      <Link 
        href="/"
        style={{
          padding: '12px 24px',
          background: '#3B82F6',
          color: 'white',
          textDecoration: 'none',
          borderRadius: '8px',
          fontSize: '14px'
        }}
      >
        Go Home
      </Link>
    </div>
  );
}
