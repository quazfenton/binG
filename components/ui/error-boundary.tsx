'use client';

import React, { Component, ErrorInfo, ReactNode, useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { AlertCircle, RefreshCw, Bug, Home } from 'lucide-react';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('UI:ErrorBoundary');

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  onReset?: () => void;
  name?: string;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

/**
 * Error Boundary Component
 * 
 * Catches JavaScript errors anywhere in the component tree
 * Displays fallback UI and logs error details
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      error,
      errorInfo: null,
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.setState({ errorInfo });
    
    // Log error
    logger.error('ErrorBoundary caught error', error, {
      componentStack: errorInfo.componentStack,
      boundaryName: this.props.name,
    });
    
    // Call custom error handler
    this.props.onError?.(error, errorInfo);
    
    // Report to error tracking service
    if (typeof window !== 'undefined' && (window as any).Sentry) {
      (window as any).Sentry.captureException(error, {
        extra: {
          componentStack: errorInfo.componentStack,
          boundaryName: this.props.name,
        },
      });
    }
  }

  handleReset = (): void => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });
    this.props.onReset?.();
  };

  render(): ReactNode {
    if (this.state.hasError) {
      // Use custom fallback if provided
      if (this.props.fallback) {
        return this.props.fallback;
      }

      // Default error UI
      return (
        <ErrorFallback
          error={this.state.error}
          componentStack={this.state.errorInfo?.componentStack}
          onReset={this.handleReset}
          boundaryName={this.props.name}
        />
      );
    }

    return this.props.children;
  }
}

/**
 * Default Error Fallback UI
 */
interface ErrorFallbackProps {
  error: Error | null;
  componentStack?: string;
  onReset: () => void;
  boundaryName?: string;
}

function ErrorFallback({ error, componentStack, onReset, boundaryName }: ErrorFallbackProps) {
  const [showDetails, setShowDetails] = useState(false);

  return (
    <div className="flex flex-col items-center justify-center min-h-[400px] p-6 bg-red-50 dark:bg-red-950/20 rounded-lg border border-red-200 dark:border-red-800">
      <AlertCircle className="w-12 h-12 text-red-500 mb-4" />
      
      <h2 className="text-xl font-semibold text-red-800 dark:text-red-200 mb-2">
        Something went wrong
      </h2>
      
      {boundaryName && (
        <p className="text-sm text-red-600 dark:text-red-400 mb-4">
          Component: {boundaryName}
        </p>
      )}
      
      <p className="text-red-600 dark:text-red-400 mb-6 text-center max-w-md">
        {error?.message || 'An unexpected error occurred'}
      </p>
      
      <div className="flex gap-3">
        <Button
          onClick={onReset}
          className="flex items-center gap-2"
        >
          <RefreshCw className="w-4 h-4" />
          Try Again
        </Button>
        
        <Button
          variant="outline"
          onClick={() => setShowDetails(!showDetails)}
          className="flex items-center gap-2"
        >
          <Bug className="w-4 h-4" />
          {showDetails ? 'Hide' : 'Show'} Details
        </Button>
        
        <Button
          variant="ghost"
          onClick={() => window.location.href = '/'}
          className="flex items-center gap-2"
        >
          <Home className="w-4 h-4" />
          Go Home
        </Button>
      </div>
      
      {showDetails && (
        <details className="mt-6 w-full max-w-2xl">
          <summary className="cursor-pointer text-sm font-medium text-red-700 dark:text-red-300 mb-2">
            Error Details
          </summary>
          <div className="p-4 bg-red-100 dark:bg-red-900/30 rounded border border-red-300 dark:border-red-700 overflow-auto max-h-96">
            <pre className="text-xs text-red-800 dark:text-red-200 whitespace-pre-wrap">
              {error?.toString()}
              {'\n\n'}
              Component Stack:
              {'\n'}
              {componentStack}
            </pre>
          </div>
        </details>
      )}
    </div>
  );
}

/**
 * Functional Error Boundary Hook
 * 
 * For use in functional components
 */
export function useErrorBoundary() {
  const [error, setError] = useState<Error | null>(null);
  const [errorInfo, setErrorInfo] = useState<ErrorInfo | null>(null);

  const reportError = (err: Error, info?: ErrorInfo): void => {
    setError(err);
    setErrorInfo(info || null);
    
    logger.error('useErrorBoundary caught error', err, {
      componentStack: info?.componentStack,
    });
  };

  const reset = (): void => {
    setError(null);
    setErrorInfo(null);
  };

  return {
    error,
    errorInfo,
    hasError: !!error,
    reportError,
    reset,
  };
}

/**
 * Async Error Boundary Wrapper
 * 
 * Wraps async operations with error handling
 */
export async function withErrorBoundary<T>(
  operation: () => Promise<T>,
  options?: {
    fallback?: T;
    onError?: (error: Error) => void;
    name?: string;
  }
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    
    logger.error('Async operation failed', err, {
      operationName: options?.name,
    });
    
    options?.onError?.(err);
    
    if (options?.fallback !== undefined) {
      return options.fallback;
    }
    
    throw err;
  }
}

/**
 * Global Error Handler
 * 
 * Catches unhandled errors at the application level
 */
export function useGlobalErrorHandler() {
  useEffect(() => {
    const handleGlobalError = (event: ErrorEvent): void => {
      logger.error('Global error caught', event.error, {
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
      });
    };

    const handleUnhandledRejection = (event: PromiseRejectionEvent): void => {
      logger.error('Unhandled promise rejection', event.reason);
    };

    window.addEventListener('error', handleGlobalError);
    window.addEventListener('unhandledrejection', handleUnhandledRejection);

    return () => {
      window.removeEventListener('error', handleGlobalError);
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
    };
  }, []);
}

/**
 * App-wide Error Boundary Provider
 * 
 * Wraps the entire application with error handling
 */
interface AppErrorBoundaryProviderProps {
  children: ReactNode;
}

export function AppErrorBoundaryProvider({ children }: AppErrorBoundaryProviderProps) {
  // Install global error handler
  useGlobalErrorHandler();

  const handleError = (error: Error, errorInfo: ErrorInfo): void => {
    // Log to analytics
    if (typeof window !== 'undefined' && (window as any).gtag) {
      (window as any).gtag('event', 'exception', {
        event_category: 'error',
        event_label: error.message,
      });
    }
  };

  return (
    <ErrorBoundary name="App" onError={handleError}>
      {children}
    </ErrorBoundary>
  );
}

export default ErrorBoundary;
