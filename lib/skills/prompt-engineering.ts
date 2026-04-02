/**
 * System Prompt Engineering - Skill Context Injection
 *
 * Injects skill contexts into LLM system prompts based on:
 * - Agent type (CLI, cloud, Nullclaw, etc.)
 * - Task requirements
 * - Skill weights from reinforcement learning
 * - EJSON structured data passing
 */

import { skillsManager, type SkillConfig, type AgentTypeProfile } from './skills-manager';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('Skills:PromptEngine');

// ============================================================================
// Types
// ============================================================================

export interface PromptEngineeringConfig {
  agentType: string;
  taskDescription: string;
  includeSkills?: string[];
  excludeSkills?: string[];
  maxSkills?: number;
  weightThreshold?: number;
  includeEJson?: boolean;
}

export interface EngineeredPrompt {
  systemPrompt: string;
  skillContexts: SkillContext[];
  ejsonData?: Record<string, any>;
  metadata: PromptMetadata;
}

export interface SkillContext {
  name: string;
  systemPrompt: string;
  weight: number;
  workflows?: string[];
  subCapabilities?: string[];
}

export interface PromptMetadata {
  agentType: string;
  skillsIncluded: number;
  totalWeight: number;
  timestamp: number;
}

// ============================================================================
// Prompt Engineering Service
// ============================================================================

export class PromptEngineeringService {
  /**
   * Engineer system prompt with skill contexts
   */
  async engineerPrompt(config: PromptEngineeringConfig): Promise<EngineeredPrompt> {
    const {
      agentType,
      taskDescription,
      includeSkills = [],
      excludeSkills = [],
      maxSkills = 10,
      weightThreshold = 0.5,
      includeEJson = true,
    } = config;

    logger.info('Engineering prompt', {
      agentType,
      taskDescription: taskDescription.slice(0, 100),
      includeSkills,
      excludeSkills,
    });

    // Get skills for this agent type
    const availableSkills = skillsManager.getSkillsForAgentType(agentType);

    // Filter skills
    let selectedSkills = availableSkills.filter(({ skill, weight }) => {
      // Exclude explicitly excluded skills
      if (excludeSkills.includes(skill.metadata.name)) return false;
      
      // Include explicitly included skills regardless of weight
      if (includeSkills.includes(skill.metadata.name)) return true;
      
      // Filter by weight threshold
      return weight >= weightThreshold;
    });

    // Sort by weight and limit
    selectedSkills = selectedSkills
      .sort((a, b) => b.weight - a.weight)
      .slice(0, maxSkills);

    logger.info('Selected skills', {
      count: selectedSkills.length,
      skills: selectedSkills.map(({ skill }) => skill.metadata.name),
    });

    // Build skill contexts
    const skillContexts: SkillContext[] = [];
    const ejsonData: Record<string, any> = {};

    for (const { skill, weight } of selectedSkills) {
      const context = this.buildSkillContext(skill, weight, agentType);
      skillContexts.push(context);

      // Add EJSON data if skill has schema
      if (skill.ejsonSchema && includeEJson) {
        ejsonData[skill.metadata.name] = this.generateEJsonData(skill);
      }
    }

    // Build final system prompt
    const systemPrompt = this.buildSystemPrompt(
      taskDescription,
      skillContexts,
      agentType
    );

    return {
      systemPrompt,
      skillContexts,
      ejsonData: includeEJson ? ejsonData : undefined,
      metadata: {
        agentType,
        skillsIncluded: skillContexts.length,
        totalWeight: skillContexts.reduce((sum, sc) => sum + sc.weight, 0),
        timestamp: Date.now(),
      },
    };
  }

  /**
   * Build skill context for prompt injection
   */
  private buildSkillContext(
    skill: SkillConfig,
    weight: number,
    agentType: string
  ): SkillContext {
    // Adjust system prompt based on weight
    let adjustedPrompt = skill.systemPrompt;

    // Add weight-based confidence indicators
    if (weight > 1.5) {
      adjustedPrompt = `[HIGHLY RECOMMENDED - Success Rate: ${(weight * 50).toFixed(0)}%]\n${adjustedPrompt}`;
    } else if (weight < 0.7) {
      adjustedPrompt = `[USE WITH CAUTION - Recent issues detected]\n${adjustedPrompt}`;
    }

    // Add agent-type specific guidance
    const agentProfile = this.getAgentProfile(agentType);
    if (agentProfile) {
      const strengths = agentProfile.strengths.join(', ');
      adjustedPrompt += `\n\n## Agent Strengths to Leverage\n${strengths}`;
    }

    return {
      name: skill.metadata.name,
      systemPrompt: adjustedPrompt,
      weight,
      workflows: skill.workflows.map(w => w.name),
      subCapabilities: skill.subCapabilities,
    };
  }

  /**
   * Generate EJSON data from skill schema
   */
  private generateEJsonData(skill: SkillConfig): Record<string, any> {
    if (!skill.ejsonSchema) return {};

    // Generate structured data based on schema
    const ejsonData: Record<string, any> = {
      skill: skill.metadata.name,
      version: skill.metadata.version,
      capabilities: skill.subCapabilities,
      workflows: skill.workflows.map(w => ({
        name: w.name,
        trigger: w.trigger,
        steps: w.steps.length,
      })),
      reinforcement: {
        successRate: skill.reinforcement.avgSuccessRate,
        trend: skill.reinforcement.weights.trend,
        totalExecutions: skill.reinforcement.totalExecutions,
      },
    };

    return ejsonData;
  }

