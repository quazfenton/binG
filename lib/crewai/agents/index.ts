/**
 * CrewAI Agents Factory
 * 
 * Factory functions for creating CrewAI agents.
 */

import { RoleAgent } from './role-agent';

export interface AgentConfig {
  role: string;
  goal: string;
  backstory: string;
  verbose?: boolean;
}

/**
 * Create a generic agent
 */
export function createAgent(config: AgentConfig): RoleAgent {
  return new RoleAgent({
    role: config.role,
    goal: config.goal,
    backstory: config.backstory,
    verbose: config.verbose,
  });
}

/**
 * Create a researcher agent
 */
export function createResearcherAgent(): RoleAgent {
  return new RoleAgent({
    role: 'Researcher',
    goal: 'Find and analyze relevant information',
    backstory: 'You are an expert researcher with years of experience in gathering and analyzing information. You are thorough, accurate, and always cite your sources.',
  });
}

/**
 * Create a writer agent
 */
export function createWriterAgent(): RoleAgent {
  return new RoleAgent({
    role: 'Writer',
    goal: 'Create clear, engaging content',
    backstory: 'You are a skilled writer with a talent for crafting compelling narratives. You can adapt your writing style to any audience and always aim for clarity and impact.',
  });
}

/**
 * Create a coder agent
 */
export function createCoderAgent(): RoleAgent {
  return new RoleAgent({
    role: 'Coder',
    goal: 'Write clean, efficient code',
    backstory: 'You are an experienced programmer who follows best practices. You write well-documented code and always consider performance, security, and maintainability.',
  });
}
