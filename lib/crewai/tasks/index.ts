/**
 * CrewAI Tasks Factory
 *
 * Factory functions for creating CrewAI tasks.
 */

import { Task } from '../tasks/task';
import type { RoleAgent } from '../agents/role-agent';

export interface TaskConfig {
  description: string;
  expected_output: string;
  agent?: any;
}

/**
 * Create a generic task
 */
export function createTask(config: TaskConfig): Task {
  return new Task({
    description: config.description,
    expected_output: config.expected_output,
    agent: config.agent,
  });
}

/**
 * Create a research task
 */
export function createResearchTask(topic: string, agent: RoleAgent): Task {
  return new Task({
    description: `Research the topic: ${topic}`,
    expected_output: `Comprehensive research notes on ${topic}`,
    agent,
  });
}

/**
 * Create a write task
 */
export function createWriteTask(content: string, agent: RoleAgent): Task {
  return new Task({
    description: `Write content about: ${content}`,
    expected_output: `Well-written content about ${content}`,
    agent,
  });
}

/**
 * Create a code task
 */
export function createCodeTask(code: string, agent: RoleAgent): Task {
  return new Task({
    description: `Write code: ${code}`,
    expected_output: `Working code for: ${code}`,
    agent,
  });
}
