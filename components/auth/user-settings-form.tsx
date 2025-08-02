'use client';

"use client";

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/contexts/auth-context';
import { useEffect, useState } from 'react';
import { KeyIcon } from "lucide-react"; // Import KeyIcon
import { PROVIDERS } from "@/lib/api/llm-providers"; // Import PROVIDERS

export function UserSettingsForm() {
  const { user, getApiKeys, setApiKeys } = useAuth();
  const [keys, setKeys] = useState<Record<string, string>>({});

  // Initialize API keys from auth context
  useEffect(() => {
    if (user) {
      setKeys(getApiKeys());
    } else {
      setKeys({}); // Clear keys if not authenticated
    }
  }, [user, getApiKeys]);

  // Handler for API key input changes
  const handleApiKeyChange = (providerId: string, apiKey: string) => {
    setKeys(prevKeys => ({
      ...prevKeys,
      [providerId]: apiKey,
    }));
  };

  // Handler for saving API keys
  const handleSave = () => {
    setApiKeys(keys);
    alert('API keys saved!');
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-4">
        <KeyIcon className="h-4 w-4" />
        <h3 className="font-medium">API Keys</h3>
      </div>
      <div className="space-y-3">
        {Object.entries(PROVIDERS).map(([providerId, providerInfo]) => (
          <div key={providerId} className="space-y-2">
            <Label htmlFor={`api-key-${providerId}`}>{providerInfo.name} API Key</Label>
            <div className="flex items-center gap-2">
              <Input
                id={`api-key-${providerId}`}
                type="password" // Use password type for security
                value={keys[providerId] || ''}
                onChange={(e) => handleApiKeyChange(providerId, e.target.value)}
                className="bg-black/20 border-white/20 flex-1"
                placeholder={`Enter your ${providerInfo.name} API Key`}
              />
              {/* Could add a toggle to show/hide the key */}
            </div>
          </div>
        ))}
        <Button onClick={handleSave} className="w-full mt-4">Save API Keys</Button>
        <p className="text-xs text-gray-400 mt-2">
          Note: API keys are stored locally in your browser's localStorage. For enhanced security, consider a backend solution or more robust client-side encryption.
        </p>
      </div>
    </div>
  );
}
