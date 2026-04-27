"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Badge } from '../ui/badge';
import { 
  Send, Plus, Trash2, Copy, Save, Folder, Loader2, XCircle, 
  Code, Globe, FileText, Settings
} from 'lucide-react';
import type { PluginProps } from './plugin-manager';
import { toast } from 'sonner';

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

interface Header {
  id: number;
  key: string;
  value: string;
  enabled: boolean;
}

interface Request {
  id: string;
  name: string;
  method: HttpMethod;
  url: string;
  headers: Header[];
  body: string;
}

interface Collection {
  id: string;
  name: string;
  requests: Request[];
}

interface EnvVar {
  key: string;
  value: string;
}

const COLLECTIONS_STORAGE_KEY = 'api-playground-pro-collections';

export default function APIPlaygroundProPlugin({ onClose }: PluginProps) {
  const [method, setMethod] = useState<HttpMethod>('GET');
  const [url, setUrl] = useState('');
  const [headers, setHeaders] = useState<Header[]>([
    { id: 1, key: 'Content-Type', value: 'application/json', enabled: true }
  ]);
  const [body, setBody] = useState('');
  const [response, setResponse] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [collections, setCollections] = useState<Collection[]>(() => {
    try {
      const stored = localStorage.getItem(COLLECTIONS_STORAGE_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch { return []; }
  });
  const [graphqlQuery, setGraphqlQuery] = useState('');
  const [graphqlVars, setGraphqlVars] = useState('{}');
  const [collectionNameInput, setCollectionNameInput] = useState('');
  const [envVars, setEnvVars] = useState<EnvVar[]>([{ key: '', value: '' }]);

  useEffect(() => {
    try {
      localStorage.setItem(COLLECTIONS_STORAGE_KEY, JSON.stringify(collections));
    } catch {}
  }, [collections]);

  const replaceEnvVars = useCallback((text: string) => {
    return text.replace(/\{\{(\w+)\}\}/g, (match, varName) => {
      const found = envVars.find(v => v.key === varName);
      return found ? found.value : match;
    });
  }, [envVars]);

  const addHeader = () => {
    setHeaders([...headers, { id: Date.now(), key: '', value: '', enabled: true }]);
  };

  const removeHeader = (id: number) => {
    setHeaders(headers.filter(h => h.id !== id));
  };

  const updateHeader = (id: number, field: keyof Header, value: any) => {
    setHeaders(headers.map(h => h.id === id ? { ...h, [field]: value } : h));
  };

  const sendRequest = async (overrides?: { method?: HttpMethod; headers?: Record<string, string>; body?: string }) => {
    setLoading(true);
    const startTime = Date.now();
    const reqMethod = overrides?.method ?? method;
    const resolvedUrl = replaceEnvVars(url);
    const resolvedBody = overrides?.body ?? replaceEnvVars(body);

    try {
      const requestHeaders: Record<string, string> = overrides?.headers ?? {};
      if (!overrides?.headers) {
        headers.filter(h => h.enabled && h.key).forEach(h => {
          requestHeaders[h.key] = h.value;
        });
      }

      const res = await fetch(resolvedUrl, {
        method: reqMethod,
        headers: requestHeaders,
        body: ['POST', 'PUT', 'PATCH'].includes(reqMethod) ? resolvedBody : undefined
      });

      const time = Date.now() - startTime;
      const contentType = res.headers.get('content-type');
      let responseData;
      
      if (contentType?.includes('application/json')) {
        responseData = await res.json();
      } else {
        responseData = await res.text();
      }

      const responseHeaders: Record<string, string> = {};
      res.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });

      setResponse({
        status: res.status,
        statusText: res.statusText,
        headers: responseHeaders,
        body: responseData,
        time
      });

      toast.success(`Request completed in ${time}ms`);
    } catch (err: any) {
      setResponse({ status: 0, statusText: 'Error', body: err.message });
      toast.error('Request failed');
    } finally {
      setLoading(false);
    }
  };

  // Sensitive header keys that should be redacted before persisting to localStorage
  const SENSITIVE_HEADER_KEYS = new Set([
    'authorization', 'cookie', 'set-cookie', 'x-api-key', 'x-auth-token',
    'proxy-authorization', 'www-authenticate', 'x-csrf-token',
    'x-access-token', 'x-refresh-token',
  ]);

  const redactHeaders = (hdrs: Header[]): Header[] =>
    hdrs.map(h =>
      SENSITIVE_HEADER_KEYS.has(h.key.toLowerCase()) && h.value
        ? { ...h, value: '••••••••' }
        : h
    );

  const saveToCollection = () => {
    const name = collectionNameInput.trim() || `${method} ${url}`;
    const request: Request = {
      id: Date.now().toString(),
      name: `${method} ${url}`,
      method,
      url,
      headers: redactHeaders(headers),
      body,
    };
    const newCollection: Collection = {
      id: Date.now().toString(),
      name,
      requests: [request]
    };
    setCollections([...collections, newCollection]);
    setCollectionNameInput('');
    toast.success(`Saved to collection: ${name}`);
  };

  return (
    <div className="h-full flex flex-col bg-black text-white">
      <CardHeader className="border-b border-white/10">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Globe className="w-5 h-5 text-blue-400" />
            API Playground Pro
          </CardTitle>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <XCircle className="w-4 h-4" />
          </Button>
        </div>
      </CardHeader>

      <CardContent className="flex-1 overflow-auto p-4">
        <div className="grid grid-cols-3 gap-4 h-full">
          <div className="space-y-3">
            <Card className="bg-white/5">
              <CardHeader className="p-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Folder className="w-4 h-4" />
                  Collections
                </CardTitle>
              </CardHeader>
              <CardContent className="p-3 space-y-2">
                {collections.map(c => (
                  <div key={c.id} className="text-sm p-2 hover:bg-white/5 rounded cursor-pointer" onClick={() => {
                    const req = c.requests[0];
                    if (req) {
                      setMethod(req.method);
                      setUrl(req.url);
                      setHeaders(req.headers.map((h, i) => ({ ...h, id: Date.now() + i })));
                      setBody(req.body);
                      toast.success(`Loaded: ${c.name}`);
                    }
                  }}>
                    {c.name}
                  </div>
                ))}
                <Input
                  placeholder="Collection name..."
                  value={collectionNameInput}
                  onChange={(e) => setCollectionNameInput(e.target.value)}
                  className="text-sm"
                />
                <Button size="sm" variant="outline" className="w-full" onClick={saveToCollection}>
                  <Save className="w-3 h-3 mr-2" />
                  Save Current
                </Button>
              </CardContent>
            </Card>
          </div>

          <div className="col-span-2 space-y-3">
            <div className="flex gap-2">
              <Select value={method} onValueChange={(v) => setMethod(v as HttpMethod)}>
                <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map(m => (
                    <SelectItem key={m} value={m}>{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                placeholder="https://api.example.com/endpoint"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                className="flex-1"
                onKeyDown={(e) => e.key === 'Enter' && sendRequest()}
              />
              <Button onClick={() => sendRequest()} disabled={loading || !url}>
                {loading ? <Loader2 className="w-4 h-4 thinking-spinner" /> : <Send className="w-4 h-4" />}
              </Button>
            </div>

            <Tabs defaultValue="headers">
              <TabsList>
                <TabsTrigger value="headers">Headers</TabsTrigger>
                <TabsTrigger value="body">Body</TabsTrigger>
                <TabsTrigger value="graphql">GraphQL</TabsTrigger>
                <TabsTrigger value="env" className="flex items-center gap-1"><Settings className="w-3 h-3" />Env</TabsTrigger>
              </TabsList>

              <TabsContent value="headers" className="space-y-2">
                {headers.map(h => (
                  <div key={h.id} className="flex gap-2 items-center">
                    <input type="checkbox" checked={h.enabled} onChange={(e) => updateHeader(h.id, 'enabled', e.target.checked)} />
                    <Input placeholder="Key" value={h.key} onChange={(e) => updateHeader(h.id, 'key', e.target.value)} className="flex-1" />
                    <Input placeholder="Value" value={h.value} onChange={(e) => updateHeader(h.id, 'value', e.target.value)} className="flex-1" />
                    <Button size="icon" variant="ghost" onClick={() => removeHeader(h.id)}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
                <Button size="sm" variant="outline" onClick={addHeader}>
                  <Plus className="w-3 h-3 mr-2" />Add Header
                </Button>
              </TabsContent>

              <TabsContent value="body">
                <Textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder='{"key": "value"}'
                  rows={10}
                  className="font-mono text-sm"
                />
              </TabsContent>

              <TabsContent value="graphql" className="space-y-2">
                <Textarea
                  value={graphqlQuery}
                  onChange={(e) => setGraphqlQuery(e.target.value)}
                  placeholder="query { user(id: 1) { name } }"
                  rows={6}
                  className="font-mono text-sm"
                />
                <Textarea
                  value={graphqlVars}
                  onChange={(e) => setGraphqlVars(e.target.value)}
                  placeholder='{"id": 1}'
                  rows={4}
                  className="font-mono text-sm"
                />
                <Button
                  onClick={() => {
                    try {
                      const vars = JSON.parse(graphqlVars);
                      sendRequest({
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ query: graphqlQuery, variables: vars }),
                      });
                    } catch {
                      toast.error('Invalid GraphQL variables JSON');
                    }
                  }}
                  disabled={loading || !url || !graphqlQuery.trim()}
                >
                  <Send className="w-4 h-4 mr-2" />
                  Send GraphQL
                </Button>
              </TabsContent>

              <TabsContent value="env" className="space-y-2">
                <p className="text-xs text-gray-400">Define variables to replace <code className="bg-white/10 px-1 rounded">{'{{varName}}'}</code> in URL and body.</p>
                {envVars.map((v, idx) => (
                  <div key={idx} className="flex gap-2 items-center">
                    <Input
                      placeholder="Variable name"
                      value={v.key}
                      onChange={(e) => setEnvVars(envVars.map((ev, i) => i === idx ? { ...ev, key: e.target.value } : ev))}
                      className="flex-1"
                    />
                    <Input
                      placeholder="Value"
                      value={v.value}
                      onChange={(e) => setEnvVars(envVars.map((ev, i) => i === idx ? { ...ev, value: e.target.value } : ev))}
                      className="flex-1"
                    />
                    <Button size="icon" variant="ghost" onClick={() => setEnvVars(envVars.filter((_, i) => i !== idx))}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
                <Button size="sm" variant="outline" onClick={() => setEnvVars([...envVars, { key: '', value: '' }])}>
                  <Plus className="w-3 h-3 mr-2" />Add Variable
                </Button>
              </TabsContent>
            </Tabs>

            {response && (
              <Card className="bg-white/5">
                <CardHeader className="p-3">
                  <div className="flex justify-between items-center">
                    <span className={response.status >= 200 && response.status < 300 ? 'text-green-400' : 'text-red-400'}>
                      Status: {response.status} {response.statusText}
                    </span>
                    {response.time && <span className="text-xs text-gray-400">{response.time}ms</span>}
                  </div>
                </CardHeader>
                <CardContent className="p-3 max-h-96 overflow-auto">
                  <pre className="text-xs font-mono">
                    {typeof response.body === 'object' ? JSON.stringify(response.body, null, 2) : response.body}
                  </pre>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </CardContent>
    </div>
  );
}
