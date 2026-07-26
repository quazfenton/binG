/**
 * Composio Workflow Builder
 *
 * Multi-step tool composition for Composio 800+ toolkits.
 * Supports sequential, parallel, conditional, and iterative workflows
 * with data piping between steps, retry logic, and timeout enforcement.
 *
 * USAGE:
 *   const wf = new WorkflowBuilder('my-workflow')
 *     .step('fetch-repo', { tool: 'github_list_repos', params: { owner: '{{variables.owner}}' } })
 *     .step('analyze-lang', { tool: 'github_repo_languages', params: { repo: '{{steps.fetch-repo.output.full_name}}' } })
 *     .if('is-typescript', { condition: 'steps.analyze-lang.output.Typescript > 0' })
 *       .step('add-ts-label', { tool: 'github_add_label', params: { label: 'typescript' } })
 *     .else()
 *       .step('check-js', { tool: 'github_repo_languages' })
 *     .endif();
 *
 *   const result = await wf.execute({ userId, variables: { owner: 'vercel' } });
 *
 * @see composio-service.ts for underlying tool execution
 */

import { createLogger } from '@/lib/utils/logger';
import { getComposioService } from '@/lib/integrations/composio-service';
import { executeToolCall } from '@/lib/integrations/composio/composio-adapter';

const logger = createLogger('Composio:WorkflowBuilder');

// ============================================================================
// Types
// ============================================================================

/** Supported step types */
export type StepType = 'tool' | 'condition' | 'parallel' | 'iterate' | 'transform' | 'delay' | 'log';

/** Max items allowed in an iterate step to prevent runaway loops */
export const MAX_ITERATE_ITEMS = 100;

/** Controls what happens when a step errors */
export type ErrorStrategy = 'abort' | 'continue' | 'retry' | 'skip-to';

/** Condition operator for branching */
export type ConditionOperator = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'exists' | 'truthy' | 'falsy';

/** Template expression — reference variables, previous step outputs, or raw values */
export type ParamValue =
  | string
  | number
  | boolean
  | null
  | ParamValue[]
  | { [key: string]: ParamValue }
  /** Template string: {{variables.owner}} or {{steps.fetch.output.name}} */
  | string;

export interface ConditionClause {
  /** Left-hand side: a template path like "steps.fetch.output.full_name" */
  lhs: string;
  operator: ConditionOperator;
  /** Right-hand side value (string template or literal) */
  rhs?: ParamValue;
}

export interface StepConfig {
  /** Unique step ID within the workflow */
  id: string;
  /** Human-readable name */
  name?: string;
  /** Step type */
  type: StepType;
  /** For 'tool' steps: the Composio tool slug (e.g. "github_list_repos") */
  tool?: string;
  /** For 'tool' steps: static or template parameters */
  params?: Record<string, ParamValue>;
  /** For 'condition' steps */
  condition?: ConditionClause;
  /** For 'iterate' steps: the source array path (e.g. "steps.list-repos.output") */
  iterateOver?: string;
  /** For 'iterate' steps: alias for each item */
  itemAlias?: string;
  /** For 'parallel' and 'iterate' steps: child step configs */
  steps?: StepConfig[];
  /** For 'transform' steps: a function or expression to map data */
  transform?: string;
  /** For 'delay' steps: milliseconds to wait */
  delayMs?: number;
  /** For 'skip-to' error strategy: the target step ID */
  skipTarget?: string;
  /** Step timeout in ms (defaults to workflow timeout) */
  timeout?: number;
  /** Max retries for transient failures (defaults to workflow global) */
  retries?: number;
  /** Error handling strategy */
  onError?: ErrorStrategy;
  /** Optional description for documentation */
  description?: string;
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  description?: string;
  version: string;
  steps: StepConfig[];
  variables: Record<string, ParamValue>;
  timeout: number;
  maxRetries: number;
  tags: string[];
}

export interface StepResult {
  id: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  output: any;
  error?: string;
  duration: number;
  attempts: number;
}

export interface WorkflowResult {
  success: boolean;
  workflowId: string;
  steps: StepResult[];
  result: any;
  error?: string;
  duration: number;
  variables?: Record<string, any>;
}

