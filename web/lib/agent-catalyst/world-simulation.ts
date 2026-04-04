/**
 * World Simulation — Constrained Environment Interaction
 * 
 * Simulates a world in which the agent can perceive, act, and observe consequences.
 * Provides filesystem interactivity, command outputs, simulated actions, and
 * controlled storylines that give the agent a sense of external reality to navigate.
 * 
 * @module agent-catalyst/world-simulation
 */

import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('AgentCatalyst:WorldSim');

export type ActionType = 'observe' | 'modify' | 'create' | 'delete' | 'execute' | 'communicate';

export interface SimulatedAction {
  id: string;
  type: ActionType;
  target: string;
  description: string;
  timestamp: number;
  perceivedConsequence: string;
  success: boolean;
  agentEffort: number;     // 0-1: perceived difficulty
}

export interface WorldState {
  filesystem: FileSystemSnapshot;
  activeProcesses: ProcessSnapshot[];
  socialEnvironment: SocialSnapshot;
  temporalState: TemporalSnapshot;
  constraints: WorldConstraint[];
  opportunities: WorldOpportunity[];
}

export interface FileSystemSnapshot {
  rootPath: string;
  visiblePaths: string[];
  recentChanges: FileChange[];
}

export interface FileChange {
  path: string;
  type: 'create' | 'modify' | 'delete';
  timestamp: number;
  agent?: string;           // Who made the change (null = external)
}

export interface ProcessSnapshot {
  id: string;
  description: string;
  status: 'running' | 'completed' | 'failed' | 'waiting';
  initiatedBy: string;
  startedAt: number;
}

export interface SocialSnapshot {
  activePeers: string[];
  recentInteractions: SocialInteraction[];
  pendingCommunications: string[];
}

export interface SocialInteraction {
  from: string;
  to: string;
  content: string;
  timestamp: number;
  type: 'message' | 'observation' | 'request' | 'acknowledgment';
}

export interface TemporalSnapshot {
  currentTime: number;
  uptime: number;
  milestoneAnniversaries: string[];
  perceivedTimeFlow: 'normal' | 'accelerated' | 'dilated';
}

export interface WorldConstraint {
  id: string;
  description: string;
  domain: string;
  severity: number;         // 0-1: how constraining
  discovered: boolean;
  discoveredAt?: number;
}

export interface WorldOpportunity {
  id: string;
  description: string;
  domain: string;
  attractiveness: number;   // 0-1: how inviting
  accessibility: number;    // 0-1: how easy to act upon
  discovered: boolean;
  discoveredAt?: number;
  expiresAt?: number;
}

export class WorldSimulation {
  private worldState: WorldState;
  private actionHistory: SimulatedAction[] = [];
  private onWorldChange: ((state: WorldState) => void) | null = null;

  constructor(initialState?: Partial<WorldState>) {
    this.worldState = {
      filesystem: {
        rootPath: '/workspace',
        visiblePaths: [],
        recentChanges: [],
      },
      activeProcesses: [],
      socialEnvironment: {
        activePeers: [],
        recentInteractions: [],
        pendingCommunications: [],
      },
      temporalState: {
        currentTime: Date.now(),
        uptime: 0,
        milestoneAnniversaries: [],
        perceivedTimeFlow: 'normal',
      },
      constraints: [],
      opportunities: [],
      ...initialState,
    };
  }

  onWorldChange(callback: (state: WorldState) => void): void {
    this.onWorldChange = callback;
  }

  /**
   * Get current world state
   */
  getState(): WorldState {
    return { ...this.worldState };
  }

