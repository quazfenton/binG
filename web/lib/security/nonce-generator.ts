/**
 * Cryptographic Nonce Generator for Content Security Policy
 *
 * Generates cryptographically secure random nonces for CSP script/style enforcement.
 * Nonces allow inline scripts/styles while maintaining strict CSP protection.
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Security-Policy/script-src
 * @see https://www.w3.org/TR/CSP3/#nonce-source
 *
 * @security Nonces must be:
 * - Cryptographically random (unpredictable)
 * - Unique per request (never reused)
 * - At least 128 bits (16 bytes) for security
 * - Base64-encoded for HTTP header compatibility
 */

/**
 * Nonce configuration
 */
export interface NonceConfig {
  /** Nonce length in bytes (default: 32 bytes = 256 bits) */
  length?: number;
  /** Encoding format (default: 'base64') */
  encoding?: 'base64' | 'hex' | 'base64url';
}

/**
 * Generate cryptographically secure random bytes using Web Crypto API
 * Works in Edge Runtime, Node.js, and browsers
 */
function getSecureRandomBytes(length: number): Uint8Array {
  const array = new Uint8Array(length);
  
  // Check for Web Crypto API (Edge Runtime, browsers, Node.js 15+)
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(array);
    return array;
  }
  
  // Fallback for older Node.js (shouldn't happen in Next.js 16)
  throw new Error('No secure random number generator available');
}

/**
 * Generate a cryptographically secure nonce
 *
 * @param config - Nonce configuration
 * @returns Base64-encoded nonce string
 *
 * @example
 * ```typescript
 * const nonce = generateNonce();
 * // Use in CSP header: script-src 'nonce-{nonce}'
 * // Use in script tag: <script nonce="{nonce}">
 * ```
 *
 * @security Uses crypto.getRandomValues() for cryptographic randomness
 */
export function generateNonce(config: NonceConfig = {}): string {
  const {
    length = 32, // 256 bits (exceeds 128-bit minimum)
    encoding = 'base64url', // URL-safe base64 (no + or / characters)
  } = config;

  // Validate length (minimum 16 bytes = 128 bits per NIST)
  if (length < 16) {
    throw new Error(`Nonce length must be at least 16 bytes (128 bits), got ${length}`);
  }

  // Generate cryptographically secure random bytes
  const nonceArray = getSecureRandomBytes(length);

  // Encode based on specified format
  switch (encoding) {
    case 'base64': {
      // Convert Uint8Array to base64
      let binary = '';
      for (let i = 0; i < nonceArray.length; i++) {
        binary += String.fromCharCode(nonceArray[i]);
      }
      return btoa(binary);
    }
    case 'hex': {
      return Array.from(nonceArray)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
    }
    case 'base64url': {
      // URL-safe base64 (replaces + with -, / with _, removes padding)
      let binary = '';
      for (let i = 0; i < nonceArray.length; i++) {
        binary += String.fromCharCode(nonceArray[i]);
      }
      return btoa(binary)
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
    }
    default:
      throw new Error(`Unsupported encoding: ${encoding}`);
  }
}

/**
 * Generate multiple nonces for different CSP directives
 *
 * @param count - Number of nonces to generate
 * @param config - Nonce configuration
 * @returns Array of nonce strings
 *
 * @example
 * ```typescript
 * const [scriptNonce, styleNonce] = generateNonces(2);
 * ```
 */
export function generateNonces(count: number, config?: NonceConfig): string[] {
  if (count < 1) {
    throw new Error('Must generate at least 1 nonce');
  }

  return Array.from({ length: count }, () => generateNonce(config));
}

/**
 * Validate nonce format
 *
 * @param nonce - Nonce string to validate
 * @returns True if nonce appears valid
 *
 * @note This only checks format, not cryptographic strength
 */
export function isValidNonce(nonce: string): boolean {
  if (!nonce || typeof nonce !== 'string') {
    return false;
  }

  // Minimum length check (128 bits = ~22 base64url characters)
  if (nonce.length < 22) {
    return false;
  }

  // Check for valid base64url characters (alphanumeric, -, _)
  const base64urlRegex = /^[A-Za-z0-9_-]+$/;
  if (!base64urlRegex.test(nonce)) {
    return false;
  }

  // Check for valid base64 characters (if using standard base64)
  const base64Regex = /^[A-Za-z0-9+/]+=*$/;
  if (base64Regex.test(nonce)) {
    return true;
  }

  // Check for valid base64url (no padding)
  return base64urlRegex.test(nonce);
}

/**
 * Create CSP header value with nonce
 *
 * @param nonce - Nonce string
 * @param options - CSP options
 * @returns CSP directive string
 *
 * @example
 * ```typescript
 * const csp = createCspDirective('script-src', nonce);
 * // Returns: "script-src 'nonce-abc123...' 'strict-dynamic'"
 * ```
 */
