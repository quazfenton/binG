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

export interface UseIframeLoaderReturn {
  isLoading: boolean;
  isLoaded: boolean;
  isFailed: boolean;
  failureReason: IframeFailureReason | null;
  errorMessage: string | null;
  retryCount: number;
  canRetry: boolean;
  handleLoad: (url: string) => void;
  handleRetry: () => void;
  handleReset: () => void;
}

export function useIframeLoader({
  url,
  timeout = 30000,
  maxRetries = 3,
  retryDelay = 5000,
  enableAutoRetry = true,
  onLoaded,
  onFailed,
}: UseIframeLoaderOptions): UseIframeLoaderReturn {
  const [isLoading, setIsLoading] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [isFailed, setIsFailed] = useState(false);
  const [failureReason, setFailureReason] = useState<IframeFailureReason | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const currentUrlRef = useRef<string>('');

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

  const handleLoad = useCallback((newUrl: string) => {
    if (!newUrl) return;
    
    // Reset state
    setIsLoading(true);
    setIsLoaded(false);
    setIsFailed(false);
    setFailureReason(null);
    setErrorMessage(null);
    setRetryCount(0);
    currentUrlRef.current = newUrl;

    // Clear any existing timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    // Set timeout
    timeoutRef.current = setTimeout(() => {
      if (isLoading && !isLoaded) {
        const reason: IframeFailureReason = 'timeout';
        const errorMsg = 'Connection timed out after 30 seconds';
        
        setIsLoading(false);
        setIsFailed(true);
        setFailureReason(reason);
        setErrorMessage(errorMsg);
        
        onFailed?.(reason, errorMsg);
      }
    }, timeout);
  }, [isLoading, isLoaded, timeout, onFailed]);

  const handleSuccess = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    
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
    }
    
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
    }
    
    setIsLoading(false);
    setIsLoaded(false);
    setIsFailed(false);
    setFailureReason(null);
    setErrorMessage(null);
    setRetryCount(0);
    currentUrlRef.current = '';
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  // Auto-load when URL changes
  useEffect(() => {
    if (url) {
      handleLoad(url);
    }
  }, [url, handleLoad]);

  return {
    isLoading,
    isLoaded,
    isFailed,
    failureReason,
    errorMessage,
    retryCount,
    canRetry: retryCount < maxRetries,
    handleLoad,
    handleRetry,
    handleReset,
  };
}

export default useIframeLoader;
