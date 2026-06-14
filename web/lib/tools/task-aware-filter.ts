/**
 * Task-Aware Tool Capability Filter
 *
 * Classifies the user's task and recommends/ranks tool capabilities
 * that are relevant to the current task. Non-relevant capabilities can
 * be hidden or de-prioritized to reduce LLM distraction and token usage.
 *
 * Each task category maps to a set of recommended capabilities, a set of
 * capabilities to DEPRIORITIZE (hide from the top of the prompt), and
 * optional environment recommendations (e.g. "create a sandbox").
 */
import { ALL_CAPABILITIES } from './capabilities';

export type TaskCategory =
  | 'file_edit'       // Writing/editing code files
  | 'code_read'       // Reading and reviewing code
  | 'code_search'     // Searching codebase
  | 'shell_execute'   // Running shell commands, scripts
  | 'dev_server'      // Running dev servers, previews
  | 'package_mgmt'    // Installing packages, dependencies
  | 'web_browse'      // Web browsing, fetching
  | 'git_ops'         // Git operations
  | 'docker_ops'      // Docker/podman operations
  | 'debug'           // Debugging, error tracing
  | 'general_chat'    // General conversation, no special tools needed
  | 'test_run'        // Running tests
  | 'build'           // Building/compiling code
  | 'unknown';        // Could not determine

export interface TaskProfile {
  category: TaskCategory;
  /** Recommended capability IDs for this task */
  recommendedCapabilities: string[];
  /** Capability IDs to deprioritize (send to end of prompt) */
  deprioritizedCapabilities: string[];
  /**
   * Whether to recommend sandbox environment
   * false = no sandbox needed; null = use default
   */
  recommendSandbox: boolean | null;
  /**
   * Human-readable suggestion to inject into system prompt
   * e.g. "For running dev servers, use a sandbox environment."
   */
  systemPromptHint: string;
}

