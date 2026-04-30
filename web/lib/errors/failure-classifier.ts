/**
 * failure-classifier.ts
 * 
 * Semantic classification of errors to drive intelligent recovery policies.
 */

export type FailureType = 'PERMANENT' | 'TRANSIENT' | 'RECOVERABLE' | 'CRASH' | 'UNKNOWN';

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
  
  if (CLI_ERROR_PATTERNS.PERMANENT.test(msg)) return 'PERMANENT';
  if (CLI_ERROR_PATTERNS.TRANSIENT.test(msg)) return 'TRANSIENT';
  if (CLI_ERROR_PATTERNS.RECOVERABLE.test(msg)) return 'RECOVERABLE';
  if (CLI_ERROR_PATTERNS.CRASH.test(msg)) return 'CRASH';
  
  return 'UNKNOWN';
}
