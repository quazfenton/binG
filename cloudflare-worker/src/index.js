/**
 * Main Worker entry point
 */

import { Session } from './session.js';
import { loadConfig } from './config.js';
import { hashString } from './core.js';

export { Session };

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    
    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };
    
    if (req.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }
    
    try {
      // Health check
      if (url.pathname === '/health') {
        return new Response(JSON.stringify({ status: 'ok', timestamp: Date.now() }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
      
      // Configuration management
      if (url.pathname === '/config' && req.method === 'GET') {
        const config = await loadConfig(env);
        return new Response(JSON.stringify(config), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
      
      // Session routes
      if (url.pathname.startsWith('/session/')) {
        return handleSession(req, env, url, corsHeaders);
      }
      
      // Simple proxy (legacy compatibility)
      if (url.pathname === '/proxy' && req.method === 'POST') {
        return handleProxy(req, env, corsHeaders);
      }
      
      return new Response('Not found', { 
        status: 404, 
        headers: corsHeaders 
      });
      
    } catch (error) {
      console.error('Worker error:', error);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
  }
};

async function handleSession(req, env, url, corsHeaders) {
  const pathname = url.pathname;
  
  // Start new session
  if (pathname === '/session/start' && req.method === 'POST') {
    const id = env.SESSION_DO.idFromName(crypto.randomUUID());
    const stub = env.SESSION_DO.get(id);
    const response = await stub.fetch(new Request(`${url.origin}/start`, req));
    
    const json = await response.json();
    json.sessionUrl = `/session/${json.id}`;
    
    return new Response(JSON.stringify(json), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
  
  // Get session ID from URL
  const match = pathname.match(/^\/session\/([^\/]+)(\/.*)?$/);
  if (!match) {
    return new Response('Invalid session URL', { 
      status: 400, 
      headers: corsHeaders 
    });
  }
  
  const sessionId = match[1];
  const subPath = match[2] || '/status';
  
  // Get Durable Object stub
  const id = env.SESSION_DO.idFromName(sessionId);
  const stub = env.SESSION_DO.get(id);
  
  // Forward request to DO
  const doUrl = `${url.origin}${subPath}${url.search}`;
  const doReq = new Request(doUrl, {
    method: req.method,
    headers: req.headers,
    body: req.body
  });
  
  const response = await stub.fetch(doReq);
  
  // Add CORS headers
  const newHeaders = new Headers(response.headers);
  Object.entries(corsHeaders).forEach(([k, v]) => newHeaders.set(k, v));
  
  return new Response(response.body, {
    status: response.status,
    headers: newHeaders
  });
}

async function handleProxy(req, env, corsHeaders) {
  const body = await req.json();
  const { prompt } = body;
  
  if (!prompt) {
    return new Response(JSON.stringify({ error: 'Missing prompt' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
  
  // Check cache
  if (env.CACHE_KV) {
    const cacheKey = `proxy:${hashString(prompt)}`;
    const cached = await env.CACHE_KV.get(cacheKey);
    
    if (cached) {
      console.log('Cache hit for proxy request');
      return new Response(cached, {
        headers: { 
          ...corsHeaders, 
          'Content-Type': 'application/json',
          'X-Cache': 'HIT'
        }
      });
    }
  }
  
  // Forward to Fast-Agent
  const response = await fetch(env.FAST_AGENT_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${env.FAST_AGENT_KEY}`
    },
    body: JSON.stringify(body)
  });
  
  const result = await response.text();
  
  // Cache if successful
  if (response.ok && env.CACHE_KV) {
    const cacheKey = `proxy:${hashString(prompt)}`;
    await env.CACHE_KV.put(cacheKey, result, { expirationTtl: 86400 });
  }
  
  return new Response(result, {
    status: response.status,
    headers: { 
      ...corsHeaders, 
      'Content-Type': response.headers.get('content-type') || 'application/json',
      'X-Cache': 'MISS'
    }
  });
}
