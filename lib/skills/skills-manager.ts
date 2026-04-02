/**
 * Skills System - System Prompt Engineering & Reinforcement Learning
 *
 * Features:
 * - Skill.md parsing and context injection
 * - EJSON object passing for structured skill data
 * - Sub-capabilities tracking per skill
 * - Reinforcement learning from successful/failed executions
 * - Agent-type specific skill weights (CLI, cloud, Nullclaw, etc.)
 * - Success/failure tracking and weight adjustments
 * - Skill versioning and updates
 * - Skill discovery and loading from .agents/skills/
 */

import { z } from 'zod';
import { createLogger } from '@/lib/utils/logger';
import { readFile, writeFile, mkdir, readdir } from 'fs/promises';
import { join, dirname } from 'path';
import { existsSync } from 'fs';

const logger = createLogger('Skills:System');

// ============================================================================
// Types & Schemas
// ============================================================================

export interface SkillMetadata {
  name: string;
  description: string;
  version: string;
  author?: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

export interface SkillWorkflow {
  name: string;
  description: string;
  trigger: string;
  steps: SkillStep[];
  successRate?: number;
  avgExecutionTime?: number;
}

export interface SkillStep {
  id: string;
  action: string;
  command?: string;
  expected?: string;
  onError?: 'retry' | 'abort' | 'fallback';
  maxRetries?: number;
}

export interface SkillReinforcement {
  totalExecutions: number;
  successfulExecutions: number;
  failedExecutions: number;
  avgSuccessRate: number;
  weights: SkillWeights;
  recentFeedback: SkillFeedback[];
  lastUpdated: number;
}

export interface SkillWeights {
  overall: number;
  byAgentType: Record<string, number>;
  byWorkflow: Record<string, number>;
  trend: 'improving' | 'stable' | 'declining';
}

export interface SkillFeedback {
  timestamp: number;
  agentType: string;
  workflowName?: string;
  success: boolean;
  executionTime?: number;
  notes?: string;
  correction?: string;
}

export interface SkillConfig {
  metadata: SkillMetadata;
  systemPrompt: string;
  workflows: SkillWorkflow[];
  subCapabilities: string[];
  ejsonSchema?: Record<string, any>;
  reinforcement: SkillReinforcement;
}

export interface AgentTypeProfile {
  type: 'cli' | 'cloud' | 'nullclaw' | 'terminaluse' | 'custom';
  strengths: string[];
  weaknesses: string[];
  preferredSkills: string[];
  weightModifier: number;
}

export const SkillConfigSchema = z.object({
  metadata: z.object({
    name: z.string(),
    description: z.string(),
    version: z.string(),
    author: z.string().optional(),
    tags: z.array(z.string()),
    createdAt: z.number(),
    updatedAt: z.number(),
  }),
  systemPrompt: z.string(),
  workflows: z.array(z.object({
    name: z.string(),
    description: z.string(),
    trigger: z.string(),
    steps: z.array(z.object({
      id: z.string(),
      action: z.string(),
      command: z.string().optional(),
      expected: z.string().optional(),
      onError: z.enum(['retry', 'abort', 'fallback']).optional(),
      maxRetries: z.number().optional(),
    })),
    successRate: z.number().optional(),
    avgExecutionTime: z.number().optional(),
  })),
  subCapabilities: z.array(z.string()),
  ejsonSchema: z.record(z.any()).optional(),
  reinforcement: z.object({
    totalExecutions: z.number(),
    successfulExecutions: z.number(),
    failedExecutions: z.number(),
    avgSuccessRate: z.number(),
    weights: z.object({
      overall: z.number(),
      byAgentType: z.record(z.number()),
      byWorkflow: z.record(z.number()),
      trend: z.enum(['improving', 'stable', 'declining']),
    }),
    recentFeedback: z.array(z.object({
      timestamp: z.number(),
      agentType: z.string(),
      workflowName: z.string().optional(),
      success: z.boolean(),
      executionTime: z.number().optional(),
      notes: z.string().optional(),
      correction: z.string().optional(),
    })),
    lastUpdated: z.number(),
  }),
});

// ============================================================================
// Agent Type Profiles
// ============================================================================

const AGENT_TYPE_PROFILES: Record<string, AgentTypeProfile> = {
  cli: {
    type: 'cli',
    strengths: ['local-execution', 'filesystem-access', 'fast-response'],
    weaknesses: ['limited-resources', 'no-persistence'],
    preferredSkills: ['terminal-operations', 'file-manipulation', 'local-testing'],
    weightModifier: 1.0,
  },
  cloud: {
    type: 'cloud',
    strengths: ['scalability', 'persistence', 'api-access'],
    weaknesses: ['latency', 'cost'],
    preferredSkills: ['api-integration', 'cloud-deployment', 'database-operations'],
    weightModifier: 1.2,
  },
  nullclaw: {
    type: 'nullclaw',
    strengths: ['mcp-integration', 'tool-calling', 'structured-output'],
    weaknesses: ['complexity', 'setup-requirements'],
    preferredSkills: ['mcp-operations', 'tool-orchestration', 'multi-step-workflows'],
    weightModifier: 1.1,
  },
  terminaluse: {
    type: 'terminaluse',
    strengths: ['agent-deployment', 'task-management', 'filesystem-isolation'],
    weaknesses: ['platform-dependency'],
    preferredSkills: ['agent-creation', 'deployment-workflows', 'task-orchestration'],
    weightModifier: 1.15,
  },
};

// ============================================================================
// Skills Manager
// ============================================================================

export class SkillsManager {
  private skillsDirectory: string;
  private loadedSkills: Map<string, SkillConfig> = new Map();
  private agentTypeWeights: Map<string, Map<string, number>> = new Map();
  private reinforcementEnabled: boolean = true;

