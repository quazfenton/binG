/**
 * Minimal Next.js `next/server` shim for the standalone backend.
 *
 * The mountNextApiRoutes loader dynamically imports route files from
 * web/app/api/, most of which import { NextRequest, NextResponse }
 * from "next/server".  This shim provides compatible implementations
 * using standard Web Fetch API classes so those imports succeed.
 *
 * NextRequest is typed as extending Request with .nextUrl and .cookies.
 * NextResponse has static factories .json(), .redirect(), .rewrite().
 *
 * The Hono adapter in next-route-loader.ts already wraps the incoming
 * Request with nextUrl/cookies via a Proxy, so the shim just needs to
 * pass the underlying Request through cleanly.
 *
 * See the existing mock pattern: server-only-mock.ts
 */

// ── Helpers ──────────────────────────────────────────────────────────────

/**
 * Create a ResponseCookies-like object that mutates a Response's headers.
 * This is used both by the instance `cookies` property and the static
 * `NextResponse.cookies()` method.
 */
function createResponseCookies(resp: Response) {
  const existing = new Map<string, string>();

  // Seed from existing Set-Cookie headers
  const setCookieHeader = resp.headers.get('set-cookie');
  if (setCookieHeader) {
    for (const raw of setCookieHeader.split('\n')) {
      const parts = raw.split(';')[0];
      const eq = parts.indexOf('=');
      if (eq > 0) {
        existing.set(parts.slice(0, eq).trim(), decodeURIComponent(parts.slice(eq + 1).trim()));
      }
    }
  }

  return {
    set: (name: string, value: string, _opts?: Record<string, unknown>) => {
      let cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}`;
      if (_opts) {
        if (_opts.httpOnly) cookie += '; HttpOnly';
        if (_opts.secure) cookie += '; Secure';
        if (_opts.sameSite) cookie += `; SameSite=${_opts.sameSite}`;
        if (_opts.path) cookie += `; Path=${_opts.path}`;
        if (_opts.maxAge !== undefined) cookie += `; Max-Age=${_opts.maxAge}`;
        if (typeof _opts.expires === 'number') cookie += `; Expires=${new Date(_opts.expires * 1000).toUTCString()}`;
      }
      resp.headers.append('Set-Cookie', cookie);
      existing.set(name, value);
    },
    get: (name: string) => {
      const value = existing.get(name);
      return value !== undefined ? { name, value } : undefined;
    },
    delete: (name: string) => {
      existing.delete(name);
      resp.headers.append('Set-Cookie', `${encodeURIComponent(name)}=; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/`);
    },
  };
}

// ── NextRequest ──────────────────────────────────────────────────────────

export class NextRequest extends Request {
  public nextUrl: URL;
  public cookies: {
    get: (name: string) => { name: string; value: string } | undefined;
    getAll: () => Array<{ name: string; value: string }>;
    has: (name: string) => boolean;
  };

  constructor(input: URL | RequestInfo, init?: RequestInit) {
    super(input, init);

    // Build nextUrl — the URL the request was made to
    try {
      this.nextUrl = new URL(this.url);
    } catch {
      this.nextUrl = new URL("http://localhost");
    }

    // Parse cookies from the Cookie header
    const cookieHeader = this.headers.get("cookie") || "";
    const cookieMap = new Map<string, string>();
    // Handle quoted cookie values that may contain semicolons (RFC 6265)
    let i = 0;
    while (i < cookieHeader.length) {
      // Skip leading whitespace
      while (i < cookieHeader.length && cookieHeader[i] === ' ') i++;
      if (i >= cookieHeader.length) break;

      // Find the = sign separating name from value
      const eqIdx = cookieHeader.indexOf('=', i);
      if (eqIdx < 0 || eqIdx === i) break;

      const name = cookieHeader.slice(i, eqIdx).trim();
      i = eqIdx + 1;

      // Parse value — handle quoted strings
      let value: string;
      if (i < cookieHeader.length && cookieHeader[i] === '"') {
        // Quoted value: find closing quote before next unquoted semicolon
        const closeQuote = cookieHeader.indexOf('"', i + 1);
        if (closeQuote < 0) {
          // Malformed: no closing quote, take rest of string
          value = cookieHeader.slice(i + 1);
          i = cookieHeader.length;
        } else {
          value = cookieHeader.slice(i + 1, closeQuote);
          i = closeQuote + 1;
        }
      } else {
        // Unquoted value: find next semicolon
        const semiIdx = cookieHeader.indexOf(';', i);
        if (semiIdx < 0) {
          value = cookieHeader.slice(i);
          i = cookieHeader.length;
        } else {
          value = cookieHeader.slice(i, semiIdx);
          i = semiIdx + 1;
        }
      }

      // decodeURIComponent can throw URIError on malformed sequences like %GG
      try {
        cookieMap.set(name, decodeURIComponent(value.trim()));
      } catch {
        // Fall back to raw value if decoding fails
        cookieMap.set(name, value.trim());
      }
    }

    this.cookies = {
      get: (name: string) => {
        const value = cookieMap.get(name);
        return value !== undefined ? { name, value } : undefined;
      },
      getAll: () =>
        Array.from(cookieMap.entries()).map(([name, value]) => ({ name, value })),
      has: (name: string) => cookieMap.has(name),
    };
  }

  /** Convenience — read a typed header. */
  header(name: string): string | null {
    return this.headers.get(name);
  }
}

// ── NextResponse ─────────────────────────────────────────────────────────

export class NextResponse extends Response {
  /** Instance-level cookies object that appends Set-Cookie headers to this response. */
  public cookies: ReturnType<typeof createResponseCookies>;

  constructor(body?: BodyInit | null, init?: ResponseInit) {
    super(body, init);
    this.cookies = createResponseCookies(this);
  }

  /** Return a JSON response. */
  static json<J = unknown>(
    body: J,
    init?: ResponseInit,
  ): NextResponse {
    const headers = new Headers(init?.headers);
    if (!headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }
    return new NextResponse(JSON.stringify(body), { ...init, headers });
  }

  /** Return a redirect response. */
  static redirect(
    url: string | URL,
    status: number = 302,
  ): NextResponse {
    const dest = typeof url === "string" ? url : url.href;
    return new NextResponse(null, {
      status,
      headers: { location: dest },
    });
  }

  /** Return a "next" response (continues to next middleware). */
  static next(init?: ResponseInit): NextResponse {
    return new NextResponse(null, { ...init, status: 200 });
  }

  /**
   * Get or set cookies on a standalone response.
   * For use without a NextResponse instance, or when you want a cookies
   * object decoupled from a specific response object.
   * NOTE: Most route handlers should use `response.cookies.set()` instead.
   */
  static cookies(init?: { setCookie?: string }): ReturnType<typeof createResponseCookies> & {
    applyToHeaders(headers: Headers): void;
  } {
    // Create a dummy response so createResponseCookies has a Headers object to mutate.
    // Static callers that don't have a response instance can use this, but the
    // Set-Cookie headers are only available on the returned object — they are NOT
    // attached to any real response. This is a breaking change from the previous
    // stub, aligned with Next.js's actual API where response.cookies.set() is
    // the primary path.
    const dummyResp = new Response(null);
    const cookieStore = createResponseCookies(dummyResp);
    if (init?.setCookie) {
      const parts = init.setCookie.split(';')[0];
      const eq = parts.indexOf('=');
      if (eq > 0) {
        const name = parts.slice(0, eq).trim();
        const value = parts.slice(eq + 1).trim();
        cookieStore.set(name, decodeURIComponent(value));
      }
    }
    // Add applyToHeaders helper so callers can copy cookies to a real response.
    (cookieStore as any).applyToHeaders = (headers: Headers) => {
      const setCookieHeader = dummyResp.headers.get('set-cookie');
      if (setCookieHeader) {
        for (const cookie of setCookieHeader.split('\n')) {
          if (cookie.trim()) {
            headers.append('Set-Cookie', cookie);
          }
        }
      }
    };
    return cookieStore as ReturnType<typeof createResponseCookies> & {
      applyToHeaders(headers: Headers): void;
    };
  }

  /** Rewrite to a different URL (preserves the original request URL). */
  static rewrite(destination: string | URL, init?: ResponseInit): NextResponse {
    const dest = typeof destination === "string" ? destination : destination.href;
    const headers = new Headers(init?.headers);
    headers.set("x-middleware-rewrite", dest);
    return new NextResponse(null, { ...init, headers, status: 200 });
  }
}

// ── Default export (some files use `import NextServer from "next/server"`) ─

export default { NextRequest, NextResponse };
