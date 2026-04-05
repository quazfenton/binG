/**
 * Skills Registry
 *
 * Central registry for all skills - both global (project-wide) and user-specific.
 * Skills can be:
 * - Global: Located in .agents/skills/global/ folder (project-wide, versioned)
 * - User-specific: Located in .agents/skills/user/ folder (per-user customization)
 *
 * Integration:
 * - Skills are exposed as capabilities via capabilities.ts
 * - Skills can be registered as tools via registry.ts
 * - Agent system uses skill weights for selection
 */

import { createLogger } from '@/lib/utils/logger';
import { readFile, writeFile, mkdir, readdir } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import type { SkillConfig } from './skills-manager';

const logger = createLogger('Skills:Registry');

export interface SkillLocation {
  type: 'global' | 'user';
  path: string;
}

export interface RegisteredSkill {
  config: SkillConfig;
  location: SkillLocation;
  enabled: boolean;
}

export class SkillsRegistry {
  private static instance: SkillsRegistry;
  
  // Both global and user skills are within .agents/skills/ folder
  private globalSkillsDirectory: string = '.agents/skills/global';
  private userSkillsDirectory: string = '.agents/skills/user';
  
  private registeredSkills = new Map<string, RegisteredSkill>();
  private skillsByTag = new Map<string, string[]>();
  private skillsByCapability = new Map<string, string[]>();
  
  private constructor() {}
  
  static getInstance(): SkillsRegistry {
    if (!SkillsRegistry.instance) {
      SkillsRegistry.instance = new SkillsRegistry();
    }
    return SkillsRegistry.instance;
  }
  
  /**
   * Initialize registry - load all skills from global and user directories
   */
  async initialize(): Promise<void> {
    logger.info('Initializing skills registry...');
    
    // Load global skills first
    await this.loadSkillsFromDirectory(this.globalSkillsDirectory, 'global');
    
    // Load user-specific skills (can override global skills)
    await this.loadSkillsFromDirectory(this.userSkillsDirectory, 'user');
    
    logger.info('Skills registry initialized', { 
      count: this.registeredSkills.size,
      tags: this.skillsByTag.size,
      capabilities: this.skillsByCapability.size,
    });
  }
  
  /**
   * Load skills from a directory
   */
  private async loadSkillsFromDirectory(dirPath: string, type: 'global' | 'user'): Promise<void> {
    if (!existsSync(dirPath)) {
      logger.debug(`Skills directory not found: ${dirPath}`);
      return;
    }
    
    try {
      const skillDirs = await readdir(dirPath);
      
      for (const skillDir of skillDirs) {
        const skillPath = join(dirPath, skillDir);
        const stat = await this.statSafe(skillPath);
        
        if (stat?.isDirectory()) {
          await this.loadSkillFromPath(skillPath, type);
        }
      }
    } catch (error: any) {
      logger.error(`Failed to load skills from ${dirPath}`, { error: error.message });
    }
  }
  
  /**
   * Load a skill from a path
   */
  private async loadSkillFromPath(skillPath: string, type: 'global' | 'user'): Promise<void> {
    const skillMdPath = join(skillPath, 'SKILL.md');
    
    if (!existsSync(skillMdPath)) {
      logger.debug(`SKILL.md not found: ${skillMdPath}`);
      return;
    }
    
    try {
      const { skillsManager } = await import('./skills-manager');
      
      // Extract skill name from directory
      const skillName = skillPath.split('/').pop() || skillPath.split('\\').pop() || '';
      
      // Use skillsManager to parse the skill
      const skill = await skillsManager.loadSkill(skillName);
      
      if (!skill) {
        logger.warn(`Failed to load skill: ${skillName}`);
        return;
      }
      
      // Register the skill
      this.registerSkill({
        config: skill,
        location: {
          type,
          path: skillPath,
        },
        enabled: true,
      });
      
      logger.info(`Loaded skill: ${skill.metadata.name} (${type})`);
    } catch (error: any) {
      logger.error(`Failed to load skill from ${skillPath}`, { error: error.message });
    }
  }
  
  /**
   * Register a skill
   */
  registerSkill(skill: RegisteredSkill): void {
    const { name } = skill.config.metadata;
    
    // User skills override global skills
    const existing = this.registeredSkills.get(name);
    if (existing && existing.location.type === 'user' && skill.location.type === 'global') {
      logger.debug(`Skipping global skill ${name} - user version exists`);
      return;
    }
    
    this.registeredSkills.set(name, skill);
    
    // Index by tags
    for (const tag of skill.config.metadata.tags) {
      const skills = this.skillsByTag.get(tag) || [];
      if (!skills.includes(name)) {
        skills.push(name);
        this.skillsByTag.set(tag, skills);
      }
    }
    
    // Index by capabilities
    for (const capability of skill.config.subCapabilities) {
      const skills = this.skillsByCapability.get(capability) || [];
      if (!skills.includes(name)) {
        skills.push(name);
        this.skillsByCapability.set(capability, skills);
      }
    }
  }
  
  /**
   * Unregister a skill
   */
  unregisterSkill(skillName: string): void {
    const skill = this.registeredSkills.get(skillName);
    if (!skill) return;
    
    // Remove from tag index
    for (const tag of skill.config.metadata.tags) {
      const skills = this.skillsByTag.get(tag);
      if (skills) {
        const index = skills.indexOf(skillName);
        if (index > -1) skills.splice(index, 1);
        if (skills.length === 0) {
          this.skillsByTag.delete(tag);
        } else {
          this.skillsByTag.set(tag, skills);
        }
      }
    }
    
    // Remove from capability index
    for (const capability of skill.config.subCapabilities) {
      const skills = this.skillsByCapability.get(capability);
      if (skills) {
        const index = skills.indexOf(skillName);
        if (index > -1) skills.splice(index, 1);
        if (skills.length === 0) {
          this.skillsByCapability.delete(capability);
        } else {
          this.skillsByCapability.set(capability, skills);
        }
      }
    }
    
    this.registeredSkills.delete(skillName);
    logger.info(`Unregistered skill: ${skillName}`);
  }
  
