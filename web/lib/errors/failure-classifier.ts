/**
 * failure-classifier.ts
 * 
 * Semantic classification of errors to drive intelligent recovery policies.
 */

export type FailureType = 'PERMANENT' | 'TRANSIENT' | 'RECOVERABLE' | 'CRASH' | 'UNKNOWN';

// trycloudflare/stale-tunnel DNS errors: a stale tunnel returns 530 or 1016 from
// the Cloudflare edge, or presents as a DNS resolution failure (ENOTFOUND, EAI_AGAIN)
// when the tunnel domain no longer resolves. These are permanent for the provider's
// current endpoint — retrying the same tunnel will produce the same error.
export const TUNNEL_DNS_ERROR = /530|1016|trycloudflare|cloudflare.*(?:dns|tunnel)|ENOTFOUND|EAI_AGAIN|getaddrinfo.*(?:tunnel|cloudflare)|fetch.*failed.*tunnel/i;

const CLI_ERROR_PATTERNS = {
  PERMANENT: /ENOENT|not found|No such file|command not found/i,
  TRANSIENT: /ECONNRESET|timeout|ETIMEDOUT|503|504|Service Unavailable/i,
  RECOVERABLE: /SyntaxError|Unexpected token|JSON\.parse|invalid response/i,
  CRASH: /Segmentation fault|Bus error|SIGKILL|SIGSEGV/i,
};

/**
 * Classifies an error into a category for decision-making
 */
export function classifyFailure(error: any): FailureType {
  const msg = (error.message || '').toString();
  
  // Trycloudflare/stale-tunnel DNS errors are permanent — retrying the same stale
  // tunnel endpoint will produce the same DNS error. The system should immediately
  // fail over to a different provider rather than exhausting retries on a dead tunnel.
  if (TUNNEL_DNS_ERROR.test(msg)) return 'PERMANENT';

  if (CLI_ERROR_PATTERNS.PERMANENT.test(msg)) return 'PERMANENT';
  if (CLI_ERROR_PATTERNS.TRANSIENT.test(msg)) return 'TRANSIENT';
  if (CLI_ERROR_PATTERNS.RECOVERABLE.test(msg)) return 'RECOVERABLE';
  if (CLI_ERROR_PATTERNS.CRASH.test(msg)) return 'CRASH';
  
  return 'UNKNOWN';
}
