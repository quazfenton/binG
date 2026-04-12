/**
 * SPEC Super Mode - Hyper-Detailed Multi-Chain Enhancement
 * 
 * A comprehensive 150+ step enhancement system that combines all 10 specialized
 * meta-prompt chains into a sequential, layered build process.
 * 
 * STRUCTURE:
 * - 10 chains (frontend, backend, ml_ai, mobile, security, devops, data, api, system, web3)
 * - Each chain: 10 implementation rounds + 5 planning rounds = 15 rounds per chain
 * - Planning rounds at 1.5, 3.5, 5.5, 7.5, 9.5 for each chain generate technical plans
 * - Each plan focuses on the specific layer's features, implementation, architecture, stack
 * - Plans provide context for the subsequent implementation rounds
 * 
 * LAYER HIERARCHY:
 * - Layer 1 (Bottom): Technical Plan for chain (comprehensive, detailed)
 * - Layer 2 (Middle): Chain Meta-Prompt (strategic focus for each round)
 * - Layer 3 (Top): Implementation details (code, features, edge cases)
 * 
 * Example for Backend Chain:
 * - Step 1.5: Generate comprehensive backend architecture plan
 * - Step 2: Backend Meta-Prompt (Server Architecture) + Plan context
 * - Step 3: Backend Meta-Prompt (Database Design) + Plan context
 * - Step 3.5: Refine plan based on implementation progress
 * ... and so on
 */

import type { SpecEnhancementMode, MaximalistConfig } from './maximalist-spec-enhancer';
import { META_PROMPT_CHAINS, detectMetaPromptChain, type MetaPromptChain } from './spec-meta-prompts';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('SuperMode');

// ============================================================================
// Tracing & Progress Types
// ============================================================================

export interface SuperModeTraceEvent {
  /** Unique trace ID for this super mode execution */
  traceId: string;
  /** Event type */
  eventType: 'phase_start' | 'phase_complete' | 'phase_error' | 'planning_start' | 'planning_complete' | 'midpoint_start' | 'midpoint_complete' | 'budget_warning' | 'complete';
  /** Phase number (if applicable) */
  phase?: number;
  /** Chain name (if applicable) */
  chain?: string;
  /** Event timestamp */
  timestamp: number;
  /** Duration in ms (for complete events) */
  duration?: number;
  /** Progress percentage (0-100) */
  progress?: number;
  /** Error message (for error events) */
  error?: string;
  /** Additional metadata */
  metadata?: Record<string, any>;
}

export interface SuperModeProgress {
  traceId: string;
  currentPhase: number;
  totalPhases: number;
  currentChain: string;
  phaseType: 'plan' | 'implement';
  progressPercent: number;
  elapsedMs: number;
  estimatedRemainingMs?: number;
  completedChains: string[];
  failedPhases: number;
  /** Last phase duration in ms */
  lastPhaseDurationMs?: number;
  /** Whether execution is complete (success or budget exceeded) */
  isComplete: boolean;
}

/**
 * Callback type for progress updates
 * Can be used to emit events to clients or log to external systems
 */
export type SuperModeProgressCallback = (progress: SuperModeProgress, event: SuperModeTraceEvent) => void;

// ============================================================================
// Types
// ============================================================================

export interface SuperModePhase {
  /** Phase number (1-15 for each chain) */
  phase: number;
  /** Which chain this belongs to */
  chain: MetaPromptChain;
  /** Type of phase: 'plan' or 'implement' */
  type: 'plan' | 'implement';
  /** The meta-prompt for implementation phases */
  metaPromptId?: string;
  /** The planning prompt for plan phases */
  planningPrompt?: string;
  /** Human-readable title */
  title: string;
}

export interface SuperModeConfig {
  /** Which chains to include (default: all 10) */
  chains: MetaPromptChain[];
  /** Number of rounds per chain */
  roundsPerChain: number;
  /** Number of planning rounds per chain (at 1.5, 3.5, etc.) */
  planningRoundsPerChain: number;
  /** Enable plan generation at each planning checkpoint */
  enablePlanning: boolean;
  /** Planning depth: 'brief', 'detailed', 'comprehensive' */
  planningDepth: 'brief' | 'detailed' | 'comprehensive';
  /** Maximum phases to execute (execution budget) */
  maxPhases: number;
  /** Time budget in milliseconds */
  timeBudgetMs: number;
  /** Model to use for LLM calls */
  model: string;
  /** Provider for LLM calls */
  provider: string;
  /** Enable mid-point plan regeneration */
  enableMidPointRegen: boolean;
  /** Optional callback for progress updates (useful for streaming to clients) */
  onProgress?: SuperModeProgressCallback;
  /** Optional trace ID for tracking (generated if not provided) */
  traceId?: string;
}

export const DEFAULT_SUPER_MODE_CONFIG: SuperModeConfig = {
  chains: ['frontend', 'backend', 'ml_ai', 'mobile', 'security', 'devops', 'data', 'api', 'system', 'web3'],
  roundsPerChain: 6,         // 6 rounds per chain = ~110 total phases (6 + 5 planning × 10 chains)
  planningRoundsPerChain: 5, // 5 planning phases at 1.5, 2.5, 3.5, 4.5, 5.5
  enablePlanning: true,
  planningDepth: 'detailed',
  maxPhases: 100,            // Execution budget - max 100 phases
  timeBudgetMs: 600000,      // 10 minute time budget
  model: 'gpt-4o',           // Default model
  provider: 'openai',        // Default provider
  enableMidPointRegen: true, // Mid-point plan regeneration
};

