"use client";

import React, { useState, useCallback } from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { Switch } from '../ui/switch';
import { Label } from '../ui/label';
import { XCircle, Send, Plus, Trash2, Loader2, Shield, Lock, Library } from 'lucide-react';
import { toast } from 'sonner';
import type { PluginProps } from './plugin-manager';

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD' | 'OPTIONS';

interface Header {
  id: number;
  key: string;
  value: string;
}

interface RequestResult {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: any;
}

export const NetworkRequestBuilderPlugin: React.FC<PluginProps> = ({ onClose, onResult }) => {
  const [method, setMethod] = useState<HttpMethod>('GET');
  const [url, setUrl] = useState('');
  const [headers, setHeaders] = useState<Header[]>([{ id: 1, key: 'Content-Type', value: 'application/json' }]);
  const [body, setBody] = useState('');
  const [response, setResponse] = useState<RequestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [useEncryption, setUseEncryption] = useState(false);
  const [encryptionKey, setEncryptionKey] = useState('');

  const addHeader = () => {
    setHeaders([...headers, { id: Date.now(), key: '', value: '' }]);
  };

  const removeHeader = (id: number) => {
    setHeaders(headers.filter(h => h.id !== id));
  };

  const updateHeader = (id: number, field: 'key' | 'value', value: string) => {
    setHeaders(headers.map(h => h.id === id ? { ...h, [field]: value } : h));
  };

  const handleSendRequest = useCallback(async () => {
    if (!url.trim()) {
      toast.error('URL is required.');
      return;
    }

    setIsLoading(true);
    setError(null);
    setResponse(null);
    toast.info('Sending request...');

    try {
      const requestHeaders = new Headers();
      headers.forEach(h => {
        if (h.key.trim()) {
          requestHeaders.append(h.key.trim(), h.value.trim());
        }
      });

      let requestBody = body;
      if (useEncryption) {
        if (!encryptionKey.trim()) {
          toast.warning('Encryption key is missing.');
        }
        // This is a mock encryption for demonstration.
        // In a real app, use a robust library like crypto-js.
        requestBody = btoa(JSON.stringify({ payload: body, timestamp: Date.now() }));
        requestHeaders.append('X-Encryption-Type', 'base64-mock');
        toast.info('Payload has been "encrypted".');
      }

      const res = await fetch(url, {
        method,
        headers: requestHeaders,
        body: ['GET', 'HEAD'].includes(method) ? undefined : requestBody,
      });

      const responseHeaders: Record<string, string> = {};
      res.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });

      const contentType = res.headers.get('content-type');
      let responseBody: any;

      if (contentType && contentType.includes('application/json')) {
        responseBody = await res.json();
      } else {
        responseBody = await res.text();
      }

      if (!res.ok) {
        throw new Error(`Request failed with status ${res.status}`);
      }
      
      const result: RequestResult = {
        status: res.status,
        statusText: res.statusText,
        headers: responseHeaders,
        body: responseBody,
      };

      setResponse(result);
      onResult?.({ request: { url, method }, response: result });
      toast.success('Request successful!');

    } catch (err) {
      let errorMessage = 'An unknown error occurred.';
      if (err instanceof TypeError) {
        errorMessage = 'Network error or CORS issue. Check the browser console for more details. The target server may need to configure CORS headers.';
      } else if (err instanceof Error) {
        errorMessage = err.message;
      }
      setError(errorMessage);
      toast.error('Request Failed', { description: errorMessage });
    } finally {
      setIsLoading(false);
    }
  }, [url, method, headers, body, useEncryption, encryptionKey, onResult]);

  return (
    <div className="h-full flex flex-col p-4 space-y-4 bg-black/30 backdrop-blur-sm border border-white/20 rounded-lg text-white">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Send className="w-5 h-5 text-cyan-400" />
          <h3 className="text-lg font-semibold">Network Request Builder</h3>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose}>
          <XCircle className="w-5 h-5" />
        </Button>
      </div>

      <div className="flex items-center gap-2">
        <Select value={method} onValueChange={(v: HttpMethod) => setMethod(v)}>
          <SelectTrigger className="w-[120px] bg-white/10 border-white/20">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-gray-900/80 backdrop-blur-sm border-white/20 text-white">
            {['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'].map(m => (
              <SelectItem key={m} value={m}>{m}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input 
          placeholder="https://api.example.com/data" 
          value={url} 
          onChange={(e) => setUrl(e.target.value)}
          className="flex-1 bg-white/10 border-white/20"
        />
        <Button onClick={handleSendRequest} disabled={isLoading} className="bg-cyan-600 hover:bg-cyan-700">
          {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
        </Button>
      </div>

      <Tabs defaultValue="body" className="flex-1 flex flex-col min-h-0">
        <TabsList className="bg-white/10 border-b-0">
          <TabsTrigger value="headers">Headers</TabsTrigger>
          <TabsTrigger value="body">Body</TabsTrigger>
          <TabsTrigger value="encryption">Encryption</TabsTrigger>
          <TabsTrigger value="response">Response</TabsTrigger>
          <TabsTrigger value="presets" className="flex items-center gap-1"><Library className="w-4 h-4" /> Presets</TabsTrigger>
        </TabsList>

        <TabsContent value="headers" className="flex-1 overflow-y-auto p-2 space-y-2">
          {headers.map((h, index) => (
            <div key={h.id} className="flex items-center gap-2">
              <Input placeholder="Key" value={h.key} onChange={(e) => updateHeader(h.id, 'key', e.target.value)} className="bg-white/10 border-white/20" />
              <Input placeholder="Value" value={h.value} onChange={(e) => updateHeader(h.id, 'value', e.target.value)} className="bg-white/10 border-white/20" />
              <Button variant="destructive" size="icon" onClick={() => removeHeader(h.id)}><Trash2 className="w-4 h-4" /></Button>
            </div>
          ))}
          <Button variant="outline" onClick={addHeader} className="border-white/20"><Plus className="w-4 h-4 mr-2" />Add Header</Button>
        </TabsContent>

        <TabsContent value="body" className="flex-1 min-h-0">
          <Textarea 
            placeholder='{ "key": "value" }'
            value={body}
            onChange={(e) => setBody(e.target.value)}
            className="h-full w-full bg-white/10 border-white/20 resize-none font-mono"
            disabled={['GET', 'HEAD'].includes(method)}
          />
        </TabsContent>

        <TabsContent value="encryption" className="p-4 space-y-4">
            <div className="flex items-center space-x-2">
                <Switch id="encryption-switch" checked={useEncryption} onCheckedChange={setUseEncryption} />
                <Label htmlFor="encryption-switch" className="flex items-center gap-2"><Shield className="w-4 h-4" />Enable Payload Encryption (Mock)</Label>
            </div>
            {useEncryption && (
                <div className="space-y-2">
                    <Label htmlFor="encryption-key" className="flex items-center gap-2"><Lock className="w-4 h-4" />Encryption Key</Label>
                    <Input 
                        id="encryption-key"
                        type="password"
                        placeholder="Enter secret key..."
                        value={encryptionKey}
                        onChange={(e) => setEncryptionKey(e.target.value)}
                        className="bg-white/10 border-white/20"
                    />
                    <p className="text-xs text-yellow-400/80">Note: This is for demonstration only and uses simple Base64 encoding, not real encryption.</p>
                </div>
            )}
        </TabsContent>

        <TabsContent value="response" className="flex-1 min-h-0 bg-black/20 rounded-b-md">
          {isLoading && <div className="flex items-center justify-center h-full text-white/50"><Loader2 className="w-8 h-8 animate-spin" /></div>}
          {error && <div className="p-4 text-red-400 bg-red-900/50 h-full"><pre>{error}</pre></div>}
          {response && (
            <div className="h-full flex flex-col">
              <div className="p-2 flex gap-4 text-sm border-b border-white/20">
                <span className={response.status >= 200 && response.status < 300 ? 'text-green-400' : 'text-red-400'}>
                  Status: {response.status} {response.statusText}
                </span>
              </div>
              <div className="flex-1 overflow-y-auto p-2">
                <pre className="whitespace-pre-wrap text-xs font-mono">
                  {typeof response.body === 'object' ? JSON.stringify(response.body, null, 2) : response.body}
                </pre>
              </div>
            </div>
          )}
          {!isLoading && !error && !response && 
            <div className="flex flex-col items-center justify-center h-full text-gray-500 p-4">
              <p>Send a request to see the response here.</p>
              <p className="text-xs mt-2 text-center">Note: Requests are sent from your browser and are subject to CORS policies of the destination server.</p>
            </div>
          }
        </TabsContent>

        <TabsContent value="presets" className="flex-1 min-h-0 p-4 space-y-4 bg-black/20 rounded-b-md">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {[
              { name: 'GET JSON Placeholder Posts', method: 'GET', url: 'https://jsonplaceholder.typicode.com/posts' },
              { name: 'GET Star Wars People', method: 'GET', url: 'https://swapi.dev/api/people' },
              { name: 'GET Open-Meteo Forecast', method: 'GET', url: 'https://api.open-meteo.com/v1/forecast?latitude=52.52&longitude=13.41&hourly=temperature_2m' },
              { name: 'GET Public IP', method: 'GET', url: 'https://api.ipify.org?format=json' },
              { name: 'POST Echo HTTPBin', method: 'POST', url: 'https://httpbin.org/post', headers: [{ key: 'Content-Type', value: 'application/json' }], body: '{"hello":"world"}' },
              { name: 'GET GitHub Zen', method: 'GET', url: 'https://api.github.com/zen', headers: [{ key: 'User-Agent', value: 'binG-Request-Builder' }] }
            ].map((preset, idx) => (
              <button key={idx} className="text-left p-3 bg-white/5 border border-white/10 rounded hover:bg-white/10 transition" onClick={() => {
                setMethod(preset.method as HttpMethod);
                setUrl(preset.url);
                setHeaders((preset.headers || []).map((h, i) => ({ id: Date.now() + i, key: h.key, value: h.value })));
                setBody(preset.body || '');
                toast.success(`Loaded preset: ${preset.name}`);
              }}>
                <div className="text-sm font-medium">{preset.name}</div>
                <div className="text-xs text-white/60 mt-1">{preset.method} {preset.url}</div>
              </button>
            ))}
          </div>
          <p className="text-xs text-white/60">Tip: Many public APIs support CORS and can be tested directly. For others, use a server proxy.</p>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default NetworkRequestBuilderPlugin;