export interface WorkflowExecutionContext {
  userId: string;
  variables: Record<string, any>;
  parent?: WorkflowExecutionContext;
  signal?: AbortSignal;
}

// ============================================================================
// Template Engine — resolve {{path}} references
// ============================================================================

/**
 * Resolve a dotted path against a context object.
 * Supports: "variables.owner", "steps.step-id.output.field.nested"
 */
function resolvePath(path: string, ctx: WorkflowStepContext): any {
  const parts = path.split('.');
  let current: any = ctx;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (typeof current === 'object' && part in current) {
      current = (current as Record<string, any>)[part];
    } else {
      return undefined;
    }
  }
  return current;
}

interface WorkflowStepContext {
  variables: Record<string, any>;
  steps: Record<string, StepResult>;
  input?: any;
}

/**
 * Interpolate template strings like "Hello {{variables.name}}"
 * Supports nested paths: {{steps.step-id.output.field}}
 */
function interpolate(value: any, ctx: WorkflowStepContext): any {
  if (typeof value === 'string') {
    // Replace all {{...}} placeholders
    return value.replace(/\{\{(.+?)\}\}/g, (_, expr) => {
      const resolved = resolvePath(expr.trim(), ctx);
      return resolved !== undefined ? String(resolved) : `{{${expr.trim()}}}`;
    });
  }
  if (Array.isArray(value)) {
    return value.map(v => interpolate(v, ctx));
  }
  if (value && typeof value === 'object') {
    const obj: Record<string, any> = {};
    for (const [k, v] of Object.entries(value)) {
      obj[k] = interpolate(v, ctx);
    }
    return obj;
  }
  return value;
}

// ============================================================================
// Condition Evaluation
// ============================================================================

function evaluateCondition(clause: ConditionClause, ctx: WorkflowStepContext): boolean {
  const lhs = resolvePath(clause.lhs, ctx);
  const rhs = clause.rhs !== undefined ? interpolate(clause.rhs, ctx) : undefined;

  switch (clause.operator) {
    case 'eq':  return lhs === rhs;
    case 'neq': return lhs !== rhs;
    case 'gt':  return Number(lhs) > Number(rhs);
    case 'gte': return Number(lhs) >= Number(rhs);
    case 'lt':  return Number(lhs) < Number(rhs);
    case 'lte': return Number(lhs) <= Number(rhs);
    case 'contains':
      if (typeof lhs === 'string' && typeof rhs === 'string') return lhs.includes(rhs);
      if (Array.isArray(lhs)) return lhs.includes(rhs);
      return false;
    case 'exists': return lhs !== undefined && lhs !== null;
    case 'truthy': return !!lhs;
    case 'falsy':  return !lhs;
    default: return false;
  }
}

// ============================================================================
// Workflow Builder (DSL)
// ============================================================================

export class WorkflowBuilder {
  private definition: WorkflowDefinition;

  constructor(idOrDef: string | WorkflowDefinition) {
    if (typeof idOrDef === 'string') {
      this.definition = {
        id: idOrDef,
        name: idOrDef,
        version: '1.0.0',
        steps: [],
        variables: {},
        timeout: 120_000,
        maxRetries: 2,
        tags: [],
      };
    } else {
      this.definition = { ...idOrDef, steps: [...idOrDef.steps] };
    }
  }

  // --- Metadata setters ---

  setName(name: string): this {
    this.definition.name = name;
    return this;
  }

  setVersion(version: string): this {
    this.definition.version = version;
    return this;
  }

  setDescription(description: string): this {
    this.definition.description = description;
    return this;
  }

  setTimeout(ms: number): this {
    this.definition.timeout = ms;
    return this;
  }

  setMaxRetries(n: number): this {
    this.definition.maxRetries = n;
    return this;
  }

  setVariables(vars: Record<string, ParamValue>): this {
    this.definition.variables = { ...this.definition.variables, ...vars };
    return this;
  }

  setTags(tags: string[]): this {
    this.definition.tags = tags;
    return this;
  }

  // --- Step builders ---

