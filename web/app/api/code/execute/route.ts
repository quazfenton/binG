/**
 * Code Execution API
 *
 * POST /api/code/execute - Execute code (requires authentication)
 * GET /api/code/templates - Get code templates (public)
 *
 * SECURITY: Code execution endpoints require authentication via withAuth middleware.
 * Rate limited to 10 executions per user per hour to prevent abuse.
 * All executions are audit-logged with user context.
 */

import { NextRequest, NextResponse } from 'next/server';


import { executeCode, getCodeTemplate, type CodeLanguage } from '@/lib/code-executor/code-executor';
import { withAuth, logSecurityEvent, type EnhancedAuthResult } from '@/lib/auth/enhanced-middleware';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('API:Code:Execute');

// Per-user rate limiter for code execution: 10 executions per hour
const executionCounts = new Map<string, { count: number; resetAt: number }>();
const MAX_EXECUTIONS_PER_HOUR = 10;
const HOUR_MS = 60 * 60 * 1000;
const MAX_RATE_LIMIT_ENTRIES = 10000; // Prevent unbounded memory growth

function checkExecutionRateLimit(userId: string): { allowed: boolean; remaining: number } {
  const now = Date.now();
  
  // Periodic cleanup: remove expired entries to prevent memory leak
  if (executionCounts.size > MAX_RATE_LIMIT_ENTRIES) {
    const keysToDelete: string[] = [];
    executionCounts.forEach((val, key) => {
      if (now >= val.resetAt) keysToDelete.push(key);
    });
    keysToDelete.forEach(key => executionCounts.delete(key));
  }
  
  const entry = executionCounts.get(userId);
  
  if (!entry || now >= entry.resetAt) {
    executionCounts.set(userId, { count: 1, resetAt: now + HOUR_MS });
    return { allowed: true, remaining: MAX_EXECUTIONS_PER_HOUR - 1 };
  }
  
  if (entry.count >= MAX_EXECUTIONS_PER_HOUR) {
    return { allowed: false, remaining: 0 };
  }
  
  entry.count++;
  return { allowed: true, remaining: MAX_EXECUTIONS_PER_HOUR - entry.count };
}

// POST handler (authenticated + rate limited) — inner function, not exported
const handlePost = async (request: NextRequest, auth: EnhancedAuthResult) => {
  try {
    // Rate limit per user
    const userId = auth.userId || 'anonymous';
    const rateLimit = checkExecutionRateLimit(userId);
    
    if (!rateLimit.allowed) {
      logSecurityEvent({
        type: 'code_execution_rate_limited',
        userId,
        details: { path: '/api/code/execute' },
      }, request);
      
      return NextResponse.json(
        { error: 'Code execution rate limit exceeded. Maximum 10 executions per hour.' },
        { status: 429, headers: { 'X-RateLimit-Remaining': '0' } }
      );
    }

    const body = await request.json();
    const { code, language, stdin, timeout } = body;

    // Validate input
    if (!code || typeof code !== 'string') {
      return NextResponse.json(
        { error: 'Code is required' },
        { status: 400 }
      );
    }

    const validLanguages: CodeLanguage[] = [
      'javascript', 'typescript', 'python', 'html', 'css', 'sql', 'bash', 'json'
    ];

    if (!validLanguages.includes(language)) {
      return NextResponse.json(
        { error: `Invalid language. Must be one of: ${validLanguages.join(', ')}` },
        { status: 400 }
      );
    }

    // Audit log before execution
    logger.info('Code execution requested', {
      userId,
      language,
      codeLength: code.length,
    });

    // Execute code via sandbox (never eval)
    const result = await executeCode({
      code,
      language,
      stdin,
      timeout: Math.min(timeout || 10000, 30000), // Max 30s timeout
    });

    // Audit log after execution
    logger.info('Code execution completed', {
      userId,
      language,
      success: result.success,
      executionTime: result.executionTime,
    });

    const response = NextResponse.json({
      success: result.success,
      ...result,
    });
    
    response.headers.set('X-RateLimit-Remaining', rateLimit.remaining.toString());
    return response;
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error('Code execution failed:', { error: errMsg });
    return NextResponse.json(
      { error: errMsg || 'Failed to execute code' },
      { status: 500 }
    );
  }
};

// Export POST handler wrapped with auth middleware (matches codebase convention)
export const POST = withAuth(handlePost, { requiredRoles: ['user'] });

// GET - Get code template (public — no auth needed for templates)
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const language = searchParams.get('language') as CodeLanguage;

    const validLanguages: CodeLanguage[] = [
      'javascript', 'typescript', 'python', 'html', 'css', 'sql', 'bash', 'json'
    ];

    if (!language || !validLanguages.includes(language)) {
      return NextResponse.json(
        { error: `Invalid language. Must be one of: ${validLanguages.join(', ')}` },
        { status: 400 }
      );
    }

    const template = getCodeTemplate(language);

    return NextResponse.json({
      success: true,
      language,
      template,
    });
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error('Failed to get template:', { error: errMsg });
    return NextResponse.json(
      { error: 'Failed to get template' },
      { status: 500 }
    );
  }
}
