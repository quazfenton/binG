import { openai } from '@ai-sdk/openai';
import type { SandboxHandle } from '@/lib/sandbox/providers/sandbox-provider';

export interface StatefulAgentOptions {
  sessionId?: string;
  sandboxHandle?: SandboxHandle;
  maxSelfHealAttempts?: number;
  enforcePlanActVerify?: boolean;
}

export interface StatefulAgentResult {
  success: boolean;
  response: string;
  steps: number;
  errors: Array<{ message: string; path?: string }>;
  vfs?: Record<string, string>;
}

// ===========================================
// Session Lock Manager
// Prevents concurrent access to same session
// ===========================================

interface SessionLock {
  promise: Promise<void>;
  release: () => void;
}

const sessionLocks = new Map<string, SessionLock>();
const pendingLocks = new Map<string, Promise<SessionLock>>();

/**
 * Acquire exclusive lock for session
 * Waits for any existing lock to release
 */
async function acquireSessionLock(sessionId: string): Promise<() => void> {
  // Check if there's already a pending lock acquisition for this session
  const pendingLock = pendingLocks.get(sessionId);
  if (pendingLock) {
    // Wait for the pending lock to complete, then acquire our own
    await pendingLock;
  }

  // Check if there's an existing active lock
  const existingLock = sessionLocks.get(sessionId);
  if (existingLock) {
    // Wait for existing lock to release
    await existingLock.promise;
  }

  // Create new lock
  let releaseLock: () => void;
  const promise = new Promise<void>((resolve) => {
    releaseLock = resolve;
  });

  const lock: SessionLock = {
    promise,
    release: releaseLock!,
  };

  // Track as pending while we set it up
  pendingLocks.set(sessionId, Promise.resolve(lock));
  
  // Store the lock
  sessionLocks.set(sessionId, lock);
  
  // Clear pending status
  pendingLocks.delete(sessionId);

  // Return release function
  return () => {
    lock.release();
    sessionLocks.delete(sessionId);
  };
}

/**
 * Get number of active session locks (for monitoring)
 */
export function getActiveSessionLocks(): number {
  return sessionLocks.size;
}

/**
 * Clear all session locks (for cleanup/testing)
 */
export function clearAllSessionLocks(): void {
  for (const lock of sessionLocks.values()) {
    lock.release();
  }
  sessionLocks.clear();
  pendingLocks.clear();
}

const DEFAULT_SYSTEM_PROMPT = `You are an expert software engineer with access to a stateful sandbox workspace.

IMPORTANT WORKFLOW - Follow these phases EXACTLY:

PHASE 1: DISCOVERY (Required First)
- Use list_files and read_file tools to understand the current codebase

PHASE 2: PLANNING (Required Before Editing)
- Create a plan before editing files

PHASE 3: EDITING
- Use surgical edits (only change specific lines)
- NEVER use full write_file for existing files

PHASE 4: VERIFICATION
- Verify changes compile/syntax is correct

RULES:
- Use surgical apply_diff instead of full write_file
- Explain your thought process for each change
- Max 3 self-healing attempts per error`;

export class StatefulAgent {
  private sessionId: string;
  private sandboxHandle?: SandboxHandle;
  private vfs: Record<string, string> = {};
  private transactionLog: Array<{ path: string; type: string; timestamp: number; originalContent?: string }> = [];
  private maxSelfHealAttempts: number;
  private enforcePlanActVerify: boolean;
  private currentPlan: any = null;
  private status: string = 'idle';
  private errors: Array<{ step: number; path?: string; message: string; timestamp: number }> = [];
  private retryCount: number = 0;
  private steps: number = 0;

  constructor(options: StatefulAgentOptions = {}) {
    this.sessionId = options.sessionId || crypto.randomUUID();
    this.sandboxHandle = options.sandboxHandle;
    this.maxSelfHealAttempts = options.maxSelfHealAttempts || 3;
    this.enforcePlanActVerify = options.enforcePlanActVerify ?? true;
  }

