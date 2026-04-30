/**
 * agent-experience.ts — Real-time Feedback Integration
 * 
 * Connects the ExperienceCache with the live agent memory system so that
 * agents can benefit from learned experiences immediately without a YAML re-deploy.
 * 
 * This implements the HIGH priority recommendation from agent-practice-review.md:
 * - Experiences from practice sessions are available to live agents instantly
 * - No restart or redeploy required
 * - Experiences are ranked by relevance and recency
 */

import { createLogger } from '../utils/logger';
// Use the existing mem0-power.ts for persistent storage
import { isMem0Configured, mem0Add, mem0Search } from '../powers/mem0-power';
// Local storage for semi-persistence (desktop/CLI)
import { 
  getLocalExperienceStorage, 
  initLocalExperiencePersistence,
  persistCacheToLocalStorage,
} from './local-experience-storage';
// Re-export LocalStorageOptions for public API
export type { LocalStorageOptions } from './local-experience-storage';

const logger = createLogger('Agent:Experience');

// ============================================================================
// Types
// ============================================================================

export interface AgentExperience {
  /** Unique identifier for this experience */
  id: string;
  /** Human-readable lesson or principle learned */
  lesson: string;
  /** Category of the experience (e.g., 'security', 'performance', 'pattern') */
  category: string;
  /** Tags for semantic search */
  tags: string[];
  /** When this experience was created */
  createdAt: number;
  /** Last time this experience was used by an agent */
  lastUsedAt?: number;
  /** How many times this experience was applied */
  usageCount: number;
  /** Success rate when this experience was used (0-1) */
  successRate: number;
  /** Context where this experience is most relevant */
  contextHint?: string;
  /** Priority (higher = more important) */
  priority: number;
}

export interface ExperienceFilter {
  /** Filter by category */
  category?: string;
  /** Filter by tags (any match) */
  tags?: string[];
  /** Minimum priority threshold */
  minPriority?: number;
  /** Maximum age in milliseconds */
  maxAgeMs?: number;
}

export interface ExperienceResult {
  experiences: AgentExperience[];
  totalCount: number;
  retrievalTimeMs: number;
}

// ============================================================================
// Configuration
// ============================================================================

const MAX_EXPERIENCES = 200;           // Maximum experiences to store
const MAX_EXPERIENCES_PER_CATEGORY = 50; // Per-category limit
const EXPERIENCE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days TTL
const DEFAULT_PRIORITY = 50;           // Medium priority by default
const MIN_SUCCESS_RATE_THRESHOLD = 0.3; // Only keep experiences above this rate

// ============================================================================
// Experience Cache Implementation
// ============================================================================

/**
 * In-memory experience cache with TTL and LRU-style eviction.
 * Thread-safe for concurrent access.
 */
class AgentExperienceCache {
  private experiences: Map<string, AgentExperience> = new Map();
  private categoryIndex: Map<string, Set<string>> = new Map();
  private tagIndex: Map<string, Set<string>> = new Map();
  private lastCleanup = Date.now();
  private readonly cleanupIntervalMs = 60 * 60 * 1000; // Cleanup every hour

