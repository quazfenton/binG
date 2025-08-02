"use client"

import React, { useState, useCallback } from 'react';
import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '../ui/select';
import { Sparkles, Copy, Check, Loader2, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import type { PluginProps } from './plugin-manager';

type EnhancementMode = 'professional' | 'casual' | 'technical' | 'creative' | 'concise';

export const AIEnhancerPlugin: React.FC<PluginProps> = ({ 
  onClose, 
  onResult, 
  initialData 
}) => {
  const [input, setInput] = useState(initialData?.text || '');
  const [enhanced, setEnhanced] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [mode, setMode] = useState<EnhancementMode>('professional');
  const [error, setError] = useState<string | null>(null);

  const enhanceText = useCallback(async () => {
    if (!input.trim()) {
      setError('Input text cannot be empty.');
      toast.warning('Please enter some text to enhance.');
      return;
    }
    setError(null);
    setIsProcessing(true);
    toast.info(`Enhancing text in ${mode} mode...`);

    try {
      // Simulate AI enhancement with a delay
      await new Promise(resolve => setTimeout(resolve, 1500));

      // In a real implementation, this would be an API call
      // const response = await fetch('/api/enhance-text', {
      //   method: 'POST',
      //   headers: { 'Content-Type': 'application/json' },
      //   body: JSON.stringify({ text: input, mode }),
      // });
      // if (!response.ok) throw new Error('API request failed');
      // const data = await response.json();
      
      const enhancementPrompts = {
        professional: `Rewrite the following text in a professional tone, ensuring clarity, precision, and a formal structure.`,
        casual: `Make the following text sound more casual, friendly, and approachable. Use conversational language.`,
        technical: `Convert the following text into a more technical format. Use precise terminology, and structure it for a knowledgeable audience.`,
        creative: `Reimagine the following text with a creative flair. Use vivid imagery and engaging language to make it more compelling.`,
        concise: `Summarize the following text, making it as concise as possible while retaining the core message.`
      };

      const enhancedText = `
        **Enhancement Mode: ${mode.charAt(0).toUpperCase() + mode.slice(1)}**
        *${enhancementPrompts[mode]}*

        ---

        **Original:**
        "${input}"

        ---

        **Enhanced Version:**
        This is the AI-enhanced version of your text. It has been carefully crafted to fit the "${mode}" style. The structure is improved, the language is more appropriate for the selected tone, and the overall message is delivered more effectively. For example, key points are now highlighted, and the flow is more logical.
      `;
      
      setEnhanced(enhancedText);
      onResult?.({ original: input, enhanced: enhancedText, mode });
      toast.success('Text enhanced successfully!');
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'An unknown error occurred.';
      setError(errorMessage);
      toast.error('Enhancement Failed', { description: errorMessage });
    } finally {
      setIsProcessing(false);
    }
  }, [input, mode, onResult]);

  const copyToClipboard = useCallback(() => {
    if (!enhanced) return;

    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(enhanced).then(() => {
        setCopied(true);
        toast.success('Copied to clipboard!');
        setTimeout(() => setCopied(false), 2000);
      }, (err) => {
        toast.error('Failed to copy', { description: 'Could not copy text to clipboard.' });
        console.error('Failed to copy:', err);
      });
    } else {
      // Fallback for non-secure contexts or older browsers
      try {
        const textArea = document.createElement('textarea');
        textArea.value = enhanced;
        textArea.style.position = 'absolute';
        textArea.style.left = '-9999px';
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        setCopied(true);
        toast.success('Copied to clipboard!');
        setTimeout(() => setCopied(false), 2000);
      } catch (err) {
        toast.error('Failed to copy', { description: 'Clipboard access is not available.' });
        console.error('Fallback copy failed:', err);
      }
    }
  }, [enhanced]);

  const clearFields = () => {
    setInput('');
    setEnhanced('');
    setError(null);
    toast.info('Fields cleared.');
  };

  return (
    <div className="h-full flex flex-col p-4 space-y-4 bg-black/30 backdrop-blur-sm border border-white/20 rounded-lg text-white">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-purple-400" />
          <h3 className="text-lg font-semibold">AI Text Enhancer</h3>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose}>
          <XCircle className="w-5 h-5" />
        </Button>
      </div>

      <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-4 overflow-y-auto">
        {/* Input Column */}
        <div className="flex flex-col space-y-4">
          <div>
            <label htmlFor="enhancement-mode" className="block text-sm font-medium text-white/80 mb-2">
              Enhancement Mode
            </label>
            <Select value={mode} onValueChange={(value: EnhancementMode) => setMode(value)}>
              <SelectTrigger className="w-full bg-gray-800 border-gray-600">
                <SelectValue placeholder="Select mode" />
              </SelectTrigger>
              <SelectContent className="bg-gray-800 text-white border-gray-600">
                <SelectItem value="professional">Professional</SelectItem>
                <SelectItem value="casual">Casual</SelectItem>
                <SelectItem value="technical">Technical</SelectItem>
                <SelectItem value="creative">Creative</SelectItem>
                <SelectItem value="concise">Concise</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label htmlFor="original-text" className="block text-sm font-medium text-white/80 mb-2">
              Original Text
            </label>
            <Textarea
              id="original-text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Enter text to enhance..."
              className="min-h-[200px] bg-gray-800 border-gray-600 focus:ring-purple-500 resize-none"
            />
            <div className="text-xs text-right text-white/50 mt-1">
              {input.length} / 5000 characters
            </div>
          </div>
          {error && (
            <div className="text-sm text-red-400 bg-red-900/50 p-2 rounded">
              {error}
            </div>
          )}
          <div className="flex gap-2">
            <Button
              onClick={enhanceText}
              disabled={!input.trim() || isProcessing}
              className="w-full bg-purple-600 hover:bg-purple-700"
            >
              {isProcessing ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Sparkles className="w-4 h-4 mr-2" />
              )}
              Enhance
            </Button>
            <Button
              variant="outline"
              onClick={clearFields}
              className="border-gray-600 hover:bg-gray-700"
            >
              <XCircle className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Output Column */}
        <div className="flex flex-col space-y-2">
          <div className="flex items-center justify-between">
            <label className="block text-sm font-medium text-white/80">
              Enhanced Text
            </label>
            <Button
              size="sm"
              variant="ghost"
              onClick={copyToClipboard}
              disabled={!enhanced}
              className="text-white/60 hover:text-white disabled:text-white/30"
            >
              {copied ? <Check className="w-4 h-4 mr-1" /> : <Copy className="w-4 h-4 mr-1" />}
              {copied ? 'Copied!' : 'Copy'}
            </Button>
          </div>
          <div className="flex-1 bg-black/30 border border-gray-700 rounded-lg p-3 text-sm overflow-y-auto">
            {isProcessing && !enhanced ? (
              <div className="flex items-center justify-center h-full text-white/50">
                <Loader2 className="w-6 h-6 animate-spin" />
              </div>
            ) : enhanced ? (
              <pre className="whitespace-pre-wrap font-mono text-xs">{enhanced}</pre>
            ) : (
              <div className="flex items-center justify-center h-full">
                <p className="text-gray-500 italic">Enhanced text will appear here</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AIEnhancerPlugin;
