/**
 * Task Management CLI Commands
 * 
 * Provides CLI commands for task management:
 * - task:list - List tasks with filtering and pagination
 * - task:create - Create new tasks with steps
 * - task:edit - Modify task properties
 * - task:delete - Delete tasks
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';

const COLORS = {
  primary: chalk.cyan,
  success: chalk.green,
  warning: chalk.yellow,
  error: chalk.red,
  info: chalk.blue,
  muted: chalk.gray,
};

// ============================================================================
// Types & Interfaces
// ============================================================================

// Valid task statuses for validation
const VALID_STATUSES = ['pending', 'in_progress', 'completed', 'failed'] as const;
type TaskStatus = typeof VALID_STATUSES[number];

interface Task {
  id: string;
  title: string;
  description?: string;
  status: string;
  priority: number;
  progress: number;
  steps?: Step[];
  tags?: string[];
  createdAt?: number;
  updatedAt?: number;
  lastAccessedAt?: number;
}

interface Step {
  id: string;
  description: string;
  status: string;
  order: number;
}

interface PaginationInfo {
  offset: number;
  limit: number;
  total: number;
  hasMore: boolean;
}

interface ApiResponse<T> {
  success?: boolean;
  task?: T;
  tasks?: T[];
  pagination?: PaginationInfo;
  error?: string;
}

/**
 * Task filter interface for querying tasks
 */
interface TaskFilter {
  status?: string | string[];
  retention?: string | string[];
  tags?: string[];
  minPriority?: number;
  maxPriority?: number;
}

/**
 * Validate task status value
 * @throws Error if status is invalid
 */
function validateStatus(status: string): void {
  if (!VALID_STATUSES.includes(status as TaskStatus)) {
    throw new Error(`Invalid status '${status}'. Valid values: ${VALID_STATUSES.join(', ')}`);
  }
}

/**
 * Validate numeric input for pagination/priority
 */
function validateNumber(value: string, name: string, min: number, max: number): number {
  const num = parseInt(value);
  if (isNaN(num) || num < min || num > max) {
    throw new Error(`Invalid ${name} (must be ${min}-${max})`);
  }
  return num;
}

/**
 * Parse step input string into step objects
 * Format: "Step 1, Step 2, Step 3" or "1. First, 2. Second"
 */
function parseSteps(input: string[]): { description: string; order: number }[] {
  const steps = input.join(',').split(',').map((s, i) => ({
    description: s.trim(),
    order: i,
  }));
  return steps.filter(s => s.description.length > 0);
}

/**
 * Format task for table display
 */
function formatTaskRow(t: Task) {
  return {
    ID: t.id?.slice(0, 8) || '-',
    Title: t.title?.slice(0, 40) || '-',
    Status: t.status || 'pending',
    Priority: t.priority ?? 50,
    Progress: `${Math.round((t.progress || 0) * 100)}%`,
    Steps: t.steps?.length || 0,
    Tags: (t.tags || []).slice(0, 3).join(', '),
  };
}

/**
 * Parse JSON output option
 */
function shouldOutputJson(options: any): boolean {
  return options.json === true;
}

/**
 * LLM-aided step enrichment
 * Takes a step description and returns a more detailed version
 */
async function enrichStepWithLLM(
  step: string,
  apiRequest: (endpoint: string, options?: any) => Promise<any>,
  multiPerspective = false
): Promise<{ enriched: string; details?: any }> {
  try {
    const endpoint = multiPerspective 
      ? '/memory/task/enrich-step-multi' 
      : '/memory/task/enrich-step';
    
    const result = await apiRequest(endpoint, {
      method: 'POST',
      data: { step },
    }).catch(() => null);
    
    if (result?.enriched) {
      return { 
        enriched: result.enriched, 
        details: multiPerspective ? result : undefined 
      };
    }
    return { enriched: step }; // Fallback to original
  } catch {
    return { enriched: step };
  }
}

/**
 * Display multi-perspective enrichment results
 */
