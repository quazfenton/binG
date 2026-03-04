'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import {
  Key, Eye, EyeOff, Save, Trash2, Download, Upload, RotateCcw,
  CheckCircle, XCircle, AlertCircle, Lock, Cloud, Database
} from 'lucide-react';
import { toast } from 'sonner';
import {
  getUserAPIKeys,
  setUserAPIKeys,
  deleteUserAPIKey,
  clearAllUserAPIKeys,
  exportUserAPIKeys,
  importUserAPIKeys,
  type UserAPIKeys,
} from '@/lib/user/user-api-keys';

interface APIKeyField {
  key: keyof UserAPIKeys;
  label: string;
  description: string;
  category: 'llm' | 'tools' | 'oauth' | 'other';
  placeholder?: string;
}

const API_KEY_FIELDS: APIKeyField[] = [
  // LLM Providers
  {
    key: 'openai_api_key',
    label: 'OpenAI API Key',
    description: 'For GPT-4, GPT-3.5-turbo models',
    category: 'llm',
    placeholder: 'sk-...',
  },
  {
    key: 'anthropic_api_key',
    label: 'Anthropic API Key',
    description: 'For Claude models',
    category: 'llm',
    placeholder: 'sk-ant-...',
  },
  {
    key: 'google_api_key',
    label: 'Google API Key',
    description: 'For Gemini models',
    category: 'llm',
    placeholder: 'AIza...',
  },
  {
    key: 'mistral_api_key',
    label: 'Mistral API Key',
    description: 'For Mistral AI models',
    category: 'llm',
    placeholder: '...',
  },
  {
    key: 'together_api_key',
    label: 'Together AI API Key',
    description: 'For Together AI models',
    category: 'llm',
    placeholder: '...',
  },
  {
    key: 'replicate_api_token',
    label: 'Replicate API Token',
    description: 'For image generation models',
    category: 'llm',
    placeholder: 'r8_...',
  },
  {
    key: 'openrouter_api_key',
    label: 'OpenRouter API Key',
    description: 'For access to multiple models',
    category: 'llm',
    placeholder: 'sk-or-...',
  },
  
  // Tools & MCP
  {
    key: 'composio_api_key',
    label: 'Composio API Key',
    description: 'For tool integrations',
    category: 'tools',
    placeholder: '...',
  },
  {
    key: 'nango_api_key',
    label: 'Nango API Key',
    description: 'For OAuth integrations',
    category: 'tools',
    placeholder: '...',
  },
  
  // OAuth Tokens
  {
    key: 'notion_oauth_token',
    label: 'Notion OAuth Token',
    description: 'For Notion integration',
    category: 'oauth',
  },
  {
    key: 'slack_oauth_token',
    label: 'Slack OAuth Token',
    description: 'For Slack integration',
    category: 'oauth',
  },
  {
    key: 'github_oauth_token',
    label: 'GitHub OAuth Token',
    description: 'For GitHub integration',
    category: 'oauth',
    placeholder: 'ghp_...',
  },
  {
    key: 'google_oauth_token',
    label: 'Google OAuth Token',
    description: 'For Google Workspace integration',
    category: 'oauth',
  },
  
  // Other Services
  {
    key: 'serper_api_key',
    label: 'Serper API Key',
    description: 'For web search',
    category: 'other',
    placeholder: '...',
  },
  {
    key: 'exa_api_key',
    label: 'Exa API Key',
    description: 'For semantic search',
    category: 'other',
    placeholder: '...',
  },
];

interface UserAPIKeysPanelProps {
  userId?: string;
}

