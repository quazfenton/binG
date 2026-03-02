'use client';

import { useEffect, useState } from 'react';
import { useServiceWorker } from '@/hooks/use-service-worker';
import { X } from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function PWAInstallPrompt() {
  const { updateAvailable, updateServiceWorker } = useServiceWorker();
  const [showPrompt, setShowPrompt] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);

  useEffect(() => {
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      
      // Check if user dismissed recently before showing
      const dismissed = localStorage.getItem('pwa-install-dismissed');
      if (dismissed) {
        const dismissedTime = parseInt(dismissed, 10);
        const thirtyDays = 30 * 24 * 60 * 60 * 1000;
        if (Date.now() - dismissedTime < thirtyDays) {
          return; // Don't show if dismissed within 30 days
        }
      }
      
      setDeferredPrompt(e);
      // Show install prompt after 3 seconds
      setTimeout(() => setShowPrompt(true), 3000);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    };
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;

    try {
      await deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      
      if (outcome === 'accepted') {
        console.log('User accepted the install prompt');
      }
      
      setDeferredPrompt(null);
      setShowPrompt(false);
    } catch (error) {
      console.error('Install prompt error:', error);
    }
  };

  const handleDismiss = () => {
    setShowPrompt(false);
    localStorage.setItem('pwa-install-dismissed', Date.now().toString());
  };

  // Check if user dismissed recently
  useEffect(() => {
    const dismissed = localStorage.getItem('pwa-install-dismissed');
    if (dismissed) {
      const dismissedTime = parseInt(dismissed, 10);
      const thirtyDays = 30 * 24 * 60 * 60 * 1000;
      if (Date.now() - dismissedTime < thirtyDays) {
        setShowPrompt(false);
      }
    }
  }, []);

  // Only show component if showPrompt is true (respects dismiss for both install and update)
  if (!showPrompt) return null;

  return (
    <div className="fixed bottom-4 left-4 right-4 md:left-auto md:right-4 md:w-96 z-50">
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg shadow-lg p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1">
            {updateAvailable ? (
              <>
                <h3 className="font-semibold text-zinc-900 dark:text-white">
                  Update Available
                </h3>
                <p className="text-sm text-zinc-600 dark:text-zinc-400">
                  A new version is ready. Reload to get the latest features.
                </p>
              </>
            ) : (
              <>
                <h3 className="font-semibold text-zinc-900 dark:text-white">
                  Install binG0
                </h3>
                <p className="text-sm text-zinc-600 dark:text-zinc-400">
                  Install our app for quick access and offline support.
                </p>
              </>
            )}
          </div>
          <button
            onClick={handleDismiss}
            className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex gap-2">
          {updateAvailable ? (
            <button
              onClick={updateServiceWorker}
              className="flex-1 px-3 py-1.5 bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 rounded-md text-sm font-medium hover:bg-zinc-800 dark:hover:bg-zinc-100 transition-colors"
            >
              Reload Now
            </button>
          ) : (
            <button
              onClick={handleInstall}
              className="flex-1 px-3 py-1.5 bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 rounded-md text-sm font-medium hover:bg-zinc-800 dark:hover:bg-zinc-100 transition-colors"
            >
              Install
            </button>
          )}
          <button
            onClick={handleDismiss}
            className="px-3 py-1.5 bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 rounded-md text-sm font-medium hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
          >
            Later
          </button>
        </div>
      </div>
    </div>
  );
}
