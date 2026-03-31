/**
 * Skills as Capabilities
 *
 * Bridges the skills system with the capabilities layer.
 * Each skill can be exposed as one or more capabilities.
 *
 * Usage:
 * ```typescript
 * import { registerSkillCapabilities } from '@/lib/tools/skills-capabilities';
 * await registerSkillCapabilities();
 * ```
 */

import { z } from 'zod';
import { createLogger } from '@/lib/utils/logger';
import type { CapabilityDefinition } from './capabilities';
import { skillsRegistry } from '@/lib/skills/skills-registry';

const logger = createLogger('Skills:Capabilities');

/**
 * Skill-based capability definition
 */
export interface SkillCapability extends CapabilityDefinition {
  skillName: string;
  workflowName?: string;
}

/**
 * Register all skills as capabilities
 */
export async function registerSkillCapabilities(): Promise<SkillCapability[]> {
  const capabilities: SkillCapability[] = [];
  
  try {
    // Initialize skills registry if not already done
    await skillsRegistry.initialize();
    
    // Get all enabled skills
    const skills = skillsRegistry.getAllSkills().filter(s => s.enabled);
    
    for (const skill of skills) {
      // Create capability for each skill
      const capability = createSkillCapability(skill.config, skill.location.type);
      if (capability) {
        capabilities.push(capability);
        
        // Create workflow-specific capabilities
        for (const workflow of skill.config.workflows) {
          const workflowCapability = createWorkflowCapability(skill.config, workflow, skill.location.type);
          if (workflowCapability) {
            capabilities.push(workflowCapability);
          }
        }
      }
    }
    
    logger.info('Registered skill capabilities', { count: capabilities.length });
    return capabilities;
  } catch (error: any) {
    logger.error('Failed to register skill capabilities', { error: error.message });
    return [];
  }
}

/**
 * Create a capability from a skill
 */
function createSkillCapability(
  skill: any,
  location: 'global' | 'user'
): SkillCapability | null {
  const { metadata, systemPrompt, subCapabilities } = skill;
  
  // Create a general capability for the skill
  return {
    id: `skill.${metadata.name}`,
    name: metadata.name,
    category: 'automation',
    description: metadata.description,
    inputSchema: z.object({
      task: z.string().describe('Task description'),
      context: z.record(z.unknown()).optional().describe('Additional context'),
    }),
    outputSchema: z.object({
      success: z.boolean(),
      result: z.unknown().optional(),
      skillUsed: z.string(),
    }),
    providerPriority: [location === 'global' ? 'global-skill' : 'user-skill'],
    tags: [...metadata.tags, 'skill', location],
    metadata: {
      latency: 'medium',
      cost: 'low',
      reliability: 0.9,
    },
    permissions: ['skill.execute'],
    skillName: metadata.name,
  };
}

/**
 * Create a capability for a specific workflow
 */
function createWorkflowCapability(
  skill: any,
  workflow: any,
  location: 'global' | 'user'
): SkillCapability | null {
  return {
    id: `skill.${skill.metadata.name}.${workflow.name.toLowerCase().replace(/\s+/g, '-')}`,
    name: `${skill.metadata.name}: ${workflow.name}`,
    category: 'automation',
    description: workflow.description || workflow.trigger,
    inputSchema: z.object({
      input: z.string().describe('Input for the workflow'),
      options: z.record(z.unknown()).optional().describe('Workflow options'),
    }),
    outputSchema: z.object({
      success: z.boolean(),
      steps: z.array(z.object({
        action: z.string(),
        result: z.unknown().optional(),
        error: z.string().optional(),
      })),
    }),
    providerPriority: [location === 'global' ? 'global-skill' : 'user-skill'],
    tags: [...skill.metadata.tags, 'skill', 'workflow', location],
    metadata: {
      latency: 'medium',
      cost: 'low',
      reliability: 0.85,
    },
    permissions: ['skill.execute'],
    skillName: skill.metadata.name,
    workflowName: workflow.name,
  };
}

/**
 * Get skill capability by ID
 */
export function getSkillCapability(capabilityId: string): SkillCapability | null {
  // This would typically query a registry
  // For now, returns null - actual lookup happens via capability router
  return null;
}

/**
 * Execute a skill capability
 */
export async function executeSkillCapability(
  capabilityId: string,
  input: Record<string, unknown>,
  context?: {
    agentType?: string;
    conversationId?: string;
  }
): Promise<{ success: boolean; skillUsed: string; workflowUsed?: string; error?: string }> {
  const parts = capabilityId.split('.');

  if (parts[0] !== 'skill') {
    throw new Error(`Not a skill capability: ${capabilityId}`);
  }

  const skillName = parts[1];
  const workflowName = parts[2];

  const skill = skillsRegistry.getSkill(skillName);

  if (!skill) {
    return { success: false, skillUsed: skillName, error: `Skill not found: ${skillName}` };
  }

  if (!skill.enabled) {
    return { success: false, skillUsed: skillName, error: `Skill disabled: ${skillName}` };
  }

  // Find workflow if specified
  const workflow = workflowName
    ? skill.config.workflows.find(w => w.name.toLowerCase().replace(/\s+/g, '-') === workflowName)
    : skill.config.workflows[0];

  if (!workflow) {
    return { success: false, skillUsed: skillName, error: `Workflow not found: ${workflowName}` };
  }

  // Execute the skill/workflow
  // In production, this would integrate with the agent execution system
  logger.info('Executing skill capability', {
    skill: skillName,
    workflow: workflow.name,
    agentType: context?.agentType,
  });

  // Record execution for reinforcement learning
  const { skillsManager } = await import('@/lib/skills/skills-manager');
  
  try {
    await skillsManager.recordExecution(
      skillName,
      context?.agentType || 'unknown',
      workflow.name || 'general',
      true, // success - would be determined by actual execution
      undefined, // executionTime
      `Executed via capability: ${capabilityId}`
    );

    return {
      success: true,
      skillUsed: skillName,
      workflowUsed: workflow.name,
    };
  } catch (error: any) {
    logger.error('Failed to record skill execution', { error: error.message });
    return {
      success: false,
      skillUsed: skillName,
      workflowUsed: workflow.name,
      error: error.message,
    };
  }
}

/**
 * Get skills filtered by agent type for capability routing
 */
export function getSkillCapabilitiesForAgentType(agentType: string): SkillCapability[] {
  const skills = skillsRegistry.getSkillsForAgentType(agentType);
  
  const capabilities: SkillCapability[] = [];
  
  for (const { skill, weight } of skills) {
    if (weight < 0.5) continue; // Skip low-weight skills
    
    const capability = createSkillCapability(skill.config, skill.location.type);
    if (capability) {
      capabilities.push(capability);
    }
  }
  
  return capabilities;
}
