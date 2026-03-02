/**
 * CrewAI Tasks Factory
 * 
 * Factory functions for creating CrewAI tasks.
 */

import { Task } from '../tasks/task';

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
export function createResearchTask(topic: string): Task {
  return new Task({
    description: `Research the topic: ${topic}`,
    expected_output: `Comprehensive research notes on ${topic}`,
  });
}

/**
 * Create a write task
 */
export function createWriteTask(content: string): Task {
  return new Task({
    description: `Write content about: ${content}`,
    expected_output: `Well-written content about ${content}`,
  });
}

/**
 * Create a code task
 */
export function createCodeTask(code: string): Task {
  return new Task({
    description: `Write code: ${code}`,
    expected_output: `Working code for: ${code}`,
  });
}
