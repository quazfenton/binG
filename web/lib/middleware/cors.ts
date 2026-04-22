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
 * 
 * SECURITY: When credentials are enabled, we cannot use wildcard origin.
 * Browsers reject responses with both Access-Control-Allow-Origin: * 
 * and Access-Control-Allow-Credentials: true.
 * 
 * For production, set ALLOWED_ORIGINS to specific domains.
 * For development, localhost is allowed by default.
 */
const DEFAULT_CORS_CONFIG: CORSConfig = {
  origins: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Request-ID'],
  exposedHeaders: ['X-Request-ID', 'X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset'],
  credentials: false, // Disabled by default - enable only when needed with specific origins
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
export function createCORS(config: Partial<CORSConfig> = {}): (request: NextRequest) => NextResponse | null {
  const mergedConfig: CORSConfig = { ...DEFAULT_CORS_CONFIG, ...config };
  return function cors(request: NextRequest): NextResponse | null {
    const origin = request.headers.get('origin');
    const isPreflight = request.method === 'OPTIONS';

    // Validate origin if dynamic origin is enabled
    if (mergedConfig.dynamicOrigin && origin && !validateOrigin(origin, mergedConfig)) {
      return NextResponse.json(
        { error: 'Origin not allowed' },
        { status: 403 }
      );
    }

    // SECURITY: Cannot use wildcard origin with credentials
    const hasWildcardOrigin = mergedConfig.origins.includes('*');
    const shouldUseCredentials = mergedConfig.credentials && !hasWildcardOrigin;

    // Create response headers
    const headers: Record<string, string> = {};

    // Set origin header
    if (origin && hasWildcardOrigin) {
      // When wildcard, echo back the request origin (but don't allow credentials)
      headers['Access-Control-Allow-Origin'] = origin;
    } else if (origin && validateOrigin(origin, mergedConfig)) {
      headers['Access-Control-Allow-Origin'] = origin;
    } else if (mergedConfig.origins.length === 1 && !hasWildcardOrigin) {
      headers['Access-Control-Allow-Origin'] = mergedConfig.origins[0];
    }

    // Set Vary header for caching
    if (mergedConfig.dynamicOrigin || hasWildcardOrigin) {
      headers['Vary'] = 'Origin';
    }

    // Set methods
    headers['Access-Control-Allow-Methods'] = mergedConfig.methods.join(', ');

    // Set headers
    headers['Access-Control-Allow-Headers'] = mergedConfig.allowedHeaders.join(', ');

    // Set exposed headers
    if (mergedConfig.exposedHeaders.length > 0) {
      headers['Access-Control-Expose-Headers'] = mergedConfig.exposedHeaders.join(', ');
    }

    // SECURITY: Only set credentials if not using wildcard origin
    // Browsers reject responses with both wildcard origin and credentials
    if (shouldUseCredentials) {
      headers['Access-Control-Allow-Credentials'] = 'true';
    }

    // Set max age for preflight
    if (isPreflight) {
      headers['Access-Control-Max-Age'] = String(mergedConfig.maxAge);
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
 * 
 * SECURITY: When credentials are enabled, we cannot use wildcard origin.
 * This function automatically disables credentials if wildcard origin is detected.
 */
export function addCORSHeaders(
  response: NextResponse,
  config: Partial<CORSConfig> = {},
  request?: NextRequest
): NextResponse {
  const mergedConfig: CORSConfig = { ...DEFAULT_CORS_CONFIG, ...config };
  const origin = request?.headers.get('origin');

  // SECURITY: Cannot use wildcard origin with credentials
  // If credentials are enabled but origin is wildcard, we must be explicit
  const hasWildcardOrigin = mergedConfig.origins.includes('*');
  const shouldUseCredentials = mergedConfig.credentials && !hasWildcardOrigin;

  // Set origin header
  if (origin && hasWildcardOrigin) {
    // When wildcard, echo back the request origin (but don't allow credentials)
    response.headers.set('Access-Control-Allow-Origin', origin);
  } else if (origin && validateOrigin(origin, mergedConfig)) {
    response.headers.set('Access-Control-Allow-Origin', origin);
  } else if (mergedConfig.origins.length === 1 && !hasWildcardOrigin) {
    response.headers.set('Access-Control-Allow-Origin', mergedConfig.origins[0]);
  }

  // Set Vary header
  if (mergedConfig.dynamicOrigin || hasWildcardOrigin) {
    response.headers.set('Vary', 'Origin');
  }

  // Set methods
  response.headers.set('Access-Control-Allow-Methods', mergedConfig.methods.join(', '));

  // Set headers
  response.headers.set('Access-Control-Allow-Headers', mergedConfig.allowedHeaders.join(', '));

  // Set exposed headers
  if (mergedConfig.exposedHeaders.length > 0) {
    response.headers.set('Access-Control-Expose-Headers', mergedConfig.exposedHeaders.join(', '));
  }

  // SECURITY: Only set credentials if not using wildcard origin
  // Browsers reject responses with both wildcard origin and credentials
  if (shouldUseCredentials) {
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
  config: Partial<CORSConfig> = {}
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
  }) as unknown as T;
}

/**
 * Validate origin manually
 *
 * @param origin - Origin to validate
 * @param config - CORS configuration
 * @returns True if origin is valid
 */
export function isValidOrigin(origin: string, config: Partial<CORSConfig> = {}): boolean {
  const mergedConfig: CORSConfig = { ...DEFAULT_CORS_CONFIG, ...config };
  return validateOrigin(origin, mergedConfig);
}

/**
 * Get allowed origins
 *
 * @param config - CORS configuration
 * @returns Array of allowed origins
 */
export function getAllowedOrigins(config: Partial<CORSConfig> = {}): string[] {
  const mergedConfig: CORSConfig = { ...DEFAULT_CORS_CONFIG, ...config };
  return mergedConfig.origins;
}

/**
 * Add origin to allowlist
 *
 * @param origin - Origin to add
 * @param config - CORS configuration
 */
export function addOrigin(origin: string, config: Partial<CORSConfig> = {}): void {
  const mergedConfig: CORSConfig = { ...DEFAULT_CORS_CONFIG, ...config };
  if (!mergedConfig.origins.includes(origin)) {
    mergedConfig.origins.push(origin);
  }
}

/**
 * Remove origin from allowlist
 *
 * @param origin - Origin to remove
 * @param config - CORS configuration
 */
export function removeOrigin(origin: string, config: Partial<CORSConfig> = {}): void {
  const mergedConfig: CORSConfig = { ...DEFAULT_CORS_CONFIG, ...config };
  const index = mergedConfig.origins.indexOf(origin);
  if (index > -1) {
    mergedConfig.origins.splice(index, 1);
  }
}
