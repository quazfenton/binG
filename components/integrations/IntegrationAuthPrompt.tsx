'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { 
  Mail, Calendar, FileText, Github, Twitter, MessageSquare, 
  Music, Cloud, MapPin, Search, Phone, Database, ExternalLink,
  X, CheckCircle, AlertCircle, Sparkles
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface IntegrationAuthPromptProps {
  toolName: string;
  provider: string;
  authUrl: string;
  onDismiss: () => void;
  onAuthorized?: () => void;
  message?: string;
}

const PROVIDER_ICONS: Record<string, React.ReactNode> = {
  google: <Mail className="w-6 h-6" />,
  gmail: <Mail className="w-6 h-6" />,
  googledocs: <FileText className="w-6 h-6" />,
  googlesheets: <FileText className="w-6 h-6" />,
  googlecalendar: <Calendar className="w-6 h-6" />,
  googledrive: <Cloud className="w-6 h-6" />,
  github: <Github className="w-6 h-6" />,
  twitter: <Twitter className="w-6 h-6" />,
  slack: <MessageSquare className="w-6 h-6" />,
  spotify: <Music className="w-6 h-6" />,
  notion: <FileText className="w-6 h-6" />,
  dropbox: <Cloud className="w-6 h-6" />,
  exa: <Search className="w-6 h-6" />,
  twilio: <Phone className="w-6 h-6" />,
  vercel: <Cloud className="w-6 h-6" />,
  railway: <Database className="w-6 h-6" />,
  discord: <MessageSquare className="w-6 h-6" />,
};

const PROVIDER_COLORS: Record<string, string> = {
  google: 'from-blue-500 to-green-500',
  gmail: 'from-red-500 to-red-600',
  googledocs: 'from-blue-400 to-blue-600',
  googlesheets: 'from-green-400 to-green-600',
  googlecalendar: 'from-blue-500 to-purple-500',
  googledrive: 'from-yellow-500 to-green-500',
  github: 'from-gray-600 to-gray-800',
  twitter: 'from-blue-400 to-blue-600',
  slack: 'from-purple-500 to-pink-500',
  spotify: 'from-green-400 to-green-600',
  notion: 'from-gray-600 to-gray-800',
  dropbox: 'from-blue-500 to-blue-700',
  exa: 'from-orange-500 to-red-500',
  twilio: 'from-red-500 to-red-600',
  vercel: 'from-black to-gray-800',
  railway: 'from-purple-500 to-pink-500',
  discord: 'from-indigo-500 to-purple-500',
};

const PROVIDER_NAMES: Record<string, string> = {
  google: 'Google',
  gmail: 'Gmail',
  googledocs: 'Google Docs',
  googlesheets: 'Google Sheets',
  googlecalendar: 'Google Calendar',
  googledrive: 'Google Drive',
  github: 'GitHub',
  twitter: 'X (Twitter)',
  slack: 'Slack',
  spotify: 'Spotify',
  notion: 'Notion',
  dropbox: 'Dropbox',
  exa: 'Exa Search',
  twilio: 'Twilio',
  vercel: 'Vercel',
  railway: 'Railway',
  discord: 'Discord',
};

