import yaml from 'js-yaml';
import { virtualFilesystem } from '../virtual-filesystem/virtual-filesystem-service';
import { normalizeSessionId } from '../virtual-filesystem/scope-utils';
import { createLogger } from '../utils/logger';

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
  return `project/sessions/${simpleSessionId}/STATE.yaml`;
}

export async function loadState(userId: string, conversationId: string): Promise<WorkforceState> {
  const path = getStatePath(conversationId);
  try {
    const file = await virtualFilesystem.readFile(userId, path);
    const parsed = yaml.load(file.content) as WorkforceState;
    if (!parsed || !Array.isArray(parsed.tasks)) {
      return { ...DEFAULT_STATE, updatedAt: new Date().toISOString() };
    }
    return parsed;
  } catch {
    logger.debug('STATE.yaml not found, initializing new state');
    await saveState(userId, conversationId, DEFAULT_STATE);
    return { ...DEFAULT_STATE };
  }
}

export async function saveState(
  userId: string,
  conversationId: string,
  state: WorkforceState,
): Promise<void> {
  const path = getStatePath(conversationId);
  const content = yaml.dump({
    ...state,
    updatedAt: new Date().toISOString(),
  });
  await virtualFilesystem.writeFile(userId, path, content);
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