  constructor(skillsDirectory: string = '.agents/skills') {
    this.skillsDirectory = skillsDirectory;
  }

  /**
   * Load all skills from directory
   */
  async loadAllSkills(): Promise<void> {
    if (!existsSync(this.skillsDirectory)) {
      logger.warn('Skills directory not found', { path: this.skillsDirectory });
      return;
    }

    const skillDirs = await readdir(this.skillsDirectory);
    
    for (const skillDir of skillDirs) {
      const skillPath = join(this.skillsDirectory, skillDir);
      const stat = await this.statSafe(skillPath);
      
      if (stat?.isDirectory()) {
        try {
          const skill = await this.loadSkill(skillDir);
          if (skill) {
            this.loadedSkills.set(skill.metadata.name, skill);
            logger.info('Loaded skill', { name: skill.metadata.name });
          }
        } catch (error: any) {
          logger.error('Failed to load skill', { skill: skillDir, error: error.message });
        }
      }
    }

    logger.info('Skills loading complete', { count: this.loadedSkills.size });
  }

  /**
   * Load a specific skill
   */
  async loadSkill(skillName: string): Promise<SkillConfig | null> {
    const skillPath = join(this.skillsDirectory, skillName);
    const skillMdPath = join(skillPath, 'SKILL.md');
    
    if (!existsSync(skillMdPath)) {
      logger.warn('SKILL.md not found', { skill: skillName });
      return null;
    }

    try {
      // Parse SKILL.md
      const skillMdContent = await readFile(skillMdPath, 'utf-8');
      const parsed = this.parseSkillMd(skillMdContent, skillName);

      // Load workflows
      const workflowsPath = join(skillPath, 'workflows');
      const workflows = await this.loadWorkflows(workflowsPath);

      // Load or create reinforcement data
      const reinforcementPath = join(skillPath, 'reinforcement.json');
      const reinforcement = existsSync(reinforcementPath)
        ? JSON.parse(await readFile(reinforcementPath, 'utf-8'))
        : this.createDefaultReinforcement();

      const skill: SkillConfig = {
        metadata: parsed.metadata,
        systemPrompt: parsed.systemPrompt,
        workflows,
        subCapabilities: parsed.subCapabilities,
        ejsonSchema: parsed.ejsonSchema,
        reinforcement,
      };

      // Validate schema
      SkillConfigSchema.parse(skill);

      return skill;
    } catch (error: any) {
      logger.error('Failed to parse skill', { skill: skillName, error: error.message });
      return null;
    }
  }

