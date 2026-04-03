'use client';

import React, { Component, ErrorInfo, ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { AlertCircle, RefreshCw, Bug, Code, FileText, Zap } from 'lucide-react';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('Preview:ErrorBoundary');

interface PreviewErrorBoundaryProps {
  children: ReactNode;
  previewMode?: string;
  framework?: string;
  onReset?: () => void;
  fallbackComponent?: ReactNode;
}

interface PreviewErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

/**
 * Preview-specific error messages and recovery suggestions
 */
const PREVIEW_ERROR_MESSAGES: Record<string, { message: string; suggestion: string; icon: ReactNode }> = {
  'SandpackError': {
    message: 'Sandpack bundler failed to compile',
    suggestion: 'Try clearing the cache and refreshing, or switch to a different preview mode',
    icon: <Code className="w-8 h-8" />,
  },
  'WebContainerError': {
    message: 'WebContainer failed to boot',
    suggestion: 'Your browser may not support SharedArrayBuffer. Try Chrome/Edge or use cloud preview.',
    icon: <Zap className="w-8 h-8" />,
  },
  'PyodideError': {
    message: 'Pyodide Python runtime failed to load',
    suggestion: 'Check your internet connection and try again, or use cloud Python execution.',
    icon: <FileText className="w-8 h-8" />,
  },
  'NetworkError': {
    message: 'Network error loading preview resources',
    suggestion: 'Check your internet connection and try again.',
    icon: <AlertCircle className="w-8 h-8" />,
  },
  'default': {
    message: 'Preview rendering failed unexpectedly',
    suggestion: 'Try refreshing the preview or switching to a different mode.',
    icon: <AlertCircle className="w-8 h-8" />,
  },
};

/**
 * Detect error type from error message
 */
function detectErrorType(error: Error): string {
  const message = error.message.toLowerCase();
  
  if (message.includes('sandpack') || message.includes('compil') || message.includes('bundl')) {
    return 'SandpackError';
  }
  if (message.includes('webcontainer') || message.includes('sharedarraybuffer') || message.includes('cross-origin')) {
    return 'WebContainerError';
  }
  if (message.includes('pyodide') || message.includes('python') || message.includes('loadpyodide')) {
    return 'PyodideError';
  }
  if (message.includes('network') || message.includes('fetch') || message.includes('failed to fetch')) {
    return 'NetworkError';
  }
  
  return 'default';
}

/**
 * Preview Error Boundary Component
 * 
 * Catches errors in the preview rendering and provides preview-specific
 * error UI with recovery options
 */
export class PreviewErrorBoundary extends Component<PreviewErrorBoundaryProps, PreviewErrorBoundaryState> {
  constructor(props: PreviewErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): PreviewErrorBoundaryState {
    return {
      hasError: true,
      error,
      errorInfo: null,
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.setState({ errorInfo });
    
    const errorType = detectErrorType(error);
    logger.error(`PreviewErrorBoundary caught ${errorType} error`, error, {
      componentStack: errorInfo.componentStack,
      previewMode: this.props.previewMode,
    });
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
      if (this.props.fallbackComponent) {
        return this.props.fallbackComponent;
      }

      return (
        <PreviewErrorFallback
          error={this.state.error}
          componentStack={this.state.errorInfo?.componentStack}
          onReset={this.handleReset}
          previewMode={this.props.previewMode}
        />
      );
    }

    return this.props.children;
  }
}

/**
 * Preview-specific error fallback UI
 */
interface PreviewErrorFallbackProps {
  error: Error | null;
  componentStack?: string;
  onReset: () => void;
  previewMode?: string;
}

function PreviewErrorFallback({ error, componentStack, onReset, previewMode }: PreviewErrorFallbackProps) {
  const [showDetails, setShowDetails] = React.useState(false);
  
  const errorType = error ? detectErrorType(error) : 'default';
  const errorConfig = PREVIEW_ERROR_MESSAGES[errorType] || PREVIEW_ERROR_MESSAGES['default'];

  return (
    <div className="flex flex-col items-center justify-center min-h-[400px] p-6 bg-gray-900/50 rounded-lg border border-red-500/30">
      <div className="text-red-400 mb-4">
        {errorConfig.icon}
      </div>
      
      <h2 className="text-xl font-semibold text-white mb-2">
        Preview Error
      </h2>
      
      <p className="text-red-300 mb-2 text-center max-w-md">
        {errorConfig.message}
      </p>
      
      {previewMode && (
        <p className="text-sm text-gray-400 mb-4">
          Current mode: <span className="text-gray-300">{previewMode}</span>
        </p>
      )}
      
      <p className="text-gray-400 mb-6 text-center max-w-md text-sm">
        {errorConfig.suggestion}
      </p>
      
      <div className="flex gap-3 flex-wrap justify-center">
        <Button
          onClick={onReset}
          className="flex items-center gap-2 bg-red-600 hover:bg-red-700"
        >
          <RefreshCw className="w-4 h-4" />
          Retry Preview
        </Button>
        
        <Button
          variant="outline"
          onClick={() => setShowDetails(!showDetails)}
          className="flex items-center gap-2 border-gray-600 text-gray-300 hover:bg-gray-800"
        >
          <Bug className="w-4 h-4" />
          {showDetails ? 'Hide' : 'Show'} Details
        </Button>
      </div>
      
      {showDetails && (
        <details className="mt-6 w-full max-w-2xl">
          <summary className="cursor-pointer text-sm font-medium text-gray-400 mb-2">
            Technical Details
          </summary>
          <div className="p-4 bg-black/50 rounded border border-gray-700 overflow-auto max-h-64">
            <pre className="text-xs text-red-300 whitespace-pre-wrap">
              {error?.message || 'Unknown error'}
              {'\n\n'}
              {componentStack && `Stack Trace:\n${componentStack}`}
            </pre>
          </div>
        </details>
      )}
    </div>
  );
}

export default PreviewErrorBoundary;