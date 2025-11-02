"use client";

import React, { useState } from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Badge } from '../ui/badge';
import { 
  Send, Plus, Trash2, Copy, Save, Folder, Loader2, XCircle, 
  Code, Globe, FileText
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

export default function APIPlaygroundProPlugin({ onClose }: PluginProps) {
  const [method, setMethod] = useState<HttpMethod>('GET');
  const [url, setUrl] = useState('');
  const [headers, setHeaders] = useState<Header[]>([
    { id: 1, key: 'Content-Type', value: 'application/json', enabled: true }
  ]);
  const [body, setBody] = useState('');
  const [response, setResponse] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [graphqlQuery, setGraphqlQuery] = useState('');
  const [graphqlVars, setGraphqlVars] = useState('{}');

  const addHeader = () => {
    setHeaders([...headers, { id: Date.now(), key: '', value: '', enabled: true }]);
  };

  const removeHeader = (id: number) => {
    setHeaders(headers.filter(h => h.id !== id));
  };

  const updateHeader = (id: number, field: keyof Header, value: any) => {
    setHeaders(headers.map(h => h.id === id ? { ...h, [field]: value } : h));
  };

  const sendRequest = async () => {
    setLoading(true);
    const startTime = Date.now();
    
    try {
      const requestHeaders: Record<string, string> = {};
      headers.filter(h => h.enabled && h.key).forEach(h => {
        requestHeaders[h.key] = h.value;
      });

      const res = await fetch(url, {
        method,
        headers: requestHeaders,
        body: ['POST', 'PUT', 'PATCH'].includes(method) ? body : undefined
      });

      const time = Date.now() - startTime;
      const contentType = res.headers.get('content-type');
      let responseData;
      
      if (contentType?.includes('application/json')) {
        responseData = await res.json();
      } else {
        responseData = await res.text();
      }

      setResponse({
        status: res.status,
        statusText: res.statusText,
        headers: Object.fromEntries(res.headers.entries()),
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

  const saveToCollection = () => {
    const request: Request = {
      id: Date.now().toString(),
      name: `${method} ${url}`,
      method,
      url,
      headers,
      body
    };
    const newCollection: Collection = {
      id: Date.now().toString(),
      name: 'New Collection',
      requests: [request]
    };
    setCollections([...collections, newCollection]);
    toast.success('Saved to collection');
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
                  <div key={c.id} className="text-sm p-2 hover:bg-white/5 rounded">
                    {c.name}
                  </div>
                ))}
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
              <Button onClick={sendRequest} disabled={loading || !url}>
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              </Button>
            </div>

            <Tabs defaultValue="headers">
              <TabsList>
                <TabsTrigger value="headers">Headers</TabsTrigger>
                <TabsTrigger value="body">Body</TabsTrigger>
                <TabsTrigger value="graphql">GraphQL</TabsTrigger>
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
