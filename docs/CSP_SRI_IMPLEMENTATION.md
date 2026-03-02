# Content Security Policy (CSP) & Subresource Integrity (SRI) Implementation

## Overview

This document describes the enhanced security measures implemented for Content Security Policy (CSP) with cryptographic nonces and Subresource Integrity (SRI) for CDN resources.

## Table of Contents

1. [CSP with Nonce-Based Script Control](#csp-with-nonce-based-script-control)
2. [Subresource Integrity (SRI)](#subresource-integrity-sri)
3. [Implementation Details](#implementation-details)
4. [Usage Guide](#usage-guide)
5. [Monitoring & Reporting](#monitoring--reporting)
6. [Troubleshooting](#troubleshooting)

---

## CSP with Nonce-Based Script Control

### What is CSP Nonce?

A **nonce** (number used once) is a cryptographic token that allows specific inline scripts/styles to execute while blocking all others. This provides stronger security than URL-based CSP alone.

### How It Works

1. **Middleware generates nonce** - Each request gets unique cryptographic nonces
2. **Nonce added to CSP header** - Server sends `Content-Security-Policy: script-src 'nonce-abc123...'`
3. **Nonce added to script tags** - Inline scripts include `<script nonce="abc123...">`
4. **Browser enforcement** - Only scripts with matching nonce execute

### Security Benefits

- ✅ **Prevents XSS** - Attacker-injected scripts without nonce are blocked
- ✅ **Per-request uniqueness** - Nonces can't be reused across requests
- ✅ **Cryptographic strength** - 256-bit random nonces are unpredictable
- ✅ **Backward compatible** - Falls back gracefully if nonce unavailable

### Implementation Files

| File | Purpose |
|------|---------|
| `lib/security/nonce-generator.ts` | Nonce generation utilities |
| `middleware.ts` | Per-request nonce generation |
| `lib/security/use-csp-nonce.ts` | React hooks for nonce access |
| `app/api/csp-report/route.ts` | CSP violation reporting |

### Configuration

```typescript
// In middleware.ts
const nonces = generateAndStoreNonces(requestId);

// CSP header with nonces
const cspHeader = generateCspHeader(nonces, {
  reportUri: '/api/csp-report',
  reportTo: 'csp-endpoint',
  upgradeInsecureRequests: process.env.NODE_ENV === 'production',
});
```

---

## Subresource Integrity (SRI)

### What is SRI?

**Subresource Integrity** allows browsers to verify that externally-hosted resources (CDN scripts, styles) haven't been tampered with by comparing cryptographic hashes.

### How It Works

1. **Generate hash** - Create SHA-384 hash of resource content
2. **Add to HTML** - Include hash in `integrity` attribute
3. **Browser verification** - Browser computes hash and compares
4. **Block on mismatch** - Resource blocked if hash doesn't match

### Security Benefits

- ✅ **Prevents CDN compromise** - Tampered resources are blocked
- ✅ **Mitigates MITM attacks** - Modified in-transit resources rejected
- ✅ **Supply chain security** - Verifies resource integrity
- ✅ **Multiple algorithms** - Supports sha256, sha384, sha512

### Implementation Files

| File | Purpose |
|------|---------|
| `lib/security/sri-generator.ts` | SRI hash generation utilities |
| `scripts/generate-sri.ts` | CLI tool for generating SRI hashes |

### Usage Examples

#### Generate SRI Hash via CLI

```bash
# Single URL
pnpm tsx scripts/generate-sri.ts https://cdn.example.com/script.js

# With specific algorithm
pnpm tsx scripts/generate-sri.ts https://cdn.example.com/script.js -a sha512

# Batch processing
pnpm tsx scripts/generate-sri.ts --batch urls.txt -o sri-hashes.json
```

#### Generate SRI Hash Programmatically

```typescript
import { generateSRIHash, fetchAndHashResource } from '@/lib/security/sri-generator';

// For inline content
const sri = generateSRIHash('<script>console.log("hello")</script>');
console.log(sri.integrity); // "sha384-..."

// For remote resource
const remoteSri = await fetchAndHashResource('https://cdn.example.com/app.js');
console.log(remoteSri.integrity); // "sha384-..."
```

#### Use in HTML/JSX

```tsx
// With SRI
<script
  src="https://cdn.example.com/app.js"
  integrity="sha384-oqVuAfXRKap7fdgcCY5uykM6+R9GqQ8K/uxy9rx7HNQlGYl1kPzQho1wx4JwY8wC"
  crossOrigin="anonymous"
/>

// With both SRI and CSP nonce
<script
  src="https://cdn.example.com/app.js"
  integrity="sha384-..."
  crossOrigin="anonymous"
  nonce={scriptNonce}
/>
```

---

## Implementation Details

### Nonce Generation

```typescript
// lib/security/nonce-generator.ts
export function generateNonce(config: NonceConfig = {}): string {
  const {
    length = 32, // 256 bits
    encoding = 'base64url',
  } = config;

  const nonceBuffer = randomBytes(length);
  
  // URL-safe base64 encoding
  return nonceBuffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
```

### SRI Hash Generation

```typescript
// lib/security/sri-generator.ts
export function generateSRIHash(
  content: string | Buffer,
  algorithm: SRIAlgorithm = 'sha384'
): SRIHash {
  const buffer = typeof content === 'string' 
    ? Buffer.from(content, 'utf8') 
    : content;

  const hash = createHash(algorithm).update(buffer).digest('base64');

  return {
    algorithm,
    hash,
    integrity: `${algorithm}-${hash}`,
  };
}
```

### Middleware Integration

```typescript
// middleware.ts
export function middleware(request: NextRequest) {
  // Generate unique nonces
  const requestId = request.headers.get('x-request-id') || 
                    `req_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  
  const nonces = generateAndStoreNonces(requestId);

  const response = NextResponse.next();

  // Add nonces to headers for component access
  response.headers.set('x-csp-nonce-script', nonces.script);
  response.headers.set('x-csp-nonce-style', nonces.style);

  // Generate CSP header with nonces
  const cspHeader = generateCspHeader(nonces, {
    reportUri: '/api/csp-report',
    upgradeInsecureRequests: process.env.NODE_ENV === 'production',
  });
  
  response.headers.set('Content-Security-Policy', cspHeader);

  return response;
}
```

---

## Usage Guide

### Using Nonces in Components

#### Server Components (Next.js App Router)

```tsx
// app/page.tsx
import { getCSPNonce } from '@/lib/security/use-csp-nonce';

export default async function Page() {
  const { scriptNonce, styleNonce } = await getCSPNonce();

  return (
    <>
      <script nonce={scriptNonce} dangerouslySetInnerHTML={{ __html: '...' }} />
      <style nonce={styleNonce}>{`.my-class { color: red; }`}</style>
    </>
  );
}
```

#### Client Components

```tsx
// components/my-component.tsx
'use client';

import { useCSPNonce, CSPScript, CSPStyle } from '@/lib/security/use-csp-nonce';

export function MyComponent() {
  const { scriptNonce, styleNonce } = useCSPNonce();

  return (
    <>
      <CSPScript>
        console.log('CSP-compliant inline script');
      </CSPScript>
      
      <CSPStyle>
        {`.my-class { color: blue; }`}
      </CSPStyle>
    </>
  );
}
```

### Generating SRI for Build Assets

```bash
# After build, generate SRI for all assets
pnpm tsx scripts/generate-sri.ts --batch dist-urls.txt -o sri-manifest.json
```

### Environment Variables

```bash
# .env.local
# CSP Configuration
CSP_REPORT_URI=/api/csp-report

# SRI Configuration  
ENABLE_SRI=true

# Optional: Custom SRI algorithm (default: sha384)
SRI_ALGORITHM=sha512
```

---

## Monitoring & Reporting

### CSP Violation Reports

CSP violations are automatically sent to `/api/csp-report`. The endpoint:

1. **Validates report structure**
2. **Analyzes violation severity** (low/medium/high/critical)
3. **Logs with context** (user agent, IP, timestamp)
4. **Alerts on critical violations**

### Viewing Reports

```bash
# Check recent CSP violations
curl https://your-app.com/api/csp-report

# Sample response
{
  "csp-report": {
    "blocked-uri": "https://evil.com/malicious.js",
    "document-uri": "https://example.com/page",
    "effective-directive": "script-src",
    "original-policy": "default-src 'self'; script-src 'self' 'nonce-abc123'",
    "source-file": "https://example.com/page",
    "line-number": 42
  }
}
```

### Severity Levels

| Severity | Category | Action Required |
|----------|----------|-----------------|
| Critical | potential-xss | Immediate investigation |
| High | insecure-script | Review and fix |
| Medium | inline-script/style | Add nonce or move to external file |
| Low | expected-block/third-party | Monitor, may be legitimate |

---

## Troubleshooting

### Common Issues

#### 1. Scripts Blocked After Deploy

**Symptom**: Legitimate scripts stopped working after CSP implementation

**Solution**:
```tsx
// Add nonce to script
const { scriptNonce } = useCSPNonce();
<script nonce={scriptNonce}>...</script>

// OR move to external file
<script src="/path/to/script.js"></script>
```

#### 2. SRI Hash Mismatch

**Symptom**: Browser console shows "SRI hash mismatch" error

**Solution**:
```bash
# Regenerate SRI hash
pnpm tsx scripts/generate-sri.ts https://cdn.example.com/script.js

# Verify resource hasn't changed
curl -I https://cdn.example.com/script.js
```

#### 3. Nonce Not Working

**Symptom**: Scripts with nonce still blocked

**Solution**:
1. Check middleware is running
2. Verify nonce in headers: `x-csp-nonce-script`
3. Ensure nonce in script matches CSP header

#### 4. CSP Report Not Received

**Symptom**: No reports at `/api/csp-report`

**Solution**:
```bash
# Check browser support
# Modern browsers support report-uri and Report-To

# Verify endpoint is accessible
curl -X POST https://your-app.com/api/csp-report \
  -H "Content-Type: application/json" \
  -d '{"csp-report": {...}}'
```

### Debugging Tips

```typescript
// Enable CSP debug logging
// In middleware.ts
console.log('[CSP] Generated nonces:', {
  script: nonces.script.substring(0, 20) + '...',
  style: nonces.style.substring(0, 20) + '...',
});

// Check CSP header in browser DevTools
// Application > Cookies > [your-domain] > View headers

// Test CSP without enforcing (report-only mode)
// Change header to: Content-Security-Policy-Report-Only
```

---

## Security Best Practices

### DO ✅

- Generate unique nonces per request
- Use SHA-384 or SHA-512 for SRI
- Verify SRI hashes periodically
- Monitor CSP violation reports
- Use `crossorigin="anonymous"` with SRI
- Implement strict CSP in production

### DON'T ❌

- Reuse nonces across requests
- Use SHA-1 for SRI (broken)
- Include `'unsafe-inline'` in production CSP
- Include `'unsafe-eval'` unless absolutely necessary
- Allow `data:` in script-src
- Ignore critical CSP violations

---

## References

- [MDN CSP Documentation](https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP)
- [MDN SRI Documentation](https://developer.mozilla.org/en-US/docs/Web/Security/Subresource_Integrity)
- [W3C CSP Level 3](https://www.w3.org/TR/CSP3/)
- [W3C SRI Specification](https://w3c.github.io/webappsec-subresource-integrity/)
- [CSP Evaluator](https://csp-evaluator.withgoogle.com/)
- [SRI Hash Generator](https://www.srihash.org/)
