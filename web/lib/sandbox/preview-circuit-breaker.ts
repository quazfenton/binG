// web/lib/sandbox/preview-circuit-breaker.ts

const FAILURE_LIMIT = 3;
const failureCounts = new Map<string, number>();

export function recordFailure(provider: string) {
  const count = (failureCounts.get(provider) || 0) + 1;
  failureCounts.set(provider, count);
  if (count >= FAILURE_LIMIT) {
    console.warn(`[CircuitBreaker] Blacklisting provider: ${provider} due to repeated failures.`);
  }
}

export function isBlacklisted(provider: string): boolean {
  return (failureCounts.get(provider) || 0) >= FAILURE_LIMIT;
}

export function resetFailure(provider: string) {
    failureCounts.delete(provider);
}