  /**
   * Build final system prompt with skill contexts
   */
  private buildSystemPrompt(
    taskDescription: string,
    skillContexts: SkillContext[],
    agentType: string
  ): string {
    const sections: string[] = [];

    // Base instruction
    sections.push(`# Task
${taskDescription}

You are an AI agent of type: ${agentType.toUpperCase()}

`);

    // Add skill contexts
    if (skillContexts.length > 0) {
      sections.push(`# Available Skills

You have access to the following specialized skills. Pay attention to the weight indicators and success rates when deciding which skills to use.

`);

      for (const context of skillContexts) {
        sections.push(`## Skill: ${context.name}
${context.systemPrompt}

**Workflows**: ${context.workflows?.join(', ') || 'None'}
**Sub-Capabilities**: ${context.subCapabilities?.join(', ') || 'None'}
**Weight**: ${context.weight.toFixed(2)}

`);
      }
    }

    // Add agent-type specific instructions
    const agentProfile = this.getAgentProfile(agentType);
    if (agentProfile) {
      sections.push(`# Agent Type: ${agentType.toUpperCase()}

## Strengths
${agentProfile.strengths.map(s => `- ${s}`).join('\n')}

## Weaknesses to Compensate For
${agentProfile.weaknesses.map(w => `- ${w}`).join('\n')}

## Preferred Skills
${agentProfile.preferredSkills.map(s => `- ${s}`).join('\n')}

`);
    }

    // Add execution guidance
    sections.push(`# Execution Guidelines

1. **Skill Selection**: Choose skills based on their weight indicators and relevance to the task.
2. **Workflow Adherence**: Follow workflow steps precisely when using skills.
3. **Error Handling**: If a skill fails, check recent feedback for known issues.
4. **Reinforcement**: Your execution results will be recorded to improve future skill recommendations.
5. **Agent Type Awareness**: Leverage your agent type's strengths and compensate for weaknesses.

`);

    return sections.join('\n');
  }

  /**
   * Get agent type profile
   */
  private getAgentProfile(agentType: string): AgentTypeProfile | null {
    const profiles: Record<string, AgentTypeProfile> = {
      cli: {
        type: 'cli',
        strengths: ['Local execution', 'Filesystem access', 'Fast response'],
        weaknesses: ['Limited resources', 'No persistence'],
        preferredSkills: ['terminal-operations', 'file-manipulation', 'local-testing'],
        weightModifier: 1.0,
      },
      cloud: {
        type: 'cloud',
        strengths: ['Scalability', 'Persistence', 'API access'],
        weaknesses: ['Latency', 'Cost'],
        preferredSkills: ['api-integration', 'cloud-deployment', 'database-operations'],
        weightModifier: 1.2,
      },
      nullclaw: {
        type: 'nullclaw',
        strengths: ['MCP integration', 'Tool calling', 'Structured output'],
        weaknesses: ['Complexity', 'Setup requirements'],
        preferredSkills: ['mcp-operations', 'tool-orchestration', 'multi-step-workflows'],
        weightModifier: 1.1,
      },
      terminaluse: {
        type: 'terminaluse',
        strengths: ['Agent deployment', 'Task management', 'Filesystem isolation'],
        weaknesses: ['Platform dependency'],
        preferredSkills: ['agent-creation', 'deployment-workflows', 'task-orchestration'],
        weightModifier: 1.15,
      },
    };

    return profiles[agentType] || null;
  }

  /**
   * Record feedback for reinforcement learning
   */
  async recordFeedback(
    skillName: string,
    agentType: string,
    workflowName: string,
    success: boolean,
    executionTime?: number,
    notes?: string,
    correction?: string
  ): Promise<void> {
    await skillsManager.recordExecution(
      skillName,
      agentType,
      workflowName,
      success,
      executionTime,
      notes,
      correction
    );
  }

  /**
   * Get skill recommendations for a task
   */
  async getSkillRecommendations(
    taskDescription: string,
    agentType: string,
    limit: number = 5
  ): Promise<Array<{ skill: string; weight: number; reason: string }>> {
    const skills = skillsManager.getSkillsForAgentType(agentType);
    
    return skills
      .slice(0, limit)
      .map(({ skill, weight }) => ({
        skill: skill.metadata.name,
        weight,
        reason: this.generateRecommendationReason(skill, taskDescription, agentType),
      }));
  }

  /**
   * Generate recommendation reason
   */
  private generateRecommendationReason(
    skill: SkillConfig,
    taskDescription: string,
    agentType: string
  ): string {
    const reasons: string[] = [];

    // Based on success rate
    if (skill.reinforcement.avgSuccessRate > 0.8) {
      reasons.push(`High success rate (${(skill.reinforcement.avgSuccessRate * 100).toFixed(0)}%)`);
    }

    // Based on trend
    if (skill.reinforcement.weights.trend === 'improving') {
      reasons.push('Improving performance');
    }

    // Based on agent type match
    const profile = this.getAgentProfile(agentType);
    if (profile?.preferredSkills.includes(skill.metadata.name)) {
      reasons.push(`Preferred for ${agentType} agents`);
    }

    // Based on task match
    const taskLower = taskDescription.toLowerCase();
    for (const workflow of skill.workflows) {
      if (taskLower.includes(workflow.trigger.toLowerCase())) {
        reasons.push(`Matches workflow: ${workflow.name}`);
        break;
      }
    }

    return reasons.join('; ') || 'General purpose skill';
  }
}

// Singleton instance
export const promptEngineeringService = new PromptEngineeringService();