  /**
   * Add a tool execution step.
   * Parameters can use {{variables.xxx}} and {{steps.previous-step-id.output.field}} templates.
   */
  step(
    id: string,
    config: Omit<StepConfig, 'id' | 'type'> & { tool: string },
  ): this {
    this.definition.steps.push({ id, ...config, type: 'tool' });
    return this;
  }

  /**
   * Add a conditional branch.
   * Call .step() or other builders between this and .else() / .endif().
   * Returns a BranchBuilder that scopes the next steps.
   */
  if(id: string, clause: ConditionClause): BranchBuilder {
    return new BranchBuilder(this, id, clause);
  }

  /**
   * Add a parallel step group — all child steps execute in parallel.
   * Results are collected into an array keyed by step ID.
   */
  parallel(id: string, childSteps: StepConfig[]): this {
    this.definition.steps.push({
      id,
      type: 'parallel',
      steps: childSteps,
    });
    return this;
  }

  /**
   * Add an iteration step — execute child steps for each item in an array.
   * The current item is available as {{iterate.item}} within child steps.
   */
  iterate(id: string, config: {
    over: string;
    itemAlias?: string;
    steps: StepConfig[];
  }): this {
    this.definition.steps.push({
      id,
      type: 'iterate',
      iterateOver: config.over,
      itemAlias: config.itemAlias || 'item',
      steps: config.steps,
    });
    return this;
  }

  /**
   * Add a data transformation step (defined as an expression or function reference).
   */
  transform(id: string, transformExpr: string, params?: Record<string, ParamValue>): this {
    this.definition.steps.push({
      id,
      type: 'transform',
      transform: transformExpr,
      params,
    });
    return this;
  }

  /**
   * Add a delay between steps.
   */
  delay(id: string, ms: number): this {
    this.definition.steps.push({
      id,
      type: 'delay',
      delayMs: ms,
    });
    return this;
  }

  // --- Execution ---

  /**
   * Execute the workflow with the given context.
   */
  async execute(context: WorkflowExecutionContext): Promise<WorkflowResult> {
    const startTime = Date.now();
    const stepResults: Record<string, StepResult> = {};
    const steps: StepResult[] = [];

    const ctx: WorkflowStepContext = {
      variables: { ...this.definition.variables, ...context.variables },
      steps: stepResults,
    };

    const workflowTimeout = this.definition.timeout;
    const globalMaxRetries = this.definition.maxRetries;

    // Track which steps were actually "run" for the final result array
    let aborted = false;
    let skipTo: string | null = null;

    for (let i = 0; i < this.definition.steps.length && !aborted; i++) {
      const stepConfig = this.definition.steps[i];

      // Skip-to support
      if (skipTo) {
        if (stepConfig.id === skipTo) {
          skipTo = null;
        } else {
          const skipped: StepResult = {
            id: stepConfig.id,
            status: 'skipped',
            output: null,
            duration: 0,
            attempts: 0,
          };
          stepResults[stepConfig.id] = skipped;
          steps.push(skipped);
          continue;
        }
      }

      // Check abort signal
      if (context.signal?.aborted) {
        logger.warn(`[Workflow] Aborted during step "${stepConfig.id}"`);
        const failed: StepResult = {
          id: stepConfig.id,
          status: 'failed',
          output: null,
          error: 'Workflow aborted by signal',
          duration: Date.now() - startTime,
          attempts: 0,
        };
        stepResults[stepConfig.id] = failed;
        steps.push(failed);
        break;
      }

      let stepResult: StepResult;

      try {
        stepResult = await this.executeStep(stepConfig, ctx, {
          userId: context.userId,
          workflowTimeout,
          globalMaxRetries,
          signal: context.signal,
        });
      } catch (err: any) {
        stepResult = {
          id: stepConfig.id,
          status: 'failed',
          output: null,
          error: err.message || String(err),
          duration: 0,
          attempts: 1,
        };
      }

      stepResults[stepConfig.id] = stepResult;
      steps.push(stepResult);

      // Handle step error
      if (stepResult.status === 'failed') {
        const strategy = stepConfig.onError || 'abort';
        switch (strategy) {
          case 'abort':
            aborted = true;
            break;
          case 'continue':
            // Continue with next step
            break;
          case 'skip-to':
            skipTo = stepConfig.skipTarget || null;
            break;
          case 'retry':
            // Retry is handled within executeStep itself
            break;
        }
      }
    }

    const totalDuration = Date.now() - startTime;
    const finalSteps = steps;
    const failedSteps = finalSteps.filter(s => s.status === 'failed');
    const success = failedSteps.length === 0 && !aborted;

    return {
      success,
      workflowId: this.definition.id,
      steps: finalSteps,
      result: finalSteps.find(s => s.status === 'completed')?.output ?? null,
      error: !success
        ? failedSteps.map(s => s.error).filter(Boolean).join('; ')
        : undefined,
      duration: totalDuration,
      variables: finalSteps.length > 0 ? ctx.variables : undefined,
    };
  }

