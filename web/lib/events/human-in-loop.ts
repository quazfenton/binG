/**
 * Human-in-the-Loop - Approval workflows for events
 *
 * Provides mechanisms for pausing event execution and waiting for human approval.
 * Supports timeouts, approval/rejection responses, and audit logging.
 *
 * @module events/human-in-loop
 */

import { getDatabase } from '@/lib/database/connection';
import { execSchemaFile } from '@/lib/database/schema';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('Events:HumanInLoop');

/**
 * Approval request interface
 */
export interface ApprovalRequest {
  id: string;
  eventId: string;
  action: string;
  details: Record<string, any>;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  createdAt: string;
  respondedAt?: string;
  response?: string;
  expiresAt?: string;
  userId?: string;
}

/**
 * Create an approval request
 */
export async function createApprovalRequest(
  eventId: string,
  action: string,
  details: Record<string, any>,
  options?: {
    timeout?: number; // milliseconds
    userId?: string;
  }
): Promise<ApprovalRequest> {
  const db = getDatabase();
  const id = crypto.randomUUID();
  const now = new Date();

  const expiresAt = options?.timeout ? new Date(now.getTime() + options.timeout) : undefined;

  db.prepare(`
    INSERT INTO approval_requests
    (id, event_id, action, details, status, created_at, expires_at, user_id)
    VALUES (?, ?, ?, ?, 'pending', CURRENT_TIMESTAMP, ?, ?)
  `).run(id, eventId, action, JSON.stringify(details), expiresAt?.toISOString(), options?.userId);

  logger.info('Approval request created', {
    approvalId: id,
    eventId,
    action,
    expiresAt,
  });

  return {
    id,
    eventId,
    action,
    details,
    status: 'pending',
    createdAt: now.toISOString(),
    expiresAt: expiresAt?.toISOString(),
    userId: options?.userId,
  };
}

/**
 * Wait for approval response (polling)
 */
export async function waitForApproval(
  approvalId: string,
  timeoutMs: number
): Promise<{ approved: boolean; response?: string }> {
  const db = getDatabase();
  const startTime = Date.now();

  logger.info('Waiting for approval', { approvalId, timeoutMs });

  while (Date.now() - startTime < timeoutMs) {
    const request = db.prepare(`
      SELECT * FROM approval_requests
      WHERE id = ?
    `).get(approvalId) as any;

    if (!request) {
      throw new Error(`Approval request not found: ${approvalId}`);
    }

    if (request.status === 'approved') {
      return {
        approved: true,
        response: request.response,
      };
    }

    if (request.status === 'rejected') {
      return {
        approved: false,
        response: request.response,
      };
    }

    if (request.status === 'expired') {
      throw new Error('Approval request expired');
    }

    // Check if expired by time
    if (request.expires_at && new Date(request.expires_at) < new Date()) {
      // Mark as expired
      db.prepare(`
        UPDATE approval_requests
        SET status = 'expired', updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(approvalId);

      throw new Error('Approval request expired');
    }

    // Wait 2 seconds before polling again
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  throw new Error('Approval timeout');
}

/**
 * Respond to an approval request
 */
export async function respondToApproval(
  approvalId: string,
  approved: boolean,
  response?: string,
  userId?: string
): Promise<void> {
  const db = getDatabase();

  db.prepare(`
    UPDATE approval_requests
    SET status = ?,
        response = ?,
        responded_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(approved ? 'approved' : 'rejected', response, approvalId);

  logger.info('Approval response recorded', {
    approvalId,
    approved,
    response,
  });
}

/**
 * Get approval request by ID
 */
export async function getApprovalRequest(approvalId: string): Promise<ApprovalRequest | null> {
  const db = getDatabase();

  const row = db.prepare(`
    SELECT * FROM approval_requests
    WHERE id = ?
  `).get(approvalId) as any;

  if (!row) {
    return null;
  }

  return {
    ...row,
    details: JSON.parse(row.details),
  };
}

/**
 * Get pending approval requests for a user
 */
export async function getPendingApprovals(userId?: string, limit: number = 50): Promise<ApprovalRequest[]> {
  const db = getDatabase();

  let rows: any[];

  if (userId) {
    rows = db.prepare(`
      SELECT * FROM approval_requests
      WHERE status = 'pending'
        AND (user_id = ? OR user_id IS NULL)
      ORDER BY created_at ASC
      LIMIT ?
    `).all(userId, limit) as any[];
  } else {
    rows = db.prepare(`
      SELECT * FROM approval_requests
      WHERE status = 'pending'
      ORDER BY created_at ASC
      LIMIT ?
    `).all(limit) as any[];
  }

  return rows.map((row) => ({
    ...row,
    details: JSON.parse(row.details),
  }));
}

/**
 * Expire old pending approvals
 */
export async function expireOldApprovals(): Promise<number> {
  const db = getDatabase();

  const result = db.prepare(`
    UPDATE approval_requests
    SET status = 'expired', updated_at = CURRENT_TIMESTAMP
    WHERE status = 'pending'
      AND expires_at < CURRENT_TIMESTAMP
  `).run();

  logger.info('Expired old approvals', { count: result.changes });

  return result.changes;
}

/**
 * Get approval statistics
 */
export async function getApprovalStats(): Promise<{
  pending: number;
  approved: number;
  rejected: number;
  expired: number;
}> {
  const db = getDatabase();

  const stats: any = {};

  stats.pending = db.prepare("SELECT COUNT(*) as count FROM approval_requests WHERE status = 'pending'").get() as any;
  stats.approved = db.prepare("SELECT COUNT(*) as count FROM approval_requests WHERE status = 'approved'").get() as any;
  stats.rejected = db.prepare("SELECT COUNT(*) as count FROM approval_requests WHERE status = 'rejected'").get() as any;
  stats.expired = db.prepare("SELECT COUNT(*) as count FROM approval_requests WHERE status = 'expired'").get() as any;

  return {
    pending: stats.pending.count,
    approved: stats.approved.count,
    rejected: stats.rejected.count,
    expired: stats.expired.count,
  };
}

/**
 * Initialize approval requests table
 */
export async function initializeApprovalRequests(): Promise<void> {
  const db = getDatabase();

  // approval-requests.sql defines approval_requests (human-in-loop variant with details/response columns)
  execSchemaFile(db, 'approval-requests');

  logger.info('Approval requests table initialized');
}

/**
 * API endpoint helpers
 */
export async function handleApprovalResponse(
  approvalId: string,
  approved: boolean,
  response?: string,
  userId?: string
): Promise<{ success: boolean; message?: string }> {
  try {
    await respondToApproval(approvalId, approved, response, userId);
    return { success: true, message: 'Approval response recorded' };
  } catch (error: any) {
    logger.error('Failed to record approval response', { error: error.message });
    return { success: false, message: error.message };
  }
}

/**
 * Create approval URL for email notifications
 */
export function createApprovalUrl(approvalId: string, baseUrl: string): {
  approveUrl: string;
  rejectUrl: string;
} {
  const approveUrl = `${baseUrl}/api/events/approvals/${approvalId}/approve`;
  const rejectUrl = `${baseUrl}/api/events/approvals/${approvalId}/reject`;

  return { approveUrl, rejectUrl };
}