export default function IntegrationAuthPrompt({
  toolName,
  provider,
  authUrl,
  onDismiss,
  onAuthorized,
  message,
}: IntegrationAuthPromptProps) {
  const [isConnecting, setIsConnecting] = useState(false);
  const [popupWindow, setPopupWindow] = useState<Window | null>(null);

  const providerName = PROVIDER_NAMES[provider] || provider;
  const providerIcon = PROVIDER_ICONS[provider] || <ExternalLink className="w-6 h-6" />;
  const gradientColor = PROVIDER_COLORS[provider] || 'from-purple-500 to-blue-500';

  useEffect(() => {
    // Listen for OAuth success/cancel messages from the popup
    const handleMessage = (event: MessageEvent) => {
      // Validate message origin for security
      if (event.origin !== window.location.origin) return;

      if (event.data?.type === 'oauth_success') {
        setPopupWindow(null);
        setIsConnecting(false);
        onAuthorized?.();
      } else if (event.data?.type === 'oauth_cancel') {
        setPopupWindow(null);
        setIsConnecting(false);
        // Don't call onAuthorized - user cancelled
      }
    };

    window.addEventListener('message', handleMessage);

    // Fallback: detect if popup was closed without completing OAuth
    // Only poll if a popup is actually open
    let interval: number | undefined;
    if (popupWindow) {
      interval = setInterval(() => {
        if (popupWindow.closed) {
          setPopupWindow(null);
          setIsConnecting(false);
          // Popup closed without sending success message - treat as cancel
          // Don't call onAuthorized to allow retry
        }
      }, 500);
    }

    return () => {
      if (interval !== undefined) {
        clearInterval(interval);
      }
      window.removeEventListener('message', handleMessage);
    };
  }, [popupWindow, onAuthorized]);

  const handleConnect = useCallback(() => {
    setIsConnecting(true);

    const width = 600;
    const height = 700;
    const left = window.screenX + (window.outerWidth - width) / 2;
    const top = window.screenY + (window.outerHeight - height) / 2;

    // Add origin parameter for postMessage security
    const urlWithOrigin = `${authUrl}${authUrl.includes('?') ? '&' : '?'}origin=${encodeURIComponent(window.location.origin)}`;

    const popup = window.open(
      urlWithOrigin,
      'oauth_popup',
      `width=${width},height=${height},left=${left},top=${top},toolbar=no,menubar=no,scrollbars=yes,resizable=yes`
    );

    if (popup) {
      setPopupWindow(popup);
    } else {
      // Fallback: open in new tab
      window.open(authUrl, '_blank');
      setIsConnecting(false);
    }
  }, [authUrl]);

  const getToolDescription = () => {
    const toolDescriptions: Record<string, string> = {
      'gmail.send': 'send emails via Gmail',
      'gmail.read': 'read your Gmail messages',
      'googlecalendar.create': 'create calendar events',
      'github.create_issue': 'create GitHub issues',
      'twitter.post': 'post to X (Twitter)',
      'slack.send_message': 'send Slack messages',
      'spotify.play': 'control Spotify playback',
    };

    return toolDescriptions[toolName] || `use ${toolName}`;
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="my-4"
    >
      <div className="relative overflow-hidden rounded-xl border border-white/10 bg-gradient-to-br from-black/80 to-black/60 backdrop-blur-sm">
        {/* Animated gradient background */}
        <div className={`absolute inset-0 bg-gradient-to-r ${gradientColor} opacity-10`} />
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAiIGhlaWdodD0iMjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGNpcmNsZSBjeD0iMSIgY3k9IjEiIHI9IjEiIGZpbGw9InJnYmEoMjU1LDI1NSwyNTUsMC4wNSkiLz48L3N2Zz4=')] opacity-20" />
        
        <div className="relative p-4">
          {/* Header */}
          <div className="flex items-start justify-between mb-3">
            <div className="flex items-center gap-3">
              <div className={`p-2.5 rounded-xl bg-gradient-to-br ${gradientColor} shadow-lg`}>
                {providerIcon}
              </div>
              <div>
                <h3 className="font-semibold text-white flex items-center gap-2">
                  Connect {providerName}
                  <Sparkles className="w-4 h-4 text-yellow-400" />
                </h3>
                <p className="text-sm text-white/60">
                  Enable AI-powered actions
                </p>
              </div>
            </div>
            <button
              onClick={onDismiss}
              className="p-1.5 rounded-lg hover:bg-white/10 transition-colors text-white/40 hover:text-white/80"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Description */}
          <div className="mb-4">
            <p className="text-sm text-white/80 leading-relaxed">
              {message || (
                <>To <span className="text-white font-medium">{getToolDescription()}</span>, I need permission to access your <span className="text-white font-medium">{providerName}</span> account.</>
              )}
            </p>
            <div className="flex items-center gap-2 mt-2 text-xs text-white/50">
              <CheckCircle className="w-3 h-3 text-green-400" />
              <span>Secure OAuth connection</span>
              <span className="mx-1">•</span>
              <CheckCircle className="w-3 h-3 text-green-400" />
              <span>You control permissions</span>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3">
            <Button
              onClick={handleConnect}
              disabled={isConnecting}
              className={`flex-1 bg-gradient-to-r ${gradientColor} hover:opacity-90 text-white border-0 shadow-lg transition-all duration-200`}
            >
              {isConnecting ? (
                <>
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                    className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full mr-2"
                  />
                  Connecting...
                </>
              ) : (
                <>
                  <ExternalLink className="w-4 h-4 mr-2" />
                  Connect {providerName}
                </>
              )}
            </Button>
            <Button
              variant="ghost"
              onClick={onDismiss}
              disabled={isConnecting}
              className="text-white/60 hover:text-white hover:bg-white/10"
            >
              Maybe Later
            </Button>
          </div>

          {/* Privacy note */}
          <div className="mt-3 pt-3 border-t border-white/10 flex items-start gap-2">
            <AlertCircle className="w-3 h-3 text-white/40 mt-0.5 flex-shrink-0" />
            <p className="text-[10px] text-white/40">
              Your data stays secure. We never store your passwords. You can revoke access anytime from Settings.
            </p>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