export function createCspDirective(
  directive: string,
  nonce: string,
  options?: {
    strictDynamic?: boolean;
    reportUri?: string;
    additionalSources?: string[];
  }
): string {
  const parts: string[] = [];

  // Add nonce source
  parts.push(`'nonce-${nonce}'`);

  // Add strict-dynamic if enabled (allows trusted scripts to load additional scripts)
  if (options?.strictDynamic) {
    parts.push("'strict-dynamic'");
  }

  // Add additional sources
  if (options?.additionalSources) {
    parts.push(...options.additionalSources);
  }

  // Add report URI if specified
  if (options?.reportUri) {
    parts.push(`report-uri ${options.reportUri}`);
  }

  return `${directive} ${parts.join(' ')}`;
}

/**
 * Generate complete CSP header with nonces
 *
 * @param nonces - Object with nonces for different directives
 * @param options - CSP options
 * @returns Complete Content-Security-Policy header value
 *
 * @example
 * ```typescript
 * const nonces = {
 *   script: generateNonce(),
 *   style: generateNonce(),
 * };
 * const cspHeader = generateCspHeader(nonces);
 * ```
 */
export function generateCspHeader(
  nonces: {
    script?: string;
    style?: string;
  },
  options?: {
    reportUri?: string;
    reportTo?: string;
    upgradeInsecureRequests?: boolean;
  }
): string {
  const directives: string[] = [];

  // Default sources
  const defaultSrc = [
    "'self'",
    'https:',
    "'unsafe-inline'", // Required for some Next.js features
  ];

  // Script source with nonce
  if (nonces.script) {
    directives.push(
      createCspDirective('script-src', nonces.script, {
        strictDynamic: true,
        additionalSources: ["'unsafe-inline'"], // Required for Next.js
        reportUri: options?.reportUri,
      })
    );
  }

  // Style source with nonce
  // In development, allow inline styles for React/CSS-in-JS compatibility
  if (nonces.style) {
    directives.push(
      createCspDirective('style-src', nonces.style, {
        additionalSources: process.env.NODE_ENV === 'production' 
          ? ["'self'"]  // Production: only allow self-hosted styles
          : ["'self'", "'unsafe-inline'"],  // Dev: allow inline for compatibility
        reportUri: options?.reportUri,
      })
    );
  }

  // Default source
  directives.push(`default-src ${defaultSrc.join(' ')}`);

  // Font source
  directives.push("font-src 'self' data: https://fonts.gstatic.com");

  // Image source
  directives.push("img-src 'self' data: https: blob:");

  // Connect source (for fetch/XHR)
  directives.push("connect-src 'self' https:");

  // Frame ancestors - allow same-origin for plugin iframes
  // This is required for the embed plugins to work
  directives.push("frame-ancestors 'self'");

  // Frame sources - allow iframes from same origin and trusted HTTPS sources
  directives.push("frame-src 'self' https:");

  // Base URI
  directives.push("base-uri 'self'");

  // Form action
  directives.push("form-action 'self'");

  // Upgrade insecure requests
  if (options?.upgradeInsecureRequests) {
    directives.push('upgrade-insecure-requests');
  }

  // Report-To directive (modern replacement for report-uri)
  if (options?.reportTo) {
    directives.push(`report-to ${options.reportTo}`);
  }

  return directives.join('; ');
}

/**
 * Nonce storage for request context
 *
 * Stores nonces for the current request to be used in both
 * middleware (headers) and components (script/style tags).
 */
class NonceStore {
  private store = new Map<string, { script?: string; style?: string }>();
  private readonly ttl = 5 * 60 * 1000; // 5 minutes

  /**
   * Set nonces for a request
   */
  set(requestId: string, nonces: { script?: string; style?: string }): void {
    this.store.set(requestId, {
      ...nonces,
      script: nonces.script || generateNonce(),
      style: nonces.style || generateNonce(),
    });

    // Auto-expire after TTL
    setTimeout(() => {
      this.store.delete(requestId);
    }, this.ttl);
  }

  /**
   * Get nonces for a request
   */
  get(requestId: string): { script: string; style: string } | null {
    const nonces = this.store.get(requestId);
    if (!nonces) {
      return null;
    }
    return {
      script: nonces.script!,
      style: nonces.style!,
    };
  }

  /**
   * Delete nonces for a request
   */
  delete(requestId: string): void {
    this.store.delete(requestId);
  }

  /**
   * Clear all stored nonces
   */
  clear(): void {
    this.store.clear();
  }
}

// Singleton instance for request-scoped nonce storage
export const nonceStore = new NonceStore();

/**
 * Generate and store nonces for a request
 *
 * @param requestId - Unique request identifier
 * @returns Generated nonces
 */
export function generateAndStoreNonces(requestId: string): {
  script: string;
  style: string;
} {
  const nonces = {
    script: generateNonce(),
    style: generateNonce(),
  };

  nonceStore.set(requestId, nonces);
  return nonces;
}

/**
 * Get stored nonces for a request
 *
 * @param requestId - Unique request identifier
 * @returns Stored nonces or null if not found
 */
export function getStoredNonces(requestId: string): {
  script: string;
  style: string;
} | null {
  return nonceStore.get(requestId);
}
