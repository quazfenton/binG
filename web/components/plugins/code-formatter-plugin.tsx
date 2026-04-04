"use client"

import React, { useState } from 'react';
import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Code, Copy, Check, Download, Loader2 } from 'lucide-react';
import type { PluginProps } from './plugin-manager';
import { toast } from 'sonner';
import { clipboard } from '@bing/platform/clipboard';

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
      let formattedCode = code;
      
      if (language === 'json') {
        try {
          const parsed = JSON.parse(code);
          formattedCode = JSON.stringify(parsed, null, 2);
        } catch {
          formattedCode = code;
        }
      } else if (language === 'html' || language === 'xml') {
        // Simple tag-aware indentation formatter
        const lines: string[] = [];
        let depth = 0;
        const indent = (d: number) => '  '.repeat(d);
        // Split on tag boundaries while keeping tags and text
        const tokens = code.replace(/>\s*</g, '>\n<').split('\n');
        for (const raw of tokens) {
          const token = raw.trim();
          if (!token) continue;
          // Closing tag
          if (/^<\//.test(token)) {
            depth = Math.max(0, depth - 1);
            lines.push(indent(depth) + token);
          // Self-closing or void tag
          } else if (/\/>$/.test(token) || /^<(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)\b/i.test(token)) {
            lines.push(indent(depth) + token);
          // Opening tag
          } else if (/^<[a-zA-Z]/.test(token)) {
            lines.push(indent(depth) + token);
            depth++;
          } else {
            lines.push(indent(depth) + token);
          }
        }
        formattedCode = lines.join('\n');
      } else if (language === 'css') {
        formattedCode = code
          .replace(/\s*\{\s*/g, ' {\n')
          .replace(/\s*\}\s*/g, '\n}\n')
          .replace(/;\s*/g, ';\n')
          .split('\n')
          .map(line => line.trim())
          .filter(line => line.length > 0)
          .map(line => {
            if (line === '}') return '}';
            if (line.endsWith('{')) return line;
            if (line.startsWith('}')) return line;
            return '  ' + line;
          })
          .join('\n');
      } else if (language === 'javascript' || language === 'typescript') {
        // Try JSON first
        try {
          const parsed = JSON.parse(code);
          formattedCode = JSON.stringify(parsed, null, 2);
        } catch {
          // Basic brace-depth formatting
          const result: string[] = [];
          let depth = 0;
          const indent = (d: number) => '  '.repeat(d);
          // Normalize and split on meaningful boundaries
          const normalized = code
            .replace(/\r\n/g, '\n')
            .replace(/\{/g, '{\n')
            .replace(/\}/g, '\n}\n')
            .replace(/;/g, ';\n');
          const lines = normalized.split('\n');
          for (const raw of lines) {
            const line = raw.trim();
            if (!line) continue;
            if (line === '}' || line.startsWith('}')) {
              depth = Math.max(0, depth - 1);
              result.push(indent(depth) + line);
            } else {
              result.push(indent(depth) + line);
            }
            // Count braces to adjust depth for next line
            for (const ch of line) {
              if (ch === '{') depth++;
              else if (ch === '}') depth = Math.max(0, depth - 1);
            }
          }
          formattedCode = result.join('\n');
        }
      } else if (language === 'sql') {
        const keywords = ['SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'ORDER BY', 'GROUP BY', 'HAVING', 'INSERT', 'UPDATE', 'DELETE', 'SET', 'VALUES', 'JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'INNER JOIN', 'OUTER JOIN', 'ON', 'INTO', 'CREATE', 'ALTER', 'DROP', 'TABLE', 'INDEX', 'LIMIT', 'OFFSET', 'UNION', 'AS', 'IN', 'NOT', 'NULL', 'IS', 'LIKE', 'BETWEEN', 'EXISTS', 'DISTINCT', 'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'ASC', 'DESC'];
        // Uppercase keywords
        formattedCode = code;
        for (const kw of keywords) {
          formattedCode = formattedCode.replace(new RegExp(`\\b${kw}\\b`, 'gi'), kw);
        }
        // Add newlines before major clauses
        const majorClauses = ['SELECT', 'FROM', 'WHERE', 'ORDER BY', 'GROUP BY', 'HAVING', 'LIMIT', 'UNION', 'JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'INNER JOIN', 'OUTER JOIN', 'INSERT', 'UPDATE', 'DELETE', 'SET', 'VALUES'];
        for (const clause of majorClauses) {
          formattedCode = formattedCode.replace(new RegExp(`\\s+${clause}\\b`, 'g'), `\n${clause}`);
        }
        formattedCode = formattedCode.trim();
      } else {
        // Python, Java, C++, and other languages
        formattedCode = code;
        toast.info('Formatting for this language uses basic whitespace normalization');
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
      await clipboard.writeText(formatted);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy:', error);
      throw new Error('Copy to clipboard failed');
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
                <Loader2 className="w-4 h-4 mr-2 thinking-spinner" />
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