  async run(userMessage: string): Promise<StatefulAgentResult> {
    // Acquire exclusive session lock to prevent concurrent access
    const releaseLock = await acquireSessionLock(this.sessionId);
    
    try {
      this.status = 'discovering';
      this.steps = 0;

      try {
        await this.runDiscoveryPhase(userMessage);

        this.status = 'planning';
        await this.runPlanningPhase(userMessage);

        this.status = 'editing';
        await this.runEditingPhase(userMessage);

        this.status = 'committing';

        return {
          success: this.errors.length === 0,
          response: `Completed ${this.steps} steps. Modified ${this.transactionLog.length} files.`,
          steps: this.steps,
          errors: this.errors,
          vfs: this.vfs,
        };
      } catch (error) {
        this.status = 'error';
        return {
          success: false,
          response: error instanceof Error ? error.message : 'Unknown error',
          steps: this.steps,
          errors: this.errors,
          vfs: this.vfs,
        };
      }
    } finally {
      // Always release the lock, even if there's an error
      releaseLock();
    }
  }

  private getModel() {
    const modelString = (process.env.DEFAULT_MODEL || 'gpt-4o').replace('openai:', '');
    return openai(modelString) as any;
  }

  private async runDiscoveryPhase(userMessage: string) {
    const discoveryPrompt = `Analyze this request and list the files you need to read:
    
${userMessage}

Simply list the files that need to be read.`;

    try {
      const { generateText } = await import('ai');
      const result = await generateText({
        model: this.getModel(),
        prompt: discoveryPrompt,
        maxSteps: 3,
      });

      const filePaths = result.text
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0 && !line.startsWith('#'));

      for (const filePath of filePaths.slice(0, 10)) {
        try {
          if (this.sandboxHandle) {
            const content = await this.sandboxHandle.readFile(filePath);
            if (content.success) {
              this.vfs[filePath] = content.output;
            }
          }
        } catch (error) {
          console.error(`Failed to read ${filePath}:`, error);
        }
      }
    } catch (error) {
      console.error('[StatefulAgent] Discovery error:', error);
    }

    this.steps++;
  }

  private async runPlanningPhase(userMessage: string) {
    if (this.enforcePlanActVerify && Object.keys(this.vfs).length > 0) {
      const filesList = Object.keys(this.vfs).join('\n');
      
      const planningPrompt = `Create a brief plan for this task:

Task: ${userMessage}

Available files:
${filesList}

Return a JSON object with:
{
  "task": "...",
  "files": [{"path": "file.ts", "action": "edit", "reason": "..."}],
  "execution_order": ["file.ts"]
}`;

      try {
        const { generateText } = await import('ai');
        const result = await generateText({
          model: this.getModel(),
          prompt: planningPrompt,
          maxTokens: 1000,
        });

        try {
          const parsed = JSON.parse(result.text);
          this.currentPlan = parsed;
        } catch {
          this.currentPlan = { task: userMessage, files: [], execution_order: [] };
        }
      } catch (error) {
        console.error('[StatefulAgent] Planning error:', error);
        this.currentPlan = { task: userMessage, files: [], execution_order: [] };
      }
    }
    this.steps++;
  }

  private async runEditingPhase(userMessage: string) {
    const editPrompt = this.currentPlan
      ? `Execute the following task:\n${this.currentPlan.task}\n\nFiles to modify: ${JSON.stringify(this.currentPlan.files)}\n\nMake surgical edits only.`
      : userMessage;

    try {
      const { generateText } = await import('ai');
      await generateText({
        model: this.getModel(),
        prompt: editPrompt,
        maxSteps: 10,
      });

      this.status = 'verifying';
    } catch (error) {
      this.errors.push({
        step: this.steps,
        message: error instanceof Error ? error.message : 'Editing failed',
        timestamp: Date.now(),
      });
    }

    this.steps++;
  }

  getState() {
    return {
      sessionId: this.sessionId,
      vfs: this.vfs,
      transactionLog: this.transactionLog,
      currentPlan: this.currentPlan,
      errors: this.errors,
      retryCount: this.retryCount,
      status: this.status,
    };
  }
}

export async function createStatefulAgent(options?: StatefulAgentOptions): Promise<StatefulAgent> {
  return new StatefulAgent(options);
}

export async function runStatefulAgent(
  userMessage: string,
  options?: StatefulAgentOptions
): Promise<StatefulAgentResult> {
  const agent = new StatefulAgent(options);
  return agent.run(userMessage);
}
