// Edge function — geo-aware router that forwards short, non-streaming requests
// to the Oracle-hosted backend. Used as an OPTIONAL hardening layer; the
// Vercel app can also call the backend directly.
//
// Streaming endpoints (e.g. /api/chat) MUST bypass this function — they are
// declared in netlify.toml under `path` and are NOT matched here.

import type { Context } from 'https://edge.netlify.com';

export default async (request: Request, context: Context) => {
  const url = new URL(request.url);
  const target = new URL(url.pathname.replace(/^\/edge/, ''), Netlify.env.get('ORACLE_BACKEND_URL'));
  url.searchParams.forEach((v, k) => target.searchParams.set(k, v));

  const upstream = await fetch(target, {
    method: request.method,
    headers: {
      ...Object.fromEntries(request.headers),
      'x-edge-country': context.geo?.country?.code ?? '',
      'x-edge-city':    context.geo?.city ?? '',
    },
    body: ['GET', 'HEAD'].includes(request.method) ? undefined : await request.arrayBuffer(),
  });

  return new Response(upstream.body, {
    status:  upstream.status,
    headers: upstream.headers,
  });
};

export const config = { path: '/edge/*' };
