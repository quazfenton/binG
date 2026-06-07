/**
 * Secret Broker — Environment Variable Virtualization Layer
 *
 * Sits between env var access and actual secret values. Instead of passing
 * real API keys, database URLs, or tokens in sandbox environment variables
 * (where they could be leaked through logs, error messages, $env introspection,
 * or child process inheritance), the SecretBroker:
 *
 *   1. Encrypts secrets at rest using AES-256-GCM
 *   2. Replaces real values with placeholder references in sandbox env vars
 *   3. Logs all access attempts for audit trail
 *   4. Resolves secrets on-demand at the point of use
 *
 * Usage flow:
 *   ```
 *   const broker = getSecretBroker();
 *   await broker.setSecret('OPENAI_API_KEY', 'sk-...', { ownerId: 'user123' });
 *
 *   // When creating a sandbox:
 *   const env = broker.virtualizeEnvVars({
 *     OPENAI_API_KEY: 'sk-...',     // replaced with placeholder
 *     USER_ID: 'user123',           // passed through as-is
 *   });
 *   // env = { OPENAI_API_KEY: '__SB__OPENAI_API_KEY__', USER_ID: 'user123' }
 *
 *   // In the execution router, resolve before actually using:
 *   const actualKey = await broker.resolveSecret('OPENAI_API_KEY');
 *   ```
 *
 * @see lib/terminal/execution-router.ts — Uses SecretBroker for env resolution
 * @see lib/sandbox/sandbox-orchestrator.ts — Uses SecretBroker in createSandboxHandle
 */