const TASK_PATTERNS: Array<{
  category: TaskCategory;
  patterns: RegExp[];
  profile: Omit<TaskProfile, 'category'>;
}> = [
  {
    category: 'dev_server',
    patterns: [
      /serve|preview|http\.server|live[- ]?reload/i,
      /start\s+(a|the|my)?\s*(dev|development|local)\s+server/i,
      /run\s+(a|the|my)?\s*(app|application|website|site)/i,
      /view\s+(a|the|my)?\s*(app|page|website)/i,
      /port\s+\d+/i,
    ],
    profile: {
      recommendedCapabilities: ['bash.execute', 'sandbox.execute', 'sandbox.create', 'file.read', 'file.write', 'file.list'],
      deprioritizedCapabilities: ['web.search', 'memory.store', 'memory.retrieve', 'automation.discord', 'desktop.screenshot'],
      recommendSandbox: true,
      systemPromptHint: 'To serve/preview your app, the sandbox environment has the necessary runtimes and port forwarding. Use bash_execute inside the sandbox.',
    },
  },
  {
    category: 'shell_execute',
    patterns: [
      /^(run|execute|bash|shell|terminal|command)/i,
      /run\s+(a|this|the|that)\s+(command|script|bash)/i,
      /install\s+(package|dependency|module|tool)/i,
      /setup|configure|initialize/i,
      /execute\s+this/i,
    ],
    profile: {
      recommendedCapabilities: ['bash.execute', 'sandbox.execute', 'sandbox.create', 'file.read', 'file.write'],
      deprioritizedCapabilities: ['web.search', 'memory.store', 'automation.discord'],
      recommendSandbox: true,
      systemPromptHint: 'For running commands, the sandbox provides a full execution environment with all necessary runtimes.',
    },
  },
  {
    category: 'file_edit',
    patterns: [
      /create\s+(a|the|this|new)?\s*file/i,
      /write\s+(a|the|this)?\s*(code|file|script|function|component)/i,
      /edit|update|modify|change|fix|refactor|rewrite/i,
      /add\s+(a|the|this|new)?\s*(feature|function|method|component|route)/i,
      /implement|code\s+up|build\s+(a|the|this)/i,
      /\b(fix|patch|bug)\b.*\b(code|error|issue|crash|bug)\b/i,
    ],
    profile: {
      recommendedCapabilities: ['file.read', 'file.write', 'file.str_replace', 'file.batch_write', 'file.list', 'repo.search', 'bash.execute'],
      deprioritizedCapabilities: ['web.search', 'web.browse', 'automation.discord', 'desktop.screenshot', 'memory.store'],
      recommendSandbox: null,
      systemPromptHint: '',
    },
  },
  {
    category: 'code_search',
    patterns: [
      /find\s+(the|where|all|which)/i,
      /search\s+(for|the|code|file|function|class|method)/i,
      /look\s+(for|up|at|into)/i,
      /where\s+(is|are|does|do)/i,
      /show\s+(me|the)\s+(code|file|function|class)/i,
    ],
    profile: {
      recommendedCapabilities: ['repo.search', 'file.read', 'file.list', 'file.grep'],
      deprioritizedCapabilities: ['file.write', 'file.batch_write', 'bash.execute', 'sandbox.execute', 'web.search', 'web.browse'],
      recommendSandbox: null,
      systemPromptHint: '',
    },
  },
  {
    category: 'package_mgmt',
    patterns: [
      /install\s+(package|dependency|librar|module|npm|pip|gem)/i,
      /\b(npm|pnpm|yarn|pip|pip3|poetry|cargo|go)\s+(install|add|init)\b/i,
      /add\s+(package|dependency)/i,
      /update\s+(package|dependency)/i,
    ],
    profile: {
      recommendedCapabilities: ['bash.execute', 'sandbox.execute', 'sandbox.create', 'file.read', 'file.write'],
      deprioritizedCapabilities: ['web.search', 'web.browse', 'automation.discord', 'memory.retrieve'],
      recommendSandbox: true,
      systemPromptHint: 'Package installation requires internet access. The sandbox environment has network access and the necessary package managers.',
    },
  },
  {
    category: 'test_run',
    patterns: [
      /run\s+(the\s+)?tests?/i,
      /execute\s+(the\s+)?tests?/i,
      /\b(pytest|vitest|jest|mocha|cypress|playwright|rspec|minitest|go\s+test|cargo\s+test)\b/i,
      /test\s+(suite|runner|coverage)/i,
    ],
    profile: {
      recommendedCapabilities: ['bash.execute', 'sandbox.execute', 'sandbox.create', 'file.read', 'file.list', 'repo.search'],
      deprioritizedCapabilities: ['web.search', 'web.browse', 'automation.discord', 'desktop.screenshot'],
      recommendSandbox: true,
      systemPromptHint: 'Tests run in the sandbox environment which has all necessary runtimes installed.',
    },
  },
  {
    category: 'build',
    patterns: [
      /build\s+(the\s+)?(project|app|code|binary|artifact)/i,
      /compile\s+(the\s+)?(code|project|app)/i,
      /\b(tsc|webpack|esbuild|rollup|vite\s+build|next\s+build)\b/i,
      /transpile|bundle|pack/i,
    ],
    profile: {
      recommendedCapabilities: ['bash.execute', 'sandbox.execute', 'sandbox.create', 'file.read', 'file.write', 'file.list'],
      deprioritizedCapabilities: ['web.search', 'web.browse', 'automation.discord', 'memory.store', 'memory.retrieve'],
      recommendSandbox: true,
      systemPromptHint: 'Building requires build tools. The sandbox environment has compilers and build tools available.',
    },
  },
  {
    category: 'debug',
    patterns: [
      /\b(debug|debugging)\b/i,
      /fix\s+(this|the|a|that)\s+(error|bug|issue|crash|problem)/i,
      /why\s+(is|does|are|did|won)/i,
      /traceback|stack\s+trace|error\s+log|exception/i,
      /something\s+(is\s+)?(broken|wrong|not\s+working|failing)/i,
    ],
    profile: {
      recommendedCapabilities: ['file.read', 'file.write', 'file.str_replace', 'repo.search', 'bash.execute', 'sandbox.execute', 'file.list'],
      deprioritizedCapabilities: ['web.search', 'web.browse', 'automation.discord', 'memory.store', 'desktop.screenshot'],
      recommendSandbox: null,
      systemPromptHint: '',
    },
  },
  {
    category: 'web_browse',
    patterns: [
      /browse|fetch|scrape|crawl/i,
      /go\s+to\s+(a|the|this)\s+(website|url|link|page)/i,
      /open\s+(a|the|this)\s+(url|link|website)/i,
      /search\s+(the\s+)?(web|internet|google|duckduckgo)/i,
      /what\s+(is|are|can|does)\b.*\bon\s+(the\s+)?(web|internet)/i,
    ],
    profile: {
      recommendedCapabilities: ['web.search', 'web.browse', 'web.fetch'],
      deprioritizedCapabilities: ['bash.execute', 'sandbox.execute', 'file.write', 'file.batch_write', 'file.str_replace'],
      recommendSandbox: null,
      systemPromptHint: '',
    },
  },
  {
    category: 'git_ops',
    patterns: [
      /\b(git|commit|push|pull|branch|merge|rebase|clone|checkout|stash)\b/,
      /git\s+(status|log|diff|add|reset)/i,
    ],
    profile: {
      recommendedCapabilities: ['bash.execute', 'file.read', 'file.list', 'file.write'],
      deprioritizedCapabilities: ['web.search', 'web.browse', 'automation.discord', 'sandbox.execute'],
      recommendSandbox: null,
      systemPromptHint: '',
    },
  },
  {
    category: 'docker_ops',
    patterns: [
      /\b(docker|podman)\s+(run|compose|build|exec|ps|logs|pull|push)\b/,
      /container|image|compose/i,
    ],
    profile: {
      recommendedCapabilities: ['bash.execute', 'sandbox.execute', 'sandbox.create'],
      deprioritizedCapabilities: ['web.search', 'web.browse', 'automation.discord', 'memory.store', 'repo.search'],
      recommendSandbox: true,
      systemPromptHint: 'Docker commands require a sandbox environment with Docker installed.',
    },
  },
];