  /**
   * Get a skill by name
   */
  getSkill(skillName: string): RegisteredSkill | undefined {
    return this.registeredSkills.get(skillName);
  }
  
  /**
   * Get skills by tag
   */
  getSkillsByTag(tag: string): RegisteredSkill[] {
    const skillNames = this.skillsByTag.get(tag) || [];
    return skillNames
      .map(name => this.registeredSkills.get(name))
      .filter((s): s is RegisteredSkill => s !== undefined);
  }
  
  /**
   * Get skills by capability
   */
  getSkillsByCapability(capability: string): RegisteredSkill[] {
    const skillNames = this.skillsByCapability.get(capability) || [];
    return skillNames
      .map(name => this.registeredSkills.get(name))
      .filter((s): s is RegisteredSkill => s !== undefined);
  }
  
  /**
   * Get all registered skills
   */
  getAllSkills(): RegisteredSkill[] {
    return Array.from(this.registeredSkills.values());
  }
  
  /**
   * Get skills filtered by agent type
   */
  getSkillsForAgentType(agentType: string): Array<{ skill: RegisteredSkill; weight: number }> {
    // Import dynamically to avoid circular dependency
    const AGENT_TYPE_PROFILES: Record<string, any> = {
      cli: { preferredSkills: [] as string[], weightModifier: 1.0 },
      cloud: { preferredSkills: [] as string[], weightModifier: 1.2 },
      nullclaw: { preferredSkills: [] as string[], weightModifier: 1.1 },
      terminaluse: { preferredSkills: [] as string[], weightModifier: 1.15 },
    };
    
    const profile = AGENT_TYPE_PROFILES[agentType];
    const skills: Array<{ skill: RegisteredSkill; weight: number }> = [];

    for (const [name, skill] of this.registeredSkills.entries()) {
      if (!skill.enabled) continue;

      const baseWeight = skill.config.reinforcement.weights.byAgentType[agentType] || 1.0;
      const preferenceBonus = profile?.preferredSkills.includes(name) ? 0.2 : 0;
      const weight = baseWeight + preferenceBonus;

      skills.push({ skill, weight });
    }

    return skills.sort((a, b) => b.weight - a.weight);
  }
  
  /**
   * Enable/disable a skill
   */
  setSkillEnabled(skillName: string, enabled: boolean): void {
    const skill = this.registeredSkills.get(skillName);
    if (!skill) return;
    
    skill.enabled = enabled;
    logger.info(`Skill ${skillName} ${enabled ? 'enabled' : 'disabled'}`);
  }
  
  /**
   * Add a new skill programmatically
   */
  async addSkill(config: {
    name: string;
    description: string;
    systemPrompt: string;
    workflows?: any[];
    subCapabilities?: string[];
    tags?: string[];
    location?: 'global' | 'user';
  }): Promise<boolean> {
    const { skillsManager } = await import('./skills-manager');
    
    const location = config.location || 'user';
    const skillsDir = location === 'global' ? this.globalSkillsDirectory : this.userSkillsDirectory;
    const skillPath = join(skillsDir, config.name);
    
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

${workflow.steps.map((step: any, i: number) => `${i + 1}. \`${step.action}\``).join('\n')}
`;
          await writeFile(
            join(workflowsPath, `${workflow.name.toLowerCase().replace(/\s+/g, '-')}.md`),
            workflowMd
          );
        }
      }
      
      // Create reinforcement.json
      const defaultReinforcement = {
        totalExecutions: 0,
        successfulExecutions: 0,
        failedExecutions: 0,
        avgSuccessRate: 0,
        weights: {
          overall: 1.0,
          byAgentType: {},
          byWorkflow: {},
          trend: 'stable' as const,
        },
        recentFeedback: [],
        lastUpdated: Date.now(),
      };
      
      await writeFile(
        join(skillPath, 'reinforcement.json'),
        JSON.stringify(defaultReinforcement, null, 2)
      );
      
      // Load and register the skill
      await this.loadSkillFromPath(skillPath, location);
      
      logger.info(`Added new skill: ${config.name} (${location})`);
      return true;
    } catch (error: any) {
      logger.error(`Failed to add skill: ${config.name}`, { error: error.message });
      return false;
    }
  }
  
  /**
   * Get registry statistics
   */
  getStats(): {
    totalSkills: number;
    enabledSkills: number;
    globalSkills: number;
    userSkills: number;
    tags: number;
    capabilities: number;
  } {
    const skills = Array.from(this.registeredSkills.values());
    
    return {
      totalSkills: skills.length,
      enabledSkills: skills.filter(s => s.enabled).length,
      globalSkills: skills.filter(s => s.location.type === 'global').length,
      userSkills: skills.filter(s => s.location.type === 'user').length,
      tags: this.skillsByTag.size,
      capabilities: this.skillsByCapability.size,
    };
  }
  
  /**
   * Safe stat wrapper
   */
  private async statSafe(path: string): Promise<{ isDirectory: () => boolean } | null> {
    try {
      const { stat } = await import('fs/promises');
      const statResult = await stat(path);
      return {
        isDirectory: () => statResult.isDirectory(),
      };
    } catch {
      return null;
    }
  }
}

// Singleton instance
export const skillsRegistry = SkillsRegistry.getInstance();