  /**
   * Execute a single step and return its result.
   */
  private async executeStep(
    config: StepConfig,
    ctx: WorkflowStepContext,
    opts: {
      userId: string;
      workflowTimeout: number;
      globalMaxRetries: number;
      signal?: AbortSignal;
    },
  ): Promise<StepResult> {
    const startTime = Date.now();
    const maxAttempts = (config.retries ?? opts.globalMaxRetries) + 1;
    const stepTimeout = config.timeout ?? opts.workflowTimeout;
    const lastError: string[] = [];

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const attemptStart = Date.now();

      try {
        if (opts.signal?.aborted) {
          return { id: config.id, status: 'failed', output: null, error: 'Aborted', duration: 0, attempts: attempt - 1 };
        }

        let output: any;

        switch (config.type) {
          case 'tool':
            output = await this.executeToolStep(config, ctx, opts.userId, stepTimeout);
            break;
          case 'condition':
            output = await this.executeConditionStep(config, ctx, opts);
            break;
          case 'parallel':
            output = await this.executeParallelStep(config, ctx, opts, stepTimeout);
            break;
          case 'iterate':
            output = await this.executeIterateStep(config, ctx, opts, stepTimeout);
            break;
          case 'transform':
            output = this.executeTransformStep(config, ctx);
            break;
          case 'delay':
            output = await this.executeDelayStep(config);
            break;
          case 'log':
            output = this.executeLogStep(config, ctx);
            break;
          default:
            throw new Error(`Unknown step type: ${config.type}`);
        }

        const duration = Date.now() - attemptStart;
        return {
          id: config.id,
          status: 'completed',
          output,
          duration,
          attempts: attempt,
        };
      } catch (err: any) {
        const errMsg = err.message || String(err);
        lastError.push(`attempt ${attempt}: ${errMsg}`);

        if (attempt < maxAttempts) {
          logger.warn(`[Workflow] Step "${config.id}" failed (attempt ${attempt}/${maxAttempts}), retrying...`, { error: errMsg });
          // Exponential backoff: 1s, 2s, 4s...
          await new Promise(r => setTimeout(r, Math.min(1000 * Math.pow(2, attempt - 1), 30_000)));
        }
      }
    }

