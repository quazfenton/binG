"use client";
import React, { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Key, Save, X, AlertTriangle, RefreshCw, Eye, EyeOff, Loader2 } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';

interface BYOKFadeInInputProps {
  providerId: string;
  providerName: string;
  errorMessage: string;
  onSave: (providerId: string, apiKey: string) => Promise<void>;
  onRetry: () => void;
  onDismiss: () => void;
  initialApiKey?: string;
}

export default function BYOKFadeInInput({
  providerId,
  providerName,
  errorMessage,
  onSave,
  onRetry,
  onDismiss,
  initialApiKey = '',
}: BYOKFadeInInputProps) {
  const [apiKey, setApiKey] = useState(initialApiKey);
  const [isSaving, setIsSaving] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Focus the input when component mounts
    if (inputRef.current) {
      inputRef.current.focus();
    }
  }, []);

  const handleSave = async () => {
    if (!apiKey.trim()) {
      toast.error('Please enter your API key');
      return;
    }

    try {
      setIsSaving(true);
      await onSave(providerId, apiKey);
      toast.success(`${providerName} API key saved successfully!`);
    } catch (error) {
      toast.error(`Failed to save API key: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSave();
    }
  };

  const handleClickOutside = (e: React.MouseEvent) => {
    // Don't dismiss if clicking inside the component
    if (e.target === e.currentTarget) {
      onDismiss();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={handleClickOutside}
    >
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -20 }}
        transition={{ duration: 0.2 }}
        className="w-full max-w-md p-6 mx-4 bg-gradient-to-br from-gray-900 to-gray-800 rounded-xl border border-white/10 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-4 mb-4">
          <div className="p-3 rounded-lg bg-purple-900/30 border border-purple-800">
            <Key className="h-5 w-5 text-purple-400" />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-white mb-1">
              {providerName} API Key Required
            </h3>
            <p className="text-sm text-gray-300">
              {errorMessage}
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={onDismiss}
            className="h-8 w-8 p-0 text-gray-400 hover:text-white"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="space-y-4 mb-6">
          <div className="relative">
            <Label className="text-sm font-medium text-white mb-2 block">
              Enter your {providerName} API Key
            </Label>
            <div className="relative">
              <Input
                ref={inputRef}
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={`sk-${providerId}-...`}
                className="bg-black/50 border-white/20 text-white placeholder:text-gray-600"
              />
            </div>
            {initialApiKey && (
              <p className="text-xs text-gray-400 mt-2">
                Current key is saved.
              </p>
            )}
          </div>

          <div className="p-3 rounded-lg bg-yellow-900/30 border border-yellow-800">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-4 w-4 text-yellow-400 mt-0.5" />
              <div className="text-xs text-yellow-200">
                <p className="font-medium">Important Information:</p>
                <ul className="mt-1 space-y-1">
                  <li>• Keys are stored locally in your browser</li>
                  <li>• Never share your API keys with anyone</li>
                  <li>• This key will override the server's default key</li>
                  <li>• Get your key from {providerName}'s developer portal</li>
                </ul>
              </div>
            </div>
          </div>
        </div>

        <div className="flex gap-3">
          {initialApiKey && apiKey === initialApiKey && (
            <Button
              variant="outline"
              onClick={onRetry}
              disabled={isSaving}
              className="flex-1"
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              Retry with Same Key
            </Button>
          )}
          <Button
            onClick={handleSave}
            disabled={isSaving || !apiKey.trim()}
            className="flex-1 bg-purple-600 hover:bg-purple-700"
          >
            {isSaving ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="h-4 w-4 mr-2" />
                Save and Retry
              </>
            )}
          </Button>
        </div>
      </motion.div>
    </div>
  );
}

// Helper component for the fade-in animation wrapper
export function BYOKFadeInWrapper({
  children,
  isVisible,
  onDismiss,
}: {
  children: React.ReactNode;
  isVisible: boolean;
  onDismiss: () => void;
}) {
  return (
    <AnimatePresence>
      {isVisible && children}
    </AnimatePresence>
  );
}