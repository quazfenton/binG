/**
 * P-Stream Movie Embed Plugin
 *
 * Simple full embed of pstream.net with proxy fallback
 */

"use client";

import React, { useState, useCallback } from 'react';
import useIframeLoader from '@/hooks/use-iframe-loader';
import { IframeUnavailableScreen } from '../ui/iframe-unavailable-screen';

const PStreamEmbedPlugin: React.FC<{ onClose: () => void, initialUrl?: string }> = ({ onClose, initialUrl }) => {
  const [isFullscreen, setIsFullscreen] = useState(false);

  const {
    isFailed,
    failureReason,
    errorMessage,
    retryCount,
    isUsingFallback,
    fallbackUrl,
    handleRetry,
  } = useIframeLoader({
    url: 'https://www.pstream.net',
    timeout: 30000,
    maxRetries: 3,
    retryDelay: 5000,
    enableAutoRetry: true,
    enableFallback: true,
  });

  const handleOpenExternal = useCallback(() => {
    window.open('https://www.pstream.net', '_blank', 'noopener,noreferrer');
  }, []);

  const src = isUsingFallback && fallbackUrl ? fallbackUrl : 'https://www.pstream.net';

  return (
    <div className={`w-full h-full flex flex-col bg-black ${isFullscreen ? 'fixed inset-0 z-50' : ''}`}>
      {/* Minimal header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/10 bg-black">
        <span className="text-xs text-white/60">
          Movies{isUsingFallback ? ' (via proxy)' : ''}
        </span>
        <div className="flex gap-2">
          <button
            onClick={() => setIsFullscreen(!isFullscreen)}
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
          <iframe
            src={src}
            className="w-full h-full border-0"
            allow="autoplay; fullscreen; picture-in-picture"
            allowFullScreen
            title="P-Stream Movies"
          />
        )}
      </div>
    </div>
  );
};

export default PStreamEmbedPlugin;
