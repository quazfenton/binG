/**
 * Iframe Loading Overlay
 *
 * Shared loading overlay for all embed plugins.
 * Shows a progress bar that fills during the timeout period.
 * Replaces the failed state while awaiting timeout/fallback.
 */

"use client";

import React from 'react';
import { Loader2, AlertCircle } from 'lucide-react';

interface IframeLoadingOverlayProps {
  /** Current loading progress (0-100) */
  progress: number;
  /** Whether currently loading */
  isLoading: boolean;
  /** Label to show (e.g., movie name, site name) */
  label?: string;
  /** Whether using a fallback (webfuse, proxy) - logged but not displayed */
  isUsingFallback?: boolean;
  /** Current fallback level - logged but not displayed */
  fallbackLevel?: 'none' | 'proxy' | 'webfuse';
}

export function IframeLoadingOverlay({
  progress,
  isLoading,
  label = 'Loading',
  isUsingFallback = false,
  fallbackLevel = 'none',
}: IframeLoadingOverlayProps) {
  // NOTE: useEffect must be called before any early return (rules of hooks)
  const cappedProgress = Math.max(0, Math.min(progress, 100));

  React.useEffect(() => {
    if (isUsingFallback && fallbackLevel !== 'none') {
      console.log(`[IframeLoadingOverlay] Using fallback: ${fallbackLevel}`);
    }
  }, [isUsingFallback, fallbackLevel]);

  // Log fallback state for debugging (not shown to user)
  if (!isLoading) return null;

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/90 z-10 backdrop-blur-sm">
      <div className="w-full max-w-md px-6 space-y-4">
        {/* Spinner and label */}
        <div className="flex items-center gap-3">
          <Loader2 className="w-5 h-5 text-white/60 animate-spin" />
          <span className="text-sm text-white/60">{label}</span>
        </div>

        {/* Progress bar */}
        <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-cyan-500 to-blue-500 rounded-full transition-all duration-150 ease-linear"
            style={{ width: `${cappedProgress}%` }}
          />
        </div>

        {/* Progress percentage */}
        <div className="flex items-center justify-between text-xs text-white/40">
          <span>{Math.round(cappedProgress)}%</span>
          {progress > 80 && (
            <span className="flex items-center gap-1 text-yellow-400/60">
              <AlertCircle className="w-3 h-3" />
              Trying fallback if needed...
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export default IframeLoadingOverlay;
