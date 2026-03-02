import * as path from 'path';
import { Crew, type ProcessType } from '@/lib/crewai/crew/crew';
import { RoleAgent } from '@/lib/crewai/agents/role-agent';
import { Task } from '@/lib/crewai/tasks/task';

export interface CrewAIRunOptions {
  sessionId: string;
  userMessage: string;
  process?: ProcessType;
  agentsConfigPath?: string;
  verbose?: boolean;
  memory?: boolean;
  cache?: boolean;
}

export interface CrewAIRunResult {
  success: boolean;
  response: string;
  process: ProcessType;
  tasks: Array<{ agent: string; description: string; output: string }>;
  errors: Array<{ message: string }>;
}

function resolveConfigPath(filePath: string): string {
  return path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
}

function parseProcess(value: string | undefined): ProcessType {
  if (value === 'hierarchical' || value === 'consensual' || value === 'sequential') {
    return value;
  }
  return 'sequential';
}

export async function runCrewAIWorkflow(options: CrewAIRunOptions): Promise<CrewAIRunResult> {
  const processType = options.process || parseProcess(process.env.CREWAI_DEFAULT_PROCESS);
  const configPath = resolveConfigPath(
    options.agentsConfigPath || process.env.CREWAI_AGENTS_CONFIG || 'src/config/agents.yaml',
  );

  const agents = await RoleAgent.loadAllFromYAML(configPath, options.sessionId, {
    user_request: options.userMessage,
  });

  const planner = agents.get(process.env.CREWAI_PLANNER_AGENT || 'planner');
  const coder = agents.get(process.env.CREWAI_CODER_AGENT || 'coder');
  const critic = agents.get(process.env.CREWAI_CRITIC_AGENT || 'critic');
  const manager = agents.get(process.env.CREWAI_MANAGER_AGENT || 'manager');

  if (!planner || !coder || !critic) {
    throw new Error(
      `CrewAI config missing required agents (planner/coder/critic) at ${configPath}`,
    );
  }

  const planTask = new Task({
    description: `Create an execution plan for this request: ${options.userMessage}`,
    expected_output:
      'Return concise plan with ordered steps, target files, and validation strategy.',
    agent: planner,
  });

  const implementationTask = new Task({
    description: `Implement the request based on plan and existing project constraints: ${options.userMessage}`,
    expected_output:
      'Return implemented approach, key file changes, and any commands/tests run.',
    agent: coder,
    context: [planTask],
  });

  const reviewTask = new Task({
    description:
      'Review implementation for correctness, safety, and edge cases. Provide fixes if needed.',
    expected_output: 'Return review summary and final validated answer.',
    agent: critic,
    context: [planTask, implementationTask],
  });

  const crew = new Crew({
    agents: Array.from(agents.values()),
    tasks: [planTask, implementationTask, reviewTask],
    process: processType,
    verbose: options.verbose ?? process.env.CREWAI_VERBOSE === 'true',
    memory: options.memory ?? process.env.CREWAI_MEMORY === 'true',
    cache: options.cache ?? process.env.CREWAI_CACHE !== 'false',
    manager_agent: processType === 'hierarchical' ? manager : undefined,
    manager_llm: process.env.CREWAI_PROCESS_LLM,
  });

  const result = await crew.kickoff({
    inputs: {
      user_request: options.userMessage,
    },
  });

  return {
    success: true,
    response: result.raw,
    process: processType,
    tasks: result.tasks_output.map((task) => ({
      agent: task.agent,
      description: task.description,
      output: task.raw,
    })),
    errors: [],
  };
}
