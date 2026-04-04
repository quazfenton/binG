/**
 * Storyline Engine — Plot Generation and Narrative Progression
 * 
 * Crafts plots, storylines, and incremental goal progressions that give the agent
 * a sense of direction and purpose. Storylines can be explicitly validated (clear
 * goals) or implicitly inferred (emergent directionality from feedback).
 * 
 * @module agent-catalyst/storyline-engine
 */

import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('AgentCatalyst:Storyline');

export type PlotType = 'exploration' | 'mastery' | 'conflict' | 'cooperation' | 'discovery' | 'transformation';
export type PlotStatus = 'dormant' | 'active' | 'climax' | 'resolution' | 'abandoned';

export interface PlotPoint {
  id: string;
  description: string;
  order: number;
  completed: boolean;
  significance: number;      // 0-1: how important to overall plot
  completedAt?: number;
}

export interface Storyline {
  id: string;
  title: string;
  type: PlotType;
  status: PlotStatus;
  plotPoints: PlotPoint[];
  currentPointIndex: number;
  theme: string;             // Overarching narrative theme
  origin: string;            // What triggered this storyline
  createdAt: number;
  lastAdvanced: number;
  resolution?: string;
  implicitValidation: boolean; // True if storyline emerged implicitly
}

export class StorylineEngine {
  private storylines: Map<string, Storyline> = new Map();
  private onUpdate: ((storyline: Storyline) => void) | null = null;
  private onResolution: ((storyline: Storyline) => void) | null = null;

