/**
 * CORS Middleware
 *
 * Provides Cross-Origin Resource Sharing (CORS) configuration for API routes.
 * Supports custom origins, methods, headers, and credentials.
 *
 * Features:
 * - Custom origin allowlist
 * - Configurable methods and headers
 * - Credentials support
 * - Preflight caching
 * - Dynamic origin validation
 *
 * @see docs/sdk/cors.md
 */

import { NextRequest, NextResponse } from 'next/server';

/**
 * CORS configuration
 */
export interface CORSConfig {
  /** Allowed origins */
  origins: string[];
  /** Allowed methods */
  methods: string[];
  /** Allowed headers */
  allowedHeaders: string[];
  /** Exposed headers */
  exposedHeaders: string[];
  /** Allow credentials */
  credentials: boolean;
  /** Max age for preflight cache */
  maxAge: number;
  /** Enable dynamic origin validation */
  dynamicOrigin?: boolean;
}

/**
 * Default CORS configuration
 */
const DEFAULT_CORS_CONFIG: CORSConfig = {
  origins: process.env.ALLOWED_ORIGINS?.split(',') || ['*'],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Request-ID'],
  exposedHeaders: ['X-Request-ID', 'X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset'],
  credentials: true,
  maxAge: 86400, // 24 hours
  dynamicOrigin: true,
};

/**
 * Validate origin against allowlist
 *
 * @param origin - Request origin
 * @param config - CORS configuration
 * @returns True if origin is allowed
 */
function validateOrigin(origin: string | null, config: CORSConfig): boolean {
  if (!origin) return false;

  // Wildcard allows all origins
  if (config.origins.includes('*')) return true;

  // Check against allowlist
  if (config.origins.includes(origin)) return true;

  // Support wildcard subdomains
  for (const allowed of config.origins) {
    if (allowed.startsWith('*.')) {
      const domain = allowed.slice(2);
      if (origin.endsWith(domain)) return true;
    }
  }

  return false;
}

/**
 * Create CORS middleware
 *
 * @param config - CORS configuration
 * @returns Middleware function
 *
 * @example
 * ```typescript
 * const cors = createCORS({
 *   origins: ['https://example.com'],
 *   methods: ['GET', 'POST'],
 *   credentials: true,
 * });
 *
 * export async function POST(request: NextRequest) {
 *   const corsResponse = cors(request);
 *   if (corsResponse) return corsResponse;
 *
 *   // Process request...
 * }
 * ```
 */
export function createCORS(config: CORSConfig = DEFAULT_CORS_CONFIG) {
  return function cors(request: NextRequest): NextResponse | null {
    const origin = request.headers.get('origin');
    const isPreflight = request.method === 'OPTIONS';

    // Validate origin if dynamic origin is enabled
    if (config.dynamicOrigin && origin && !validateOrigin(origin, config)) {
      return NextResponse.json(
        { error: 'Origin not allowed' },
        { status: 403 }
      );
    }

    // Create response headers
    const headers: Record<string, string> = {};

    // Set origin header
    if (origin && config.origins.includes('*')) {
      headers['Access-Control-Allow-Origin'] = '*';
    } else if (origin && validateOrigin(origin, config)) {
      headers['Access-Control-Allow-Origin'] = origin;
    } else if (config.origins.length === 1) {
      headers['Access-Control-Allow-Origin'] = config.origins[0];
    }

    // Set Vary header for caching
    if (config.dynamicOrigin) {
      headers['Vary'] = 'Origin';
    }

    // Set methods
    headers['Access-Control-Allow-Methods'] = config.methods.join(', ');

    // Set headers
    headers['Access-Control-Allow-Headers'] = config.allowedHeaders.join(', ');

    // Set exposed headers
    if (config.exposedHeaders.length > 0) {
      headers['Access-Control-Expose-Headers'] = config.exposedHeaders.join(', ');
    }

    // Set credentials
    if (config.credentials) {
      headers['Access-Control-Allow-Credentials'] = 'true';
    }

    // Set max age for preflight
    if (isPreflight) {
      headers['Access-Control-Max-Age'] = String(config.maxAge);
    }

    // Handle preflight requests
    if (isPreflight) {
      return new NextResponse(null, {
        status: 204,
        headers,
      });
    }

    // For non-preflight requests, return null
    // Caller should add headers to their response
    return null;
  };
}

