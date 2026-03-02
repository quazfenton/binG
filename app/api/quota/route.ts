/**
 * Quota Monitoring API
 * 
 * Real-time quota usage monitoring and alerts.
 * Provides usage statistics, alerts, and quota management.
 * 
 * @see {@link ../../services/quota-manager} QuotaManager
 */

import { NextRequest, NextResponse } from 'next/server';
import { resolveRequestAuth } from '@/lib/auth/request-auth';
import { quotaManager } from '@/lib/services/quota-manager';

/**
 * Quota status response
 */
interface QuotaStatusResponse {
  success: boolean;
  quotas: Array<{
    provider: string;
    used: number;
    limit: number;
    remaining: number;
    percentageUsed: number;
    resetDate: string;
    isDisabled: boolean;
    type: 'calls' | 'hours' | 'sessions';
  }>;
  alerts: Array<{
    type: 'critical' | 'warning' | 'info';
    provider: string;
    message: string;
    percentageUsed: number;
  }>;
  summary: {
    totalProviders: number;
    disabledProviders: number;
    criticalAlerts: number;
    warningAlerts: number;
  };
}

/**
 * GET - Get quota status for all providers
 */
export async function GET(request: NextRequest) {
  try {
    // SECURITY: Require authentication to prevent unauthorized access to internal quota data
    const authResult = await resolveRequestAuth(request, { allowAnonymous: false });
    if (!authResult.success || !authResult.userId) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const quotasData = quotaManager.getAllQuotas();

    // Build response
    const quotas = quotasData.map((s) => {
      const percentageUsed = s.monthlyLimit > 0 ? (s.currentUsage / s.monthlyLimit) * 100 : 0;

      return {
        provider: s.provider,
        used: s.currentUsage,
        limit: s.monthlyLimit,
        remaining: Math.max(0, s.monthlyLimit - s.currentUsage),
        percentageUsed: Math.round(percentageUsed * 100) / 100,
        resetDate: s.resetDate,
        isDisabled: s.isDisabled,
        type: getProviderType(s.provider),
      };
    });

    // Generate alerts
    const alerts = generateAlerts(quotas);

    // Build summary
    const summary = {
      totalProviders: quotas.length,
      disabledProviders: quotas.filter(q => q.isDisabled).length,
      criticalAlerts: alerts.filter(a => a.type === 'critical').length,
      warningAlerts: alerts.filter(a => a.type === 'warning').length,
    };

    return NextResponse.json<QuotaStatusResponse>({
      success: true,
      quotas,
      alerts,
      summary,
    });
  } catch (error: any) {
    return NextResponse.json({
      success: false,
      error: error.message || 'Failed to get quota status',
    }, { status: 500 });
  }
}

/**
 * POST - Reset quota for a provider
 */
export async function POST(request: NextRequest) {
  try {
    // SECURITY: Require authentication to prevent unauthorized quota management
    const authResult = await resolveRequestAuth(request, { allowAnonymous: false });
    if (!authResult.success || !authResult.userId) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { provider, action } = body;

    if (!provider) {
      return NextResponse.json({
        success: false,
        error: 'Provider is required',
      }, { status: 400 });
    }

    if (action === 'reset') {
      quotaManager.resetQuota(provider);
      
      return NextResponse.json({
        success: true,
        message: `Quota reset for provider: ${provider}`,
      });
    } else if (action === 'enable') {
      quotaManager.enableProvider(provider);
      
      return NextResponse.json({
        success: true,
        message: `Provider enabled: ${provider}`,
      });
    } else {
      return NextResponse.json({
        success: false,
        error: `Unknown action: ${action}. Use 'reset' or 'enable'.`,
      }, { status: 400 });
    }
  } catch (error: any) {
    return NextResponse.json({
      success: false,
      error: error.message || 'Failed to process request',
    }, { status: 500 });
  }
}

/**
 * Get provider type based on provider name
 */
function getProviderType(provider: string): 'calls' | 'hours' | 'sessions' {
  const hourBasedProviders = ['e2b', 'sprites', 'blaxel'];
  const sessionBasedProviders = ['daytona', 'runloop', 'microsandbox', 'mistral'];
  
  if (hourBasedProviders.includes(provider)) {
    return 'hours';
  } else if (sessionBasedProviders.includes(provider)) {
    return 'sessions';
  } else {
    return 'calls';
  }
}

/**
 * Generate alerts based on quota usage
 */
function generateAlerts(quotas: Array<{
  provider: string;
  percentageUsed: number;
  isDisabled: boolean;
}>): Array<{
  type: 'critical' | 'warning' | 'info';
  provider: string;
  message: string;
  percentageUsed: number;
}> {
  const alerts: Array<{
    type: 'critical' | 'warning' | 'info';
    provider: string;
    message: string;
    percentageUsed: number;
  }> = [];

  for (const quota of quotas) {
    const { provider, percentageUsed, isDisabled } = quota;

    if (isDisabled) {
      alerts.push({
        type: 'critical',
        provider,
        message: `Provider ${provider} is disabled - quota exceeded`,
        percentageUsed,
      });
    } else if (percentageUsed >= 100) {
      alerts.push({
        type: 'critical',
        provider,
        message: `Provider ${provider} has exceeded quota (${Math.round(percentageUsed)}%)`,
        percentageUsed,
      });
    } else if (percentageUsed >= 90) {
      alerts.push({
        type: 'warning',
        provider,
        message: `Provider ${provider} is nearly at quota limit (${Math.round(percentageUsed)}%)`,
        percentageUsed,
      });
    } else if (percentageUsed >= 80) {
      alerts.push({
        type: 'info',
        provider,
        message: `Provider ${provider} usage is high (${Math.round(percentageUsed)}%)`,
        percentageUsed,
      });
    }
  }

  // Sort by severity
  return alerts.sort((a, b) => {
    const severity = { critical: 0, warning: 1, info: 2 };
    return severity[a.type] - severity[b.type];
  });
}