/**
 * Classify a user task string into a TaskProfile with recommended
 * and deprioritized tool capabilities.
 */
export function classifyTask(task: string): TaskProfile {
  if (!task || task.trim().length === 0) {
    return {
      category: 'unknown',
      recommendedCapabilities: [],
      deprioritizedCapabilities: [],
      recommendSandbox: null,
      systemPromptHint: '',
    };
  }

  // Score each category by number of matching patterns
  let bestCategory: TaskCategory = 'unknown';
  let bestScore = 0;
  let bestProfile: Omit<TaskProfile, 'category'> | null = null;

  for (const entry of TASK_PATTERNS) {
    let score = 0;
    for (const re of entry.patterns) {
      if (re.test(task)) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      bestCategory = entry.category;
      bestProfile = entry.profile;
    }
  }

  if (!bestProfile) {
    return {
      category: 'general_chat',
      recommendedCapabilities: [],
      deprioritizedCapabilities: [],
      recommendSandbox: null,
      systemPromptHint: '',
    };
  }

  return {
    category: bestCategory,
    ...bestProfile,
  };
}

/**
 * Build a system-prompt fragment that tells the LLM which capabilities
 * are recommended for this task. Empty string when no recommendations.
 */
export function buildToolRecommendation(task: string): string {
  const profile = classifyTask(task);
  if (profile.category === 'unknown' || profile.category === 'general_chat') {
    return '';
  }

  const lines: string[] = [];
  if (profile.systemPromptHint) {
    lines.push(profile.systemPromptHint);
  }
  if (profile.recommendedCapabilities.length > 0) {
    lines.push('Recommended tools for this task:');
    for (const cap of profile.recommendedCapabilities) {
      const def = ALL_CAPABILITIES.find((c) => c.id === cap);
      if (def) {
        lines.push(`  - ${cap}: ${def.description.split('.')[0]}`);
      } else {
        lines.push(`  - ${cap}`);
      }
    }
  }
  if (profile.recommendSandbox) {
    lines.push('This task benefits from a sandbox execution environment. If bash commands fail, a sandbox session will be auto-created.');
  }
  return lines.join('\n');
}

/**
 * Get capability IDs that should be DEPRIORITIZED (hidden) for a task.
 * Returns an empty array when no capabilities should be hidden.
 */
export function getDeprioritizedCapabilities(task: string): string[] {
  const profile = classifyTask(task);
  return profile.deprioritizedCapabilities;
}

/**
 * Whether the task recommends sandbox creation.
 * Returns true when sandbox is strongly recommended.
 */
export function recommendsSandbox(task: string): boolean {
  const profile = classifyTask(task);
  return profile.recommendSandbox === true;
}