  /**
   * Parse SKILL.md file
   */
  private parseSkillMd(content: string, skillName: string): {
    metadata: SkillMetadata;
    systemPrompt: string;
    subCapabilities: string[];
    ejsonSchema?: Record<string, any>;
  } {
    // Parse frontmatter
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    const metadata: SkillMetadata = {
      name: skillName,
      description: '',
      version: '1.0.0',
      tags: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    if (frontmatterMatch) {
      const frontmatter = frontmatterMatch[1];
      const descMatch = frontmatter.match(/description:\s*(.+)/);
      if (descMatch) metadata.description = descMatch[1].trim();
      
      const tagsMatch = frontmatter.match(/tags:\s*\[(.*?)\]/);
      if (tagsMatch) metadata.tags = tagsMatch[1].split(',').map(t => t.trim());
    }

    // Extract system prompt (content after frontmatter)
    const contentAfterFrontmatter = content.replace(/^---\n[\s\S]*?\n---\n/, '');
    const systemPrompt = contentAfterFrontmatter.trim();

    // Extract sub-capabilities from headings
    const subCapabilities = contentAfterFrontmatter
      .match(/^##\s+(.+)$/gm)
      ?.map(h => h.replace('## ', '').trim()) || [];

    return {
      metadata,
      systemPrompt,
      subCapabilities,
    };
  }

  /**
   * Load workflows from workflows directory
   */
  private async loadWorkflows(workflowsPath: string): Promise<SkillWorkflow[]> {
    if (!existsSync(workflowsPath)) {
      return [];
    }

    const workflowFiles = await readdir(workflowsPath);
    const workflows: SkillWorkflow[] = [];

    for (const file of workflowFiles) {
      if (file.endsWith('.md')) {
        try {
          const content = await readFile(join(workflowsPath, file), 'utf-8');
          const workflow = this.parseWorkflowMd(content, file.replace('.md', ''));
          workflows.push(workflow);
        } catch (error: any) {
          logger.warn('Failed to parse workflow', { file, error: error.message });
        }
      }
    }

    return workflows;
  }

  /**
   * Parse workflow markdown file
   */
  private parseWorkflowMd(content: string, workflowName: string): SkillWorkflow {
    const workflow: SkillWorkflow = {
      name: workflowName,
      description: '',
      trigger: '',
      steps: [],
    };

    // Extract description
    const descMatch = content.match(/\*\*Trigger\*\*:\s*(.+)/i);
    if (descMatch) {
      workflow.description = descMatch[1].trim();
      workflow.trigger = descMatch[1].trim();
    }

    // Extract steps from numbered lists or code blocks
    const stepMatches = content.matchAll(/```bash\n([\s\S]*?)```/g);
    for (const match of stepMatches) {
      const commands = match[1].trim().split('\n');
      for (const cmd of commands) {
        if (cmd.trim() && !cmd.startsWith('#')) {
          workflow.steps.push({
            id: `step-${workflow.steps.length + 1}`,
            action: cmd.trim(),
            command: cmd.trim(),
          });
        }
      }
    }

    return workflow;
  }

  /**
   * Create default reinforcement data
   */
  private createDefaultReinforcement(): SkillReinforcement {
    return {
      totalExecutions: 0,
      successfulExecutions: 0,
      failedExecutions: 0,
      avgSuccessRate: 0,
      weights: {
        overall: 1.0,
        byAgentType: {},
        byWorkflow: {},
        trend: 'stable',
      },
      recentFeedback: [],
      lastUpdated: Date.now(),
    };
  }

  /**
   * Record skill execution for reinforcement learning
   */
  async recordExecution(
    skillName: string,
    agentType: string,
    workflowName: string,
    success: boolean,
    executionTime?: number,
    notes?: string,
    correction?: string
  ): Promise<void> {
    if (!this.reinforcementEnabled) return;

    const skill = this.loadedSkills.get(skillName);
    if (!skill) {
      logger.warn('Skill not found for reinforcement', { skill: skillName });
      return;
    }

    // Update reinforcement data
    skill.reinforcement.totalExecutions++;
    if (success) {
      skill.reinforcement.successfulExecutions++;
    } else {
      skill.reinforcement.failedExecutions++;
    }

    skill.reinforcement.avgSuccessRate = 
      skill.reinforcement.successfulExecutions / skill.reinforcement.totalExecutions;

    // Add feedback
    skill.reinforcement.recentFeedback.push({
      timestamp: Date.now(),
      agentType,
      workflowName,
      success,
      executionTime,
      notes,
      correction,
    });

    // Keep only last 100 feedback entries
    if (skill.reinforcement.recentFeedback.length > 100) {
      skill.reinforcement.recentFeedback = skill.reinforcement.recentFeedback.slice(-100);
    }

    // Update weights
    this.updateWeights(skill, agentType, workflowName, success);

    // Save reinforcement data
    await this.saveReinforcement(skillName, skill.reinforcement);

    logger.info('Recorded skill execution', {
      skill: skillName,
      agentType,
      workflowName,
      success,
    });
  }

  /**
   * Update skill weights based on execution
   */
  private updateWeights(
    skill: SkillConfig,
    agentType: string,
    workflowName: string,
    success: boolean
  ): void {
    const agentProfile = AGENT_TYPE_PROFILES[agentType];
    const modifier = agentProfile?.weightModifier || 1.0;

    // Initialize agent type weight if not exists
    if (!skill.reinforcement.weights.byAgentType[agentType]) {
      skill.reinforcement.weights.byAgentType[agentType] = 1.0;
    }

    // Initialize workflow weight if not exists
    if (!skill.reinforcement.weights.byWorkflow[workflowName]) {
      skill.reinforcement.weights.byWorkflow[workflowName] = 1.0;
    }

    // Adjust weights based on success/failure
    const adjustment = success ? 0.05 : -0.1;
    
    skill.reinforcement.weights.byAgentType[agentType] += adjustment * modifier;
    skill.reinforcement.weights.byWorkflow[workflowName] += adjustment;
    skill.reinforcement.weights.overall += adjustment * 0.5;

    // Clamp weights between 0.1 and 2.0
    skill.reinforcement.weights.byAgentType[agentType] = 
      Math.max(0.1, Math.min(2.0, skill.reinforcement.weights.byAgentType[agentType]));
    skill.reinforcement.weights.byWorkflow[workflowName] = 
      Math.max(0.1, Math.min(2.0, skill.reinforcement.weights.byWorkflow[workflowName]));
    skill.reinforcement.weights.overall = 
      Math.max(0.1, Math.min(2.0, skill.reinforcement.weights.overall));

    // Determine trend
    const recentFeedback = skill.reinforcement.recentFeedback.slice(-10);
    const recentSuccessRate = recentFeedback.filter(f => f.success).length / recentFeedback.length;
    
    if (recentSuccessRate > 0.7) {
      skill.reinforcement.weights.trend = 'improving';
    } else if (recentSuccessRate < 0.3) {
      skill.reinforcement.weights.trend = 'declining';
    } else {
      skill.reinforcement.weights.trend = 'stable';
    }

    skill.reinforcement.lastUpdated = Date.now();
  }

  /**
   * Save reinforcement data to file
   */
  private async saveReinforcement(skillName: string, reinforcement: SkillReinforcement): Promise<void> {
    const skillPath = join(this.skillsDirectory, skillName);
    const reinforcementPath = join(skillPath, 'reinforcement.json');

    try {
      await writeFile(reinforcementPath, JSON.stringify(reinforcement, null, 2));
    } catch (error: any) {
      logger.error('Failed to save reinforcement data', { skill: skillName, error: error.message });
    }
  }

  /**
   * Get skill with context for system prompt injection
   */
  getSkillContext(
    skillName: string,
    agentType: string,
    workflowName?: string
  ): { systemPrompt: string; weight: number } | null {
    const skill = this.loadedSkills.get(skillName);
    if (!skill) return null;

    // Calculate effective weight for this agent type
    const baseWeight = skill.reinforcement.weights.byAgentType[agentType] || 1.0;
    const workflowWeight = workflowName 
      ? skill.reinforcement.weights.byWorkflow[workflowName] || 1.0
      : 1.0;
    
    const effectiveWeight = baseWeight * workflowWeight * skill.reinforcement.weights.overall;

    return {
      systemPrompt: skill.systemPrompt,
      weight: effectiveWeight,
    };
  }

  /**
   * Get all loaded skills
   */
  getAllSkills(): SkillConfig[] {
    return Array.from(this.loadedSkills.values());
  }

  /**
   * Get skills filtered by agent type
   */
  getSkillsForAgentType(agentType: string): Array<{ skill: SkillConfig; weight: number }> {
    const skills: Array<{ skill: SkillConfig; weight: number }> = [];
    const profile = AGENT_TYPE_PROFILES[agentType];

    for (const [name, skill] of this.loadedSkills.entries()) {
      const baseWeight = skill.reinforcement.weights.byAgentType[agentType] || 1.0;
      const preferenceBonus = profile?.preferredSkills.includes(name) ? 0.2 : 0;
      const weight = baseWeight + preferenceBonus;

      skills.push({ skill, weight });
    }

    // Sort by weight descending
    return skills.sort((a, b) => b.weight - a.weight);
  }

  /**
   * Add new skill via CLI command
   */
  async addSkill(config: {
    name: string;
    description: string;
    systemPrompt: string;
    workflows?: SkillWorkflow[];
    subCapabilities?: string[];
    tags?: string[];
  }): Promise<boolean> {
    const skillPath = join(this.skillsDirectory, config.name);
    
    try {
      // Create directory
      await mkdir(skillPath, { recursive: true });

      // Create SKILL.md
      const skillMd = `---
name: ${config.name}
description: ${config.description}
tags: [${config.tags?.join(', ') || ''}]
---

${config.systemPrompt}
`;

      await writeFile(join(skillPath, 'SKILL.md'), skillMd);

      // Create workflows directory and files
      if (config.workflows?.length) {
        const workflowsPath = join(skillPath, 'workflows');
        await mkdir(workflowsPath, { recursive: true });

        for (const workflow of config.workflows) {
          const workflowMd = `# ${workflow.name}

**Trigger**: ${workflow.trigger}

${workflow.description}

## Steps

${workflow.steps.map((step, i) => `${i + 1}. \`${step.action}\``).join('\n')}
`;
          await writeFile(
            join(workflowsPath, `${workflow.name.toLowerCase().replace(/\s+/g, '-')}.md`),
            workflowMd
          );
        }
      }

      // Create reinforcement.json
      await writeFile(
        join(skillPath, 'reinforcement.json'),
        JSON.stringify(this.createDefaultReinforcement(), null, 2)
      );

      // Reload skills
      await this.loadSkill(config.name);

      logger.info('Added new skill', { name: config.name });
      return true;
    } catch (error: any) {
      logger.error('Failed to add skill', { name: config.name, error: error.message });
      return false;
    }
  }

  /**
   * Safe stat wrapper
   */
  private async statSafe(path: string): Promise<{ isDirectory: () => boolean } | null> {
    try {
      const stat = await this.stat(path);
      return stat;
    } catch {
      return null;
    }
  }

  private async stat(path: string): Promise<{ isDirectory: () => boolean }> {
    const { stat: fsStat } = await import('fs/promises');
    const stat = await fsStat(path);
    return {
      isDirectory: () => stat.isDirectory(),
    };
  }
}

// Singleton instance
export const skillsManager = new SkillsManager();