    // All attempts exhausted
    const duration = Date.now() - startTime;
    return {
      id: config.id,
      status: 'failed',
      output: null,
      error: lastError.join('; '),
      duration,
      attempts: maxAttempts,
    };
  }

  /**
   * Execute a tool step via Composio.
   */
  private async executeToolStep(
    config: StepConfig,
    ctx: WorkflowStepContext,
    userId: string,
    timeout: number,
  ): Promise<any> {
    if (!config.tool) throw new Error(`Tool step "${config.id}" has no tool specified`);
    if (!userId) throw new Error('userId is required for tool execution');

    // Interpolate parameters
    const resolvedParams = config.params ? interpolate(config.params, ctx) : {};

    // Try executing via composio-service first, fall back to composio-adapter
    const composio = getComposioService();
    if (composio && typeof composio.executeTool === 'function') {
      try {
        const result = await composio.executeTool(config.tool, resolvedParams, userId);
        return result;
      } catch (err: any) {
        logger.debug(`[Workflow] composio-service.executeTool failed, trying adapter: ${err.message}`);
      }
    }

    // Fallback to the adapter's executeToolCall
    return await executeToolCall(userId, config.tool, resolvedParams);
  }

  /**
   * Execute a condition step — evaluate the condition, then execute the
   * matching branch (then or else) inline.
   */
  private async executeConditionStep(
    config: StepConfig,
    ctx: WorkflowStepContext,
    opts: { userId: string; workflowTimeout: number; globalMaxRetries: number; signal?: AbortSignal },
  ): Promise<{ conditionResult: boolean; branchResults: Record<string, StepResult> }> {
    if (!config.condition) throw new Error(`Condition step "${config.id}" has no condition clause`);

    const conditionResult = evaluateCondition(config.condition, ctx);
    const branchSteps = config.steps || [];

    // Determine which steps to execute based on the condition result.
    // then-steps come first, else-steps come after. _thenCount tells us the boundary.
    const thenCount = (config.params?._thenCount as number | undefined) ?? branchSteps.length;
    const stepsToRun = conditionResult
      ? branchSteps.slice(0, thenCount)
      : branchSteps.slice(thenCount);

    const branchResults: Record<string, StepResult> = {};

    for (const child of stepsToRun) {
      const result = await this.executeStep(child, ctx, opts);
      branchResults[child.id] = result;
      ctx.steps[child.id] = result;
    }

    return { conditionResult, branchResults };
  }

  /**
   * Execute a parallel step group — all child steps run concurrently.
   */
  private async executeParallelStep(
    config: StepConfig,
    ctx: WorkflowStepContext,
    opts: { userId: string; workflowTimeout: number; globalMaxRetries: number; signal?: AbortSignal },
    timeout: number,
  ): Promise<Record<string, StepResult>> {
    const childSteps = config.steps;
    if (!childSteps || childSteps.length === 0) return {};

    const results: Record<string, StepResult> = {};
    const settled = new Map<string, boolean>();

    // Create a child context that inherits from parent
    const childCtx: WorkflowStepContext = {
      variables: { ...ctx.variables },
      steps: { ...ctx.steps },
    };

    const promises = childSteps.map(async (child) => {
      const result = await this.executeStep(child, childCtx, opts);
      results[child.id] = result;
      settled.set(child.id, true);
      return result;
    });

    // Run with a race vs. timeout. If the timeout wins, the child promises
    // still complete in the background but their results are discarded.
    // The settled map tracks which finished before the timeout cutoff.
    try {
      await Promise.race([
        Promise.all(promises),
        new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error(`Parallel group "${config.id}" exceeded timeout of ${timeout}ms`)), timeout),
        ),
      ]);
    } catch (timeoutErr: any) {
      // Discard results from steps that didn't settle before timeout
      for (const step of childSteps) {
        if (!settled.has(step.id)) {
          results[step.id] = {
            id: step.id,
            status: 'failed',
            output: null,
            error: `Parallel group timeout after ${timeout}ms`,
            duration: 0,
            attempts: 0,
          };
        }
      }
    }

    return results;
  }

  /**
   * Execute an iterate step — run child steps for each item in an array.
   */
  private async executeIterateStep(
    config: StepConfig,
    ctx: WorkflowStepContext,
    opts: { userId: string; workflowTimeout: number; globalMaxRetries: number; signal?: AbortSignal },
    timeout: number,
  ): Promise<Array<{ item: any; index: number; results: Record<string, StepResult> }>> {
    if (!config.iterateOver) throw new Error(`Iterate step "${config.id}" has no iterateOver path`);
    if (!config.steps || config.steps.length === 0) throw new Error(`Iterate step "${config.id}" has no child steps`);

    const source = resolvePath(config.iterateOver, ctx);
    if (!Array.isArray(source)) {
      throw new Error(`Iterate step "${config.id}": path "${config.iterateOver}" did not resolve to an array`);
    }

    // Guard against runaway iteration
    if (source.length > MAX_ITERATE_ITEMS) {
      throw new Error(`Iterate step "${config.id}": source array has ${source.length} items, max is ${MAX_ITERATE_ITEMS}`);
    }

    const itemAlias = config.itemAlias || 'item';
    const results: Array<{ item: any; index: number; results: Record<string, StepResult> }> = [];

    for (let idx = 0; idx < source.length; idx++) {
      if (opts.signal?.aborted) break;

      const item = source[idx];
      const iterCtx: WorkflowStepContext = {
        variables: {
          ...ctx.variables,
          [itemAlias]: item,
          iterateIndex: idx,
          iterateTotal: source.length,
        },
        steps: { ...ctx.steps },
      };

      const iterStepResults: Record<string, StepResult> = {};

      for (const child of config.steps) {
        const result = await this.executeStep(child, iterCtx, opts);
        iterStepResults[child.id] = result;
        iterCtx.steps[child.id] = result;
      }

      results.push({ item, index: idx, results: iterStepResults });
    }

    return results;
  }

  /**
   * Execute a transform step — evaluate a simple expression against context.
   */
  private executeTransformStep(config: StepConfig, ctx: WorkflowStepContext): any {
    if (!config.transform) throw new Error(`Transform step "${config.id}" has no transform expression`);

    const resolvedParams = config.params ? interpolate(config.params, ctx) : {};
    const expr = interpolate(config.transform, ctx) as string;

    // Support common transform patterns:
    // - "map.steps.list.output" — extract a field
    // - "join.steps.list.output," — join array with delimiter
    // - "count.steps.list.output" — count array items
    // - "filter.steps.list.output.key=value" — filter array items

    if (expr.startsWith('map.')) {
      const path = expr.slice(4);
      const value = resolvePath(path, ctx);
      if (Array.isArray(value)) return value;
      return value;
    }

    if (expr.startsWith('join.')) {
      const parts = expr.slice(5).split(',');
      const path = parts[0];
      const delimiter = parts.slice(1).join(',') || ',';
      const value = resolvePath(path, ctx);
      if (Array.isArray(value)) {
        return value.map(v => {
          if (v === null || v === undefined) return '';
          if (typeof v === 'object') return JSON.stringify(v);
          return String(v);
        }).join(delimiter);
      }
      if (value && typeof value === 'object') return JSON.stringify(value);
      return String(value);
    }

    if (expr.startsWith('count.')) {
      const path = expr.slice(6);
      const value = resolvePath(path, ctx);
      if (Array.isArray(value)) return value.length;
      return 0;
    }

    if (expr.startsWith('filter.')) {
      // Format: filter.arrayPath|key=value
      // Example: filter.steps.list-repos.output|name=test
      // The `|` separates the array accessor path from the filter predicate
      // because dots in the path (e.g. steps.list-repos.output) are
      // indistinguishable from the filter key prefix otherwise.
      const rest = expr.slice(7); // everything after 'filter.'
      const pipeIdx = rest.lastIndexOf('|');
      if (pipeIdx === -1) {
        logger.warn(`[Workflow] Filter transform missing '|' delimiter in "${expr}". Use format: filter.path|key=value`);
        return [];
      }

      const path = rest.slice(0, pipeIdx);        // e.g. "steps.list-repos.output"
      const predicate = rest.slice(pipeIdx + 1);   // e.g. "name=test"

      const eqIdx = predicate.indexOf('=');
      const filterKey = eqIdx > -1 ? predicate.slice(0, eqIdx) : predicate;
      const filterVal = eqIdx > -1 ? predicate.slice(eqIdx + 1) : 'true';

      const arr = resolvePath(path, ctx);
      if (!Array.isArray(arr)) return [];

      return arr.filter((item: any) => {
        const v = typeof item === 'object' && item
          ? resolvePath(filterKey, { variables: {}, steps: {}, input: item })
          : item;
        return String(v) === filterVal;
      });
    }

    // Default: resolve as a path
    return resolvePath(expr, ctx);
  }

  /**
   * Execute a delay step.
   */
  private async executeDelayStep(config: StepConfig): Promise<null> {
    const ms = config.delayMs || 1000;
    await new Promise(r => setTimeout(r, ms));
    return null;
  }

  /**
   * Execute a log step — just logs a message and returns the interpolated message.
   */
  private executeLogStep(config: StepConfig, ctx: WorkflowStepContext): string {
    const msg = config.params?.message
      ? String(interpolate(config.params.message, ctx))
      : `[Log step "${config.id}"]`;
    logger.info(`[Workflow:Log] ${msg}`);
    return msg;
  }

  // --- Accessors ---

  getDefinition(): WorkflowDefinition {
    return { ...this.definition, steps: [...this.definition.steps] };
  }

  getSteps(): StepConfig[] {
    return [...this.definition.steps];
  }
}

