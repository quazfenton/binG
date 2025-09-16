"use client"

import React, { useState, useCallback } from 'react';
import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';
import { Alert, AlertDescription } from '../ui/alert';
import { Badge } from '../ui/badge';
import { 
  FileJson, 
  CheckCircle, 
  XCircle, 
  Copy, 
  Check, 
  Download,
  Loader2,
  AlertTriangle,
  Info
} from 'lucide-react';
import type { PluginProps } from './plugin-manager';

interface ValidationResult {
  valid: boolean;
  error?: string;
  line?: number;
  column?: number;
  formatted?: string;
  stats?: {
    size: number;
    keys: number;
    depth: number;
    arrays: number;
    objects: number;
  };
}

export const JsonValidatorPlugin: React.FC<PluginProps> = ({ 
  onClose, 
  onResult, 
  initialData 
}) => {
  const [input, setInput] = useState(initialData?.json || '');
  const [result, setResult] = useState<ValidationResult | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [mode, setMode] = useState<'validate' | 'format' | 'minify'>('validate');

  const validateJson = useCallback(async () => {
    if (!input.trim()) {
      setResult({ valid: false, error: 'Input is empty' });
      return;
    }

    setIsValidating(true);
    
    try {
      // Simulate processing time for large JSON
      if (input.length > 10000) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      const parsed = JSON.parse(input);
      const stats = calculateStats(parsed);
      
      let formatted = '';
      if (mode === 'format') {
        formatted = JSON.stringify(parsed, null, 2);
      } else if (mode === 'minify') {
        formatted = JSON.stringify(parsed);
      }

      const validationResult: ValidationResult = {
        valid: true,
        formatted: formatted || undefined,
        stats
      };

      setResult(validationResult);
      onResult?.(validationResult);
      
    } catch (error) {
      let errorMessage = 'Invalid JSON';
      let line: number | undefined;
      let column: number | undefined;

      if (error instanceof SyntaxError) {
        errorMessage = error.message;
        
        // Try to extract line and column information
        const match = error.message.match(/at position (\d+)/);
        if (match) {
          const position = parseInt(match[1]);
          const lines = input.substring(0, position).split('\n');
          line = lines.length;
          column = lines[lines.length - 1].length + 1;
        }
      }

      const validationResult: ValidationResult = {
        valid: false,
        error: errorMessage,
        line,
        column
      };

      setResult(validationResult);
      onResult?.(validationResult);
    } finally {
      setIsValidating(false);
    }
  }, [input, mode, onResult]);

  const calculateStats = (obj: any): ValidationResult['stats'] => {
    let keys = 0;
    let depth = 0;
    let arrays = 0;
    let objects = 0;

    const traverse = (value: any, currentDepth: number) => {
      depth = Math.max(depth, currentDepth);
      
      if (Array.isArray(value)) {
        arrays++;
        value.forEach(item => traverse(item, currentDepth + 1));
      } else if (value && typeof value === 'object') {
        objects++;
        Object.keys(value).forEach(key => {
          keys++;
          traverse(value[key], currentDepth + 1);
        });
      }
    };

    traverse(obj, 1);

    return {
      size: JSON.stringify(obj).length,
      keys,
      depth,
      arrays,
      objects
    };
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy:', error);
      // Fallback method
      const textArea = document.createElement('textarea');
      textArea.value = text;
      document.body.appendChild(textArea);
      textArea.select();
      try {
        document.execCommand('copy');
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch (fallbackError) {
        throw new Error('Copy to clipboard failed');
      } finally {
        document.body.removeChild(textArea);
      }
    }
  };

  const downloadJson = (content: string, filename: string) => {
    try {
      const blob = new Blob([content], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Download failed:', error);
      throw new Error('Download failed');
    }
  };

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <div className="h-full flex flex-col p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileJson className="w-5 h-5 text-green-400" />
          <h3 className="text-lg font-semibold text-white">JSON Validator</h3>
        </div>
        
        <div className="flex items-center gap-2">
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as any)}
            className="bg-black/40 border border-white/20 rounded px-2 py-1 text-sm text-white"
          >
            <option value="validate">Validate</option>
            <option value="format">Format</option>
            <option value="minify">Minify</option>
          </select>
          
          <Button
            onClick={validateJson}
            disabled={!input.trim() || isValidating}
            className="bg-green-600 hover:bg-green-700"
          >
            {isValidating ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Processing...
              </>
            ) : (
              <>
                <CheckCircle className="w-4 h-4 mr-2" />
                {mode === 'validate' ? 'Validate' : mode === 'format' ? 'Format' : 'Minify'}
              </>
            )}
          </Button>
        </div>
      </div>

      <div className="flex-1 space-y-4">
        {/* Input */}
        <div>
          <label className="block text-sm font-medium text-white/80 mb-2">
            JSON Input
          </label>
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Paste your JSON here..."
            className="min-h-[200px] bg-black/40 border-white/20 text-white resize-none font-mono text-sm"
          />
        </div>

        {/* Results */}
        {result && (
          <div className="space-y-4">
            {/* Status */}
            <div className="flex items-center gap-2">
              {result.valid ? (
                <>
                  <CheckCircle className="w-5 h-5 text-green-400" />
                  <span className="text-green-400 font-medium">Valid JSON</span>
                </>
              ) : (
                <>
                  <XCircle className="w-5 h-5 text-red-400" />
                  <span className="text-red-400 font-medium">Invalid JSON</span>
                </>
              )}
            </div>

            {/* Error Details */}
            {!result.valid && result.error && (
              <Alert className="border-red-500/50 bg-red-500/10">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  <div className="space-y-1">
                    <div>{result.error}</div>
                    {result.line && result.column && (
                      <div className="text-sm text-red-300">
                        Line {result.line}, Column {result.column}
                      </div>
                    )}
                  </div>
                </AlertDescription>
              </Alert>
            )}

            {/* Statistics */}
            {result.valid && result.stats && (
              <div className="p-3 bg-black/20 rounded-lg border border-white/10">
                <div className="flex items-center gap-2 mb-2">
                  <Info className="w-4 h-4 text-blue-400" />
                  <span className="text-sm font-medium text-white/80">Statistics</span>
                </div>
                
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
                  <div>
                    <div className="text-white/60">Size</div>
                    <div className="font-semibold">{formatBytes(result.stats.size)}</div>
                  </div>
                  <div>
                    <div className="text-white/60">Keys</div>
                    <div className="font-semibold">{result.stats.keys}</div>
                  </div>
                  <div>
                    <div className="text-white/60">Depth</div>
                    <div className="font-semibold">{result.stats.depth}</div>
                  </div>
                  <div>
                    <div className="text-white/60">Objects</div>
                    <div className="font-semibold">{result.stats.objects}</div>
                  </div>
                  <div>
                    <div className="text-white/60">Arrays</div>
                    <div className="font-semibold">{result.stats.arrays}</div>
                  </div>
                </div>
              </div>
            )}

            {/* Formatted Output */}
            {result.formatted && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-sm font-medium text-white/80">
                    {mode === 'format' ? 'Formatted JSON' : 'Minified JSON'}
                  </label>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => copyToClipboard(result.formatted!)}
                      className="text-white/60 hover:text-white"
                    >
                      {copied ? (
                        <>
                          <Check className="w-4 h-4 mr-1" />
                          Copied!
                        </>
                      ) : (
                        <>
                          <Copy className="w-4 h-4 mr-1" />
                          Copy
                        </>
                      )}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => downloadJson(
                        result.formatted!, 
                        `${mode === 'format' ? 'formatted' : 'minified'}.json`
                      )}
                      className="text-white/60 hover:text-white"
                    >
                      <Download className="w-4 h-4 mr-1" />
                      Download
                    </Button>
                  </div>
                </div>
                <Textarea
                  value={result.formatted}
                  readOnly
                  className="min-h-[200px] bg-black/40 border-white/20 text-white resize-none font-mono text-sm"
                />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default JsonValidatorPlugin;