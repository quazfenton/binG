import * as path from 'path';
import { Crew, type ProcessType, type StreamChunk } from '@/lib/crewai/crew/crew';
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
  stream?: boolean;
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

export async function runCrewAIWorkflow(options: CrewAIRunOptions): Promise<CrewAIRunResult | AsyncGenerator<StreamChunk>> {
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
    description: `Analyze this user request and create a detailed execution plan: ${options.userMessage}. 
List the specific technical steps, target components, and validation criteria.`,
    expected_output: 'A comprehensive engineering plan in markdown format.',
    agent: planner,
  });

  const planningCrew = new Crew({
    agents: [planner],
    tasks: [planTask],
    verbose: options.verbose,
  });
  
  const planResult = await planningCrew.kickoff();
  const planRaw = planResult.raw;

  const implementationTask = new Task({
    description: `Execute the following engineering plan surgically:
${planRaw}

Original request: ${options.userMessage}`,
    expected_output: 'Summary of changes implemented, including file paths and verification results.',
    agent: coder,
    context: [planTask],
  });

  const reviewTask = new Task({
    description: `Critically review the implementation for:
1. Adherence to the plan
2. Code quality and safety
3. Edge case handling
4. Correctness of logic

Implementation details: {implementation_output}`,
    expected_output: 'Final verification report and a consolidated answer to the user.',
    agent: critic,
    context: [implementationTask],
  });

  const crew = new Crew({
    agents: Array.from(agents.values()),
    tasks: [implementationTask, reviewTask],
    process: processType,
    verbose: options.verbose ?? process.env.CREWAI_VERBOSE === 'true',
    memory: options.memory ?? process.env.CREWAI_MEMORY === 'true',
    cache: options.cache ?? process.env.CREWAI_CACHE !== 'false',
    manager_agent: processType === 'hierarchical' ? manager : undefined,
    manager_llm: process.env.CREWAI_PROCESS_LLM,
  });

  const kickoffOptions = {
    inputs: {
      user_request: options.userMessage,
      plan: planRaw,
    },
  };

  if (options.stream) {
    return crew.kickoffStream(kickoffOptions);
  }

  const result = await crew.kickoff(kickoffOptions);

  return {
    success: true,
    response: result.raw,
    process: processType,
    tasks: [
      { agent: planner.role, description: planTask.description, output: planRaw },
      ...result.tasks_output.map((task) => ({
        agent: task.agent,
        description: task.description,
        output: task.raw,
      })),
    ],
    errors: [],
  };
}

