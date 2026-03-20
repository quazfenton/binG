/**
 * Iframe Unavailable Screen
 * 
 * Displays when an iframe is blocked, fails to load, or detects restrictive headers
 * Shows a temporary unavailability message with troubleshooting options
 */

"use client";

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import {
  AlertCircle,
  Shield,
  RefreshCw,
  ExternalLink,
  Copy,
  Check,
  Clock,
  Info,
  X,
  Globe,
  Lock,
  AlertTriangle,
} from 'lucide-react';
import { toast } from 'sonner';

export interface IframeUnavailableProps {
  url: string;
  reason?: 'blocked' | 'failed' | 'header-detected' | 'timeout' | 'x-frame-options' | 'csp-blocked' | 'network-error' | 'ssl-error';
  errorMessage?: string;
  onRetry?: () => void;
  onOpenExternal?: () => void;
  onTryFallback?: () => void;
  onClose?: () => void;
  autoRetryCount?: number;
  maxRetries?: number;
}

export const IframeUnavailableScreen: React.FC<IframeUnavailableProps> = ({
  url,
  reason = 'failed',
  errorMessage,
  onRetry,
  onOpenExternal,
  onTryFallback,
  onClose,
  autoRetryCount = 0,
  maxRetries = 3,
}) => {
  const [copied, setCopied] = useState(false);
  const [timeUntilRetry, setTimeUntilRetry] = useState<number | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);

  // Countdown timer for auto-retry
  useEffect(() => {
    if (autoRetryCount > 0 && autoRetryCount < maxRetries) {
      setTimeUntilRetry(5); // 5 second countdown
      
      const timer = setInterval(() => {
        setTimeUntilRetry((prev) => {
          if (prev === null || prev <= 1) {
            clearInterval(timer);
            return null;
          }
          return prev - 1;
        });
      }, 1000);

      return () => { clearInterval(timer); };
    }
  }, [autoRetryCount, maxRetries]);

  const handleCopyUrl = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success('URL copied to clipboard');
      setTimeout(() => { setCopied(false); }, 2000);
    } catch (error: any) {
      console.error('Failed to copy URL to clipboard:', error.message);
      toast.error('Failed to copy URL. Please copy it manually.');
      // Fallback: select the URL text if available
      const urlElement = document.getElementById('preview-url-text');
      if (urlElement) {
        const range = document.createRange();
        range.selectNode(urlElement);
        window.getSelection()?.removeAllRanges();
        window.getSelection()?.addRange(range);
      }
    }
  };

  const handleRetry = () => {
    if (onRetry) {
      onRetry();
      setTimeUntilRetry(null);
    }
  };

  const handleOpenExternal = () => {
    if (onOpenExternal) {
      onOpenExternal();
    } else if (url) {
      // Validate URL scheme before opening (prevent javascript:, data:, etc.)
      try {
        const urlObj = new URL(url);
        if (urlObj.protocol === 'http:' || urlObj.protocol === 'https:') {
          window.open(url, '_blank', 'noopener,noreferrer');
        } else {
          console.warn('[iframe-unavailable-screen] Blocked unsafe URL:', url);
        }
      } catch {
        console.warn('[iframe-unavailable-screen] Invalid URL:', url);
      }
    }
  };

  const getReasonInfo = () => {
    switch (reason) {
      case 'x-frame-options':
        return {
          icon: Lock,
          title: 'Frame Embedding Blocked',
          description: 'This website does not allow embedding in iframes (X-Frame-Options header)',
          color: 'text-red-400',
          bgColor: 'bg-red-500/10',
          borderColor: 'border-red-500/20',
        };
      case 'csp-blocked':
        return {
          icon: Shield,
          title: 'Content Security Policy Block',
          description: 'The website\'s CSP policy prevents iframe embedding',
          color: 'text-orange-400',
          bgColor: 'bg-orange-500/10',
          borderColor: 'border-orange-500/20',
        };
      case 'timeout':
        return {
          icon: Clock,
          title: 'Connection Timeout',
          description: 'The website took too long to respond',
          color: 'text-yellow-400',
          bgColor: 'bg-yellow-500/10',
          borderColor: 'border-yellow-500/20',
        };
      case 'blocked':
        return {
          icon: AlertTriangle,
          title: 'Access Restricted',
          description: 'Access to this website is temporarily restricted',
          color: 'text-red-400',
          bgColor: 'bg-red-500/10',
          borderColor: 'border-red-500/20',
        };
      case 'header-detected':
        return {
          icon: Info,
          title: 'Restrictive Headers Detected',
          description: 'The website has headers that prevent embedding',
          color: 'text-orange-400',
          bgColor: 'bg-orange-500/10',
          borderColor: 'border-orange-500/20',
        };
      default:
        return {
          icon: AlertCircle,
          title: 'Failed to Load',
          description: 'Unable to load the requested content',
          color: 'text-yellow-400',
          bgColor: 'bg-yellow-500/10',
          borderColor: 'border-yellow-500/20',
        };
    }
  };

  const reasonInfo = getReasonInfo();
  const IconComponent = reasonInfo.icon;

  return (
    <Card className="w-full h-full flex flex-col bg-gradient-to-br from-slate-900 via-red-900/20 to-slate-900 border-yellow-500/20">
      <CardHeader className="flex flex-row items-center justify-between p-4 border-b border-yellow-500/20 bg-black/40">
        <div className="flex items-center gap-2">
          <div className={`p-2 ${reasonInfo.bgColor} rounded-lg`}>
            <IconComponent className={`w-5 h-5 ${reasonInfo.color}`} />
          </div>
          <div>
            <CardTitle className="text-lg text-white">{reasonInfo.title}</CardTitle>
            {autoRetryCount > 0 && autoRetryCount < maxRetries && (
              <p className="text-xs text-yellow-400 flex items-center gap-1">
                <RefreshCw className="w-3 h-3 animate-spin" />
                Auto-retrying... ({autoRetryCount}/{maxRetries})
              </p>
            )}
          </div>
        </div>
        
        {onClose && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="h-8 w-8 text-yellow-300 hover:text-white hover:bg-yellow-500/20"
          >
            <X className="w-4 h-4" />
          </Button>
        )}
      </CardHeader>

      <CardContent className="flex-1 flex flex-col p-6 overflow-auto">
        {/* Main Message */}
        <div className={`p-4 rounded-lg border ${reasonInfo.bgColor} ${reasonInfo.borderColor} mb-6`}>
          <p className={`text-sm ${reasonInfo.color} mb-2`}>{reasonInfo.description}</p>
          {errorMessage && (
            <div className="mt-3 p-3 bg-black/40 rounded border border-white/10">
              <p className="text-xs text-red-400 font-mono break-all">{errorMessage}</p>
            </div>
          )}
        </div>

        {/* URL Display */}
        <div className="mb-6">
          <label className="text-xs text-yellow-300/70 mb-2 block">Requested URL</label>
          <div className="flex gap-2">
            <div className="flex-1 p-3 bg-black/40 rounded border border-white/10">
              <p className="text-xs text-white/70 font-mono break-all">{url}</p>
            </div>
            <Button
              variant="outline"
              size="icon"
              onClick={handleCopyUrl}
              className="h-auto border-white/20 text-white/70 hover:text-white hover:bg-white/10"
              title="Copy URL"
            >
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            </Button>
          </div>
        </div>

        {/* Troubleshooting Tips */}
        <div className="mb-6">
          <button
            onClick={() => { setIsExpanded(!isExpanded); }}
            className="flex items-center gap-2 text-sm text-yellow-300 hover:text-yellow-200 mb-3"
          >
            <Info className="w-4 h-4" />
            <span>Troubleshooting Tips</span>
            <span className={`transform transition-transform ${isExpanded ? 'rotate-180' : ''}`}>▼</span>
          </button>
          
          {isExpanded && (
            <div className="space-y-2 text-xs text-white/60">
              <div className="flex items-start gap-2">
                <Globe className="w-3 h-3 mt-0.5 text-blue-400" />
                <p>Some websites block iframe embedding for security reasons</p>
              </div>
              <div className="flex items-start gap-2">
                <ExternalLink className="w-3 h-3 mt-0.5 text-green-400" />
                <p>Try opening the link in a new tab instead</p>
              </div>
              <div className="flex items-start gap-2">
                <RefreshCw className="w-3 h-3 mt-0.5 text-yellow-400" />
                <p>Wait a moment and try again - the issue might be temporary</p>
              </div>
              {reason === 'timeout' && (
                <div className="flex items-start gap-2">
                  <Clock className="w-3 h-3 mt-0.5 text-purple-400" />
                  <p>The website may be experiencing high traffic or slow response times</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap gap-3 mt-auto">
          {onTryFallback && (
            <Button
              onClick={onTryFallback}
              className="flex-1 min-w-[140px] bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 text-white"
            >
              <Globe className="w-4 h-4 mr-2" />
              Try Fallback
            </Button>
          )}

          {onRetry && autoRetryCount < maxRetries && (
            <Button
              onClick={handleRetry}
              disabled={timeUntilRetry !== null && timeUntilRetry > 0}
              className="flex-1 min-w-[140px] bg-gradient-to-r from-yellow-600 to-orange-600 hover:from-yellow-700 hover:to-orange-700 text-white"
            >
              {timeUntilRetry !== null && timeUntilRetry > 0 ? (
                <>
                  <Clock className="w-4 h-4 mr-2" />
                  Retry in {timeUntilRetry}s
                </>
              ) : (
                <>
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Try Again
                </>
              )}
            </Button>
          )}

          <Button
            onClick={handleOpenExternal}
            variant="outline"
            className="flex-1 min-w-[140px] border-white/20 text-white hover:bg-white/10"
          >
            <ExternalLink className="w-4 h-4 mr-2" />
            Open in New Tab
          </Button>

          {onClose && (
            <Button
              onClick={onClose}
              variant="ghost"
              className="border border-white/10 text-white/70 hover:text-white hover:bg-white/10"
            >
              Close
            </Button>
          )}
        </div>

        {/* Retry Status */}
        {autoRetryCount > 0 && (
          <div className="mt-4 pt-4 border-t border-white/10">
            <div className="flex items-center justify-between text-xs text-white/50">
              <span>Retry Attempts</span>
              <Badge variant="outline" className="border-yellow-500/30 text-yellow-400">
                {autoRetryCount} / {maxRetries}
              </Badge>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default IframeUnavailableScreen;
