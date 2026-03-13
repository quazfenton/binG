"use client";

// Global error boundary - must be a Client Component in Next.js 16
// Note: This page is intentionally kept minimal to avoid build-time errors

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div style={{ padding: '2rem', textAlign: 'center' }}>
      <h1>Error</h1>
      <p>An error occurred. Please refresh the page.</p>
      <button onClick={() => reset()} style={{ marginTop: '1rem', padding: '0.5rem 1rem' }}>
        Try again
      </button>
    </div>
  );
}