function displayMultiPerspectiveEnrichment(details: any, colors: typeof COLORS): void {
  if (!details || !details.perspectives) return;
  
  console.log(colors.info('\n📊 Multi-Perspective Analysis:'));
  console.log(colors.primary('\n🔧 Technical:'));
  console.log('  ' + details.perspectives.technical.split('\n').join('\n  '));
  
  console.log(colors.primary('\n🧪 QA:'));
  console.log('  ' + details.perspectives.qa.split('\n').join('\n  '));
  
  console.log(colors.primary('\n🎨 UX:'));
  console.log('  ' + details.perspectives.ux.split('\n').join('\n  '));
  
  console.log(colors.primary('\n🔒 Security:'));
  console.log('  ' + details.perspectives.security.split('\n').join('\n  '));
  
  if (details.metrics) {
    console.log(colors.info('\n📈 Quality Metrics:'));
    console.log(`  Clarity: ${colors.success(details.metrics.clarity + '%')}`);
    console.log(`  Completeness: ${colors.success(details.metrics.completeness + '%')}`);
    console.log(`  Actionability: ${colors.success(details.metrics.actionability + '%')}`);
    console.log(`  Risk Assessment: ${colors.warning(details.metrics.riskAssessment + '%')}`);
    console.log(`  Overall: ${colors.primary(details.metrics.overall + '%')}`);
  }
  
  if (details.risks?.length) {
    console.log(colors.error('\n⚠️ Risks:'));
    details.risks.forEach((r: string) => console.log('  ' + r));
  }
  
  if (details.recommendations?.length) {
    console.log(colors.muted('\n💡 Recommendations:'));
    details.recommendations.forEach((r: string) => console.log('  ' + r));
  }
  
  if (details.microSteps?.length) {
    console.log(colors.info('\n📋 Micro-Steps:'));
    details.microSteps.forEach((m: any, i: number) => {
      const riskIcon = m.riskLevel === 'high' ? '🔴' : m.riskLevel === 'medium' ? '🟡' : '🟢';
      const time = m.estimatedMinutes ? ` [${m.estimatedMinutes}min]` : '';
      console.log(`  ${i + 1}. ${riskIcon} ${m.description}${time}`);
    });
  }
}

/**
 * Parse steps with optional LLM enrichment
 */
async function parseStepsWithEnrichment(
  input: string[],
  enrich: boolean,
  apiRequest: (endpoint: string, options?: any) => Promise<any>,
  multiPerspective = false
): Promise<{ description: string; order: number }[]> {
  const steps = input.join(',').split(',').map((s, i) => ({
    description: s.trim(),
    order: i,
  })).filter(s => s.description.length > 0);
  
  if (enrich && steps.length > 0) {
    const spinner = ora('Enriching steps with AI...').start();
    const enrichedSteps = await Promise.all(
      steps.map(async (s, i) => {
        const result = await enrichStepWithLLM(s.description, apiRequest, multiPerspective);
        return { ...s, description: result.enriched, order: i };
      })
    );
    spinner.stop();
    return enrichedSteps;
  }
  
  return steps;
}

/**
 * Register task commands with the CLI program
 */
