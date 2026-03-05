/**
 * Verify Authentication Helper
 *
 * Simple wrapper around the enhanced middleware auth verification
 * for use in API routes that need straightforward auth checking.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth, type EnhancedAuthResult } from './enhanced-middleware';

/**
 * Verify authentication for a request
 * Returns auth result with userId if authenticated, null otherwise
 */
export async function verifyAuth(
  request: NextRequest
): Promise<EnhancedAuthResult | null> {
  try {
    const authResult = await withAuth(request);
    return authResult;
  } catch (error) {
    console.error('[verifyAuth] Error:', error);
    return null;
  }
}

/**
 * Require authentication - throws error if not authenticated
 */
export function requireAuth(authResult: EnhancedAuthResult | null): asserts authResult is EnhancedAuthResult {
  if (!authResult?.success || !authResult?.userId) {
    throw new Error('Authentication required');
  }
}

/**
 * Get user ID from auth result or throw
 */
export function getUserId(authResult: EnhancedAuthResult | null): string {
  if (!authResult?.success || !authResult?.userId) {
    throw new Error('Authentication required');
  }
  return authResult.userId;
}
