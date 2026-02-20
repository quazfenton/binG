'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

interface ToolAuthPromptProps {
  authUrl: string;
  toolName: string;
  provider: string;
  onDismiss: () => void;
  onAuthorized?: () => void;
}

const PROVIDER_LABELS: Record<string, string> = {
  google: 'Google',
  github: 'GitHub',
  spotify: 'Spotify',
  slack: 'Slack',
  notion: 'Notion',
  discord: 'Discord',
  twitter: 'X (Twitter)',
  dropbox: 'Dropbox',
  microsoft: 'Microsoft',
  twilio: 'Twilio',
  reddit: 'Reddit',
  vercel: 'Vercel',
  railway: 'Railway',
  exa: 'Exa',
};

export default function ToolAuthPrompt({
  authUrl,
  toolName,
  provider,
  onDismiss,
  onAuthorized,
}: ToolAuthPromptProps) {
  const [popupOpen, setPopupOpen] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isProviderConnected = useCallback(async () => {
    try {
      const token = (() => {
        try {
          return localStorage.getItem('token');
        } catch {
          return null;
        }
      })();
      const response = await fetch('/api/tools/execute', {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (!response.ok) return false;
      const data = await response.json();
      const connected: string[] = Array.isArray(data?.connectedProviders) ? data.connectedProviders : [];
      const expected = provider.toLowerCase();
      const aliases = new Set<string>([expected]);
      if (expected === 'gmail' || expected.startsWith('google')) aliases.add('google');
      return connected.some((p) => aliases.has(String(p).toLowerCase()));
    } catch {
      return false;
    }
  }, [provider]);

  // Cleanup interval on unmount
  useEffect(() => {
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, []);

  const handleConnect = useCallback(() => {
    const width = 600;
    const height = 700;
    const left = window.screenX + (window.outerWidth - width) / 2;
    const top = window.screenY + (window.outerHeight - height) / 2;

    // SECURITY: OAuth popup - DO NOT use noopener/noreferrer
    // The OAuth success page needs window.opener to send postMessage back to parent
    // Reverse-tabnabbing is not a risk here since we control the OAuth domain

    // SECURITY: Do NOT pass token in URL query string to prevent leakage via:
    // - Server/proxy access logs
    // - Browser history
    // - Referer headers sent to OAuth provider
    // The popup will authenticate via existing session cookies instead
    
    // Validate authUrl before proceeding
    if (!authUrl) {
      console.error('[ToolAuthPrompt] Missing authUrl for provider', provider);
      toast.error('Authorization URL not available. Please try again.');
      setIsConnecting(false);
      return;
    }
    
    const extraParams = new URLSearchParams({
      origin: window.location.origin,
    });
    const popupUrl = `${authUrl}${authUrl.includes('?') ? '&' : '?'}${extraParams.toString()}`;

    const popup = window.open(
      popupUrl,
      'oauth_popup',
      `width=${width},height=${height},left=${left},top=${top},toolbar=no,menubar=no,scrollbars=yes,resizable=yes`,
    );

    if (popup) {
      setPopupOpen(true);

      intervalRef.current = setInterval(() => {
        if (popup.closed) {
          clearInterval(intervalRef.current!);
          intervalRef.current = null;
          setPopupOpen(false);
          isProviderConnected()
            .then((connected) => {
              if (connected) {
                onAuthorized?.();
              }
            })
            .catch(() => {});
        }
      }, 500);
    }
  }, [authUrl, isProviderConnected, onAuthorized]);

  const label = PROVIDER_LABELS[provider] || provider;

  return (
    <div className="mx-2 my-2 rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-3">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 text-yellow-500">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
            <polyline points="10 17 15 12 10 7" />
            <line x1="15" y1="12" x2="3" y2="12" />
          </svg>
        </div>
        <div className="flex-1">
          <p className="text-sm font-medium text-yellow-200">
            Connect {label} to use {toolName.replace(/\./g, ' → ')}
          </p>
          <p className="mt-1 text-xs text-yellow-200/70">
            This action requires access to your {label} account. Your data stays secure.
          </p>
          <div className="mt-2 flex gap-2">
            <button
              onClick={handleConnect}
              disabled={popupOpen}
              className="rounded-md bg-yellow-500 px-3 py-1 text-xs font-medium text-black transition-colors hover:bg-yellow-400 disabled:opacity-50"
            >
              {popupOpen ? 'Connecting...' : `Connect ${label}`}
            </button>
            <button
              onClick={onDismiss}
              className="rounded-md px-3 py-1 text-xs text-yellow-200/70 transition-colors hover:text-yellow-200"
            >
              Dismiss
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