// ============================================================================
// Branch Builder — scoped DSL for if/else/endif
// ============================================================================

export class BranchBuilder {
  private parent: WorkflowBuilder;
  private branchId: string;
  private clause: ConditionClause;
  private thenSteps: StepConfig[] = [];
  private elseSteps: StepConfig[] = [];
  /** When true, subsequent .step() calls add to the else branch */
  private onElseBranch = false;

  constructor(parent: WorkflowBuilder, id: string, clause: ConditionClause) {
    this.parent = parent;
    this.branchId = id;
    this.clause = clause;
  }

  /**
   * Add a step to the current branch (then or else, depending on whether
   * .else() has been called).
   */
  step(id: string, config: Omit<StepConfig, 'id' | 'type'> & { tool: string }): this {
    if (this.onElseBranch) {
      this.elseSteps.push({ id, ...config, type: 'tool' });
    } else {
      this.thenSteps.push({ id, ...config, type: 'tool' });
    }
    return this;
  }

  /**
   * Switch to the "else" branch. Subsequent .step() calls go to else.
   */
  else(): this {
    this.onElseBranch = true;
    return this;
  }

  /**
   * Finalize the branch and return to the parent builder.
   */
  endif(): WorkflowBuilder {
    // Build the branch metadata: first entry is then-clause, optional second is else-clause
    this.parent['definition'].steps.push({
      id: this.branchId,
      type: 'condition' as StepType,
      condition: this.clause,
      steps: [
        ...this.thenSteps.map(s => ({ ...s })),
        ...this.elseSteps.map(s => ({ ...s })),
      ],
      // Stash the boundary so executeConditionStep knows where then ends and else begins
      params: { _thenCount: this.thenSteps.length },
    });
    return this.parent;
  }
}

