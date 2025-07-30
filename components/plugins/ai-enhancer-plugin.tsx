"use client"

import React, { useState } from 'react';
import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Sparkles, Copy, Check, Loader2 } from 'lucide-react';
import type { PluginProps } from './plugin-manager';

export const AIEnhancerPlugin: React.FC<PluginProps> = ({ 
  onClose, 
  onResult, 
  initialData 
}) => {
  const [input, setInput] = useState(initialData?.text || '');
  const [enhanced, setEnhanced] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [copied, setCopied] = useState(false);

  const enhanceText = async () => {
    if (!input.trim()) return;
    
    setIsProcessing(true);
    try {
      // Simulate AI enhancement
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const enhancedText = `Enhanced version of: "${input}"

This is a more detailed, structured, and professional version that:
• Provides clearer context and specific requirements
• Uses more precise technical language
• Includes relevant examples and use cases
• Follows best practices for communication
• Maintains the original intent while improving clarity

The enhanced text would be generated here based on the input provided.`;
      
      setEnhanced(enhancedText);
      onResult?.(enhancedText);
    } catch (error) {
      console.error('Enhancement failed:', error);
    } finally {
      setIsProcessing(false);
    }
  };

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(enhanced);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy:', error);
    }
  };

  return (
    <div className="h-full flex flex-col p-4 space-y-4">
      <div className="flex items-center gap-2">
        <Sparkles className="w-5 h-5 text-purple-400" />
        <h3 className="text-lg font-semibold text-white">AI Text Enhancer</h3>
      </div>

      <div className="flex-1 space-y-4">
        <div>
          <label className="block text-sm font-medium text-white/80 mb-2">
            Original Text
          </label>
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Enter text to enhance..."
            className="min-h-[120px] bg-black/40 border-white/20 text-white resize-none"
          />
        </div>

        <Button
          onClick={enhanceText}
          disabled={!input.trim() || isProcessing}
          className="w-full bg-purple-600 hover:bg-purple-700"
        >
          {isProcessing ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Enhancing...
            </>
          ) : (
            <>
              <Sparkles className="w-4 h-4 mr-2" />
              Enhance Text
            </>
          )}
        </Button>

        {enhanced && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium text-white/80">
                Enhanced Text
              </label>
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
            </div>
            <Textarea
              value={enhanced}
              readOnly
              className="min-h-[200px] bg-black/40 border-white/20 text-white resize-none"
            />
          </div>
        )}
      </div>
    </div>
  );
};

export default AIEnhancerPlugin;