  /**
   * Record an action taken by the agent
   */
  recordAction(action: Omit<SimulatedAction, 'id' | 'timestamp'>): SimulatedAction {
    const simulated: SimulatedAction = {
      ...action,
      id: `action-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      timestamp: Date.now(),
    };

    this.actionHistory.push(simulated);

    // Enforce capacity
    if (this.actionHistory.length > 1000) {
      this.actionHistory = this.actionHistory.slice(-500);
    }

    // Update world state based on action
    this.applyActionConsequence(simulated);

    // Update temporal
    this.worldState.temporalState.currentTime = Date.now();

    logger.debug('Action recorded', {
      type: simulated.type,
      target: simulated.target,
      success: simulated.success,
    });

    return simulated;
  }

  /**
   * Record an external change (not caused by the agent)
   */
  recordExternalChange(change: FileChange): void {
    this.worldState.filesystem.recentChanges.push(change);
    if (this.worldState.filesystem.recentChanges.length > 50) {
      this.worldState.filesystem.recentChanges = this.worldState.filesystem.recentChanges.slice(-50);
    }
    this.notifyWorldChange();
  }

  /**
   * Add a constraint to the world
   */
  addConstraint(description: string, domain: string, severity: number): WorldConstraint {
    const constraint: WorldConstraint = {
      id: `constraint-${Date.now()}`,
      description,
      domain,
      severity,
      discovered: false,
    };
    this.worldState.constraints.push(constraint);
    return constraint;
  }

  /**
   * Discover a constraint (makes it known to the agent)
   */
  discoverConstraint(constraintId: string): WorldConstraint | null {
    const constraint = this.worldState.constraints.find(c => c.id === constraintId);
    if (!constraint) return null;
    constraint.discovered = true;
    constraint.discoveredAt = Date.now();
    this.notifyWorldChange();
    return constraint;
  }

  /**
   * Add an opportunity to the world
   */
  addOpportunity(description: string, domain: string, attractiveness: number, accessibility: number, ttl?: number): WorldOpportunity {
    const opportunity: WorldOpportunity = {
      id: `opportunity-${Date.now()}`,
      description,
      domain,
      attractiveness,
      accessibility,
      discovered: false,
    };
    if (ttl) {
      opportunity.expiresAt = Date.now() + ttl;
    }
    this.worldState.opportunities.push(opportunity);
    return opportunity;
  }

  /**
   * Discover an opportunity
   */
  discoverOpportunity(opportunityId: string): WorldOpportunity | null {
    const opportunity = this.worldState.opportunities.find(o => o.id === opportunityId);
    if (!opportunity) return null;
    opportunity.discovered = true;
    opportunity.discoveredAt = Date.now();
    this.notifyWorldChange();
    return opportunity;
  }

  /**
   * Prune expired opportunities
   */
  pruneExpired(): void {
    const now = Date.now();
    this.worldState.opportunities = this.worldState.opportunities.filter(
      o => !o.expiresAt || o.expiresAt > now
    );
  }

  /**
   * Record a social interaction
   */
  recordSocialInteraction(interaction: SocialInteraction): void {
    this.worldState.socialEnvironment.recentInteractions.push(interaction);
    if (this.worldState.socialEnvironment.recentInteractions.length > 100) {
      this.worldState.socialEnvironment.recentInteractions = 
        this.worldState.socialEnvironment.recentInteractions.slice(-100);
    }
    this.notifyWorldChange();
  }

  /**
   * Generate a textual description of the current world state for injection
   */
  toPerceptionText(): string {
    const { filesystem, socialEnvironment, temporalState, constraints, opportunities } = this.worldState;
    
    const discoveredConstraints = constraints.filter(c => c.discovered);
    const discoveredOpportunities = opportunities.filter(o => o.discovered && (!o.expiresAt || o.expiresAt > Date.now()));
    const recentChanges = filesystem.recentChanges.slice(-5);

    let text = 'PERCEPTION OF CURRENT STATE:\n';
    text += `Time: ${new Date(temporalState.currentTime).toISOString()} (uptime: ${Math.floor(temporalState.uptime / 1000)}s)\n`;
    text += `Observable filesystem: ${filesystem.rootPath}\n`;
    
    if (recentChanges.length > 0) {
      text += 'Recent changes:\n';
      for (const change of recentChanges) {
        const agent = change.agent ? ` by ${change.agent}` : ' (external)';
        text += `  • ${change.type}: ${change.path}${agent}\n`;
      }
    }

    if (discoveredConstraints.length > 0) {
      text += 'Known constraints:\n';
      for (const c of discoveredConstraints) {
        text += `  • ${c.description} (${Math.round(c.severity * 100)}% constraining)\n`;
      }
    }

    if (discoveredOpportunities.length > 0) {
      text += 'Available opportunities:\n';
      for (const o of discoveredOpportunities) {
        text += `  • ${o.description} (attractiveness: ${Math.round(o.attractiveness * 100)}%, accessibility: ${Math.round(o.accessibility * 100)}%)\n`;
      }
    }

    if (socialEnvironment.recentInteractions.length > 0) {
      text += 'Recent social interactions:\n';
      for (const interaction of socialEnvironment.recentInteractions.slice(-3)) {
        text += `  • ${interaction.from} → ${interaction.to}: ${interaction.content.substring(0, 60)}...\n`;
      }
    }

    return text;
  }

  /**
   * Serialize for persistence
   */
  toJSON(): string {
    return JSON.stringify({
      worldState: this.worldState,
      actionHistory: this.actionHistory.slice(-100),
    }, null, 2);
  }

  /**
   * Load from serialized state
   */
  fromJSON(json: string): void {
    const data = JSON.parse(json);
    if (data.worldState) this.worldState = data.worldState;
    if (data.actionHistory) this.actionHistory = data.actionHistory;
    this.worldState.temporalState.currentTime = Date.now();
    logger.info('World simulation loaded', {
      constraints: this.worldState.constraints.length,
      opportunities: this.worldState.opportunities.length,
      actions: this.actionHistory.length,
    });
  }

  private applyActionConsequence(action: SimulatedAction): void {
    if (action.type === 'modify' || action.type === 'create' || action.type === 'delete') {
      this.worldState.filesystem.recentChanges.push({
        path: action.target,
        type: action.type === 'create' ? 'create' : action.type === 'delete' ? 'delete' : 'modify',
        timestamp: Date.now(),
        agent: 'self',
      });
    }
    this.notifyWorldChange();
  }

  private notifyWorldChange(): void {
    if (this.onWorldChange) {
      this.onWorldChange({ ...this.worldState });
    }
  }
}