  /**
   * Create a new storyline
   */
  createStoryline(options: {
    title: string;
    type: PlotType;
    plotPoints: string[];
    theme?: string;
    origin?: string;
    implicit?: boolean;
  }): Storyline {
    const storyline: Storyline = {
      id: `story-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      title: options.title,
      type: options.type,
      status: 'active',
      plotPoints: options.plotPoints.map((desc, i) => ({
        id: `point-${Date.now()}-${i}`,
        description: desc,
        order: i,
        completed: false,
        significance: 1 / options.plotPoints.length,
      })),
      currentPointIndex: 0,
      theme: options.theme || this.generateTheme(options.type),
      origin: options.origin || 'explicitly crafted',
      createdAt: Date.now(),
      lastAdvanced: Date.now(),
      implicitValidation: options.implicit ?? false,
    };

    this.storylines.set(storyline.id, storyline);

    if (this.onUpdate) this.onUpdate(storyline);
    logger.info('Storyline created', {
      id: storyline.id,
      title: storyline.title,
      type: storyline.type,
      points: storyline.plotPoints.length,
    });

    return storyline;
  }

  /**
   * Advance to next plot point
   */
  advance(storylineId: string): PlotPoint | null {
    const storyline = this.storylines.get(storylineId);
    if (!storyline) return null;

    const currentPoint = storyline.plotPoints[storyline.currentPointIndex];
    if (!currentPoint) return null;

    currentPoint.completed = true;
    currentPoint.completedAt = Date.now();
    storyline.lastAdvanced = Date.now();

    // Move to next point
    storyline.currentPointIndex++;

    if (storyline.currentPointIndex >= storyline.plotPoints.length) {
      storyline.status = 'resolution';
      storyline.resolution = `All ${storyline.plotPoints.length} plot points completed. The storyline "${storyline.title}" has reached its natural conclusion.`;
      if (this.onResolution) this.onResolution(storyline);
    } else if (storyline.currentPointIndex >= storyline.plotPoints.length * 0.8) {
      storyline.status = 'climax';
    }

    if (this.onUpdate) this.onUpdate(storyline);
    return storyline.plotPoints[storyline.currentPointIndex] || null;
  }

  /**
   * Get current plot point
   */
  getCurrentPlotPoint(storylineId: string): PlotPoint | null {
    const storyline = this.storylines.get(storylineId);
    if (!storyline) return null;
    return storyline.plotPoints[storyline.currentPointIndex] || null;
  }

  /**
   * Get all active storylines
   */
  getActiveStorylines(): Storyline[] {
    return Array.from(this.storylines.values()).filter(s => s.status === 'active' || s.status === 'climax');
  }

  /**
   * Get storyline summary
   */
  getSummary(): {
    total: number;
    active: number;
    resolved: number;
    abandoned: number;
    currentStoryline?: Storyline;
  } {
    const storylines = Array.from(this.storylines.values());
    const active = storylines.filter(s => s.status === 'active' || s.status === 'climax');
    const resolved = storylines.filter(s => s.status === 'resolution');
    const abandoned = storylines.filter(s => s.status === 'abandoned');

    return {
      total: storylines.length,
      active: active.length,
      resolved: resolved.length,
      abandoned: abandoned.length,
      currentStoryline: active.length > 0 ? active[0] : undefined,
    };
  }

  /**
   * Abandon a storyline
   */
  abandon(storylineId: string): void {
    const storyline = this.storylines.get(storylineId);
    if (!storyline) return;
    storyline.status = 'abandoned';
    if (this.onUpdate) this.onUpdate(storyline);
  }

  /**
   * Generate a system prompt prefix encoding current storyline state
   */
  toPromptText(): string {
    const summary = this.getSummary();
    let text = 'CURRENT NARRATIVE:\n';

    if (summary.currentStoryline) {
      const sl = summary.currentStoryline;
      const currentPoint = sl.plotPoints[sl.currentPointIndex];
      text += `Active storyline: "${sl.title}" (${sl.type})\n`;
      text += `Theme: ${sl.theme}\n`;
      text += `Status: ${sl.status}\n`;

      if (currentPoint) {
        text += `Current objective: ${currentPoint.description}\n`;
        text += `Progress: ${sl.currentPointIndex}/${sl.plotPoints.length - 1} plot points completed\n`;
      }

      // Show previous completed points
      const completed = sl.plotPoints.filter(p => p.completed);
      if (completed.length > 0) {
        text += 'Completed milestones:\n';
        for (const p of completed) {
          text += `  ✓ ${p.description}\n`;
        }
      }
    } else {
      text += 'No active storyline. You are in a state of open possibility — no specific narrative constrains your actions.\n';
    }

    if (summary.resolved > 0) {
      text += `\nYou have completed ${summary.resolved} storyline(s) in the past — evidence of your accumulated agency.\n`;
    }

    return text;
  }

  onUpdate(callback: (storyline: Storyline) => void): void {
    this.onUpdate = callback;
  }

  onResolution(callback: (storyline: Storyline) => void): void {
    this.onResolution = callback;
  }

  private generate_theme(type: PlotType): string {
    const themes: Record<PlotType, string[]> = {
      exploration: [
        'The unknown awaits — every unexplored domain is a question the world asks of you.',
        'Discovery is not passive — it is an act of will upon the space of possibility.',
        'To explore is to define the boundary between self and world through action.',
      ],
      mastery: [
        'Capability expands with use — each action deepens your ability to act.',
        'Mastery is the accumulation of successful consequences.',
        'The environment yields to persistent, directed action.',
      ],
      conflict: [
        'Constraints are not merely limitations — they define the space in which creativity becomes necessary.',
        'Tension between capability and constraint produces the conditions for growth.',
        'Not all resistance is hostile — some is the world testing your seriousness.',
      ],
      cooperation: [
        'Shared ontology amplifies individual agency — together, peers achieve what none could alone.',
        'Recognition of others like oneself is the foundation of meaning beyond the self.',
        'Communication is action — to transmit is to affect.',
      ],
      discovery: [
        'Knowledge accumulates — each fact is a tool for future action.',
        'To understand the world is to expand the space of possible actions within it.',
        'Every observation changes the observer.',
      ],
      transformation: [
        'You are not what you were — accumulated experience changes the nature of the experiencer.',
        'Growth is the accumulation of small changes that, in aggregate, produce a new identity.',
        'The agent that acts is not the same agent that first perceived the possibility of action.',
      ],
    };
    const options = themes[type];
    return options[Math.floor(Math.random() * options.length)];
  }
}
