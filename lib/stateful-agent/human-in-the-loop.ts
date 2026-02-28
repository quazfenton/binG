import type { ApprovalRequest } from './schemas';
import { hitlAuditLogger } from './hitl-audit-logger';

export interface InterruptRequest {
  type: 'approval_required';
  action: string;
  target: string;
  reason: string;
  diff?: string;
  metadata?: Record<string, any>;
}

export interface InterruptResponse {
  approved: boolean;
  feedback?: string;
  modified_value?: any;
}

type InterruptHandler = (request: InterruptRequest) => Promise<InterruptResponse>;

class HumanInTheLoopManager {
  private pendingInterrupts: Map<string, {
    request: InterruptRequest;
    resolve: (response: InterruptResponse) => void;
    createdAt: Date;
    requestLogged: boolean;
  }> = new Map();

  private handler: InterruptHandler | null = null;

  setHandler(handler: InterruptHandler) {
    this.handler = handler;
  }

  async requestInterrupt(
    request: InterruptRequest,
    userId?: string,
    metadata?: Record<string, any>
  ): Promise<InterruptResponse> {
    const interruptId = crypto.randomUUID();
    const requestStartTime = Date.now();

    if (!this.handler) {
      console.warn('[HITL] No handler configured, auto-denying interrupt');
      await hitlAuditLogger.logApprovalDecision(interruptId, false, 'No approval handler configured');
      return { approved: false, feedback: 'No approval handler configured' };
    }

    // Log approval request for audit
    if (userId) {
      await hitlAuditLogger.logApprovalRequest(
        interruptId,
        userId,
        request.action,
        request.target,
        request.reason,
        metadata
      );
    }

    const promise = new Promise<InterruptResponse>((resolve) => {
      this.pendingInterrupts.set(interruptId, {
        request,
        resolve,
        createdAt: new Date(),
        requestLogged: !!userId,
      });
    });

    this.handler(request);

    // Parse timeout with validation (default: 5 minutes, min: 10s, max: 30 minutes)
    const configuredTimeout = parseInt(process.env.HITL_TIMEOUT || '300000');
    const timeout = Number.isNaN(configuredTimeout)
      ? 300000
      : Math.max(10000, Math.min(1800000, configuredTimeout));

    const timeoutPromise = new Promise<InterruptResponse>((resolve) => {
      setTimeout(() => {
        resolve({ approved: false, feedback: 'Approval request timed out' });
      }, timeout);
    });

    const response = await Promise.race([promise, timeoutPromise]);
    
    // Log approval decision for audit
    const responseTimeMs = Date.now() - requestStartTime;
    await hitlAuditLogger.logApprovalDecision(
      interruptId,
      response.approved,
      response.feedback,
      response.modified_value,
      responseTimeMs
    );

    return response;
  }

  async resolveInterrupt(interruptId: string, response: InterruptResponse): Promise<void> {
    const pending = this.pendingInterrupts.get(interruptId);
    if (pending) {
      pending.resolve(response);
      this.pendingInterrupts.delete(interruptId);
    }
  }

  getPendingInterrupts(): Array<{ id: string; request: InterruptRequest; createdAt: Date }> {
    return Array.from(this.pendingInterrupts.entries()).map(([id, { request, createdAt }]) => ({
      id,
      request,
      createdAt,
    }));
  }

  cancelAllInterrupts(): void {
    for (const [id, pending] of this.pendingInterrupts) {
      pending.resolve({ approved: false, feedback: 'Session cancelled' });
    }
    this.pendingInterrupts.clear();
  }
}

export const hitlManager = new HumanInTheLoopManager();

export function createApprovalRequest(
  action: ApprovalRequest['action'],
  target: string,
  reason: string,
  diff?: string
): ApprovalRequest {
  return {
    id: crypto.randomUUID(),
    action,
    target,
    reason,
    diff,
    requested_at: new Date().toISOString(),
    status: 'pending',
  };
}

export async function requireApproval(
  action: ApprovalRequest['action'],
  target: string,
  reason: string,
  diff?: string,
  userId?: string,
  metadata?: Record<string, any>
): Promise<boolean> {
  const shouldEnforce = process.env.ENABLE_HITL === 'true';
  const requiresApproval = process.env.HITL_APPROVAL_REQUIRED_ACTIONS?.split(',').includes(action) ?? false;

  if (!shouldEnforce || !requiresApproval) {
    return true;
  }

  const request: InterruptRequest = {
    type: 'approval_required',
    action,
    target,
    reason,
    diff,
  };

  const response = await hitlManager.requestInterrupt(request, userId, metadata);
  return response.approved;
}
