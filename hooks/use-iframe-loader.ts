/**
 * useIframeLoader Hook
 * 
 * Handles iframe loading, error detection, and retry logic
 * Detects X-Frame-Options, CSP blocks, timeouts, and connection failures
 */

"use client";

import { useState, useEffect, useCallback, useRef } from 'react';

export interface UseIframeLoaderOptions {
  url?: string;
  timeout?: number;
  maxRetries?: number;
  retryDelay?: number;
  enableAutoRetry?: boolean;
  enableFallback?: boolean;
  onLoaded?: () => void;
  onFailed?: (reason: IframeFailureReason, error?: string) => void;
}

export type IframeFailureReason =
  | 'blocked'
  | 'failed'
  | 'header-detected'
  | 'timeout'
  | 'x-frame-options'
  | 'csp-blocked'
  | 'network-error'
  | 'ssl-error';

export type FallbackLevel = 'none' | 'proxy' | 'webfuse';

export interface UseIframeLoaderReturn {
  isLoading: boolean;
  isLoaded: boolean;
  isFailed: boolean;
  failureReason: IframeFailureReason | null;
  errorMessage: string | null;
  retryCount: number;
  canRetry: boolean;
  isUsingFallback: boolean;
  fallbackLevel: FallbackLevel;
  fallbackUrl: string | null;
  loadingProgress: number; // 0-100% progress during loading
  handleLoad: (url: string) => void;
  handleRetry: () => void;
  handleReset: () => void;
  handleFallback: () => void;
  handleLoadSuccess: () => void;
}

