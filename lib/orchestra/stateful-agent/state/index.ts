import type { PlanJSON, FileModificationIntent, TransactionLogEntry, ApprovalRequest } from '../schemas';

export interface VfsState {
  vfs: Record<string, string>;
  transactionLog: TransactionLogEntry[];
  currentPlan: PlanJSON | null;
  discoveryIntents: FileModificationIntent[];
  errors: Array<{
    step: number;
    path?: string;
    message: string;
    timestamp: number;
  }>;
  retryCount: number;
  status: 'idle' | 'discovering' | 'planning' | 'editing' | 'verifying' | 'committing' | 'error';
  sandboxId: string | null;
  sessionId: string;
  pendingApproval: ApprovalRequest | null;
}

export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface AgentState extends VfsState {
  messages: Message[];
}

export function createInitialState(options?: {
  sessionId?: string;
  sandboxId?: string;
  initialMessages?: Message[];
}): AgentState {
  return {
    sessionId: options?.sessionId || crypto.randomUUID(),
    sandboxId: options?.sandboxId || null,
    messages: options?.initialMessages || [],
    vfs: {},
    transactionLog: [],
    currentPlan: null,
    discoveryIntents: [],
    errors: [],
    retryCount: 0,
    status: 'idle',
    pendingApproval: null,
  };
}
