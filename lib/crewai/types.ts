/**
 * CrewAI Types
 * 
 * Type definitions for CrewAI integration.
 */

export enum CrewProcess {
  sequential = 'sequential',
  hierarchical = 'hierarchical',
}

export interface CrewAIConfig {
  name: string;
  agents: any[];
  tasks: any[];
  process?: CrewProcess;
  verbose?: boolean;
}
