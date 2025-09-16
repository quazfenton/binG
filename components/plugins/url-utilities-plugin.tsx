"use client"

import React, { useState, useCallback } from 'react';
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
}

export const UrlUtilitiesPlugin: React.FC<PluginProps> = ({ 
  onClose, 
  onResult, 
  initialData 
}) => {
  const [mode, setMode] = useState<'validate' | 'shorten' | 'bulk'>('validate');
  const [input, setInput] = useState(initialData?.url || '');
  const [bulkInput, setBulkInput] = useState('');
  const [analysis, setAnalysis] = useState<UrlAnalysis | null>(null);
  const [shortenedUrls, setShortenedUrls] = useState<ShortenedUrl[]>([]);
  const [bulkResults, setBulkResults] = useState<UrlAnalysis[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [copied, setCopied] = useState<string>('');

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

  const handleShorten = async () => {
    setIsProcessing(true);
    try {
      const validation = await validateUrl(input);
      if (!validation.valid) {
        setAnalysis(validation);
        return;
      }

      // Simulate URL shortening (in real implementation, this would call an API)
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      const shortened: ShortenedUrl = {
        original: input,
        shortened: `https://short.ly/${Math.random().toString(36).substr(2, 8)}`,
        clicks: 0,
        created: new Date().toISOString()
      };

      setShortenedUrls(prev => [shortened, ...prev.slice(0, 9)]); // Keep last 10
      setAnalysis({ valid: true, url: validation.url });
      onResult?.(shortened);
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
                        <div className="flex justify-between text-xs text-white/40">
                          <span>{item.clicks} clicks</span>
                          <span>{new Date(item.created).toLocaleDateString()}</span>
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
      </div>
    </div>
  );
};

export default UrlUtilitiesPlugin;