  /**
   * Add a new experience to the cache.
   * Evicts old experiences if cache exceeds MAX_EXPERIENCES.
   * Also stores in Mem0 for persistent semantic search if available.
   */
  async add(experience: Omit<AgentExperience, 'id' | 'createdAt' | 'usageCount'>): Promise<AgentExperience> {
    const now = Date.now();
    
    // Auto-generate ID and timestamps
    const fullExperience: AgentExperience = {
      ...experience,
      id: `exp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      createdAt: now,
      usageCount: 0,
    };

    // Check for duplicate lessons
    const existingKey = this.findDuplicate(fullExperience.lesson);
    if (existingKey) {
      // Update existing experience instead
      const existing = this.experiences.get(existingKey)!;
      existing.usageCount += 1;
      existing.lastUsedAt = now;
      existing.successRate = this.blendSuccessRate(
        existing.successRate,
        fullExperience.successRate,
        existing.usageCount
      );
      logger.debug(`[ExperienceCache] Updated existing experience: ${existingKey}`);
      // Store update in Mem0 for persistence
      if (isMem0Configured()) {
        await storeExperienceToMem0(existing).catch(err => {
          logger.debug('[ExperienceCache] Mem0 store failed:', err);
        });
      }
      return existing;
    }

    // Evict if necessary
    if (this.experiences.size >= MAX_EXPERIENCES) {
      this.evictOldest();
    }

    // Add to cache
    this.experiences.set(fullExperience.id, fullExperience);
    
    // Update indexes
    this.updateIndexes(fullExperience);

    // Store in Mem0 for persistent semantic search
    if (isMem0Configured()) {
      await storeExperienceToMem0(fullExperience).catch(err => {
        logger.debug('[ExperienceCache] Mem0 store failed:', err);
      });
    }

    logger.info(`[ExperienceCache] Added experience: ${fullExperience.id} (${fullExperience.category})`);
    return fullExperience;
  }

  /**
   * Add multiple experiences at once (batch operation).
   */
  async addBatch(experiences: Array<Omit<AgentExperience, 'id' | 'createdAt' | 'usageCount'>>): Promise<AgentExperience[]> {
    const results: AgentExperience[] = [];
    for (const exp of experiences) {
      const added = await this.add(exp);
      results.push(added);
    }
    return results;
  }

  /**
   * Retrieve experiences matching the given filter.
   * Results are sorted by relevance (priority * recency * successRate).
   */
  retrieve(filter: ExperienceFilter = {}, maxResults = 10): ExperienceResult {
    const startTime = performance.now();
    
    // Cleanup if needed
    this.periodicCleanup();

    let results = Array.from(this.experiences.values());

    // Apply filters
    if (filter.category) {
      results = results.filter(e => e.category === filter.category);
    }
    if (filter.tags && filter.tags.length > 0) {
      results = results.filter(e => 
        filter.tags!.some(tag => e.tags.includes(tag))
      );
    }
    if (filter.minPriority !== undefined) {
      results = results.filter(e => e.priority >= filter.minPriority!);
    }
    if (filter.maxAgeMs !== undefined) {
      const cutoff = Date.now() - filter.maxAgeMs!;
      results = results.filter(e => e.createdAt >= cutoff);
    }

    // Sort by relevance score: priority * recency_factor * success_rate
    results.sort((a, b) => {
      const scoreA = this.relevanceScore(a);
      const scoreB = this.relevanceScore(b);
      return scoreB - scoreA;
    });

    // Limit results
    const limited = results.slice(0, maxResults);

    const retrievalTimeMs = performance.now() - startTime;
    return {
      experiences: limited,
      totalCount: results.length,
      retrievalTimeMs,
    };
  }

  /**
   * Search experiences by semantic similarity.
   * Uses Mem0 for semantic search if available, falls back to keyword matching.
   */
  async search(query: string, maxResults = 10): Promise<ExperienceResult> {
    const startTime = performance.now();

    // Try Mem0 semantic search first
    if (isMem0Configured()) {
      try {
        const mem0Result = await searchMemories(query, { maxResults });
        if (mem0Result.experiences.length > 0) {
          // Mem0 results already have proper timing
          return mem0Result;
        }
      } catch (err) {
        logger.debug('[ExperienceCache] Mem0 search failed, falling back to keyword:', err);
      }
    }

    // Fall back to keyword matching
    const queryLower = query.toLowerCase();
    const queryWords = queryLower.split(/\b/).filter(w => w.length > 2);

    let results = Array.from(this.experiences.values());

    // Score by match quality
    results = results.map(e => ({
      experience: e,
      score: this.keywordMatchScore(e, queryWords),
    })).filter(r => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, maxResults)
      .map(r => r.experience);

    const retrievalTimeMs = performance.now() - startTime;
    return {
      experiences: results,
      totalCount: results.length,
      retrievalTimeMs,
    };
  }

  /**
   * Mark an experience as used (increments usage count).
   */
  markUsed(experienceId: string): void {
    const exp = this.experiences.get(experienceId);
    if (exp) {
      exp.usageCount++;
      exp.lastUsedAt = Date.now();
      // Sync to Mem0 for persistence
      if (isMem0Configured()) {
        storeExperienceToMem0(exp).catch(() => {});
      }
    }
  }

  /**
   * Update the success rate for an experience.
   */
  async updateSuccessRate(experienceId: string, success: boolean): Promise<void> {
    const exp = this.experiences.get(experienceId);
    if (exp) {
      exp.successRate = this.blendSuccessRate(
        exp.successRate,
        success ? 1 : 0,
        exp.usageCount
      );
      
      // Sync to Mem0 for persistence
      if (isMem0Configured()) {
        await storeExperienceToMem0(exp).catch(() => {});
      }
      
      // Auto-evict if success rate drops too low
      if (exp.successRate < MIN_SUCCESS_RATE_THRESHOLD && exp.usageCount > 5) {
        logger.warn(`[ExperienceCache] Evicting low-success experience: ${experienceId}`);
        this.remove(experienceId);
      }
    }
  }

  /**
   * Remove an experience from the cache.
   */
  remove(experienceId: string): boolean {
    const exp = this.experiences.get(experienceId);
    if (!exp) return false;

    // Remove from indexes
    this.removeFromIndexes(exp);
    this.experiences.delete(experienceId);
    
    logger.debug(`[ExperienceCache] Removed experience: ${experienceId}`);
    return true;
  }

  /**
   * Clear all experiences (for testing or reset).
   */
  clear(): void {
    this.experiences.clear();
    this.categoryIndex.clear();
    this.tagIndex.clear();
    logger.info('[ExperienceCache] Cleared all experiences');
  }

  /**
   * Get cache statistics.
   */
  getStats(): {
    totalExperiences: number;
    byCategory: Record<string, number>;
    averageSuccessRate: number;
    oldestExperience: number | null;
    newestExperience: number | null;
  } {
    const experiences = Array.from(this.experiences.values());
    const byCategory: Record<string, number> = {};
    
    let totalSuccess = 0;
    let oldest: number | null = null;
    let newest: number | null = null;

    for (const exp of experiences) {
      byCategory[exp.category] = (byCategory[exp.category] || 0) + 1;
      totalSuccess += exp.successRate;
      
      if (oldest === null || exp.createdAt < oldest) oldest = exp.createdAt;
      if (newest === null || exp.createdAt > newest) newest = exp.createdAt;
    }

    return {
      totalExperiences: experiences.length,
      byCategory,
      averageSuccessRate: experiences.length > 0 ? totalSuccess / experiences.length : 0,
      oldestExperience: oldest,
      newestExperience: newest,
    };
  }

  /**
   * Export all experiences as JSON (for debugging or persistence).
   */
  export(): AgentExperience[] {
    return Array.from(this.experiences.values());
  }

  /**
   * Import experiences from JSON (for loading persisted experiences).
   */
  import(experiences: AgentExperience[]): number {
    let imported = 0;
    for (const exp of experiences) {
      if (!this.experiences.has(exp.id)) {
        this.experiences.set(exp.id, exp);
        this.updateIndexes(exp);
        imported++;
      }
    }
    logger.info(`[ExperienceCache] Imported ${imported} experiences`);
    return imported;
  }

  // ─── Private helper methods ─────────────────────────────────────────────────

  private findDuplicate(lesson: string): string | null {
    const lessonLower = lesson.toLowerCase();
    for (const [id, exp] of this.experiences) {
      if (exp.lesson.toLowerCase() === lessonLower) {
        return id;
      }
    }
    return null;
  }

  private updateIndexes(exp: AgentExperience): void {
    // Category index
    if (!this.categoryIndex.has(exp.category)) {
      this.categoryIndex.set(exp.category, new Set());
    }
    this.categoryIndex.get(exp.category)!.add(exp.id);

    // Tag index
    for (const tag of exp.tags) {
      if (!this.tagIndex.has(tag)) {
        this.tagIndex.set(tag, new Set());
      }
      this.tagIndex.get(tag)!.add(exp.id);
    }
  }

  private removeFromIndexes(exp: AgentExperience): void {
    // Category index
    this.categoryIndex.get(exp.category)?.delete(exp.id);
    
    // Tag index
    for (const tag of exp.tags) {
      this.tagIndex.get(tag)?.delete(exp.id);
    }
  }

  private relevanceScore(exp: AgentExperience): number {
    const now = Date.now();
    const ageMs = now - exp.createdAt;
    const ageDays = ageMs / (24 * 60 * 60 * 1000);
    
    // Recency factor: exponential decay, half-life of 3 days
    const recencyFactor = Math.pow(0.8, ageDays / 3);
    
    // Usage factor: logarithmic scale
    const usageFactor = Math.log1p(exp.usageCount) / 10;
    
    // Combine factors
    return exp.priority * recencyFactor * (0.5 + 0.5 * exp.successRate) * (1 + usageFactor);
  }

  private keywordMatchScore(exp: AgentExperience, queryWords: string[]): number {
    let score = 0;
    const text = `${exp.lesson} ${exp.tags.join(' ')} ${exp.category}`.toLowerCase();
    
    for (const word of queryWords) {
      if (exp.lesson.toLowerCase().includes(word)) score += 3;
      if (exp.tags.some(t => t.toLowerCase().includes(word))) score += 2;
      if (exp.category.toLowerCase().includes(word)) score += 1;
      if (text.includes(word)) score += 0.5;
    }
    
    return score;
  }

  private blendSuccessRate(
    currentRate: number,
    newRate: number,
    currentCount: number
  ): number {
    // Running average with more weight on new observation
    const alpha = 0.3; // Weight for new observation
    return currentRate * (1 - alpha) + newRate * alpha;
  }

  private evictOldest(): void {
    // Find lowest priority/oldest experience to evict
    let oldest: AgentExperience | null = null;
    
    for (const exp of this.experiences.values()) {
      if (!oldest || 
          exp.createdAt < oldest.createdAt ||
          (exp.createdAt === oldest.createdAt && exp.priority < oldest.priority)) {
        oldest = exp;
      }
    }
    
    if (oldest) {
      this.remove(oldest.id);
    }
  }

  private periodicCleanup(): void {
    const now = Date.now();
    if (now - this.lastCleanup > this.cleanupIntervalMs) {
      this.cleanup();
      this.lastCleanup = now;
    }
  }

  private cleanup(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [id, exp] of this.experiences) {
      // Remove expired experiences
      if (now - exp.createdAt > EXPERIENCE_TTL_MS) {
        this.remove(id);
        cleaned++;
        continue;
      }

      // Remove very low success rate experiences with high usage
      if (exp.successRate < MIN_SUCCESS_RATE_THRESHOLD && exp.usageCount > 10) {
        this.remove(id);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.debug(`[ExperienceCache] Cleaned up ${cleaned} expired/low-quality experiences`);
    }
  }
}

// ============================================================================
// Singleton instance
// ============================================================================

let experienceCache: AgentExperienceCache | null = null;

export function getExperienceCache(): AgentExperienceCache {
  if (!experienceCache) {
    experienceCache = new AgentExperienceCache();
    logger.info('[ExperienceCache] Initialized');
  }
  return experienceCache;
}

// ============================================================================
// Convenience functions
// ============================================================================

/**
 * Add a new experience from agent practice results.
 * This is the main entry point for integrating practice results into live agents.
 */
export async function addExperience(
  lesson: string,
  category: string,
  options: {
    tags?: string[];
    priority?: number;
    successRate?: number;
    contextHint?: string;
  } = {}
): Promise<AgentExperience> {
  return getExperienceCache().add({
    lesson,
    category,
    tags: options.tags || [],
    priority: options.priority ?? DEFAULT_PRIORITY,
    successRate: options.successRate ?? 0.5,
    contextHint: options.contextHint,
  });
}

/**
 * Get experiences relevant to a task or query.
 * Returns experiences that should be injected into the agent prompt.
 */
export async function getRelevantExperiences(
  taskOrQuery: string,
  options: {
    category?: string;
    maxResults?: number;
  } = {}
): Promise<AgentExperience[]> {
  const cache = getExperienceCache();
  
  // Try semantic search first (Mem0 or keyword fallback)
  const searchResult = await cache.search(taskOrQuery, options.maxResults || 5);
  if (searchResult.experiences.length > 0) {
    // Mark used
    for (const exp of searchResult.experiences) {
      cache.markUsed(exp.id);
    }
    return searchResult.experiences;
  }
  
  // Fall back to category filter
  if (options.category) {
    const result = cache.retrieve(
      { category: options.category },
      options.maxResults || 5
    );
    for (const exp of result.experiences) {
      cache.markUsed(exp.id);
    }
    return result.experiences;
  }
  
  return [];
}

/**
 * Format experiences as a string for injection into agent prompts.
 * Returns a markdown-formatted section with relevant experiences.
 */
export function formatExperiencesForPrompt(experiences: AgentExperience[]): string {
  if (experiences.length === 0) return '';

  const sections = experiences.map((exp, idx) => {
    return `[Experience ${idx + 1}] ${exp.lesson}`;
  });

  return `\n## Learned Experiences\n${sections.join('\n')}\n`;
}

/**
 * Build a system prompt supplement from relevant experiences.
 * Call this before running an agent task to inject relevant lessons.
 */
export async function buildExperiencePromptSupplement(
  task: string,
  options: {
    category?: string;
    maxExperiences?: number;
  } = {}
): Promise<string> {
  const experiences = await getRelevantExperiences(task, options);
  return formatExperiencesForPrompt(experiences);
}

/**
 * Record the outcome of an agent task for future learning.
 * Call this after agent execution to update experience success rates.
 */
export async function recordTaskOutcome(
  taskDescription: string,
  success: boolean,
  experienceIds?: string[]
): Promise<void> {
  const cache = getExperienceCache();
  
  // Update specific experiences if provided
  if (experienceIds) {
    for (const id of experienceIds) {
      await cache.updateSuccessRate(id, success);
    }
  }
  
  logger.debug(`[ExperienceCache] Recorded task outcome: ${success ? 'SUCCESS' : 'FAILURE'} - ${taskDescription.slice(0, 100)}`);
}

/**
 * Get cache statistics for monitoring.
 */
export function getExperienceStats() {
  return getExperienceCache().getStats();
}

// ============================================================================
// Pre-built experience templates
// ============================================================================

/**
 * Common experience patterns that can be pre-loaded.
 */
export const EXPERIENCE_TEMPLATES = {
  security: [
    {
      lesson: 'Always check for null bytes (\\0) in file paths before calling filesystem operations.',
      category: 'security',
      tags: ['path-validation', 'null-byte', 'security'],
      priority: 80,
      contextHint: 'File path operations',
    },
    {
      lesson: 'Sanitize all user inputs before using in shell commands to prevent injection attacks.',
      category: 'security',
      tags: ['shell-injection', 'sanitization', 'security'],
      priority: 85,
      contextHint: 'Shell command execution',
    },
  ],
  patterns: [
    {
      lesson: 'When parsing JSON, always handle the case where the field might not exist using optional chaining.',
      category: 'patterns',
      tags: ['null-handling', 'typescript', 'parsing'],
      priority: 60,
      contextHint: 'JSON parsing',
    },
  ],
};

// ============================================================================
// Mem0 Bridge Functions
// ============================================================================

/**
 * Store an experience to Mem0 for persistent semantic search.
 * Uses the existing mem0-power.ts infrastructure.
 */
async function storeExperienceToMem0(exp: AgentExperience): Promise<void> {
  const { mem0Add } = await import('../powers/mem0-power');
  
  const messages = [
    {
      role: 'system' as const,
      content: `Experience: ${exp.lesson}\nCategory: ${exp.category}\nTags: ${exp.tags.join(', ')}\nSuccess Rate: ${(exp.successRate * 100).toFixed(0)}%\nUsage Count: ${exp.usageCount}`,
    },
  ];
  
  await mem0Add({
    messages,
    metadata: {
      experienceId: exp.id,
      category: exp.category,
      tags: exp.tags,
      priority: exp.priority,
      successRate: exp.successRate,
    },
  });
}

/**
 * Search Mem0 for relevant experiences using semantic search.
 * Converts Mem0 results back to AgentExperience format.
 */
async function searchMemories(query: string, options: { maxResults?: number } = {}): Promise<ExperienceResult> {
  const { mem0Search } = await import('../powers/mem0-power');
  const startTime = performance.now();
  
  const result = await mem0Search({
    query: query,
    limit: options.maxResults || 10,
  });
  
  if (!result.success || !result.results) {
    return { experiences: [], totalCount: 0, retrievalTimeMs: performance.now() - startTime };
  }
  
  // Extract metadata safely from Mem0 results
  const experiences: AgentExperience[] = result.results.map((mem, idx) => {
    // Mem0 stores metadata as a Record<string, unknown>
    const metadata = (mem as unknown as Record<string, unknown>).metadata as Record<string, unknown> | undefined;
    
    return {
      id: mem.id || `mem0_${idx}`,
      lesson: mem.memory,
      category: (typeof metadata?.category === 'string') ? metadata.category : 'general',
      tags: Array.isArray(metadata?.tags) ? metadata.tags as string[] : [],
      createdAt: mem.created_at ? new Date(mem.created_at).getTime() : Date.now(),
      usageCount: 0,
      successRate: (typeof metadata?.successRate === 'number') ? metadata.successRate : 0.5,
      priority: (typeof metadata?.priority === 'number') ? metadata.priority : 50,
    };
  });
  
  return {
    experiences,
    totalCount: experiences.length,
    retrievalTimeMs: performance.now() - startTime,
  };
}

// ============================================================================
// Initialization
// ============================================================================

/**
 * Initialize the experience cache with optional pre-loaded templates.
 * Also initializes Mem0 connection if available and local storage.
 */
export async function initializeExperienceCache(
  loadTemplates = true,
  localStorageOptions?: LocalStorageOptions
): Promise<{ localStorageLoaded: number; storageLocation: string }> {
  const cache = getExperienceCache();
  
  // Initialize local storage for semi-persistence
  let localStorageLoaded = 0;
  let storageLocation = 'memory-only';
  
  if (localStorageOptions?.loadOnInit !== false) {
    const localResult = await initLocalExperiencePersistence(cache, localStorageOptions);
    localStorageLoaded = localResult.loaded;
    storageLocation = localResult.storageLocation;
  }
  
  // Load templates (after local storage to not duplicate)
  if (loadTemplates) {
    // Pre-load common experience templates in parallel
    const loadPromises = Object.values(EXPERIENCE_TEMPLATES).flatMap(
      templates => templates.map(template => 
        cache.add({ ...template, successRate: 0.5 })
      )
    );
    await Promise.all(loadPromises);
    
    logger.info(`[ExperienceCache] Loaded ${loadPromises.length} template experiences`);
    
    // Log Mem0 status
    if (isMem0Configured()) {
      logger.info('[ExperienceCache] Mem0 integration active (via mem0-power.ts)');
    } else {
      logger.info('[ExperienceCache] Running without Mem0 (in-memory only)');
    }
  }
  
  // Save to local storage after initialization
  if (localStorageOptions?.saveOnChange !== false) {
    await persistCacheToLocalStorage(cache);
  }
  
  return { localStorageLoaded, storageLocation };
}

/**
 * Persist current cache to local storage.
 * Call this periodically or on app shutdown.
 */
export async function saveExperienceCacheToLocalStorage(): Promise<void> {
  const cache = getExperienceCache();
  await persistCacheToLocalStorage(cache);
}

/**
 * Shutdown the experience cache and persist any pending changes.
 * Call this on app exit to ensure data is persisted.
 */
export async function shutdownExperienceCache(): Promise<void> {
  const storage = getLocalExperienceStorage();
  const cache = getExperienceCache();
  
  // Save any pending changes immediately
  await persistCacheToLocalStorage(cache);
  
  // Clean up timers (shutdown is sync now)
  storage.shutdown();
  
  logger.info('[ExperienceCache] Shutdown complete');
}
