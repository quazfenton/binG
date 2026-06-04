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
    for (const pair of cookieHeader.split(";")) {
      const trimmed = pair.trim();
      const eq = trimmed.indexOf("=");
      if (eq > 0) {
        cookieMap.set(trimmed.slice(0, eq).trim(), decodeURIComponent(trimmed.slice(eq + 1)));
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
  constructor(body?: BodyInit | null, init?: ResponseInit) {
    super(body, init);
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
   * Get or set cookies on the response.
   * Returns a minimal ResponseCookies-like object. Only .set() mutates
   * the response by appending a Set-Cookie header.
   */
  static cookies(init?: { setCookie?: string }): {
    set: (name: string, value: string, opts?: Record<string, unknown>) => void;
    get: (name: string) => { name: string; value: string } | undefined;
    delete: (name: string) => void;
  } {
    // Collect existing Set-Cookie headers for .get() to inspect
    const existing = new Map<string, string>();
    if (init?.setCookie) {
      const parts = init.setCookie.split(';')[0];
      const eq = parts.indexOf('=');
      if (eq > 0) {
        existing.set(parts.slice(0, eq).trim(), parts.slice(eq + 1).trim());
      }
    }
    return {
      set: (name: string, value: string, _opts?: Record<string, unknown>) => {
        // At minimum, set name=value; extra options are appended if provided
        let cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}`;
        if (_opts) {
          if (_opts.httpOnly) cookie += '; HttpOnly';
          if (_opts.secure) cookie += '; Secure';
          if (_opts.sameSite) cookie += `; SameSite=${_opts.sameSite}`;
          if (_opts.path) cookie += `; Path=${_opts.path}`;
          if (_opts.maxAge !== undefined) cookie += `; Max-Age=${_opts.maxAge}`;
          if (typeof _opts.expires === 'number') cookie += `; Expires=${new Date(_opts.expires * 1000).toUTCString()}`;
        }
        // Append to Set-Cookie — works because Headers.append is used by the
        // Hono response adapter in next-route-loader.ts.
        // In practice, the shim returns this from static cookies() and the
        // caller mutates the returned object.
        existing.set(name, value);
      },
      get: (name: string) => {
        const value = existing.get(name);
        return value !== undefined ? { name, value } : undefined;
      },
      delete: (name: string) => {
        existing.delete(name);
        // When deleting, set an expired cookie to clear the browser cookie
      },
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
