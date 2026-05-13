import yaml from 'js-yaml';
import { virtualFilesystem } from '@/lib/virtual-filesystem/virtual-filesystem-service';
import { normalizeSessionId } from '@/lib/virtual-filesystem/scope-utils';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('Agent:WorkforceState');

export type TaskStatus = 'pending' | 'running' | 'blocked' | 'completed' | 'failed';

export interface WorkforceTask {
  id: string;
  title: string;
  description: string;
  agent: 'opencode' | 'nullclaw' | 'cli';
  scope?: string;
  status: TaskStatus;
  assignedAt?: string;
  startedAt?: string;
  completedAt?: string;
  result?: string;
  error?: string;
}

export interface WorkforceState {
  version: number;
  updatedAt: string;
  tasks: WorkforceTask[];
}

const DEFAULT_STATE: WorkforceState = {
  version: 1,
  updatedAt: new Date().toISOString(),
  tasks: [],
};

function getStatePath(conversationId: string): string {
  // CRITICAL FIX: Normalize conversationId to prevent composite IDs in paths
  const simpleSessionId = normalizeSessionId(conversationId) || '001'; // Fallback to '001' only if truly invalid
  return `workspace/sessions/${simpleSessionId}/STATE.yaml`;
}

export async function loadState(userId: string, conversationId: string): Promise<WorkforceState> {
  const path = getStatePath(conversationId);
  try {
    const file = await virtualFilesystem.readFile(userId, path);
    const parsed = yaml.load(file.content) as WorkforceState | null;
    // yaml.load returns null for empty files — rethrow instead of treating as default
    if (parsed === null || parsed === undefined) {
      logger.error('STATE.yaml is empty or parse returned null');
      throw new Error('STATE.yaml is empty; cannot load empty state');
    }
    if (!Array.isArray(parsed.tasks)) {
      return { ...DEFAULT_STATE, updatedAt: new Date().toISOString() };
    }
    return parsed;
  } catch (err: any) {
    const errMsg = err?.message || '';
    const isNotFound = err?.code === 'ENOENT' || 
      errMsg.includes('ENOENT') || 
      errMsg.includes('not found') || 
      errMsg.includes('no such file') ||
      errMsg.includes('file does not exist') ||
      errMsg.includes('Path does not exist');
    if (isNotFound) {
      logger.debug('STATE.yaml not found, initializing new state');
      await saveState(userId, conversationId, DEFAULT_STATE);
      return { ...DEFAULT_STATE };
    }
    logger.error('Failed to load state:', err);
    throw err;
  }
}

export async function saveState(
  userId: string,
  conversationId: string,
  state: WorkforceState,
): Promise<void> {
  const path = getStatePath(conversationId);
  let content: string;
  try {
    content = yaml.dump({
      ...state,
      updatedAt: new Date().toISOString(),
    });
  } catch (err: any) {
    logger.error('Failed to serialize state to YAML:', err);
    throw new Error(`Failed to serialize state: ${err?.message || String(err)}`);
  }
  try {
    await virtualFilesystem.writeFile(userId, path, content);
  } catch (err: any) {
    logger.error('Failed to write STATE.yaml:', { path, error: err?.message || String(err) });
    throw err;
  }
}

export async function addTask(
  userId: string,
  conversationId: string,
  task: WorkforceTask,
): Promise<WorkforceState> {
  const state = await loadState(userId, conversationId);
  state.tasks.push(task);
  await saveState(userId, conversationId, state);
  return state;
}

export async function updateTask(
  userId: string,
  conversationId: string,
  taskId: string,
  updates: Partial<WorkforceTask>,
): Promise<WorkforceState> {
  const state = await loadState(userId, conversationId);
  const idx = state.tasks.findIndex(t => t.id === taskId);
  if (idx === -1) return state;
  state.tasks[idx] = { ...state.tasks[idx], ...updates };
  await saveState(userId, conversationId, state);
  return state;
}