// ============================================================================
// Trace Utilities
// ============================================================================

/**
 * Generate a unique trace ID for tracking
 */
function generateTraceId(): string {
  return `super-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Create a trace event and emit via callback if configured
 */
function emitTraceEvent(
  traceId: string,
  eventType: SuperModeTraceEvent['eventType'],
  phase: number | undefined,
  chain: string | undefined,
  progress: number | undefined,
  duration: number | undefined,
  error: string | undefined,
  metadata: Record<string, any> | undefined,
  callback: SuperModeProgressCallback | undefined,
  currentPhase: number,
  totalPhases: number,
  currentChain: string,
  phaseType: 'plan' | 'implement',
  elapsedMs: number,
  completedChains: string[],
  failedPhases: number
): void {
  const event: SuperModeTraceEvent = {
    traceId,
    eventType,
    phase,
    chain,
    timestamp: Date.now(),
    duration,
    progress,
    error,
    metadata,
  };

  const progressInfo: SuperModeProgress = {
    traceId,
    currentPhase,
    totalPhases,
    currentChain,
    phaseType,
    progressPercent: progress || 0,
    elapsedMs,
    completedChains,
    failedPhases,
    isComplete: false,
  };

  // Log to console in development
  const eventLabel = `[${eventType.toUpperCase()}]`;
  const phaseInfo = phase ? ` Phase ${phase}` : '';
  const chainInfo = chain ? ` Chain: ${chain}` : '';
  const progressInfoStr = progress !== undefined ? ` Progress: ${progress.toFixed(1)}%` : '';
  const durationInfo = duration ? ` Duration: ${duration}ms` : '';
  const errorInfo = error ? ` Error: ${error}` : '';
  
  logger.debug(`${eventLabel}${phaseInfo}${chainInfo}${progressInfoStr}${durationInfo}${errorInfo}`);

  // Emit to callback if configured
  if (callback) {
    try {
      callback(progressInfo, event);
    } catch (callbackError) {
      logger.warn('Progress callback failed', { error: (callbackError as Error).message });
    }
  }
}

// ============================================================================
// Chain Execution Order
// ============================================================================

/**
 * Default execution order for chains - can be customized
 * Starts with frontend (user-facing), then backend, then specialized areas
 */
export const DEFAULT_CHAIN_ORDER: MetaPromptChain[] = [
  'frontend',    // User interface first
  'backend',     // Then server logic
  'api',         // API design (builds on backend)
  'system',      // System architecture (holistic view)
  'data',        // Data layer (foundation for features)
  'devops',      // Infrastructure (deploy-ready)
  'security',    // Security (hardening)
  'ml_ai',       // AI/ML features (advanced)
  'mobile',      // Mobile adaptation
  'web3',        // Web3 integration (specialized)
];

// ============================================================================
// Planning Prompt Templates
// ============================================================================

/**
 * Generate a comprehensive technical planning prompt for a specific chain
 * This is injected at the planning checkpoints (1.5, 3.5, 5.5, etc.)
 */
function generatePlanningPrompt(
  chain: MetaPromptChain,
  phase: number,
  totalPhases: number,
  originalRequest: string,
  previousOutput: string,
  depth: 'brief' | 'detailed' | 'comprehensive'
): string {
  const chainNames: Record<MetaPromptChain, string> = {
    default: 'Full-Stack',
    frontend: 'Frontend',
    ml_ai: 'Machine Learning & AI',
    backend: 'Backend',
    mobile: 'Mobile',
    security: 'Security',
    devops: 'DevOps',
    data: 'Data Engineering',
    api: 'API Design',
    system: 'System Architecture',
    web3: 'Web3 & Blockchain',
  };

  const chainName = chainNames[chain];
  
  // Determine planning focus based on phase
  const planningFocus = getPlanningFocusForPhase(chain, phase);
  
  const depthInstructions = {
    brief: `
- High-level overview only
- Key components listed
- Minimal detail
`,
    detailed: `
- Component breakdown
- Integration points specified
- Technology choices justified
- Key interfaces defined
`,
    comprehensive: `
- Complete architecture diagrams (described)
- All components specified with responsibilities
- Data flow detailed
- Error handling strategies
- Performance considerations
- Security implications
- Scalability approach
- Testing strategy
`,
  };

  return `
============================================
# TECHNICAL PLANNING PHASE ${phase}.5
# ${chainName} Layer - ${planningFocus.title}
============================================

ORIGINAL REQUEST:
${originalRequest}

CURRENT PROGRESS:
${previousOutput.substring(0, 1500)}${previousOutput.length > 1500 ? '\n...[truncated]...' : ''}

============================================
# PLANNING CONTEXT
============================================

PHASE: ${phase} of ${totalPhases}
CHAIN: ${chainName}
FOCUS AREA: ${planningFocus.title}

${depthInstructions[depth]}

============================================
# PLANNING REQUIREMENTS
============================================

Generate a comprehensive technical plan for the ${chainName} layer focusing on:

**${planningFocus.title}**
${planningFocus.description}

Your plan should:
1. Define the architecture for this layer
2. Specify the tech stack and tooling
3. Outline key components and their responsibilities
4. Identify integration points with other layers
5. Consider edge cases and error scenarios
6. Plan for testing and quality assurance
7. Address security and performance concerns

The plan will be injected as context for the subsequent implementation phases.
Focus on making this plan ACTIONABLE - something that can be directly implemented.

Return the technical plan in a structured format.
`;
}

/**
 * Get the planning focus for a specific phase in a chain
 */
function getPlanningFocusForPhase(
  chain: MetaPromptChain,
  phase: number
): { title: string; description: string } {
  // Map phases 1-10 to specific planning focuses per chain
  const phaseMapping: Record<MetaPromptChain, Record<number, { title: string; description: string }>> = {
    frontend: {
      1: { title: 'Project Foundation', description: 'Project setup, tooling, design system foundation' },
      3: { title: 'Core Components', description: 'Component architecture, state management foundation' },
      5: { title: 'Interactive Features', description: 'User interactions, forms, real-time features' },
      7: { title: 'Advanced Features', description: 'Complex features, integrations, performance optimization' },
      9: { title: 'Production Readiness', description: 'Testing, deployment, monitoring, accessibility' },
    },
    backend: {
      1: { title: 'Server Architecture', description: 'Framework setup, routing, middleware architecture' },
      3: { title: 'Data Layer', description: 'Database schema, ORM setup, data models, migrations' },
      5: { title: 'Business Logic', description: 'Domain services, validation, complex operations' },
      7: { title: 'Integrations', description: 'External APIs, event systems, messaging' },
      9: { title: 'Production Backend', description: 'Scaling, caching, monitoring, deployment' },
    },
    ml_ai: {
      1: { title: 'ML Infrastructure', description: 'Environment setup, experiment tracking, data pipelines' },
      3: { title: 'Model Architecture', description: 'Model selection, training pipeline, evaluation framework' },
      5: { title: 'Inference System', description: 'Serving infrastructure, optimization, API integration' },
      7: { title: 'AI Features', description: 'RAG implementation, agent patterns, tool use' },
      9: { title: 'ML Production', description: 'Monitoring, retraining, drift detection, safety' },
    },
    mobile: {
      1: { title: 'Mobile Foundation', description: 'Project setup, navigation, core architecture' },
      3: { title: 'UI Components', description: 'Design system, reusable components, theming' },
      5: { title: 'Data & Sync', description: 'Offline-first, local storage, background sync' },
      7: { title: 'Native Features', description: 'Device APIs, push notifications, biometrics' },
      9: { title: 'Mobile Production', description: 'Testing, app store deployment, performance' },
    },
    security: {
      1: { title: 'Security Foundation', description: 'Threat model, authentication, authorization architecture' },
      3: { title: 'Data Protection', description: 'Encryption, key management, secure storage' },
      5: { title: 'API Security', description: 'Rate limiting, input validation, security headers' },
      7: { title: 'Monitoring & Response', description: 'Security monitoring, incident response, compliance' },
      9: { title: 'Security Hardening', description: 'Production security review, penetration testing, hardening' },
    },
    devops: {
      1: { title: 'Infrastructure Setup', description: 'Cloud resources, IaC, Kubernetes cluster setup' },
      3: { title: 'Container Strategy', description: 'Docker images, orchestration, service mesh' },
      5: { title: 'CI/CD Pipeline', description: 'Build automation, testing, deployment strategies' },
      7: { title: 'Observability', description: 'Logging, metrics, tracing, alerting infrastructure' },
      9: { title: 'Production Operations', description: 'Scaling, disaster recovery, cost optimization' },
    },
    data: {
      1: { title: 'Data Architecture', description: 'Storage strategy, data lake, warehouse design' },
      3: { title: 'Pipeline Design', description: 'ETL/ELT pipelines, orchestration, data quality' },
      5: { title: 'Analytics Foundation', description: 'Business intelligence, dashboards, reporting' },
      7: { title: 'Real-time Processing', description: 'Stream processing, event-driven features' },
      9: { title: 'Data Governance', description: 'Catalog, lineage, compliance, ML integration' },
    },
    api: {
      1: { title: 'API Design', description: 'REST/GraphQL design, versioning, OpenAPI spec' },
      3: { title: 'Authentication & Auth', description: 'API keys, OAuth, rate limiting, scopes' },
      5: { title: 'Validation & Errors', description: 'Request/response validation, error handling' },
      7: { title: 'API Gateway', description: 'Gateway setup, routing, caching, transformations' },
      9: { title: 'API Production', description: 'Documentation, SDKs, monitoring, evolution' },
    },
    system: {
      1: { title: 'Requirements Analysis', description: 'Functional/non-functional requirements, constraints' },
      3: { title: 'High-Level Architecture', description: 'System boundaries, service decomposition, patterns' },
      5: { title: 'Component Design', description: 'Interface design, data models, contracts' },
      7: { title: 'Cross-Cutting Concerns', description: 'Security, observability, resilience patterns' },
      9: { title: 'Architecture Review', description: 'Trade-off analysis, risk assessment, decisions' },
    },
    web3: {
      1: { title: 'Protocol Selection', description: 'Blockchain choice, L2 selection, cross-chain strategy' },
      3: { title: 'Smart Contract Design', description: 'Contract architecture, upgrade patterns, security' },
      5: { title: 'Wallet Integration', description: 'Wallet connection, signing, session management' },
      7: { title: 'DeFi/NFT Features', description: 'Token integration, marketplace, DeFi protocols' },
      9: { title: 'Web3 Production', description: 'Gas optimization, monitoring, governance' },
    },
    default: {
      1: { title: 'Architecture Planning', description: 'Tech stack, project structure, integration points' },
      3: { title: 'Feature Planning', description: 'Core features breakdown, dependencies, priorities' },
      5: { title: 'Implementation Planning', description: 'Code organization, patterns, testing approach' },
      7: { title: 'Integration Planning', description: 'API integrations, external services, data flow' },
      9: { title: 'Deployment Planning', description: 'CI/CD, monitoring, scaling, operations' },
    },
  };

  const chainMap = phaseMapping[chain] || phaseMapping.default;
  return chainMap[phase] || { title: 'General Planning', description: 'General planning for this phase' };
}

// ============================================================================
// Super Mode Phase Generation
// ============================================================================

/**
 * Generate all phases for super mode execution
 * Creates 150 phases: 10 chains × 15 phases (10 implement + 5 plan)
 */
export function generateSuperModePhases(
  config: SuperModeConfig = DEFAULT_SUPER_MODE_CONFIG,
  customChainOrder?: MetaPromptChain[]
): SuperModePhase[] {
  const phases: SuperModePhase[] = [];
  const chainOrder = customChainOrder || DEFAULT_CHAIN_ORDER;
  
  // Filter to only include configured chains
  const activeChains = chainOrder.filter(chain => config.chains.includes(chain));
  const totalChains = activeChains.length;
  const totalPhasesPerChain = config.roundsPerChain + config.planningRoundsPerChain;
  
  let globalPhaseNumber = 0;
  
  for (let chainIndex = 0; chainIndex < activeChains.length; chainIndex++) {
    const chain = activeChains[chainIndex];
    const chainPrompts = META_PROMPT_CHAINS[chain];
    
    // Generate phases for this chain
    for (let phaseInChain = 1; phaseInChain <= config.roundsPerChain; phaseInChain++) {
      globalPhaseNumber++;
      
      // Implementation phase
      phases.push({
        phase: globalPhaseNumber,
        chain,
        type: 'implement',
        metaPromptId: `super-${chain}-${phaseInChain}`,
        title: `${getChainDisplayName(chain)} - ${getPhaseTitle(chain, phaseInChain)}`,
      });
      
      // Planning phase after implementation (at 1.5, 3.5, 5.5, 7.5, 9.5)
      if (phaseInChain < config.roundsPerChain && config.enablePlanning) {
        const planningPhase = phaseInChain; // 1->1.5, 3->3.5, etc.
        
        phases.push({
          phase: globalPhaseNumber + 0.5,
          chain,
          type: 'plan',
          planningPrompt: `Planning checkpoint after ${phaseInChain} of ${config.roundsPerChain} for ${chain} chain`,
          title: `${getChainDisplayName(chain)} - Planning: ${getPlanningFocusForPhase(chain, phaseInChain).title}`,
        });
      }
    }
  }
  
  return phases;
}

/**
 * Get human-readable chain display name
 */
function getChainDisplayName(chain: MetaPromptChain): string {
  const names: Record<MetaPromptChain, string> = {
    default: 'Full-Stack',
    frontend: 'Frontend',
    ml_ai: 'ML/AI',
    backend: 'Backend',
    mobile: 'Mobile',
    security: 'Security',
    devops: 'DevOps',
    data: 'Data',
    api: 'API',
    system: 'System',
    web3: 'Web3',
  };
  return names[chain] || chain;
}

/**
 * Get the title for an implementation phase
 */
function getPhaseTitle(chain: MetaPromptChain, phase: number): string {
  const chainPrompts = META_PROMPT_CHAINS[chain];
  if (!chainPrompts) return `Phase ${phase}`;
  
  const prompt = chainPrompts.find(p => p.targetRound === phase);
  return prompt?.title || `Phase ${phase}`;
}

// ============================================================================
// Planning Prompt Injection
// ============================================================================

/**
 * Get the planning prompt for a specific checkpoint
 * This is called when executing a planning phase
 */
export function getPlanningPromptForCheckpoint(
  chain: MetaPromptChain,
  checkpointPhase: number,
  totalPhases: number,
  originalRequest: string,
  previousOutput: string,
  depth: 'brief' | 'detailed' | 'comprehensive' = 'detailed'
): string {
  // Convert checkpointPhase (1.5, 3.5, etc.) to planning phase (1, 3, etc.)
  const phase = Math.ceil(checkpointPhase);
  
  return generatePlanningPrompt(
    chain,
    phase,
    totalPhases,
    originalRequest,
    previousOutput,
    depth
  );
}

// ============================================================================
// Context Building
// ============================================================================

/**
 * Build the layered context for a super mode phase
 * Combines: original request + chain plan (if available) + meta-prompt
 */
export interface LayeredContext {
  originalRequest: string;
  chainPlan: string | null;
  metaPrompt: string;
  previousPhaseOutput: string;
}

export function buildLayeredContext(
  phase: SuperModePhase,
  state: {
    originalRequest: string;
    chainPlans: Record<MetaPromptChain, string>;
    accumulatedOutput: string;
    config: SuperModeConfig;
  }
): LayeredContext {
  const { originalRequest, chainPlans, accumulatedOutput, config } = state;
  
  // Get chain plan if available
  const chainPlan = phase.type === 'implement' && chainPlans[phase.chain]
    ? chainPlans[phase.chain]
    : null;
  
  // Get meta-prompt for implementation phases
  let metaPrompt = '';
  if (phase.type === 'implement' && phase.metaPromptId) {
    const chainPrompts = META_PROMPT_CHAINS[phase.chain];
    const roundNum = parseInt(phase.metaPromptId.split('-').pop() || '1');
    const prompt = chainPrompts?.find(p => p.targetRound === roundNum);
    metaPrompt = prompt?.content || '';
  }
  
  return {
    originalRequest,
    chainPlan,
    metaPrompt,
    previousPhaseOutput: accumulatedOutput,
  };
}

// ============================================================================
// Super Mode Execution Summary
// ============================================================================

/**
 * Get a summary of the super mode execution structure
 */
export function getSuperModeSummary(config: SuperModeConfig = DEFAULT_SUPER_MODE_CONFIG): {
  totalPhases: number;
  totalChains: number;
  implementationPhases: number;
  planningPhases: number;
  estimatedRounds: number;
  chainOrder: string[];
} {
  const totalChains = config.chains.length;
  const implementationPhases = totalChains * config.roundsPerChain;
  const planningPhases = config.enablePlanning 
    ? totalChains * config.planningRoundsPerChain 
    : 0;
  
  return {
    totalPhases: implementationPhases + planningPhases,
    totalChains,
    implementationPhases,
    planningPhases,
    estimatedRounds: implementationPhases + planningPhases, // Each phase is essentially a round
    chainOrder: DEFAULT_CHAIN_ORDER.filter(c => config.chains.includes(c)),
  };
}

// ============================================================================
// Integration with Maximalist Config
// ============================================================================

/**
 * Check if super mode should be enabled based on request characteristics
 */
export function shouldEnableSuperMode(request: string): boolean {
  const lower = request.toLowerCase();
  
  // Super mode indicators - extremely comprehensive requests
  const superModeIndicators = [
    'comprehensive',
    'complete system',
    'full implementation',
    'end-to-end',
    'production ready',
    'enterprise',
    'full-stack',
    'multi-layer',
    'complete overhaul',
    'entire application',
    'from scratch',
    'soup to nuts',
    'a to z',
    'ground up',
    'complete solution',
  ];
  
  const indicatorCount = superModeIndicators.filter(ind => lower.includes(ind)).length;
  
  // Also check request length - very long requests suggest comprehensive needs
  if (request.length > 1000) return true;
  
  // Multiple domain mentions suggest multi-chain needs
  const domainMentions = [
    lower.includes('frontend'),
    lower.includes('backend'),
    lower.includes('database'),
    lower.includes('api'),
    lower.includes('security'),
    lower.includes('devops'),
    lower.includes('mobile'),
    lower.includes('ai'),
    lower.includes('ml '),
    lower.includes('web3'),
  ].filter(Boolean).length;
  
  if (domainMentions >= 4) return true;
  
  // High indicator count triggers super mode
  return indicatorCount >= 2;
}

/**
 * Get the effective super mode config based on request
 */
export function getEffectiveSuperModeConfig(
  request: string,
  userConfig?: Partial<SuperModeConfig>
): SuperModeConfig {
  const baseConfig = shouldEnableSuperMode(request)
    ? DEFAULT_SUPER_MODE_CONFIG
    : { ...DEFAULT_SUPER_MODE_CONFIG, enablePlanning: false, chains: ['default'] };
  
  return {
    ...baseConfig,
    ...userConfig,
  } as SuperModeConfig;
}

// ============================================================================
// Super Mode Execution State
// ============================================================================

export interface SuperModeState {
  traceId: string;
  originalRequest: string;
  config: SuperModeConfig;
  phases: SuperModePhase[];
  currentPhaseIndex: number;
  chainPlans: Partial<Record<MetaPromptChain, string>> & { __midpoint?: string };
  accumulatedOutput: string;
  completedPhases: Array<{
    phase: SuperModePhase;
    output: string;
    success: boolean;
    durationMs?: number;
    error?: string;
  }>;
  startTime: number;
  failedPhases: number;
  /** Track if budget warning has been emitted */
  budgetWarningEmitted?: boolean;
}

// ============================================================================
// Super Mode Execution Engine
// ============================================================================

/**
 * Execute the super mode enhancement
 * This is the main entry point that runs all phases sequentially
 */
export async function executeSuperMode(
  request: string,
  baseOutput: string,
  config?: Partial<SuperModeConfig>
): Promise<{
  finalOutput: string;
  state: SuperModeState;
  summary: {
    totalPhases: number;
    successfulPhases: number;
    chainsCompleted: number;
    traceId: string;
    totalDurationMs: number;
    phaseTimings: Array<{ phase: number; chain: string; type: string; durationMs: number; success: boolean }>;
  };
}> {
  const effectiveConfig = {
    ...DEFAULT_SUPER_MODE_CONFIG,
    ...config,
  };

  // Generate or use provided trace ID
  const traceId = effectiveConfig.traceId || generateTraceId();
  const progressCallback = effectiveConfig.onProgress;
  
  logger.info('Starting Super Mode execution', {
    traceId,
    chains: effectiveConfig.chains.length,
    enablePlanning: effectiveConfig.enablePlanning,
    planningDepth: effectiveConfig.planningDepth,
    maxPhases: effectiveConfig.maxPhases,
    timeBudgetMs: effectiveConfig.timeBudgetMs,
  });
  
  // Generate all phases
  const phases = generateSuperModePhases(effectiveConfig);
  
  logger.info('Super Mode phases generated', { totalPhases: phases.length });
  
  // Initialize state with trace ID
  const state: SuperModeState = {
    traceId,
    originalRequest: request,
    config: effectiveConfig,
    phases,
    currentPhaseIndex: 0,
    chainPlans: {} as Record<MetaPromptChain, string>,
    accumulatedOutput: baseOutput,
    completedPhases: [],
    startTime: Date.now(),
    failedPhases: 0,
  };
  
  const executionStartTime = Date.now();
  
  // Emit initial trace event
  emitTraceEvent(
    traceId,
    'phase_start',
    1,
    phases[0]?.chain,
    0,
    undefined,
    undefined,
    { totalPhases: phases.length, chains: effectiveConfig.chains },
    progressCallback,
    1,
    phases.length,
    phases[0]?.chain || '',
    phases[0]?.type || 'implement',
    0,
    [],
    0
  );
  
  // Execute each phase sequentially (respecting budget limits)
  for (let i = 0; i < phases.length; i++) {
    const phase = phases[i];
    
    // Check time budget
    const elapsedMs = Date.now() - executionStartTime;
    const remainingBudget = effectiveConfig.timeBudgetMs - elapsedMs;
    
    if (remainingBudget <= 0) {
      logger.warn('Time budget exceeded, stopping execution', {
        traceId,
        elapsed: elapsedMs,
        budget: effectiveConfig.timeBudgetMs,
        phasesExecuted: i,
      });
      
      // Emit budget warning event
      emitTraceEvent(
        traceId,
        'budget_warning',
        i + 1,
        phase?.chain,
        ((i + 1) / phases.length) * 100,
        elapsedMs,
        'Time budget exceeded',
        { phasesExecuted: i, budgetMs: effectiveConfig.timeBudgetMs },
        progressCallback,
        i + 1,
        phases.length,
        phase?.chain || '',
        phase?.type || 'implement',
        elapsedMs,
        Array.from(new Set(state.completedPhases.map(p => p.phase.chain))),
        state.failedPhases
      );
      break;
    }
    
    // Warn when approaching budget limit (10% remaining) - only once
    if (remainingBudget < effectiveConfig.timeBudgetMs * 0.1 && !state.budgetWarningEmitted) {
      logger.warn('Approaching time budget limit', {
        traceId,
        remainingMs: remainingBudget,
        budgetMs: effectiveConfig.timeBudgetMs,
        phasesExecuted: i,
        totalPhases: phases.length,
      });
      state.budgetWarningEmitted = true;
    }
    
    // Check phase budget
    if (i >= effectiveConfig.maxPhases) {
      logger.warn('Max phases exceeded, stopping execution', {
        traceId,
        phasesExecuted: i,
        max: effectiveConfig.maxPhases,
      });
      
      // Emit budget warning event
      emitTraceEvent(
        traceId,
        'budget_warning',
        i + 1,
        phase?.chain,
        100,
        elapsedMs,
        'Max phases exceeded',
        { phasesExecuted: i, maxPhases: effectiveConfig.maxPhases },
        progressCallback,
        i,
        phases.length,
        phase?.chain || '',
        phase?.type || 'implement',
        elapsedMs,
        Array.from(new Set(state.completedPhases.map(p => p.phase.chain))),
        state.failedPhases
      );
      break;
    }
    
    state.currentPhaseIndex = i;
    
    // Mid-point plan regeneration (at ~half way through total phases)
    const midPoint = Math.floor(phases.length / 2);
    if (effectiveConfig.enableMidPointRegen && i === midPoint && i > 0) {
      const midpointStartTime = Date.now();
      
      logger.info('Mid-point plan regeneration starting', {
        traceId,
        phase: i,
        total: phases.length,
        progressPercent: ((i + 1) / phases.length) * 100,
      });
      
      emitTraceEvent(
        traceId,
        'midpoint_start',
        i,
        undefined,
        ((i + 1) / phases.length) * 100,
        undefined,
        undefined,
        { midPointPhase: midPoint, totalPhases: phases.length },
        progressCallback,
        i + 1,
        phases.length,
        phase?.chain || '',
        phase?.type || 'implement',
        elapsedMs,
        Array.from(new Set(state.completedPhases.map(p => p.phase.chain))),
        state.failedPhases
      );
      
      // Generate consolidated plan from all accumulated work
      const consolidatedPlanPrompt = `
============================================
# MID-POINT PLAN REGENERATION
============================================

We are at the midpoint of super mode execution. Generate a consolidated technical plan
that builds upon all the work done so far and guides the remaining phases.

ORIGINAL REQUEST:
${state.originalRequest}

COMPLETED WORK SO FAR:
${state.accumulatedOutput.substring(0, 3000)}

CHAIN PLANS GENERATED:
${Object.entries(state.chainPlans).map(([chain, plan]) => 
  `## ${chain}:\n${plan.substring(0, 500)}...`).join('\n\n---NEXT CHAIN---\n\n')}

============================================
# REGENERATION TASK
============================================

Based on all the work completed:
1. Summarize what's been implemented so far
2. Identify gaps and areas that need more work
3. Create a refined plan for the remaining phases
4. Ensure all chains integrate properly

This plan will guide the remaining implementation phases.
`;
      
      const { enhancedLLMService } = await import('@/lib/chat/enhanced-llm-service');
      const regenResponse = await enhancedLLMService.generateResponse({
        provider: effectiveConfig.provider,
        model: effectiveConfig.model,
        messages: [
          { role: 'system', content: consolidatedPlanPrompt },
          { role: 'user', content: 'Generate the consolidated mid-point plan.' }
        ],
        maxTokens: 16000,
        temperature: 0.7,
        stream: false,
      });
      
      // Store the consolidated plan as a special entry
      state.chainPlans['__midpoint'] = regenResponse.content || '';
      const midpointDuration = Date.now() - midpointStartTime;
      
      logger.info('Mid-point regeneration complete', {
        traceId,
        planLength: regenResponse.content?.length || 0,
        durationMs: midpointDuration,
      });
      
      emitTraceEvent(
        traceId,
        'midpoint_complete',
        i,
        undefined,
        ((i + 1) / phases.length) * 100,
        midpointDuration,
        undefined,
        { planLength: regenResponse.content?.length || 0 },
        progressCallback,
        i + 1,
        phases.length,
        phase?.chain || '',
        phase?.type || 'implement',
        elapsedMs,
        Array.from(new Set(state.completedPhases.map(p => p.phase.chain))),
        state.failedPhases
      );
    }
    
    const phaseStartTime = Date.now();
    const progressPercent = ((i + 1) / phases.length) * 100;
    const elapsedMsNow = Date.now() - executionStartTime;
    
    logger.info(`Executing phase ${i + 1}/${phases.length}`, {
      traceId,
      chain: phase.chain,
      type: phase.type,
      title: phase.title,
      progressPercent: progressPercent.toFixed(1),
      elapsedMs: elapsedMsNow,
    });
    
    emitTraceEvent(
      traceId,
      phase.type === 'plan' ? 'planning_start' : 'phase_start',
      i + 1,
      phase.chain,
      progressPercent,
      undefined,
      undefined,
      { title: phase.title, phaseType: phase.type },
      progressCallback,
      i + 1,
      phases.length,
      phase.chain,
      phase.type,
      elapsedMsNow,
      Array.from(new Set(state.completedPhases.map(p => p.phase.chain))),
      state.failedPhases
    );
    
    try {
      let phaseOutput = '';
      
      if (phase.type === 'plan') {
        // Execute planning phase
        phaseOutput = await executePlanningPhase(
          phase,
          state,
          effectiveConfig.planningDepth
        );
        
        // Store the plan for this chain
        state.chainPlans[phase.chain] = phaseOutput;
        
      } else {
        // Execute implementation phase
        phaseOutput = await executeImplementationPhase(
          phase,
          state
        );
      }
      
      const phaseDurationMs = Date.now() - phaseStartTime;
      state.accumulatedOutput = phaseOutput;
      state.completedPhases.push({
        phase,
        output: phaseOutput,
        success: true,
        durationMs: phaseDurationMs,
      });
      
      const completedChainsNow = Array.from(new Set(state.completedPhases.filter(p => p.success).map(p => p.phase.chain)));
      
      logger.info(`Phase ${i + 1} complete`, {
        traceId,
        outputLength: phaseOutput.length,
        chainPlansCount: Object.keys(state.chainPlans).length,
        durationMs: phaseDurationMs,
        totalElapsedMs: Date.now() - executionStartTime,
      });
      
      emitTraceEvent(
        traceId,
        phase.type === 'plan' ? 'planning_complete' : 'phase_complete',
        i + 1,
        phase.chain,
        progressPercent,
        phaseDurationMs,
        undefined,
        { outputLength: phaseOutput.length, chainPlansCount: Object.keys(state.chainPlans).length },
        progressCallback,
        i + 1,
        phases.length,
        phase.chain,
        phase.type,
        Date.now() - executionStartTime,
        completedChainsNow,
        state.failedPhases
      );
      
    } catch (error: any) {
      const phaseDurationMs = Date.now() - phaseStartTime;
      state.failedPhases++;
      
      logger.error(`Phase ${i + 1} failed`, {
        traceId,
        error: error.message,
        chain: phase.chain,
        type: phase.type,
        durationMs: phaseDurationMs,
      });
      
      // Emit phase_error for failed phases
      emitTraceEvent(
        traceId,
        'phase_error',
        i + 1,
        phase.chain,
        progressPercent,
        phaseDurationMs,
        error.message,
        { phaseType: phase.type, title: phase.title },
        progressCallback,
        i + 1,
        phases.length,
        phase.chain,
        phase.type,
        Date.now() - executionStartTime,
        Array.from(new Set(state.completedPhases.map(p => p.phase.chain))),
        state.failedPhases
      );
      
      state.completedPhases.push({
        phase,
        output: state.accumulatedOutput,
        success: false,
        durationMs: phaseDurationMs,
        error: error.message,
      });
      // Continue with next phase
    }
  }
  
  // Calculate summary
  const uniqueChainsCompleted = new Set(
    state.completedPhases.filter(p => p.success).map(p => p.phase.chain)
  ).size;
  
  const totalDurationMs = Date.now() - executionStartTime;
  // Calculate estimated remaining time
  const progressPercent = state.completedPhases.length / phases.length;
  const estimatedRemainingMs = progressPercent > 0 
    ? (totalDurationMs / progressPercent) * (1 - progressPercent)
    : undefined;
  
  const summary = {
    totalPhases: phases.length,
    successfulPhases: state.completedPhases.filter(p => p.success).length,
    chainsCompleted: uniqueChainsCompleted,
    traceId,
    totalDurationMs,
    estimatedRemainingMs,
    phaseTimings: state.completedPhases.map(p => ({
      phase: p.phase.phase,
      chain: p.phase.chain,
      type: p.phase.type as 'plan' | 'implement',
      durationMs: p.durationMs || 0,
      success: p.success,
    })),
  };
  
  logger.info('Super Mode execution complete', {
    traceId,
    totalPhases: summary.totalPhases,
    successfulPhases: summary.successfulPhases,
    chainsCompleted: summary.chainsCompleted,
    totalDurationMs,
    failedPhases: state.failedPhases,
  });
  
  // Emit completion event
  emitTraceEvent(
    traceId,
    'complete',
    state.completedPhases.length,
    undefined,
    100,
    totalDurationMs,
    undefined,
    {
      totalPhases: summary.totalPhases,
      successfulPhases: summary.successfulPhases,
      chainsCompleted: summary.chainsCompleted,
      failedPhases: state.failedPhases,
    },
    progressCallback,
    state.completedPhases.length,
    phases.length,
    '',
    'implement',
    totalDurationMs,
    Array.from(state.completedPhases.filter(p => p.success).map(p => p.phase.chain)),
    state.failedPhases
  );
  
  return {
    finalOutput: state.accumulatedOutput,
    state,
    summary,
  };
}

/**
 * Execute a planning phase
 */
async function executePlanningPhase(
  phase: SuperModePhase,
  state: SuperModeState,
  depth: 'brief' | 'detailed' | 'comprehensive'
): Promise<string> {
  const planningPrompt = getPlanningPromptForCheckpoint(
    phase.chain,
    phase.phase,
    state.phases.length,
    state.originalRequest,
    state.accumulatedOutput,
    depth
  );
  
  const { enhancedLLMService } = await import('@/lib/chat/enhanced-llm-service');
  
  const response = await enhancedLLMService.generateResponse({
    provider: state.config.provider,
    model: state.config.model,
    messages: [
      { role: 'system', content: planningPrompt },
      { role: 'user', content: `Generate the technical plan for the ${phase.chain} layer.` }
    ],
    maxTokens: 16000,
    temperature: 0.7,
    stream: false,
  });
  
  return response.content || '';
}

/**
 * Execute an implementation phase
 */
async function executeImplementationPhase(
  phase: SuperModePhase,
  state: SuperModeState
): Promise<string> {
  // Build layered context
  const context = buildLayeredContext(phase, {
    originalRequest: state.originalRequest,
    chainPlans: state.chainPlans as Record<MetaPromptChain, string>,
    accumulatedOutput: state.accumulatedOutput,
    config: state.config,
  });
  
  // Get the meta-prompt for this round
  const chainPrompts = META_PROMPT_CHAINS[phase.chain];
  const roundNum = parseInt(phase.metaPromptId?.split('-').pop() || '1');
  const metaPrompt = chainPrompts?.find(p => p.targetRound === roundNum);
  
  // Build implementation prompt with layered context
  const implementationPrompt = `
${context.metaPrompt}

============================================
# TECHNICAL PLAN (from planning phase)
============================================

${context.chainPlan || 'No specific plan - proceed with best practices'}

============================================
# ORIGINAL REQUEST
============================================

${context.originalRequest}

============================================
# CURRENT IMPLEMENTATION
============================================

${context.previousPhaseOutput.substring(0, 4000)}${context.previousPhaseOutput.length > 4000 ? '\n...[truncated]...' : ''}

============================================
# IMPLEMENTATION TASK
============================================

Task: ${phase.title}

Build upon the existing implementation and the technical plan.
- Add new functionality for the ${phase.chain} layer
- Ensure integration with other layers where applicable
- Make it production-ready

Return the complete, enhanced implementation.
`;
  
  const { enhancedLLMService } = await import('@/lib/chat/enhanced-llm-service');
  
  const response = await enhancedLLMService.generateResponse({
    provider: state.config.provider,
    model: state.config.model,
    messages: [
      { role: 'system', content: implementationPrompt },
      { role: 'user', content: 'Implement the enhancement for this phase.' }
    ],
    maxTokens: 32000,
    temperature: 0.7,
    stream: false,
  });
  
  return response.content || state.accumulatedOutput;
}