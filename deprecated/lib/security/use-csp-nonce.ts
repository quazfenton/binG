/**
 * React Hook for CSP Nonce Access
 *
 * Provides access to Content Security Policy nonces for inline scripts/styles.
 * Nonces are generated per-request in middleware and passed via headers.
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Security-Policy/script-src
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { scriptNonce, styleNonce } = useCSPNonce();
 *
 *   return (
 *     <>
 *       <script nonce={scriptNonce} dangerouslySetInnerHTML={{ __html: '...' }} />
 *       <style nonce={styleNonce}>{`...`}</style>
 *     </>
 *   );
 * }
 * ```
 */

'use client';

import { useMemo } from 'react';

/**
 * Get CSP nonce from response headers
 *
 * In Next.js, we can access headers via:
 * 1. Server components: headers() from 'next/headers'
 * 2. Client components: Passed via context or props from server
 * 3. Middleware: Stored in custom headers for client access
 */
export function useCSPNonce(): {
  scriptNonce: string;
  styleNonce: string;
  hasNonce: boolean;
} {
  // For client-side rendering, we need to get nonces from a context
  // This is a simplified implementation - in production, you'd use
  // a context provider that gets nonces from server

  // Try to get nonces from meta tags (set by server)
  const scriptNonce = useMemo(() => {
    if (typeof document === 'undefined') return '';
    const meta = document.querySelector('meta[name="csp-nonce-script"]');
    return meta?.getAttribute('content') || '';
  }, []);

  const styleNonce = useMemo(() => {
    if (typeof document === 'undefined') return '';
    const meta = document.querySelector('meta[name="csp-nonce-style"]');
    return meta?.getAttribute('content') || '';
  }, []);

  return {
    scriptNonce,
    styleNonce,
    hasNonce: !!(scriptNonce && styleNonce),
  };
}

/**
 * Server-side nonce getter for Next.js App Router
 *
 * Use in server components to get nonces from request headers
 *
 * @example
 * ```tsx
 * // In server component
 * import { getCSPNonce } from '@/lib/security/use-csp-nonce';
 *
 * export default async function Page() {
 *   const { scriptNonce, styleNonce } = await getCSPNonce();
 *   return <script nonce={scriptNonce}>...</script>;
 * }
 * ```
 */
export async function getCSPNonce(): Promise<{
  scriptNonce: string;
  styleNonce: string;
  hasNonce: boolean;
}> {
  // Dynamic import to avoid client-side errors
  const { headers } = await import('next/headers');
  const requestHeaders = await headers();

  const scriptNonce = requestHeaders.get('x-csp-nonce-script') || '';
  const styleNonce = requestHeaders.get('x-csp-nonce-style') || '';

  return {
    scriptNonce,
    styleNonce,
    hasNonce: !!(scriptNonce && styleNonce),
  };
}

/**
 * CSP-compliant script component
 *
 * Automatically includes nonce for CSP compliance
 *
 * @example
 * ```tsx
 * <CSPScript>
 *   console.log('This script is CSP-compliant');
 * </CSPScript>
 * ```
 */
export function CSPScript({
  children,
  type,
  async,
  defer,
}: {
  children: string;
  type?: string;
  async?: boolean;
  defer?: boolean;
}) {
  const { scriptNonce } = useCSPNonce();

  const props: Record<string, string | boolean> = {
    dangerouslySetInnerHTML: { __html: children },
  };

  if (scriptNonce) {
    props.nonce = scriptNonce;
  }

  if (type) {
    props.type = type;
  }

  if (async) {
    props.async = true;
  }

  if (defer) {
    props.defer = true;
  }

  return <script {...props} />;
}

/**
 * CSP-compliant style component
 *
 * Automatically includes nonce for CSP compliance
 *
 * @example
 * ```tsx
 * <CSPStyle>
 *   {`.my-class { color: red; }`}
 * </CSPStyle>
 * ```
 */
export function CSPStyle({ children }: { children: string }) {
  const { styleNonce } = useCSPNonce();

  const props: Record<string, string> = {
    children,
  };

  if (styleNonce) {
    props.nonce = styleNonce;
  }

  return <style {...props} />;
}

/**
 * Generate CSP meta tag for initial page load
 *
 * Place in <head> to provide CSP before headers are processed
 *
 * @example
 * ```tsx
 * <head>
 *   <CSPMetaTag nonce={scriptNonce} />
 * </head>
 * ```
 */
export function CSPMetaTag({
  scriptNonce,
  styleNonce,
}: {
  scriptNonce: string;
  styleNonce: string;
}) {
  return (
    <>
      <meta name="csp-nonce-script" content={scriptNonce} />
      <meta name="csp-nonce-style" content={styleNonce} />
    </>
  );
}
