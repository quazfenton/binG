'use client'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body style={{ 
        background: '#0a0a0a', 
        color: '#fff', 
        margin: 0, 
        padding: '40px', 
        textAlign: 'center',
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'sans-serif'
      }}>
        <h2 style={{ fontSize: '24px', marginBottom: '16px' }}>Something went wrong!</h2>
        <p style={{ marginBottom: '24px', color: '#888' }}>
          {error?.message || 'An unexpected error occurred.'}
        </p>
        <button
          onClick={() => reset()}
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
      </body>
    </html>
  )
}