// ============================================================================
// Workflow Registry — manage and discover workflows
// ============================================================================

const workflowRegistry = new Map<string, WorkflowBuilder>();

/**
 * Register a workflow builder for later execution.
 */
export function registerWorkflow(wf: WorkflowBuilder): void {
  const def = wf.getDefinition();
  workflowRegistry.set(def.id, wf);
  logger.info(`[WorkflowRegistry] Registered workflow "${def.id}" (${def.steps.length} steps)`);
}

/**
 * Get a registered workflow by ID.
 */
export function getWorkflow(id: string): WorkflowBuilder | undefined {
  return workflowRegistry.get(id);
}

/**
 * List all registered workflow definitions.
 */
export function listWorkflows(): WorkflowDefinition[] {
  return Array.from(workflowRegistry.values()).map(w => w.getDefinition());
}

/**
 * Remove a registered workflow.
 */
export function unregisterWorkflow(id: string): boolean {
  return workflowRegistry.delete(id);
}

// ============================================================================
// Pre-built Workflows
// ============================================================================

/**
 * Create a workflow that searches issues across multiple repos and summarizes.
 *
 * @example
 *   const wf = await WorkflowBuilder.createGithubIssueSearch('cross-repo-search');
 *   wf.setVariables({ org: 'vercel', repos: ['next.js', 'turbo'] });
 *   const result = await wf.execute({ userId, variables: { org: 'vercel' } });
 */
export function createCrossRepoIssueSearch(id: string): WorkflowBuilder {
  return new WorkflowBuilder(id)
    .setName('Cross-Repo Issue Search')
    .setDescription('Search for issues across multiple repositories and summarize findings')
    .setVersion('1.0.0')
    .setTimeout(180_000)
    .setMaxRetries(2)
    .step('fetch-repos', {
      tool: 'github_list_repos',
      description: 'List repositories for the organization',
      params: { org: '{{variables.org}}' },
      timeout: 30_000,
    })
    .step('search-issues', {
      tool: 'github_search_issues',
      description: 'Search issues across repos',
      params: {
        q: '{{variables.query}}',
        repos: '{{variables.repos}}',
      },
      timeout: 60_000,
    })
    .transform('summarize', 'map.steps.search-issues.output', {
      description: 'Extract and summarize issue data',
    })
    .step('post-summary', {
      tool: 'github_create_issue',
      description: 'Post a summary issue',
      params: {
        repo: '{{variables.summaryRepo}}',
        title: 'Issue Search Summary - {{variables.query}}',
        body: JSON.stringify({ issues: '{{steps.summarize.output}}' }),
      },
      onError: 'continue',
    });
}

