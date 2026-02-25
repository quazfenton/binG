"use client"

import React, { useState, useCallback } from 'react';
import { secureRandomString } from '@/lib/utils';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { Alert, AlertDescription } from '../ui/alert';
import { Badge } from '../ui/badge';
import { 
  Link, 
  CheckCircle, 
  XCircle, 
  Copy, 
  Check, 
  ExternalLink,
  Loader2,
  AlertTriangle,
  Info,
  Globe,
  Lock,
  Unlock
} from 'lucide-react';
import type { PluginProps } from './plugin-manager';

interface UrlAnalysis {
  valid: boolean;
  url?: URL;
  protocol?: string;
  hostname?: string;
  port?: string;
  pathname?: string;
  search?: string;
  hash?: string;
  isSecure?: boolean;
  error?: string;
}

interface ShortenedUrl {
  original: string;
  shortened: string;
  clicks: number;
  created: string;
  reachable?: boolean | null;
}

const SHORTENED_URLS_KEY = 'url-utilities-shortened';

const loadShortenedUrls = (): ShortenedUrl[] => {
  try {
    const stored = localStorage.getItem(SHORTENED_URLS_KEY);
    if (stored) return JSON.parse(stored);
  } catch {}
  return [];
};

export const UrlUtilitiesPlugin: React.FC<PluginProps> = ({ 
  onClose, 
  onResult, 
  initialData 
}) => {
  const [mode, setMode] = useState<'validate' | 'shorten' | 'bulk' | 'encode' | 'qrcode'>('validate');
  const [input, setInput] = useState(initialData?.url || '');
  const [bulkInput, setBulkInput] = useState('');
  const [analysis, setAnalysis] = useState<UrlAnalysis | null>(null);
  const [shortenedUrls, setShortenedUrls] = useState<ShortenedUrl[]>(loadShortenedUrls);
  const [bulkResults, setBulkResults] = useState<UrlAnalysis[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [copied, setCopied] = useState<string>('');
  const [encodeInput, setEncodeInput] = useState('');
  const [encodeResult, setEncodeResult] = useState('');
  const [encodeDirection, setEncodeDirection] = useState<'encode' | 'decode'>('encode');
  const [qrUrl, setQrUrl] = useState('');

  const validateUrl = useCallback(async (url: string): Promise<UrlAnalysis> => {
    if (!url.trim()) {
      return { valid: false, error: 'URL is empty' };
    }

    try {
      const urlObj = new URL(url);
      
      return {
        valid: true,
        url: urlObj,
        protocol: urlObj.protocol,
        hostname: urlObj.hostname,
        port: urlObj.port || (urlObj.protocol === 'https:' ? '443' : '80'),
        pathname: urlObj.pathname,
        search: urlObj.search,
        hash: urlObj.hash,
        isSecure: urlObj.protocol === 'https:'
      };
    } catch (error) {
      return {
        valid: false,
        error: error instanceof Error ? error.message : 'Invalid URL format'
      };
    }
  }, []);

  const handleValidate = async () => {
    setIsProcessing(true);
    try {
      const result = await validateUrl(input);
      setAnalysis(result);
      onResult?.(result);
    } catch (error) {
      console.error('Validation error:', error);
    } finally {
      setIsProcessing(false);
    }
  };

  const persistShortenedUrls = useCallback((urls: ShortenedUrl[]) => {
    setShortenedUrls(urls);
    try {
      localStorage.setItem(SHORTENED_URLS_KEY, JSON.stringify(urls));
    } catch {}
  }, []);

  const handleShorten = async () => {
    setIsProcessing(true);
    try {
      const validation = await validateUrl(input);
      if (!validation.valid) {
        setAnalysis(validation);
        return;
      }

      let shortened: ShortenedUrl | null = null;
      try {
        const res = await fetch('/api/url/shorten', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: input }),
        });
        if (res.ok) {
          const body = await res.json();
          shortened = {
            original: body.original,
            shortened: body.shortened,
            clicks: body.clicks || 0,
            created: body.created || new Date().toISOString(),
            reachable: null,
          };
        }
      } catch {
        // fallback below
      }

      if (!shortened) {
        shortened = {
          original: input,
          shortened: input,
          clicks: 0,
          created: new Date().toISOString(),
          reachable: null
        };
      }

      const newUrls = [shortened, ...shortenedUrls.slice(0, 9)];
      persistShortenedUrls(newUrls);
      setAnalysis({ valid: true, url: validation.url });
      onResult?.(shortened);

      // Non-blocking reachability check via HEAD request
      fetch(input, { method: 'HEAD', mode: 'no-cors' })
        .then(() => {
          setShortenedUrls(prev => {
            const updated = prev.map(u => u.shortened === shortened.shortened ? { ...u, reachable: true } : u);
            try { localStorage.setItem(SHORTENED_URLS_KEY, JSON.stringify(updated)); } catch {}
            return updated;
          });
        })
        .catch(() => {
          setShortenedUrls(prev => {
            const updated = prev.map(u => u.shortened === shortened.shortened ? { ...u, reachable: false } : u);
            try { localStorage.setItem(SHORTENED_URLS_KEY, JSON.stringify(updated)); } catch {}
            return updated;
          });
        });
    } catch (error) {
      console.error('Shortening error:', error);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleBulkValidate = async () => {
    if (!bulkInput.trim()) return;

    setIsProcessing(true);
    try {
      const urls = bulkInput.split('\n').filter(url => url.trim());
      const results: UrlAnalysis[] = [];

      for (const url of urls) {
        const result = await validateUrl(url.trim());
        results.push(result);
        // Small delay to prevent overwhelming
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      setBulkResults(results);
      onResult?.(results);
    } catch (error) {
      console.error('Bulk validation error:', error);
    } finally {
      setIsProcessing(false);
    }
  };

  const copyToClipboard = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
      setTimeout(() => setCopied(''), 2000);
    } catch (error) {
      console.error('Failed to copy:', error);
      // Fallback method
      const textArea = document.createElement('textarea');
      textArea.value = text;
      document.body.appendChild(textArea);
      textArea.select();
      try {
        document.execCommand('copy');
        setCopied(id);
        setTimeout(() => setCopied(''), 2000);
      } catch (fallbackError) {
        throw new Error('Copy to clipboard failed');
      } finally {
        document.body.removeChild(textArea);
      }
    }
  };

  const openUrl = (url: string) => {
    try {
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (error) {
      console.error('Failed to open URL:', error);
    }
  };

  return (
    <div className="h-full flex flex-col p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Link className="w-5 h-5 text-blue-400" />
          <h3 className="text-lg font-semibold text-white">URL Utilities</h3>
        </div>
        
        <div className="flex items-center gap-2">
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as any)}
            className="bg-black/40 border border-white/20 rounded px-2 py-1 text-sm text-white"
          >
            <option value="validate">Validate</option>
            <option value="shorten">Shorten</option>
            <option value="bulk">Bulk Validate</option>
            <option value="encode">Encode/Decode</option>
            <option value="qrcode">QR Code</option>
          </select>
        </div>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto">
        {/* Single URL Mode */}
        {(mode === 'validate' || mode === 'shorten') && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-white/80 mb-2">
                URL
              </label>
              <div className="flex gap-2">
                <Input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="https://example.com"
                  className="bg-black/40 border-white/20 text-white"
                />
                <Button
                  onClick={mode === 'validate' ? handleValidate : handleShorten}
                  disabled={!input.trim() || isProcessing}
                  className={mode === 'validate' ? 'bg-blue-600 hover:bg-blue-700' : 'bg-green-600 hover:bg-green-700'}
                >
                  {isProcessing ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : mode === 'validate' ? (
                    <>
                      <CheckCircle className="w-4 h-4 mr-2" />
                      Validate
                    </>
                  ) : (
                    <>
                      <Link className="w-4 h-4 mr-2" />
                      Shorten
                    </>
                  )}
                </Button>
              </div>
            </div>

            {/* Analysis Results */}
            {analysis && (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  {analysis.valid ? (
                    <>
                      <CheckCircle className="w-5 h-5 text-green-400" />
                      <span className="text-green-400 font-medium">Valid URL</span>
                    </>
                  ) : (
                    <>
                      <XCircle className="w-5 h-5 text-red-400" />
                      <span className="text-red-400 font-medium">Invalid URL</span>
                    </>
                  )}
                </div>

                {!analysis.valid && analysis.error && (
                  <Alert className="border-red-500/50 bg-red-500/10">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertDescription>{analysis.error}</AlertDescription>
                  </Alert>
                )}

                {analysis.valid && analysis.url && (
                  <div className="p-3 bg-black/20 rounded-lg border border-white/10 space-y-3">
                    <div className="flex items-center gap-2">
                      <Info className="w-4 h-4 text-blue-400" />
                      <span className="text-sm font-medium text-white/80">URL Details</span>
                      <div className="flex items-center gap-1">
                        {analysis.isSecure ? (
                          <Lock className="w-3 h-3 text-green-400" />
                        ) : (
                          <Unlock className="w-3 h-3 text-yellow-400" />
                        )}
                        <Badge className={`text-xs ${
                          analysis.isSecure 
                            ? 'bg-green-500/20 text-green-300 border-green-500/30'
                            : 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30'
                        }`}>
                          {analysis.isSecure ? 'Secure' : 'Not Secure'}
                        </Badge>
                      </div>
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                      <div>
                        <div className="text-white/60">Protocol</div>
                        <div className="font-mono">{analysis.protocol}</div>
                      </div>
                      <div>
                        <div className="text-white/60">Hostname</div>
                        <div className="font-mono">{analysis.hostname}</div>
                      </div>
                      <div>
                        <div className="text-white/60">Port</div>
                        <div className="font-mono">{analysis.port}</div>
                      </div>
                      <div>
                        <div className="text-white/60">Path</div>
                        <div className="font-mono">{analysis.pathname || '/'}</div>
                      </div>
                      {analysis.search && (
                        <div className="md:col-span-2">
                          <div className="text-white/60">Query</div>
                          <div className="font-mono text-xs break-all">{analysis.search}</div>
                        </div>
                      )}
                      {analysis.hash && (
                        <div className="md:col-span-2">
                          <div className="text-white/60">Fragment</div>
                          <div className="font-mono text-xs">{analysis.hash}</div>
                        </div>
                      )}
                    </div>

                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => copyToClipboard(input, 'original')}
                        className="text-white/60 hover:text-white"
                      >
                        {copied === 'original' ? (
                          <>
                            <Check className="w-3 h-3 mr-1" />
                            Copied!
                          </>
                        ) : (
                          <>
                            <Copy className="w-3 h-3 mr-1" />
                            Copy URL
                          </>
                        )}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => openUrl(input)}
                        className="text-white/60 hover:text-white"
                      >
                        <ExternalLink className="w-3 h-3 mr-1" />
                        Open
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Shortened URLs History */}
            {mode === 'shorten' && shortenedUrls.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-sm font-medium text-white/80">Recent Shortened URLs</h4>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {shortenedUrls.map((item, index) => (
                    <div key={index} className="p-3 bg-black/20 rounded border border-white/10">
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="font-mono text-sm text-blue-300">{item.shortened}</div>
                          <div className="flex gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => copyToClipboard(item.shortened, `short-${index}`)}
                              className="text-white/60 hover:text-white px-2 py-1 h-6"
                            >
                              {copied === `short-${index}` ? (
                                <Check className="w-3 h-3" />
                              ) : (
                                <Copy className="w-3 h-3" />
                              )}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => openUrl(item.shortened)}
                              className="text-white/60 hover:text-white px-2 py-1 h-6"
                            >
                              <ExternalLink className="w-3 h-3" />
                            </Button>
                          </div>
                        </div>
                        <div className="text-xs text-white/60 truncate">{item.original}</div>
                        <div className="flex justify-between items-center text-xs text-white/40">
                          <span>{item.clicks} clicks</span>
                          <div className="flex items-center gap-2">
                            {item.reachable === true && (
                              <Badge className="text-xs bg-green-500/20 text-green-300 border-green-500/30">Reachable</Badge>
                            )}
                            {item.reachable === false && (
                              <Badge className="text-xs bg-red-500/20 text-red-300 border-red-500/30">Unreachable</Badge>
                            )}
                            {item.reachable === null && (
                              <Badge className="text-xs bg-gray-500/20 text-gray-300 border-gray-500/30">Checking…</Badge>
                            )}
                            <span>{new Date(item.created).toLocaleDateString()}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Bulk Validation Mode */}
        {mode === 'bulk' && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-white/80 mb-2">
                URLs (one per line)
              </label>
              <Textarea
                value={bulkInput}
                onChange={(e) => setBulkInput(e.target.value)}
                placeholder="https://example1.com&#10;https://example2.com&#10;https://example3.com"
                className="min-h-[120px] bg-black/40 border-white/20 text-white resize-none font-mono text-sm"
              />
              <Button
                onClick={handleBulkValidate}
                disabled={!bulkInput.trim() || isProcessing}
                className="mt-2 bg-blue-600 hover:bg-blue-700"
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Validating...
                  </>
                ) : (
                  <>
                    <CheckCircle className="w-4 h-4 mr-2" />
                    Validate All
                  </>
                )}
              </Button>
            </div>

            {/* Bulk Results */}
            {bulkResults.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-medium text-white/80">Validation Results</h4>
                  <div className="flex gap-2 text-xs">
                    <Badge className="bg-green-500/20 text-green-300 border-green-500/30">
                      {bulkResults.filter(r => r.valid).length} valid
                    </Badge>
                    <Badge className="bg-red-500/20 text-red-300 border-red-500/30">
                      {bulkResults.filter(r => !r.valid).length} invalid
                    </Badge>
                  </div>
                </div>
                
                <div className="space-y-1 max-h-64 overflow-y-auto">
                  {bulkResults.map((result, index) => (
                    <div key={index} className="p-2 bg-black/20 rounded border border-white/10">
                      <div className="flex items-center gap-2">
                        {result.valid ? (
                          <CheckCircle className="w-4 h-4 text-green-400 flex-shrink-0" />
                        ) : (
                          <XCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="font-mono text-sm truncate">
                            {result.url?.href || bulkInput.split('\n')[index]}
                          </div>
                          {!result.valid && result.error && (
                            <div className="text-xs text-red-300">{result.error}</div>
                          )}
                          {result.valid && result.hostname && (
                            <div className="text-xs text-white/60">
                              {result.hostname} • {result.isSecure ? 'Secure' : 'Not Secure'}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* URL Encode/Decode Mode */}
        {mode === 'encode' && (
          <div className="space-y-4">
            <div className="flex gap-2 mb-2">
              <Button
                size="sm"
                variant={encodeDirection === 'encode' ? 'default' : 'outline'}
                onClick={() => setEncodeDirection('encode')}
                className={encodeDirection === 'encode' ? 'bg-blue-600' : ''}
              >
                Encode
              </Button>
              <Button
                size="sm"
                variant={encodeDirection === 'decode' ? 'default' : 'outline'}
                onClick={() => setEncodeDirection('decode')}
                className={encodeDirection === 'decode' ? 'bg-blue-600' : ''}
              >
                Decode
              </Button>
            </div>
            <div>
              <label className="block text-sm font-medium text-white/80 mb-2">
                {encodeDirection === 'encode' ? 'Text to encode' : 'Encoded URL to decode'}
              </label>
              <Input
                value={encodeInput}
                onChange={(e) => setEncodeInput(e.target.value)}
                placeholder={encodeDirection === 'encode' ? 'hello world & foo=bar' : 'hello%20world%20%26%20foo%3Dbar'}
                className="bg-black/40 border-white/20 text-white"
              />
            </div>
            <Button
              onClick={() => {
                try {
                  setEncodeResult(
                    encodeDirection === 'encode'
                      ? encodeURIComponent(encodeInput)
                      : decodeURIComponent(encodeInput)
                  );
                } catch {
                  setEncodeResult('Error: Invalid input for decoding');
                }
              }}
              disabled={!encodeInput.trim()}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {encodeDirection === 'encode' ? 'Encode' : 'Decode'}
            </Button>
            {encodeResult && (
              <div className="p-3 bg-black/20 rounded-lg border border-white/10 space-y-2">
                <div className="text-sm font-medium text-white/80">Result</div>
                <div className="font-mono text-sm break-all text-green-300">{encodeResult}</div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => copyToClipboard(encodeResult, 'encode-result')}
                  className="text-white/60 hover:text-white"
                >
                  {copied === 'encode-result' ? (
                    <>
                      <Check className="w-3 h-3 mr-1" />
                      Copied!
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3 mr-1" />
                      Copy
                    </>
                  )}
                </Button>
              </div>
            )}
          </div>
        )}

        {/* QR Code Mode */}
        {mode === 'qrcode' && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-white/80 mb-2">
                URL for QR Code
              </label>
              <div className="flex gap-2">
                <Input
                  value={qrUrl}
                  onChange={(e) => setQrUrl(e.target.value)}
                  placeholder="https://example.com"
                  className="bg-black/40 border-white/20 text-white"
                />
                <Button
                  onClick={() => {}}
                  disabled={!qrUrl.trim()}
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  Generate
                </Button>
              </div>
            </div>
            {qrUrl.trim() && (
              <div className="p-4 bg-white rounded-lg flex flex-col items-center gap-3">
                <img
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(qrUrl)}`}
                  alt={`QR code for ${qrUrl}`}
                  className="w-[200px] h-[200px]"
                />
                <div className="text-xs text-gray-600 text-center break-all max-w-[200px]">{qrUrl}</div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default UrlUtilitiesPlugin;
