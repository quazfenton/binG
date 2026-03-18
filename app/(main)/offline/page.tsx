'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

export default function OfflinePage() {
  const router = useRouter();
  const [isOnline, setIsOnline] = useState(false);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    setIsOnline(navigator.onLine);

    // Redirect if back online
    if (isOnline) {
      router.push('/');
    }

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [isOnline, router]);

  return (
    <div className="min-h-screen bg-black flex items-center justify-center p-4">
      <div className="text-center space-y-6 max-w-md">
        <div className="space-y-2">
          <svg
            className="w-16 h-16 mx-auto text-muted-foreground"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M18.364 5.636a9 9 0 010 12.728m0 0l-2.828-2.828m2.828 2.828L21 21M15.536 8.464a5 5 0 010 7.072m0 0l-2.828-2.828m-4.244 2.828a49.61 49.61 0 01-6.186-6.186m4.244 6.186l2.828-2.828m0 0a49.61 49.61 0 016.186-6.186m-6.186 6.186l-2.828-2.828M12 8v4m0 4h.01"
            />
          </svg>
          <h1 className="text-2xl font-bold text-white">You&apos;re Offline</h1>
          <p className="text-muted-foreground">
            It looks like you&apos;ve lost your internet connection. Some features may not be
            available until you&apos;re back online.
          </p>
        </div>

        <div className="space-y-4">
          <div className="p-4 bg-white/5 rounded-lg border border-white/10">
            <h2 className="text-sm font-medium text-white/80 mb-2">What you can still do:</h2>
            <ul className="text-sm text-muted-foreground space-y-1 text-left">
              <li>• View previously loaded content</li>
              <li>• Access cached pages</li>
              <li>• Use offline-compatible features</li>
            </ul>
          </div>

          <button
            onClick={() => window.location.reload()}
            className="w-full px-4 py-2 bg-white text-black rounded-md font-medium hover:bg-white/90 transition-colors"
          >
            Try Again
          </button>

          <button
            onClick={() => router.push('/')}
            className="w-full px-4 py-2 bg-white/10 text-white rounded-md font-medium hover:bg-white/20 transition-colors"
          >
            Go Home
          </button>
        </div>

        <p className="text-xs text-muted-foreground">
          Checking connection status...
        </p>
      </div>
    </div>
  );
}
