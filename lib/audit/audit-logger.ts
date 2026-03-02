/**
 * Audit logging utility for critical actions.
 * Logs user identity, timestamp, action, and outcome for compliance and forensics.
 */

export interface AuditLogEntry {
  timestamp: string;
  userId: string;
  action: string;
  resource?: string;
  outcome: 'success' | 'failure' | 'error';
  details?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}

export interface AuditLoggerOptions {
  userId: string;
  ipAddress?: string;
  userAgent?: string;
}

export class AuditLogger {
  private userId: string;
  private ipAddress?: string;
  private userAgent?: string;

  constructor(options: AuditLoggerOptions) {
    this.userId = options.userId;
    this.ipAddress = options.ipAddress;
    this.userAgent = options.userAgent;
  }

  /**
   * Log a critical action with full audit trail.
   */
  log(entry: Omit<AuditLogEntry, 'timestamp' | 'userId' | 'ipAddress' | 'userAgent'>): void {
    const logEntry: AuditLogEntry = {
      timestamp: new Date().toISOString(),
      userId: this.userId,
      ipAddress: this.ipAddress,
      userAgent: this.userAgent,
      ...entry,
    };

    // Log to console with structured format for log aggregation
    console.log('[AUDIT]', JSON.stringify(logEntry));

    // Also emit as structured log for potential external audit sinks
    this.emitToAuditSink(logEntry);
  }

  /**
   * Log successful action.
   */
  success(action: string, details?: Record<string, unknown>, resource?: string): void {
    this.log({ action, outcome: 'success', details, resource });
  }

  /**
   * Log failed action.
   */
  failure(action: string, details?: Record<string, unknown>, resource?: string): void {
    this.log({ action, outcome: 'failure', details, resource });
  }

  /**
   * Log action error.
   */
  error(action: string, error: Error | unknown, resource?: string): void {
    this.log({
      action,
      outcome: 'error',
      resource,
      details: {
        error: error instanceof Error ? error.message : String(error),
      },
    });
  }

  /**
   * Emit to external audit sink if configured.
   * This allows integration with SIEM systems or audit log services.
   */
  private emitToAuditSink(entry: AuditLogEntry): void {
    // Hook for external audit log emission (e.g., to file, SIEM, or audit service)
    // Can be extended via environment variable AUDIT_LOG_PATH for file-based logging
    if (process.env.AUDIT_LOG_PATH) {
      // File-based audit logging would be implemented here
      // For now, structured console log serves as primary audit output
    }
  }
}

/**
 * Create an audit logger from a Next.js request.
 */
export function createAuditLogger(req: Request, userId: string): AuditLogger {
  const ipAddress =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    undefined;

  const userAgent = req.headers.get('user-agent') || undefined;

  return new AuditLogger({ userId, ipAddress, userAgent });
}