/**
 * Create a workflow that performs a CI/CD release pipeline.
 *
 * @example
 *   const wf = WorkflowBuilder.createReleasePipeline('release-v2');
 *   const result = await wf.execute({ userId, variables: { repo: 'my-org/my-app', version: '2.0.0' } });
 */
export function createReleasePipeline(id: string): WorkflowBuilder {
  return new WorkflowBuilder(id)
    .setName('Release Pipeline')
    .setDescription('Run tests, build, publish release')
    .setVersion('1.0.0')
    .setTimeout(600_000)
    .setMaxRetries(1)
    .step('run-tests', {
      tool: 'github_actions_dispatch',
      description: 'Trigger test workflow',
      params: { repo: '{{variables.repo}}', workflow: 'test.yml', ref: 'main' },
      timeout: 120_000,
    })
    .step('build', {
      tool: 'github_actions_dispatch',
      description: 'Trigger build workflow',
      params: { repo: '{{variables.repo}}', workflow: 'build.yml', ref: 'main' },
      timeout: 120_000,
      onError: 'abort',
    })
    .if('tests-passed', {
      lhs: 'steps.run-tests.output.conclusion',
      operator: 'eq',
      rhs: 'success',
    })
      .step('publish-release', {
        tool: 'github_create_release',
        description: 'Create GitHub release',
        params: {
          repo: '{{variables.repo}}',
          tag_name: 'v{{variables.version}}',
          name: 'Release v{{variables.version}}',
          generate_release_notes: true,
        },
      })
    .else()
      .step('notify-failure', {
        tool: 'github_create_issue',
        description: 'Create failure notification issue',
        params: {
          repo: '{{variables.repo}}',
          title: 'Release v{{variables.version}} failed',
          body: 'Tests did not pass. See workflow run for details.',
          labels: ['release', 'blocked'],
        },
      })
    .endif();
}

/**
 * Create a workflow that monitors a Slack channel and creates GitHub issues.
 *
 * @example
 *   const wf = WorkflowBuilder.createSlackToGithubBridge('slack-issues');
 *   const result = await wf.execute({ userId, variables: { slackChannel: 'C01ABC123' } });
 */
export function createSlackToGithubBridge(id: string): WorkflowBuilder {
  return new WorkflowBuilder(id)
    .setName('Slack → GitHub Issue Bridge')
    .setDescription('Monitor Slack messages and create GitHub issues from action items')
    .setVersion('1.0.0')
    .setTimeout(300_000)
    .setMaxRetries(2)
    .step('fetch-messages', {
      tool: 'slack_conversations_history',
      description: 'Fetch recent Slack messages',
      params: { channel: '{{variables.slackChannel}}', limit: 5 },
      timeout: 30_000,
    })
    .step('create-issues', {
      tool: 'github_create_issue',
      description: 'Create GitHub issue from Slack messages',
      params: {
        repo: '{{variables.githubRepo}}',
        title: 'Action Item: {{steps.fetch-messages.output.messages.[0].text}}',
        body: 'Source: {{variables.slackChannel}}',
        labels: ['slack', 'action-item'],
      },
      timeout: 30_000,
      onError: 'continue',
    });
}

// ============================================================================
// Workflow Execution Helper
// ============================================================================

/**
 * Execute a workflow by its registered ID with the given context.
 * Shorthand for getWorkflow(id)?.execute(context).
 */
export async function executeWorkflowById(
  id: string,
  context: WorkflowExecutionContext,
): Promise<WorkflowResult | null> {
  const wf = getWorkflow(id);
  if (!wf) {
    logger.error(`[Workflow] No workflow registered with id "${id}"`);
    return null;
  }
  return wf.execute(context);
}

// ============================================================================
// Export default
// ============================================================================

export default WorkflowBuilder;
