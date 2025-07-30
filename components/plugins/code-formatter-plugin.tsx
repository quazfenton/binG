"use client"

import React, { useState } from 'react';
import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Code, Copy, Check, Download, Loader2 } from 'lucide-react';
import type { PluginProps } from './plugin-manager';

const LANGUAGES = [
  { value: 'javascript', label: 'JavaScript' },
  { value: 'typescript', label: 'TypeScript' },
  { value: 'python', label: 'Python' },
  { value: 'java', label: 'Java' },
  { value: 'cpp', label: 'C++' },
  { value: 'html', label: 'HTML' },
  { value: 'css', label: 'CSS' },
  { value: 'json', label: 'JSON' },
  { value: 'xml', label: 'XML' },
  { value: 'sql', label: 'SQL' }
];

export const CodeFormatterPlugin: React.FC<PluginProps> = ({ 
  onClose, 
  onResult, 
  initialData 
}) => {
  const [code, setCode] = useState(initialData?.code || '');
  const [language, setLanguage] = useState(initialData?.language || 'javascript');
  const [formatted, setFormatted] = useState('');
  const [isFormatting, setIsFormatting] = useState(false);
  const [copied, setCopied] = useState(false);

  const formatCode = async () => {
    if (!code.trim()) return;
    
    setIsFormatting(true);
    try {
      // Simulate code formatting
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Basic formatting simulation
      let formattedCode = code;
      
      if (language === 'javascript' || language === 'typescript') {
        formattedCode = code
          .replace(/;/g, ';\n')
          .replace(/{/g, ' {\n  ')
          .replace(/}/g, '\n}')
          .replace(/,/g, ',\n  ')
          .split('\n')
          .map(line => line.trim())
          .filter(line => line.length > 0)
          .join('\n');
      } else if (language === 'json') {
        try {
          const parsed = JSON.parse(code);
          formattedCode = JSON.stringify(parsed, null, 2);
        } catch {
          formattedCode = code;
        }
      }
      
      setFormatted(formattedCode);
      onResult?.({ code: formattedCode, language });
    } catch (error) {
      console.error('Formatting failed:', error);
    } finally {
      setIsFormatting(false);
    }
  };

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(formatted);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy:', error);
    }
  };

  const downloadCode = () => {
    const blob = new Blob([formatted], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `formatted-code.${language === 'javascript' ? 'js' : language}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="h-full flex flex-col p-4 space-y-4">
      <div className="flex items-center gap-2">
        <Code className="w-5 h-5 text-blue-400" />
        <h3 className="text-lg font-semibold text-white">Code Formatter</h3>
      </div>

      <div className="flex-1 space-y-4">
        <div className="flex gap-2">
          <Select value={language} onValueChange={setLanguage}>
            <SelectTrigger className="w-48 bg-black/40 border-white/20">
              <SelectValue placeholder="Select language" />
            </SelectTrigger>
            <SelectContent>
              {LANGUAGES.map(lang => (
                <SelectItem key={lang.value} value={lang.value}>
                  {lang.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          
          <Button
            onClick={formatCode}
            disabled={!code.trim() || isFormatting}
            className="bg-blue-600 hover:bg-blue-700"
          >
            {isFormatting ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Formatting...
              </>
            ) : (
              <>
                <Code className="w-4 h-4 mr-2" />
                Format
              </>
            )}
          </Button>
        </div>

        <div>
          <label className="block text-sm font-medium text-white/80 mb-2">
            Input Code
          </label>
          <Textarea
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Paste your code here..."
            className="min-h-[150px] bg-black/40 border-white/20 text-white resize-none font-mono text-sm"
          />
        </div>

        {formatted && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium text-white/80">
                Formatted Code
              </label>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={copyToClipboard}
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
                  onClick={downloadCode}
                  className="text-white/60 hover:text-white"
                >
                  <Download className="w-4 h-4 mr-1" />
                  Download
                </Button>
              </div>
            </div>
            <Textarea
              value={formatted}
              readOnly
              className="min-h-[200px] bg-black/40 border-white/20 text-white resize-none font-mono text-sm"
            />
          </div>
        )}
      </div>
    </div>
  );
};

export default CodeFormatterPlugin;