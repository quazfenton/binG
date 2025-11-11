/**
 * Configuration management with KV storage and runtime overrides
 */

export const DEFAULT_CONFIG = {
  // Orchestration
  orchestration: {
    parallelConcurrency: 3,
    maxIterations: 3,
    iterationStrategy: 'feedback', // feedback, escalate, parallel
    enableReflectCritic: true,
    threadMemorySplit: false,
  },
  
  // Quality
  quality: {
    threshold: 0.85,
    passThreshold: 0.85,
    escalateThreshold: 0.6,
    abortThreshold: 0.3,
    scoringMethod: 'n8n-test', // n8n-test, lint, heuristic
    scoreWeights: {
      correctness: 0.4,
      performance: 0.3,
      style: 0.3,
    },
  },
  
  // Testing
  testing: {
    quickTestTimeout: 5000,
    fullTestTimeout: 60000,
    testRetries: 2,
    enableQuickTests: true,
    enableFullTests: false,
  },
  
  // Agents
  agents: {
    draft: { model: 'fast-small', temperature: 0.7 },
    polish: { model: 'fast-precise', temperature: 0.3 },
    critic: { model: 'fast-medium', temperature: 0.5 },
    creative: { model: 'fast-medium', temperature: 0.9 },
  },
  
  // Caching
  caching: {
    enabled: true,
    ttl: 86400, // 24 hours
    keyStrategy: 'prompt-hash',
  },
  
  // Budget
  budget: {
    maxTokensPerRequest: 4000,
    enableSummarization: true,
    summarizationThreshold: 3000,
  },
  
  // UX
  ux: {
    streamingEnabled: true,
    streamChunkDelay: 50,
    placeholderRotation: 3000,
    showDetailedProgress: true,
    progressUpdateInterval: 1000,
  },
  
  // Parallel variants
  variants: [
    { name: 'default', modifier: '', agentConfig: 'draft' },
    { name: 'creative', modifier: 'Be creative and innovative. Think outside the box.', agentConfig: 'creative' },
    { name: 'robust', modifier: 'Focus on correctness, edge cases, and defensive programming.', agentConfig: 'draft' },
    { name: 'efficient', modifier: 'Optimize for performance and resource efficiency.', agentConfig: 'draft' },
  ],
};

export const PLACEHOLDER_MESSAGES = [
  'Thinking deeply about your request...',
  'Exploring different approaches...',
  'Running quality checks...',
  'Refining the solution...',
  'Applying best practices...',
  'Testing edge cases...',
  'Optimizing the output...',
  'Polishing the final result...',
  'Almost there...',
  'Finalizing...',
];

/**
 * Load configuration from KV with defaults
 */
export async function loadConfig(env, overrides = {}) {
  let kvConfig = {};
  
  if (env.CONFIG_KV) {
    try {
      const stored = await env.CONFIG_KV.get('orchestration-config');
      if (stored) {
        kvConfig = JSON.parse(stored);
      }
    } catch (e) {
      console.warn('Failed to load config from KV:', e);
    }
  }
  
  // Merge: defaults <- KV <- overrides
  return deepMerge(DEFAULT_CONFIG, kvConfig, overrides);
}

/**
 * Save configuration to KV
 */
export async function saveConfig(env, config) {
  if (!env.CONFIG_KV) return false;
  
  try {
    await env.CONFIG_KV.put(
      'orchestration-config',
      JSON.stringify(config)
    );
    return true;
  } catch (e) {
    console.error('Failed to save config to KV:', e);
    return false;
  }
}

/**
 * Deep merge objects
 */
function deepMerge(...objects) {
  const result = {};
  
  for (const obj of objects) {
    for (const key in obj) {
      if (obj[key] && typeof obj[key] === 'object' && !Array.isArray(obj[key])) {
        result[key] = deepMerge(result[key] || {}, obj[key]);
      } else {
        result[key] = obj[key];
      }
    }
  }
  
  return result;
}

/**
 * Select experiment variant using deterministic hashing
 */
export function selectExperimentVariant(userId, experimentName, experiments) {
  if (!experiments || !experiments[experimentName]) {
    return null;
  }
  
  const experiment = experiments[experimentName];
  const { variants, allocation } = experiment;
  
  // Hash user ID + experiment name for deterministic selection
  const hash = hashCode(`${userId}-${experimentName}`);
  const normalized = Math.abs(hash) / 2147483647; // Normalize to 0-1
  
  // Select based on allocation percentages
  let cumulative = 0;
  for (let i = 0; i < variants.length; i++) {
    cumulative += allocation[i];
    if (normalized < cumulative) {
      return variants[i];
    }
  }
  
  return variants[variants.length - 1];
}

function hashCode(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return hash;
}