export function registerTaskCommands(
  program: Command,
  apiRequest: (endpoint: string, options?: any) => Promise<any>,
  prompt: (question: string) => Promise<string>
): void {
  
  // Task List command
  program
    .command('task:list')
    .description('List tasks')
    .option('-s, --status <status>', 'Filter by status (pending, in_progress, completed, failed)')
    .option('-t, --tags <tags...>', 'Filter by tags')
    .option('--limit <number>', 'Maximum tasks to return (1-100)', '20')
    .option('--offset <number>', 'Skip N tasks for pagination (0-1000)', '0')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      const spinner = ora('Fetching tasks...').start();
      
      try {
        const limit = validateNumber(options.limit, '--limit', 1, 100);
        const offset = validateNumber(options.offset, '--offset', 0, 1000);
        
        const filter: TaskFilter = {};
        if (options.status) {
          validateStatus(options.status);
          filter.status = options.status;
        }
        if (options.tags) filter.tags = options.tags;
        
        const result: ApiResponse<Task> = await apiRequest('/memory/task/list', {
          method: 'POST',
          data: { filter, limit, offset },
        });
        
        spinner.stop();
        
        const tasks = result.tasks || result as unknown as Task[];
        const pagination = result.pagination;
        
        if (shouldOutputJson(options)) {
          console.log(JSON.stringify({ tasks, pagination }, null, 2));
          return;
        }
        
        if (tasks && tasks.length > 0) {
          console.log(COLORS.primary(`\nTasks (${tasks.length}${pagination ? ` of ${pagination.total}` : ''}):`));
          console.table(tasks.map(formatTaskRow));
          
          if (pagination && pagination.hasMore) {
            console.log(COLORS.muted(`\n  Showing ${pagination.offset + tasks.length} of ${pagination.total} tasks`));
            console.log(COLORS.muted(`  Use --offset ${pagination.offset + tasks.length} to see more`));
          }
        } else {
          console.log(COLORS.info('\nNo tasks found'));
        }
        
      } catch (error: any) {
        spinner.stop();
        console.log(COLORS.error(`Error: ${error.message}`));
        process.exit(1);
      }
    });

  // Task Create command
  program
    .command('task:create <title>')
    .description('Create a new task/plan')
    .option('-d, --description <text>', 'Task description')
    .option('-s, --steps <steps...>', 'Initial steps (comma-separated)')
    .option('-p, --priority <number>', 'Priority (0-100, default: 50)', '50')
    .option('-t, --tags <tags...>', 'Task tags')
    .option('--json', 'Output as JSON')
    .option('--enrich', 'Use AI to enrich step descriptions with more detail')
    .option('--multi', 'Use multi-perspective enrichment with analysis from Technical, QA, UX, Security')
    .option('--expand', 'Expand steps with detailed scope and sub-steps')
    .action(async (title, options) => {
      const spinner = ora('Creating task...').start();
      
      try {
        const priority = validateNumber(options.priority, '--priority', 0, 100);
        // Process steps with expansion if requested
        let steps = options.steps 
          ? await parseStepsWithEnrichment(options.steps, options.enrich, apiRequest, options.multi)
          : undefined;
        
        // Apply step expansion with scope enrichment
        if (options.expand && steps) {
          // CLI fix: Use relative path instead of web-app alias @/
          // The @/ alias is not defined in CLI runtime
          try {
            const { expandStepIntoDetail } = await import('../../shared/lib/memory/task-persistence.js');
            steps = await Promise.all(
              steps.map(async (s) => {
                const expanded = expandStepIntoDetail(s.description);
                // Update description with enriched scope
                return { ...s, description: expanded.expanded.join('\n') };
              })
            );
          } catch (importErr) {
            console.log(COLORS.warning('Step expansion unavailable: module not found'));
          }
        }
        
        const result: ApiResponse<Task> = await apiRequest('/memory/task/create', {
          method: 'POST',
          data: {
            title,
            description: options.description,
            steps,
            priority,
            tags: options.tags,
          },
        });
        
        spinner.stop();
        
        if (shouldOutputJson(options)) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }
        
        if (result.success || result.task) {
          const task = result.task || result as unknown as Task;
          console.log(COLORS.success('\n✓ Task created!'));
          console.log(`  ID: ${COLORS.info(task.id)}`);
          console.log(`  Title: ${COLORS.primary(task.title)}`);
          console.log(`  Status: ${task.status || 'pending'}`);
          console.log(`  Priority: ${task.priority ?? 50}`);
          if (task.steps?.length) {
            console.log(`  Steps: ${task.steps.length}`);
          }
        } else {
          console.log(COLORS.error(`Error: ${result.error || 'Failed to create task'}`));
          process.exit(1);
        }
        
      } catch (error: any) {
        spinner.stop();
        console.log(COLORS.error(`Error: ${error.message}`));
        process.exit(1);
      }
    });

  // Task Edit command
  program
    .command('task:edit <taskId>')
    .description('Edit a task')
    .option('--title <text>', 'New title')
    .option('-d, --description <text>', 'New description')
    .option('-p, --priority <number>', 'New priority (0-100)')
    .option('--status <status>', 'New status (pending, in_progress, completed, failed)')
    .option('--add-steps <steps...>', 'Add steps (comma-separated)')
    .option('--json', 'Output as JSON')
    .option('--enrich', 'Use AI to enrich new step descriptions')
    .option('--multi', 'Use multi-perspective enrichment with analysis')
    .option('--validate', 'Validate step quality before adding')
    .option('--expand', 'Expand steps with detailed scope and sub-steps')
    .action(async (taskId, options) => {
      const spinner = ora('Updating task...').start();
      
      try {
        const updates: Partial<Task> = {};
        if (options.title) updates.title = options.title;
        if (options.description) updates.description = options.description;
        if (options.priority) updates.priority = validateNumber(options.priority, '--priority', 0, 100);
        if (options.status) {
          validateStatus(options.status);
          updates.status = options.status;
        }
        
        let addSteps;
        if (options.addSteps) {
          // First get the existing task to determine step count for proper ordering
          const existingTask = await apiRequest('/memory/task/get', {
            method: 'POST',
            data: { taskId },
          }).catch(() => null);
          
          // Throw error if task doesn't exist
          if (!existingTask?.task && !existingTask?.id) {
            throw new Error(`Task '${taskId}' not found`);
          }
          
          const existingStepCount = existingTask?.task?.steps?.length || existingTask?.steps?.length || 0;
          
          // Append new steps with order values after existing steps
          // Use LLM enrichment if --enrich flag is set
          const stepsToEnrich = options.enrich;
          addSteps = await parseStepsWithEnrichment(options.addSteps, stepsToEnrich, apiRequest, options.multi).then(
            steps => steps.map((s, i) => ({
              ...s,
              order: existingStepCount + i,
              status: 'pending',
            }))
          );
          
          // FIX: Apply --expand to new steps if requested
          if (options.expand && addSteps) {
            try {
              const { expandStepIntoDetail } = await import('../../shared/lib/memory/task-persistence.js');
              addSteps = await Promise.all(
                addSteps.map(async (s) => {
                  const expanded = expandStepIntoDetail(s.description);
                  return { ...s, description: expanded.expanded.join('\n') };
                })
              );
            } catch (importErr) {
              console.log(COLORS.warning('Step expansion unavailable: module not found'));
            }
          }
        }
        
        const result: ApiResponse<Task> = await apiRequest('/memory/task/edit', {
          method: 'POST',
          data: {
            taskId,
            ...updates,
            ...(addSteps ? { addSteps } : {}),
          },
        });
        
        spinner.stop();
        
        if (shouldOutputJson(options)) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }
        
        if (result.success || result.task) {
          const task = result.task || result as unknown as Task;
          console.log(COLORS.success('\n✓ Task updated!'));
          console.log(`  ID: ${COLORS.info(task.id)}`);
          console.log(`  Title: ${COLORS.primary(task.title)}`);
          console.log(`  Status: ${task.status}`);
          console.log(`  Priority: ${task.priority}`);
          console.log(`  Progress: ${Math.round((task.progress || 0) * 100)}%`);
        } else {
          console.log(COLORS.error(`Error: ${result.error || 'Failed to update task'}`));
          process.exit(1);
        }
        
      } catch (error: any) {
        spinner.stop();
        console.log(COLORS.error(`Error: ${error.message}`));
        process.exit(1);
      }
    });

  // Task Delete command
  program
    .command('task:delete <taskId>')
    .description('Delete a task')
    .option('-f, --force', 'Force delete without confirmation')
    .option('--json', 'Output as JSON')
    .action(async (taskId, options) => {
      if (!options.force) {
        const answer = await prompt(COLORS.warning(`Delete task ${taskId}? (y/N): `));
        if (answer.toLowerCase() !== 'y') {
          console.log(COLORS.info('Cancelled'));
          return;
        }
      }
      
      const spinner = ora('Deleting task...').start();
      
      try {
        const result: ApiResponse<Task> = await apiRequest('/memory/task/delete', {
          method: 'POST',
          data: { taskId },
        });
        
        spinner.stop();
        
        if (shouldOutputJson(options)) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }
        
        if (result.success) {
          console.log(COLORS.success('\n✓ Task deleted!'));
        } else {
          console.log(COLORS.error(`Error: ${result.error || 'Failed to delete task'}`));
          process.exit(1);
        }
        
      } catch (error: any) {
        spinner.stop();
        console.log(COLORS.error(`Error: ${error.message}`));
        process.exit(1);
      }
    });

  // Task Get Unfinished command - for re-context
  program
    .command('task:pending')
    .description('List pending/in-progress tasks for re-context')
    .option('--limit <number>', 'Maximum tasks (1-50)', '10')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      const spinner = ora('Fetching pending tasks...').start();
      
      try {
        const limit = validateNumber(options.limit || '10', '--limit', 1, 50);
        
        const result: ApiResponse<Task> = await apiRequest('/memory/task/getUnfinished', {
          method: 'POST',
          data: { limit },
        });
        
        spinner.stop();
        
        const tasks = result.tasks || [];
        
        if (shouldOutputJson(options)) {
          console.log(JSON.stringify({ tasks }, null, 2));
          return;
        }
        
        if (tasks && tasks.length > 0) {
          console.log(COLORS.primary(`\nPending/In-Progress Tasks (${tasks.length}):`));
          console.table(
            tasks.map((t: Task) => ({
              ID: t.id?.slice(0, 8) || '-',
              Title: t.title?.slice(0, 40) || '-',
              Status: t.status,
              Progress: `${Math.round((t.progress || 0) * 100)}%`,
              Steps: `${t.steps?.filter((s: Step) => s.status === 'completed').length || 0}/${t.steps?.length || 0}`,
            }))
          );
        } else {
          console.log(COLORS.info('\nNo pending tasks'));
        }
        
      } catch (error: any) {
        spinner.stop();
        console.log(COLORS.error(`Error: ${error.message}`));
        process.exit(1);
      }
    });
}

export default registerTaskCommands;