export default function UserAPIKeysPanel({ userId }: UserAPIKeysPanelProps) {
  const [apiKeys, setApiKeys] = useState<Partial<UserAPIKeys>>({});
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});
  const [hasChanges, setHasChanges] = useState(false);
  const [importData, setImportData] = useState('');
  const [showImport, setShowImport] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Load saved API keys on mount
  useEffect(() => {
    const loadKeys = async () => {
      try {
        const saved = await getUserAPIKeys();
        setApiKeys(saved);
      } catch (error) {
        console.error('Failed to load API keys:', error);
      } finally {
        setIsLoading(false);
      }
    };
    loadKeys();
  }, []);

  // Handle key change
  const handleKeyChange = (key: keyof UserAPIKeys, value: string) => {
    setApiKeys(prev => ({ ...prev, [key]: value }));
    setHasChanges(true);
  };

  // Save all API keys
  const handleSave = async () => {
    try {
      await setUserAPIKeys(apiKeys);
      toast.success('API keys saved successfully (AES-256 encrypted)');
      setHasChanges(false);
    } catch (error) {
      toast.error('Failed to save API keys');
    }
  };

  // Delete specific key
  const handleDelete = async (key: keyof UserAPIKeys) => {
    try {
      await deleteUserAPIKey(key);
      setApiKeys(prev => {
        const updated = { ...prev };
        delete updated[key];
        return updated;
      });
      toast.success(`${key} deleted`);
      setHasChanges(true);
    } catch (error) {
      toast.error('Failed to delete API key');
    }
  };

  // Clear all keys
  const handleClearAll = async () => {
    if (confirm('Are you sure you want to clear all API keys? This cannot be undone.')) {
      try {
        clearAllUserAPIKeys();
        setApiKeys({});
        toast.success('All API keys cleared');
        setHasChanges(true);
      } catch (error) {
        toast.error('Failed to clear API keys');
      }
    }
  };

  // Export keys
  const handleExport = async () => {
    try {
      const exported = await exportUserAPIKeys();
      navigator.clipboard.writeText(exported);
      toast.success('API keys exported to clipboard (keep this secure!)');
    } catch (error) {
      toast.error('Failed to export API keys');
    }
  };

  // Import keys
  const handleImport = async () => {
    try {
      await importUserAPIKeys(importData);
      setApiKeys(await getUserAPIKeys());
      toast.success('API keys imported successfully');
      setShowImport(false);
      setImportData('');
      setHasChanges(true);
    } catch (error) {
      toast.error('Failed to import API keys: Invalid JSON');
    }
  };

  // Toggle key visibility
  const toggleKeyVisibility = (key: string) => {
    setShowKeys(prev => ({ ...prev, [key]: !prev[key] }));
  };

  // Group keys by category
  const groupedKeys = API_KEY_FIELDS.reduce((acc, field) => {
    if (!acc[field.category]) {
      acc[field.category] = [];
    }
    acc[field.category].push(field);
    return acc;
  }, {} as Record<'llm' | 'tools' | 'oauth' | 'other', APIKeyField[]>);

  const categoryLabels: Record<'llm' | 'tools' | 'oauth' | 'other', string> = {
    llm: 'LLM Providers',
    tools: 'Tools & MCP',
    oauth: 'OAuth Tokens',
    other: 'Other Services',
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white flex items-center gap-2">
            <Key className="w-6 h-6" />
            API Keys & Credentials
          </h2>
          <p className="text-gray-400 mt-1">
            Manage your personal API keys for enhanced functionality (AES-256 encrypted)
          </p>
        </div>
        
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleExport}
            disabled={isLoading}
            className="border-gray-700 text-gray-300 hover:bg-gray-800"
          >
            <Download className="w-4 h-4 mr-2" />
            Export
          </Button>
          
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowImport(!showImport)}
            disabled={isLoading}
            className="border-gray-700 text-gray-300 hover:bg-gray-800"
          >
            <Upload className="w-4 h-4 mr-2" />
            Import
          </Button>
          
          <Button
            variant="outline"
            size="sm"
            onClick={handleClearAll}
            disabled={isLoading}
            className="border-red-900 text-red-400 hover:bg-red-950"
          >
            <Trash2 className="w-4 h-4 mr-2" />
            Clear All
          </Button>
          
          <Button
            size="sm"
            onClick={handleSave}
            disabled={!hasChanges || isLoading}
            className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700"
          >
            <Save className="w-4 h-4 mr-2" />
            Save Changes
          </Button>
        </div>
      </div>

      {/* Loading State */}
      {isLoading && (
        <Card className="bg-gray-900/50 border-gray-800">
          <CardContent className="py-8">
            <div className="flex items-center justify-center gap-3">
              <div className="w-6 h-6 border-2 border-purple-600 border-t-transparent rounded-full animate-spin"></div>
              <p className="text-gray-400">Loading API keys...</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Import Panel */}
      {showImport && (
        <Card className="bg-gray-900/50 border-gray-800">
          <CardHeader>
            <CardTitle className="text-white text-lg">Import API Keys</CardTitle>
            <CardDescription className="text-gray-400">
              Paste your exported API keys JSON here
            </CardDescription>
          </CardHeader>
          <CardContent>
            <textarea
              value={importData}
              onChange={(e) => setImportData(e.target.value)}
              placeholder='{"openai_api_key": "sk-...", ...}'
              className="w-full h-40 bg-gray-800 border-gray-700 text-white rounded-md p-3 font-mono text-sm"
            />
            <div className="flex gap-2 mt-4">
              <Button onClick={handleImport} className="bg-green-600 hover:bg-green-700">
                Import Keys
              </Button>
              <Button
                variant="outline"
                onClick={() => setShowImport(false)}
                className="border-gray-700"
              >
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Info Banner */}
      <Card className="bg-blue-950/30 border-blue-900">
        <CardContent className="py-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-blue-400 mt-0.5" />
            <div className="text-sm text-blue-200">
              <p className="font-medium mb-1">About User API Keys</p>
              <ul className="list-disc list-inside space-y-1 text-blue-300">
                <li>Keys are stored locally in your browser (encrypted)</li>
                <li>Keys override server-side defaults when provided</li>
                <li>Your keys are never sent to our servers</li>
                <li>Clear your browser data to remove all keys</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* API Key Categories */}
      {(Object.keys(groupedKeys) as Array<'llm' | 'tools' | 'oauth' | 'other'>).map((category) => {
        const fields = groupedKeys[category];
        return (
          <Card key={category} className="bg-gray-900/50 border-gray-800">
            <CardHeader>
              <CardTitle className="text-white text-lg flex items-center gap-2">
                {category === 'llm' && <Cloud className="w-5 h-5" />}
                {category === 'tools' && <Database className="w-5 h-5" />}
                {category === 'oauth' && <Lock className="w-5 h-5" />}
                {category === 'other' && <Key className="w-5 h-5" />}
                {categoryLabels[category]}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4">
                {fields.map((field) => {
                  const value = apiKeys[field.key] || '';
                  const isConfigured = !!value;
                  const isVisible = showKeys[field.key];

                  return (
                    <div key={field.key} className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label className="text-gray-300 flex items-center gap-2">
                          {field.label}
                          {isConfigured ? (
                            <Badge variant="default" className="bg-green-600 text-xs">
                              <CheckCircle className="w-3 h-3 mr-1" />
                              Configured
                            </Badge>
                          ) : (
                            <Badge variant="secondary" className="bg-gray-700 text-xs">
                              <XCircle className="w-3 h-3 mr-1" />
                              Not Set
                            </Badge>
                          )}
                        </Label>
                        
                        {isConfigured && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDelete(field.key)}
                            className="text-red-400 hover:text-red-300 hover:bg-red-950"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        )}
                      </div>
                      
                      <div className="relative">
                        <Input
                          type={isVisible ? 'text' : 'password'}
                          value={value}
                          onChange={(e) => handleKeyChange(field.key, e.target.value)}
                          placeholder={field.placeholder || `Enter your ${field.label}`}
                          className="pl-10 pr-20 bg-gray-800 border-gray-700 text-white placeholder:text-gray-500"
                        />
                        
                        <div className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">
                          <Lock className="w-4 h-4" />
                        </div>
                        
                        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => toggleKeyVisibility(field.key)}
                            className="h-7 w-7 p-0 text-gray-400 hover:text-white"
                          >
                            {isVisible ? (
                              <EyeOff className="w-4 h-4" />
                            ) : (
                              <Eye className="w-4 h-4" />
                            )}
                          </Button>
                        </div>
                      </div>
                      
                      <p className="text-xs text-gray-500">{field.description}</p>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        );
      })}

      {/* OAuth Pre-Authorization Info */}
      <Card className="bg-purple-950/30 border-purple-900">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <Lock className="w-5 h-5" />
            OAuth Pre-Authorization
          </CardTitle>
          <CardDescription className="text-gray-400">
            Pre-authorize OAuth connections for seamless tool usage
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <p className="text-sm text-purple-200">
              Coming soon: Pre-authorize OAuth connections for services like Notion, Slack, and GitHub.
              This will allow the AI to use these services without prompting for authentication each time.
            </p>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {['Notion', 'Slack', 'GitHub'].map((service) => (
                <div
                  key={service}
                  className="p-4 rounded-lg bg-purple-900/30 border border-purple-800"
                >
                  <div className="flex items-center gap-2">
                    <Lock className="w-4 h-4 text-purple-400" />
                    <span className="text-white font-medium">{service}</span>
                  </div>
                  <p className="text-xs text-purple-300 mt-2">
                    Pre-authorization coming soon
                  </p>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
