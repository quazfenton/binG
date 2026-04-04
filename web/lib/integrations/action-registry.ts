/**
 * Action Handler Registry
 *
 * Pluggable provider-action handler system. Each provider registers
 * its own handler(s), and the execute route dispatches to the correct
 * handler without hard-coded switch cases.
 *
 * Benefits:
 * - Adding a new provider = registerHandler(), no route.ts edits
 * - Each handler is independently testable
 * - Handlers can declare their own validation schemas
 * - Supports batch execution across multiple providers
 */

import { NextResponse } from 'next/server';
import { createLogger } from '@/lib/utils/logger';
import { recordAudit, hashParams } from './execution-audit';

const logger = createLogger('Integrations:ActionRegistry');

/**
 * Standard execution result envelope
 */
export interface ExecutionResult<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  /** HTTP status code (defaults to 200 for success, 400/401/500 for errors) */
  statusCode?: number;
  /** If auth is required but user is not connected */
  requiresAuth?: boolean;
  /** OAuth redirect URL if requiresAuth is true */
  authUrl?: string;
  /** Suggested next action for the client */
  suggestion?: string;
  /** Execution metadata (for observability) */
  metadata?: {
    provider: string;
    action: string;
    durationMs: number;
    cached?: boolean;
  };
}

/**
 * Handler context — available to all action handlers
 */
export interface HandlerContext {
  userId: string;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Action handler function signature
 */
export type ActionHandler = (
  action: string,
  params: Record<string, any>,
  context: HandlerContext,
) => Promise<ExecutionResult>;

/**
 * Provider registration
 */
interface ProviderRegistration {
  handler: ActionHandler;
  /** List of actions this provider supports (for validation) */
  actions: Set<string>;
  /** Whether this provider requires OAuth */
  requiresAuth: boolean;
}

/**
 * Central action registry singleton
 */
class ActionRegistry {
  private providers = new Map<string, ProviderRegistration>();

  /**
   * Register a provider with its handler
   */
  registerProvider(
    provider: string,
    handler: ActionHandler,
    actions: string[],
    requiresAuth = true,
  ): void {
    this.providers.set(provider, {
      handler,
      actions: new Set(actions.map(a => a.toLowerCase())),
      requiresAuth,
    });
    logger.info(`Registered provider: ${provider} (${actions.length} actions${requiresAuth ? ', requires auth' : ''})`);
  }

  /**
   * Check if a provider is registered
   */
  hasProvider(provider: string): boolean {
    return this.providers.has(provider.toLowerCase());
  }

  /**
   * Check if a provider supports a specific action
   */
  supportsAction(provider: string, action: string): boolean {
    const reg = this.providers.get(provider.toLowerCase());
    if (!reg) return false;
    // Wildcard support: if actions set is empty, accept all
    if (reg.actions.size === 0) return true;
    return reg.actions.has(action.toLowerCase());
  }

  /**
   * Get all registered providers
   */
  getRegisteredProviders(): string[] {
    return Array.from(this.providers.keys());
  }

  /**
   * Get actions supported by a specific provider
   */
  getProviderActions(provider: string): string[] {
    const reg = this.providers.get(provider.toLowerCase());
    if (!reg) return [];
    return Array.from(reg.actions);
  }

  /**
   * Check if a provider requires OAuth
   */
  providerRequiresAuth(provider: string): boolean {
    const reg = this.providers.get(provider.toLowerCase());
    return reg?.requiresAuth ?? true;
  }

  /**
   * Execute an action — the main dispatch point
   * Handles audit logging, timing, and error normalization
   */
  async execute(
    provider: string,
    action: string,
    params: Record<string, any>,
    context: HandlerContext,
  ): Promise<NextResponse> {
    const startTime = Date.now();
    const providerKey = provider.toLowerCase();
    const actionKey = action.toLowerCase();
    const reg = this.providers.get(providerKey);

    if (!reg) {
      return NextResponse.json({
        success: false,
        error: `Provider '${provider}' is not registered`,
        availableProviders: this.getRegisteredProviders(),
      }, { status: 400 });
    }

    if (!this.supportsAction(provider, action)) {
      return NextResponse.json({
        success: false,
        error: `Action '${action}' is not supported by provider '${provider}'`,
        supportedActions: Array.from(reg.actions),
      }, { status: 400 });
    }

    try {
      const result = await reg.handler(actionKey, params, context);
      const durationMs = Date.now() - startTime;

      // Record audit
      recordAudit({
        userId: context.userId,
        provider: providerKey,
        action: actionKey,
        paramsHash: hashParams(params),
        success: result.success,
        error: result.error,
        durationMs,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      });

      const statusCode = result.statusCode ?? (result.success ? 200 : (result.requiresAuth ? 401 : 500));

      return NextResponse.json({
        success: result.success,
        data: result.data,
        error: result.error,
        requiresAuth: result.requiresAuth,
        authUrl: result.authUrl,
        suggestion: result.suggestion,
        metadata: {
          provider: providerKey,
          action: actionKey,
          durationMs,
          cached: result.metadata?.cached,
        },
      }, { status: statusCode });

    } catch (error: any) {
      const durationMs = Date.now() - startTime;

      // Record failed audit
      recordAudit({
        userId: context.userId,
        provider: providerKey,
        action: actionKey,
        paramsHash: hashParams(params),
        success: false,
        error: error.message?.slice(0, 500),
        durationMs,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      });

      logger.error(`Execution failed: ${provider}:${action}`, error);

      return NextResponse.json({
        success: false,
        error: `Execution failed: ${error.message}`,
        metadata: {
          provider: providerKey,
          action: actionKey,
          durationMs,
        },
      }, { status: 500 });
    }
  }
}

/**
 * Singleton instance
 */
export const actionRegistry = new ActionRegistry();
