export type ModelRole = 'architect' | 'builder' | 'linter';

export interface FileModificationIntent {
  file_path: string;
  action: 'read' | 'edit' | 'create' | 'delete';
  reason: string;
  dependencies: string[];
  risk_level: 'low' | 'medium' | 'high';
}

export interface PlanFile {
  path: string;
  action: 'read' | 'edit' | 'create' | 'delete';
  original_hash: string;
  new_hash?: string;
  diff_preview: string;
  blocked_by?: string[];
  reason: string;
}

export interface PlanJSON {
  version: string;
  created_at: string;
  task: string;
  files: PlanFile[];
  execution_order: string[];
  rollback_plan: string;
}

export interface ApplyDiffInput {
  path: string;
  search: string;
  replace: string;
  thought: string;
  plan_ref?: string;
}

export interface SyntaxError {
  path: string;
  line: number;
  column?: number;
  error: string;
  severity: 'error' | 'warning' | 'info';
}

export interface VerificationResult {
  passed: boolean;
  errors: SyntaxError[];
  warnings: SyntaxError[];
  reprompt?: string;
}

export interface ApprovalRequest {
  id: string;
  action: 'delete' | 'overwrite' | 'execute_destructive' | 'create_secret';
  target: string;
  reason: string;
  diff?: string;
  requested_at: string;
  status: 'pending' | 'approved' | 'rejected';
}

export interface TransactionLogEntry {
  path: string;
  type: 'UPDATE' | 'CREATE' | 'DELETE';
  timestamp: string;
  originalContent?: string;
  newContent?: string;
  search?: string;
  replace?: string;
}

export interface AgentCheckpoint {
  session_id: string;
  checkpoint_id: string;
  vfs_snapshot: Record<string, string>;
  transaction_log: TransactionLogEntry[];
  current_plan: PlanJSON | null;
  errors: Array<{
    step: number;
    path?: string;
    message: string;
    timestamp: string;
  }>;
  retry_count: number;
  status: 'idle' | 'planning' | 'editing' | 'verifying' | 'committing' | 'error';
  created_at: string;
}