import { createHash, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('SecretBroker');

// ============================================================================
// Types
// ============================================================================

export interface StoredSecret {
  /** Unique key for the secret */
  key: string;
  /** AES-256-GCM encrypted value (base64-encoded) */
  encryptedValue: string;
  /** Initialization vector for decryption (base64-encoded) */
  iv: string;
  /** Auth tag for GCM verification (base64-encoded) */
  authTag: string;
  /** When the secret was stored */
  createdAt: number;
  /** Last time the secret was accessed */
  lastAccessedAt: number | null;
  /** Number of times this secret has been accessed */
  accessCount: number;
  /** Optional owner/user scope */
  ownerId?: string;
  /** Optional list of process patterns allowed to access this secret */
  allowedProcesses?: string[];
  /** Whether this secret is "virtual" (a placeholder, not a real value) */
  isVirtual: boolean;
}

export interface AccessLogEntry {
  /** Secret key that was accessed */
  key: string;
  /** When the access occurred */
  timestamp: number;
  /** Access type: 'resolve' | 'inject' | 'virtualize' */
  type: 'resolve' | 'inject' | 'virtualize';
  /** Optional context (sandbox ID, process name, etc.) */
  context?: string;
  /** Whether the access was allowed */
  allowed: boolean;
}

export interface SecretBrokerConfig {
  /**
   * Encryption key. If not provided, falls back to SECRET_BROKER_KEY env var.
   * If neither is set, uses a derived key from the app's main secret.
   * WARNING: In-memory only — the derived key is not persisted across restarts.
   */
  encryptionKey?: string;
  /** Prefix for placeholder values (default: '__SB__') */
  placeholderPrefix?: string;
  /** Suffix for placeholder values (default: '__') */
  placeholderSuffix?: string;
  /** Whether to enable access logging (default: true) */
  enableAuditLog?: boolean;
}

// ============================================================================
// SecretBroker Implementation
// ============================================================================

export class SecretBroker {
  private secrets = new Map<string, StoredSecret>();
  private accessLog: AccessLogEntry[] = [];
  private readonly MAX_LOG_SIZE = 10_000;

  /** AES-256-GCM key (32 bytes) */
  private readonly key: Buffer;
  private readonly placeholderPrefix: string;
  private readonly placeholderSuffix: string;
  private readonly enableAuditLog: boolean;

  private static readonly PLACEHOLDER_REGEX = /__SB__([A-Z0-9_]+)__/g;

  constructor(config: SecretBrokerConfig = {}) {
    this.placeholderPrefix = config.placeholderPrefix || '__SB__';
    this.placeholderSuffix = config.placeholderSuffix || '__';
    this.enableAuditLog = config.enableAuditLog !== false;

    // Derive encryption key
    const rawKey = config.encryptionKey || process.env.SECRET_BROKER_KEY || process.env.APP_SECRET;
    if (rawKey) {
      this.key = createHash('sha256').update(rawKey).digest();
    } else {
      // Generate an ephemeral key — valid only for this process lifetime
      logger.warn(
        'No encryption key configured for SecretBroker. ' +
        'Secrets will use an ephemeral key that is lost on restart. ' +
        'Set SECRET_BROKER_KEY or APP_SECRET environment variable.',
      );
      this.key = randomBytes(32);
    }
  }

  // ==========================================================================
  // Core API
  // ==========================================================================

  /**
   * Store a secret value. The value is encrypted at rest using AES-256-GCM.
   *
   * @param key - Unique identifier for the secret (e.g., 'OPENAI_API_KEY')
   * @param value - The actual secret value
   * @param options - Owner, access control, etc.
   */
  async setSecret(
    key: string,
    value: string,
    options?: {
      ownerId?: string;
      allowedProcesses?: string[];
    },
  ): Promise<void> {
    const iv = randomBytes(12); // 96-bit IV for GCM
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);

    let encrypted = cipher.update(value, 'utf8', 'base64');
    encrypted += cipher.final('base64');
    const authTag = cipher.getAuthTag().toString('base64');

    const secret: StoredSecret = {
      key,
      encryptedValue: encrypted,
      iv: iv.toString('base64'),
      authTag,
      createdAt: Date.now(),
      lastAccessedAt: null,
      accessCount: 0,
      ownerId: options?.ownerId,
      allowedProcesses: options?.allowedProcesses,
      isVirtual: false,
    };

    this.secrets.set(key, secret);
    logger.debug('Secret stored', { key, ownerId: options?.ownerId });
  }

  /**
   * Retrieve and decrypt a secret value.
   * Logs the access for audit trail.
   *
   * @param key - The secret key
   * @param context - Optional context for audit logging (sandbox ID, process, etc.)
   * @returns The decrypted value, or null if not found
   */
  async getSecret(key: string, context?: string): Promise<string | null> {
    const secret = this.secrets.get(key);
    if (!secret) {
      this.logAccess({ key, type: 'resolve', context, allowed: false });
      return null;
    }

    try {
      const iv = Buffer.from(secret.iv, 'base64');
      const authTag = Buffer.from(secret.authTag, 'base64');
      const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
      decipher.setAuthTag(authTag);

      let decrypted = decipher.update(secret.encryptedValue, 'base64', 'utf8');
      decrypted += decipher.final('utf8');

      secret.lastAccessedAt = Date.now();
      secret.accessCount++;

      this.logAccess({ key, type: 'resolve', context, allowed: true });
      return decrypted;
    } catch (err: any) {
      logger.error('Secret decryption failed', { key, error: err.message });
      this.logAccess({ key, type: 'resolve', context, allowed: false });
      return null;
    }
  }

  /**
   * Check if a secret exists.
   */
  async hasSecret(key: string): Promise<boolean> {
    return this.secrets.has(key);
  }

  /**
   * Delete a secret.
   */
  async deleteSecret(key: string): Promise<boolean> {
    const existed = this.secrets.delete(key);
    if (existed) {
      logger.debug('Secret deleted', { key });
    }
    return existed;
  }

  // ==========================================================================
  // Env Var Virtualization
  // ==========================================================================

  /**
   * Virtualize environment variables by replacing known secret values with
   * placeholder references. Non-secret env vars pass through unchanged.
   *
   * Use this when building the env vars dict for sandbox creation — it ensures
   * real API keys never leak into sandbox env vars, logs, or error messages.
   *
   * @param envVars - The raw env vars dict (e.g., from workspaceEnv)
   * @param options - Owner context
   * @returns Env vars dict with secrets replaced by placeholders
   */
  virtualizeEnvVars(
    envVars: Record<string, string>,
    options?: { ownerId?: string },
  ): Record<string, string> {
    const result: Record<string, string> = {};

    for (const [key, value] of Object.entries(envVars)) {
      // Check if the value matches a known secret (stored by key name)
      const stored = this.secrets.get(key);
      if (stored) {
        // Replace with placeholder reference
        result[key] = `${this.placeholderPrefix}${key}${this.placeholderSuffix}`;
        this.logAccess({ key, type: 'virtualize', context: options?.ownerId, allowed: true });
      } else {
        // Also check by value — if this value is stored under any secret
        const matchedKey = this.findKeyByValue(value);
        if (matchedKey) {
          result[key] = `${this.placeholderPrefix}${matchedKey}${this.placeholderSuffix}`;
          this.logAccess({ key: matchedKey, type: 'virtualize', context: options?.ownerId, allowed: true });
        } else {
          // Not a known secret — pass through
          result[key] = value;
        }
      }
    }

    return result;
  }

  /**
   * Resolve all placeholder references in a string or env vars dict.
   * Replaces `__SB__KEY__` with the actual decrypted value.
   *
   * @param input - A string potentially containing `__SB__KEY__` placeholders
   * @param context - Optional context for audit logging
   * @returns The string with placeholders resolved to actual values
   */
  async resolvePlaceholders(input: string, context?: string): Promise<string> {
    const matches = input.match(SecretBroker.PLACEHOLDER_REGEX);
    if (!matches) return input;

    let result = input;
    for (const placeholder of matches) {
      const key = placeholder
        .replace(this.placeholderPrefix, '')
        .replace(this.placeholderSuffix, '');
      const value = await this.getSecret(key, context);
      if (value !== null) {
        result = result.replace(placeholder, value);
      }
    }

    return result;
  }

  /**
   * Resolve all placeholders in an env vars dict.
   */
  async resolveEnvVars(
    envVars: Record<string, string>,
    context?: string,
  ): Promise<Record<string, string>> {
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(envVars)) {
      result[key] = await this.resolvePlaceholders(value, context);
    }
    return result;
  }

  // ==========================================================================
  // Audit & Diagnostics
  // ==========================================================================

  /**
   * Get the access log for audit trail.
   */
  getAccessLog(): AccessLogEntry[] {
    return [...this.accessLog];
  }

  /**
   * Get statistics about stored secrets.
   */
  getStats(): {
    totalSecrets: number;
    totalAccesses: number;
    keys: string[];
  } {
    let totalAccesses = 0;
    for (const secret of this.secrets.values()) {
      totalAccesses += secret.accessCount;
    }
    return {
      totalSecrets: this.secrets.size,
      totalAccesses,
      keys: Array.from(this.secrets.keys()),
    };
  }

  // ==========================================================================
  // Private Helpers
  // ==========================================================================

  /**
   * Find a stored secret by checking if any known secret's value matches
   * the given value. This handles the case where the env var key differs
   * from the secret key (e.g., env var is `API_KEY` but secret is `OPENAI_API_KEY`).
   */
  private findKeyByValue(value: string): string | null {
    // We check via decryption — expensive but necessary for cross-referencing
    // In practice this is called once per sandbox creation, not per command.
    for (const [key, stored] of this.secrets.entries()) {
      try {
        if (stored.isVirtual) continue;
        const iv = Buffer.from(stored.iv, 'base64');
        const authTag = Buffer.from(stored.authTag, 'base64');
        const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
        decipher.setAuthTag(authTag);
        let decrypted = decipher.update(stored.encryptedValue, 'base64', 'utf8');
        decrypted += decipher.final('utf8');
        if (decrypted === value) {
          return key;
        }
      } catch {
        continue;
      }
    }
    return null;
  }

  private logAccess(entry: Omit<AccessLogEntry, 'timestamp'>): void {
    if (!this.enableAuditLog) return;

    this.accessLog.push({ ...entry, timestamp: Date.now() });
    if (this.accessLog.length > this.MAX_LOG_SIZE) {
      this.accessLog = this.accessLog.slice(-this.MAX_LOG_SIZE / 2);
    }
  }
}

// ============================================================================
// Singleton
// ============================================================================

let instance: SecretBroker | null = null;

/**
 * Get or create the shared SecretBroker instance.
 */
export function getSecretBroker(config?: SecretBrokerConfig): SecretBroker {
  if (!instance) {
    instance = new SecretBroker(config);
  }
  return instance;
}

/**
 * Reset the singleton (for testing).
 */
export function resetSecretBroker(): void {
  instance = null;
}
