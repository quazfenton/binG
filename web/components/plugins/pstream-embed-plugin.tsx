/**
 * P-Stream Movie Embed Plugin
 *
 * Embeds pstream.net with fallback chain:
 * 1. Direct load (https://www.pstream.net)
 * 2. Webfuse external framer (https://demo.webfuse.com/+iframetest/?url=...)
 * 3. Local proxy with iframe mode (/api/proxy?url=...&mode=iframe)
 */

"use client";

import React, { useState, useCallback, useRef, useEffect } from 'react';
import useIframeLoader from '@/hooks/use-iframe-loader';
import { IframeUnavailableScreen } from '../ui/iframe-unavailable-screen';
import { IframeLoadingOverlay } from '../ui/iframe-loading-overlay';

const PStreamEmbedPlugin: React.FC<{ onClose: () => void, initialUrl?: string }> = ({ onClose, initialUrl }) => {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Sync CSS fullscreen state with Fullscreen API state
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const handleToggleFullscreen = useCallback(() => {
    const elem = containerRef.current;
    if (!elem) return;

    if (!document.fullscreenElement) {
      elem.requestFullscreen().catch(() => {
        // Fallback to CSS-only fullscreen if Fullscreen API fails
        setIsFullscreen(prev => !prev);
      });
    } else {
      document.exitFullscreen();
    }
  }, []);

  const {
    isLoading,
    isLoaded,
    isFailed,
    failureReason,
    errorMessage,
    retryCount,
    isUsingFallback,
    fallbackLevel,
    fallbackUrl,
    loadingProgress,
    handleRetry,
    handleFallback,
    handleLoadSuccess,
  } = useIframeLoader({
    url: 'https://www.pstream.net',
    timeout: 10000, // 10s per attempt (fast detection, reasonable for most sites)
    maxRetries: 2,
    retryDelay: 2000,
    enableAutoRetry: true,
    enableFallback: true,
  });

  const handleOpenExternal = useCallback(() => {
    window.open('https://www.pstream.net', '_blank', 'noopener,noreferrer');
  }, []);

  // Determine iframe source based on fallback state
  let src = 'https://www.pstream.net';
  let fallbackLabel = '';

  if (isUsingFallback && fallbackUrl) {
    src = fallbackUrl;
    if (fallbackLevel === 'webfuse') {
      fallbackLabel = ' (via webfuse)';
    } else if (fallbackLevel === 'proxy') {
      fallbackLabel = ' (via proxy)';
    }
  }

  return (
    <div ref={containerRef} className={`w-full h-full flex flex-col bg-black ${isFullscreen ? 'fixed inset-0 z-50' : ''}`}>
      {/* Minimal header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/10 bg-black">
        <span className="text-xs text-white/60">
          Movies{fallbackLabel}
        </span>
        <div className="flex gap-2">
          <button
            onClick={handleToggleFullscreen}
            className="text-xs text-white/60 hover:text-white"
          >
            {isFullscreen ? 'Exit' : 'Fullscreen'}
          </button>
          <button
            onClick={onClose}
            className="text-xs text-white/60 hover:text-white"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 relative">
        {isFailed ? (
          <IframeUnavailableScreen
            url="https://www.pstream.net"
            reason={failureReason || 'failed'}
            errorMessage={errorMessage || undefined}
            onRetry={handleRetry}
            onOpenExternal={handleOpenExternal}
            onClose={onClose}
            autoRetryCount={retryCount}
            maxRetries={3}
          />
        ) : (
          <>
            {/* Shared loading overlay with progress bar */}
            <IframeLoadingOverlay
              progress={loadingProgress}
              isLoading={isLoading}
              isUsingFallback={isUsingFallback}
              fallbackLevel={fallbackLevel}
              label="Loading movies"
            />
            <iframe
              key={src} // Force re-render when src changes (fallback)
              src={src}
              className="w-full h-full border-0"
              sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
              allow="autoplay; fullscreen; picture-in-picture"
              allowFullScreen
              title="P-Stream Movies"
              onLoad={() => {
                // iframe loaded successfully - clear timeout to prevent fallback cascade
                handleLoadSuccess();
              }}
            />
          </>
        )}
      </div>
    </div>
  );
};

export default PStreamEmbedPlugin;
