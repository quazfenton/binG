/**
 * CSP Report Endpoint
 *
 * Receives and logs Content Security Policy violation reports.
 * Helps identify legitimate inline scripts that need nonces.
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Security-Policy/report-uri
 * @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Security-Policy-Report-Only
 */

import { NextRequest, NextResponse } from 'next/server';

export interface CSPReport {
  'csp-report': {
    'blocked-uri': string;
    'document-uri': string;
    'effective-directive': string;
    'original-policy': string;
    'referrer': string;
    'script-sample'?: string;
    'source-file': string;
    'line-number'?: number;
    'column-number'?: number;
    'status-code'?: number;
    'violated-directive'?: string;
    'disposition'?: string;
  };
}

/**
 * Validate CSP report structure
 */
function isValidCSPReport(body: any): body is CSPReport {
  if (!body || typeof body !== 'object') {
    return false;
  }

  const report = body['csp-report'];
  if (!report || typeof report !== 'object') {
    return false;
  }

  // Required fields
  if (typeof report['blocked-uri'] !== 'string') {
    return false;
  }

  if (typeof report['document-uri'] !== 'string') {
    return false;
  }

  if (typeof report['effective-directive'] !== 'string') {
    return false;
  }

  return true;
}

/**
 * Analyze CSP violation for security issues
 */
function analyzeViolation(report: CSPReport['csp-report']): {
  severity: 'low' | 'medium' | 'high' | 'critical';
  category: string;
  recommendation: string;
} {
  const blockedUri = report['blocked-uri'];
  const directive = report['effective-directive'];

  // Critical: Attempted loading from malicious sources
  if (
    blockedUri.includes('data:') &&
    (directive.includes('script') || directive.includes('worker'))
  ) {
    return {
      severity: 'critical',
      category: 'potential-xss',
      recommendation: 'Investigate potential XSS attack via data: URI',
    };
  }

  // High: External script blocking
  if (
    blockedUri.startsWith('http://') &&
    directive.includes('script')
  ) {
    return {
      severity: 'high',
      category: 'insecure-script',
      recommendation: 'Script loaded over HTTP instead of HTTPS',
    };
  }

  // Medium: Inline script blocking (expected with strict CSP)
  if (directive.includes('script-src') && blockedUri === 'inline') {
    return {
      severity: 'medium',
      category: 'inline-script',
      recommendation: 'Add nonce to inline script or move to external file',
    };
  }

  // Medium: Inline style blocking
  if (directive.includes('style-src') && blockedUri === 'inline') {
    return {
      severity: 'medium',
      category: 'inline-style',
      recommendation: 'Add nonce to inline style or move to external file',
    };
  }

  // Low: Expected blocking of eval/unsafe
  if (blockedUri.includes('eval') || directive.includes('unsafe')) {
    return {
      severity: 'low',
      category: 'expected-block',
      recommendation: 'Expected behavior - unsafe script execution blocked',
    };
  }

  // Low: Third-party resource blocking
  if (
    blockedUri.startsWith('https://') &&
    !blockedUri.includes(window.location.hostname)
  ) {
    return {
      severity: 'low',
      category: 'third-party',
      recommendation: 'Consider adding domain to CSP if legitimate',
    };
  }

  return {
    severity: 'low',
    category: 'other',
    recommendation: 'Review CSP policy',
  };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Validate report structure
    if (!isValidCSPReport(body)) {
      return NextResponse.json(
        { error: 'Invalid CSP report format' },
        { status: 400 }
      );
    }

    const report = body['csp-report'];

    // Analyze violation
    const analysis = analyzeViolation(report);

    // Log violation with analysis
    const logEntry = {
      timestamp: new Date().toISOString(),
      report,
      analysis,
      userAgent: request.headers.get('user-agent'),
      ip: request.headers.get('x-forwarded-for') || 'unknown',
    };

    // In production, send to logging service (e.g., Sentry, Datadog)
    console.log('[CSP Violation]', JSON.stringify(logEntry, null, 2));

    // Track critical violations for alerting
    if (analysis.severity === 'critical' || analysis.severity === 'high') {
      console.error(
        '[CSP Critical Violation]',
        JSON.stringify({
          severity: analysis.severity,
          category: analysis.category,
          blockedUri: report['blocked-uri'],
          sourceFile: report['source-file'],
          recommendation: analysis.recommendation,
        })
      );

      // TODO: Send alert to monitoring service
      // await sendAlert({
      //   type: 'csp-violation',
      //   severity: analysis.severity,
      //   details: logEntry,
      // });
    }

    // Store violation in database for analysis
    // TODO: Implement database storage
    // await db.cspViolations.create({ data: logEntry });

    return NextResponse.json({
      success: true,
      message: 'CSP report received',
    });
  } catch (error) {
    console.error('[CSP Report] Error processing report:', error);
    return NextResponse.json(
      { error: 'Failed to process CSP report' },
      { status: 500 }
    );
  }
}

export async function GET() {
  // Return CSP report endpoint documentation
  return NextResponse.json({
    endpoint: '/api/csp-report',
    method: 'POST',
    description: 'Content Security Policy violation reporting endpoint',
    format: {
      'csp-report': {
        'blocked-uri': 'The URI of the resource that was blocked',
        'document-uri': 'The URI of the document where the violation occurred',
        'effective-directive': 'The CSP directive that was violated',
        'original-policy': 'The original CSP policy',
        'referrer': 'The referrer of the document',
        'source-file': 'The source file where the violation occurred',
        'line-number': 'The line number (optional)',
        'column-number': 'The column number (optional)',
      },
    },
    example: {
      'csp-report': {
        'blocked-uri': 'https://evil.com/malicious.js',
        'document-uri': 'https://example.com/page',
        'effective-directive': 'script-src',
        'original-policy': "default-src 'self'; script-src 'self' 'nonce-abc123'",
        'referrer': 'https://google.com',
        'source-file': 'https://example.com/page',
        'line-number': 42,
        'column-number': 12,
      },
    },
  });
}