export function useIframeLoader({
  url,
  timeout = 30000,
  maxRetries = 3,
  retryDelay = 5000,
  enableAutoRetry = true,
  enableFallback = true,
  onLoaded,
  onFailed,
}: UseIframeLoaderOptions): UseIframeLoaderReturn {
  const [isLoading, setIsLoading] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [isFailed, setIsFailed] = useState(false);
  const [failureReason, setFailureReason] = useState<IframeFailureReason | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [fallbackAttempt, setFallbackAttempt] = useState(0);
  const [fallbackLevel, setFallbackLevel] = useState<FallbackLevel>('none');
  const [isUsingFallback, setIsUsingFallback] = useState(false);
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null);
  const [loadingProgress, setLoadingProgress] = useState(0);

  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const progressRef = useRef<NodeJS.Timeout | null>(null);
  const currentUrlRef = useRef<string>('');
  const originalUrlRef = useRef<string>('');
  const fallbackAttemptRef = useRef<number>(0);
  const loadStartRef = useRef<number>(0);
  // Refs for current state to avoid stale closures in timeouts
  const enableFallbackRef = useRef(enableFallback);
  const isFailedRef = useRef(isFailed);
  const isLoadingRef = useRef(isLoading);
  const timeoutValueRef = useRef(timeout);

  // Keep refs in sync
  useEffect(() => {
    enableFallbackRef.current = enableFallback;
    isFailedRef.current = isFailed;
    isLoadingRef.current = isLoading;
    timeoutValueRef.current = timeout;
  }, [enableFallback, isFailed, isLoading, timeout]);

  const detectFailureReason = useCallback((error?: string): IframeFailureReason => {
    if (!error) return 'failed';
    
    const lowerError = error.toLowerCase();
    
    // Check for specific error patterns
    if (lowerError.includes('x-frame-options') || lowerError.includes('frame') && lowerError.includes('option')) {
      return 'x-frame-options';
    }
    if (lowerError.includes('content-security-policy') || lowerError.includes('csp')) {
      return 'csp-blocked';
    }
    if (lowerError.includes('timeout') || lowerError.includes('timed out')) {
      return 'timeout';
    }
    if (lowerError.includes('network') || lowerError.includes('fetch')) {
      return 'network-error';
    }
    if (lowerError.includes('ssl') || lowerError.includes('certificate')) {
      return 'ssl-error';
    }
    if (lowerError.includes('blocked') || lowerError.includes('refused')) {
      return 'blocked';
    }
    
    return 'failed';
  }, []);

  const handleFallback = useCallback(() => {
    if (!originalUrlRef.current) return;

    // Use ref to track attempt count for proper closure behavior
    const attempt = fallbackAttemptRef.current + 1;
    fallbackAttemptRef.current = attempt;
    setFallbackAttempt(attempt);

    let nextFallback: FallbackLevel;
    let nextFallbackUrl: string;

    if (attempt === 1) {
      // First fallback: use external webfuse service (handles framing externally)
      nextFallback = 'webfuse';
      const encodedUrl = encodeURIComponent(originalUrlRef.current);
      nextFallbackUrl = `https://demo.webfuse.com/+iframetest/?url=${encodedUrl}`;
    } else if (attempt === 2) {
      // Second fallback: use local /api/proxy with iframe mode (allows HTML)
      nextFallback = 'proxy';
      nextFallbackUrl = `/api/proxy?url=${encodeURIComponent(originalUrlRef.current)}&mode=iframe`;
    } else {
      // All fallbacks exhausted
      const reason: IframeFailureReason = 'timeout';
      const errorMsg = 'All fallback options exhausted';

      setIsLoading(false);
      setIsFailed(true);
      setFailureReason(reason);
      setErrorMessage(errorMsg);

      onFailed?.(reason, errorMsg);
      return;
    }

    setFallbackLevel(nextFallback);
    setIsUsingFallback(true);
    setFallbackUrl(nextFallbackUrl);
    setIsFailed(false);
    setFailureReason(null);
    setErrorMessage(null);
    setRetryCount(0);
    setLoadingProgress(0);

    // Clear any existing timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    if (progressRef.current) {
      clearInterval(progressRef.current);
    }

    // Reset load start time for new fallback attempt
    loadStartRef.current = Date.now();

    // Start progress tracking for fallback
    progressRef.current = setInterval(() => {
      const elapsed = Date.now() - loadStartRef.current;
      const progress = Math.min((elapsed / timeoutValueRef.current) * 100, 95);
      setLoadingProgress(progress);
    }, 100);

    // Set timeout for fallback iframe
    timeoutRef.current = setTimeout(() => {
      // Clear progress tracking
      if (progressRef.current) {
        clearInterval(progressRef.current);
        progressRef.current = null;
      }
      setLoadingProgress(100);
      handleFallback(); // Cascade to next level
    }, timeout);
  }, [timeout, onFailed]);

  const handleLoad = useCallback((newUrl: string) => {
    if (!newUrl) return;

    // Only reset state if this is a completely new URL (not a retry/fallback)
    const isNewUrl = newUrl !== currentUrlRef.current;

    // Reset state
    setIsLoading(true);
    setIsLoaded(false);
    setIsFailed(false);
    setFailureReason(null);
    setErrorMessage(null);
    setLoadingProgress(0);
    if (isNewUrl) {
      setRetryCount(0);
      fallbackAttemptRef.current = 0;
      setFallbackAttempt(0);
      setFallbackLevel('none');
      setIsUsingFallback(false);
      setFallbackUrl(null);
    }
    currentUrlRef.current = newUrl;
    originalUrlRef.current = newUrl;
    loadStartRef.current = Date.now();

    // Clear any existing timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    if (progressRef.current) {
      clearInterval(progressRef.current);
    }

    // Start progress tracking (update every 100ms)
    progressRef.current = setInterval(() => {
      const elapsed = Date.now() - loadStartRef.current;
      const progress = Math.min((elapsed / timeoutValueRef.current) * 100, 95);
      setLoadingProgress(progress);
    }, 100);

    // Set timeout - auto-trigger fallback if enabled
    timeoutRef.current = setTimeout(() => {
      // Clear progress tracking
      if (progressRef.current) {
        clearInterval(progressRef.current);
        progressRef.current = null;
      }
      setLoadingProgress(100);

      // Use refs to get current state (avoid stale closures)
      if (enableFallbackRef.current && !isFailedRef.current && isLoadingRef.current) {
        // Auto-trigger fallback chain instead of failing immediately
        handleFallback();
      } else if (isLoadingRef.current) {
        // Only fail if still loading (not already handled by fallback)
        const reason: IframeFailureReason = 'timeout';
        const errorMsg = 'Connection timed out after 30 seconds';

        setIsLoading(false);
        setIsFailed(true);
        setFailureReason(reason);
        setErrorMessage(errorMsg);

        onFailed?.(reason, errorMsg);
      }
      // If not loading, the iframe already succeeded/failed - do nothing
    }, timeout);
  }, [timeout, onFailed, handleFallback]);

  const handleSuccess = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    if (progressRef.current) {
      clearInterval(progressRef.current);
      progressRef.current = null;
    }
    setLoadingProgress(100);

    setIsLoading(false);
    setIsLoaded(true);
    setIsFailed(false);
    setFailureReason(null);
    setErrorMessage(null);

    onLoaded?.();
  }, [onLoaded]);

  const handleLoadSuccess = useCallback(() => {
    // Called by component when iframe onLoad fires
    // Note: onLoad doesn't fire for CSP blocks, so timeout is still the primary failure detector
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    if (progressRef.current) {
      clearInterval(progressRef.current);
      progressRef.current = null;
    }
    setLoadingProgress(100);
    setIsLoading(false);
    setIsLoaded(true);
    setIsFailed(false);
    setFailureReason(null);
    setErrorMessage(null);
    onLoaded?.();
  }, [onLoaded]);

  const handleFailure = useCallback((error?: string) => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    if (progressRef.current) {
      clearInterval(progressRef.current);
      progressRef.current = null;
    }
    setLoadingProgress(100);

    const reason = detectFailureReason(error);

    setIsLoading(false);
    setIsLoaded(false);
    setIsFailed(true);
    setFailureReason(reason);
    setErrorMessage(error || 'Failed to load content');

    onFailed?.(reason, error);
  }, [detectFailureReason, onFailed]);

  const handleRetry = useCallback(() => {
    if (retryCount >= maxRetries) return;

    const newRetryCount = retryCount + 1;
    setRetryCount(newRetryCount);

    // Reset fallback state on retry
    fallbackAttemptRef.current = 0;
    setFallbackAttempt(0);
    setFallbackLevel('none');
    setIsUsingFallback(false);
    setFallbackUrl(null);
    setLoadingProgress(0);

    if (enableAutoRetry && newRetryCount < maxRetries) {
      // Auto-retry after delay
      setTimeout(() => {
        handleLoad(currentUrlRef.current);
      }, retryDelay);
    } else {
      // Manual retry
      handleLoad(currentUrlRef.current);
    }
  }, [retryCount, maxRetries, enableAutoRetry, retryDelay, handleLoad]);

  const handleReset = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    if (progressRef.current) {
      clearInterval(progressRef.current);
      progressRef.current = null;
    }

    setIsLoading(false);
    setIsLoaded(false);
    setIsFailed(false);
    setFailureReason(null);
    setErrorMessage(null);
    setRetryCount(0);
    setLoadingProgress(0);
    fallbackAttemptRef.current = 0;
    setFallbackAttempt(0);
    setFallbackLevel('none');
    setIsUsingFallback(false);
    setFallbackUrl(null);
    currentUrlRef.current = '';
    originalUrlRef.current = '';
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      if (progressRef.current) {
        clearInterval(progressRef.current);
      }
    };
  }, []);

  // Auto-load when URL changes (only trigger on actual URL change, not state changes)
  useEffect(() => {
    if (url && url !== currentUrlRef.current) {
      handleLoad(url);
    }
  }, [url]); // Only depend on URL, not handleLoad

  return {
    isLoading,
    isLoaded,
    isFailed,
    failureReason,
    errorMessage,
    retryCount,
    canRetry: retryCount < maxRetries,
    isUsingFallback,
    fallbackLevel,
    fallbackUrl,
    loadingProgress,
    handleLoad,
    handleRetry,
    handleReset,
    handleFallback,
    handleLoadSuccess,
  };
}

export default useIframeLoader;