/**
 * Add CORS headers to response
 *
 * @param response - Next.js response
 * @param config - CORS configuration
 * @param request - Original request
 * @returns Response with CORS headers
 */
export function addCORSHeaders(
  response: NextResponse,
  config: CORSConfig = DEFAULT_CORS_CONFIG,
  request?: NextRequest
): NextResponse {
  const origin = request?.headers.get('origin');

  // Set origin header
  if (origin && config.origins.includes('*')) {
    response.headers.set('Access-Control-Allow-Origin', '*');
  } else if (origin && validateOrigin(origin, config)) {
    response.headers.set('Access-Control-Allow-Origin', origin);
  } else if (config.origins.length === 1) {
    response.headers.set('Access-Control-Allow-Origin', config.origins[0]);
  }

  // Set Vary header
  if (config.dynamicOrigin) {
    response.headers.set('Vary', 'Origin');
  }

  // Set methods
  response.headers.set('Access-Control-Allow-Methods', config.methods.join(', '));

  // Set headers
  response.headers.set('Access-Control-Allow-Headers', config.allowedHeaders.join(', '));

  // Set exposed headers
  if (config.exposedHeaders.length > 0) {
    response.headers.set('Access-Control-Expose-Headers', config.exposedHeaders.join(', '));
  }

  // Set credentials
  if (config.credentials) {
    response.headers.set('Access-Control-Allow-Credentials', 'true');
  }

  return response;
}

/**
 * Default CORS middleware instance
 */
export const cors = createCORS();

/**
 * CORS middleware wrapper for API routes
 *
 * @param handler - API route handler
 * @param config - CORS configuration
 * @returns Wrapped handler
 *
 * @example
 * ```typescript
 * export const POST = withCORS(async function POST(request: NextRequest) {
 *   // Process request...
 * });
 * ```
 */
export function withCORS<T extends (...args: any[]) => Promise<NextResponse>>(
  handler: T,
  config: CORSConfig = DEFAULT_CORS_CONFIG
): T {
  const corsMiddleware = createCORS(config);

  return (async (...args: Parameters<T>) => {
    const request = args[0] as NextRequest;
    const corsResponse = corsMiddleware(request);

    if (corsResponse) {
      return corsResponse as ReturnType<T>;
    }

    const response = await handler(...args);
    return addCORSHeaders(response, config, request) as ReturnType<T>;
  }) as T;
}

/**
 * Validate origin manually
 *
 * @param origin - Origin to validate
 * @param config - CORS configuration
 * @returns True if origin is valid
 */
export function isValidOrigin(origin: string, config: CORSConfig = DEFAULT_CORS_CONFIG): boolean {
  return validateOrigin(origin, config);
}

/**
 * Get allowed origins
 *
 * @param config - CORS configuration
 * @returns Array of allowed origins
 */
export function getAllowedOrigins(config: CORSConfig = DEFAULT_CORS_CONFIG): string[] {
  return config.origins;
}

/**
 * Add origin to allowlist
 *
 * @param origin - Origin to add
 * @param config - CORS configuration
 */
export function addOrigin(origin: string, config: CORSConfig = DEFAULT_CORS_CONFIG): void {
  if (!config.origins.includes(origin)) {
    config.origins.push(origin);
  }
}

/**
 * Remove origin from allowlist
 *
 * @param origin - Origin to remove
 * @param config - CORS configuration
 */
export function removeOrigin(origin: string, config: CORSConfig = DEFAULT_CORS_CONFIG): void {
  const index = config.origins.indexOf(origin);
  if (index > -1) {
    config.origins.splice(index, 1);
  }
}
