/**
 * Prompt Composer — Structured, Dynamic System Prompts
 *
 * Decomposes monolithic role prompts (6500+ lines) into composable sections:
 *   - IDENTITY, DIRECTIVES, TOOL_STRATEGY, OUTPUT_FORMAT, ANTI_PATTERNS, EXAMPLES
 *
 * Features:
 * - Dynamic tool injection from ALL_CAPABILITIES (no hardcoded markdown)
 * - Auto-omits unavailable tools per role config
 * - A/B test individual sections by swapping templates
 * - Backwards compatible — existing constants still work
 *
 * Usage:
 * ```ts
 * import { composeRole, composeRoleWithTools, getRoleSections } from './prompt-composer';
 *
 * // 1. Get pre-parsed sections of an existing role
 * const coder = getRoleSections('coder');
 *
 * // 2. Compose with dynamic tool block (only tools available to this role)
 * const prompt = composeRoleWithTools('coder', {
 *   availableTools: ['file.read', 'file.write', 'repo.search'],
 * });
 *
 * // 3. Swap a single section for A/B testing
 * const promptV2 = composeRole('coder', {
 *   directives: getSectionTemplate('directives.v2'),
 * });
 * ```
 */

import { ALL_CAPABILITIES, type CapabilityDefinition } from '../../../web/lib/tools/capabilities';
import { SYSTEM_PROMPTS, type AgentRole } from './system-prompts';

// ============================================================================
// Types
// ============================================================================

export interface PromptSection {
  /** Unique section identifier (e.g., 'coder.identity', 'directives.v2') */
  id: string;
  /** Section content — can be a static string or a template function */
  template: string | ((ctx: PromptContext) => string);
  /** If this section references tools, list them here for availability filtering */
  requiredTools?: string[];
}

export interface RoleSections {
  identity: PromptSection;
  directives: PromptSection;
  toolStrategy: PromptSection;
  outputFormat?: PromptSection;
  antiPatterns?: PromptSection;
  examples?: PromptSection;
  /** Additional sections (powers, domain-specific, etc.) */
  extras?: PromptSection[];
}

export interface PromptContext {
  /** Available tool IDs for this role */
  availableTools: string[];
  /** Role name */
  roleName: string;
  /** Arbitrary extra context */
  [key: string]: unknown;
}

export interface ComposeRoleOptions {
  /** Override identity section */
  identity?: PromptSection | string;
  /** Override directives section */
  directives?: PromptSection | string;
  /** Override tool strategy section */
  toolStrategy?: PromptSection | string;
  /** Override output format section */
  outputFormat?: PromptSection | string;
  /** Override anti-patterns section */
  antiPatterns?: PromptSection | string;
  /** Override examples section */
  examples?: PromptSection | string;
  /** Extra sections to append */
  extras?: (PromptSection | string)[];
  /** Context passed to template functions */
  context?: Partial<PromptContext>;
  /** Separator between sections (default: 25 equals signs) */
  separator?: string;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_SEPARATOR = '\n\n=========================================\n\n';
const SECTION_SEPARATOR_PATTERN = /^={20,}$/m;

/** Category display names for tool block generation */
const CATEGORY_LABELS: Record<string, string> = {
  file: 'File Operations',
  sandbox: 'Sandbox Execution',
  web: 'Web Operations',
  repo: 'Repository Operations',
  memory: 'Memory & Context',
  automation: 'Automation',
};

// ============================================================================
// Section Registry — A/B test individual sections
// ============================================================================

const SECTION_TEMPLATES = new Map<string, PromptSection>();

/**
 * Register a section template for later use in composition.
 * Enables A/B testing by registering multiple versions of the same section.
 */
export function registerSection(section: PromptSection): void {
  SECTION_TEMPLATES.set(section.id, section);
}

/**
 * Get a registered section by ID.
 */
export function getSectionTemplate(id: string): PromptSection | undefined {
  return SECTION_TEMPLATES.get(id);
}

// ============================================================================
// Dynamic Tool Block Generation
// ============================================================================

export interface DynamicToolBlockOptions {
  /** Only include these tool IDs (omit all others). Empty = include all. */
  allowedTools?: string[];
  /** Explicitly exclude these tool IDs. */
  excludedTools?: string[];
  /** Include category headers (default: true) */
  showCategories?: boolean;
  /** Include metadata hints like latency/cost (default: false) */
  showMetadata?: boolean;
  /** Custom header text (default: 'AVAILABLE CAPABILITIES') */
  header?: string;
  /** Custom rules section (default: standard 5 rules) */
  rules?: string[];
  /** Additional text to append after the tool list */
  footer?: string;
}

/**
 * Generate a tool reference block dynamically from ALL_CAPABILITIES.
 * Replaces the hardcoded TOOL_CAPABILITIES string.
 */
export function generateDynamicToolBlock(options: DynamicToolBlockOptions = {}): string {
  const {
    allowedTools = [],
    excludedTools = [],
    showCategories = true,
    showMetadata = false,
    header = 'AVAILABLE CAPABILITIES',
    rules,
    footer,
  } = options;

  // Filter capabilities
  let caps = ALL_CAPABILITIES;
  if (allowedTools.length > 0) {
    caps = caps.filter(c => allowedTools.includes(c.id));
  }
  if (excludedTools.length > 0) {
    caps = caps.filter(c => !excludedTools.includes(c.id));
  }

  if (caps.length === 0) {
    return '';
  }

  const lines: string[] = [];
  lines.push('=============================================');
  lines.push(`# ${header}`);
  lines.push('=============================================');
  lines.push('');
  lines.push('You operate within a comprehensive tool system. Use the RIGHT tool at the RIGHT time:');
  lines.push('');

  // Group by category
  const byCategory = new Map<string, CapabilityDefinition[]>();
  for (const cap of caps) {
    const group = byCategory.get(cap.category) || [];
    group.push(cap);
    byCategory.set(cap.category, group);
  }

  // Render by category (preserve canonical order)
  const categoryOrder = ['file', 'sandbox', 'web', 'repo', 'memory', 'automation'];
  for (const cat of categoryOrder) {
    const group = byCategory.get(cat);
    if (!group || group.length === 0) continue;

    if (showCategories) {
      lines.push(`## ${CATEGORY_LABELS[cat] || cat}`);
    }

    for (const cap of group) {
      let entry = `- **${cap.id}** — ${cap.description}`;
      if (showMetadata && cap.metadata) {
        const hints: string[] = [];
        if (cap.metadata.latency) hints.push(`latency: ${cap.metadata.latency}`);
        if (cap.metadata.cost) hints.push(`cost: ${cap.metadata.cost}`);
        if (hints.length > 0) entry += ` [${hints.join(', ')}]`;
      }
      lines.push(entry);
    }

    lines.push('');
  }

  // Rules
  lines.push('## Rules');
  const defaultRules = [
    'Use the MOST SPECIFIC tool for the job (e.g., `web.fetch` before `web.browse`)',
    'Chain tools logically: search → read → analyze → write',
    'Check tool metadata before calling (latency, cost, reliability)',
    'Handle tool errors gracefully: retry, fallback, or report with context',
    'NEVER fabricate tool output — always call the actual tool',
  ];
  for (const rule of rules || defaultRules) {
    lines.push(`${rules ? '- ' : ''}${rule}`);
  }

  if (footer) {
    lines.push('');
    lines.push(footer);
  }

  return lines.join('\n');
}

/**
 * Generate a minimal tool hint list (inline, no categories) for roles
 * that only need tool awareness without full strategy instructions.
 */
export function generateToolHints(toolIds: string[]): string {
  const caps = ALL_CAPABILITIES.filter(c => toolIds.includes(c.id));
  if (caps.length === 0) return '';

  const entries = caps.map(c => `- **${c.id}** — ${c.description}`);
  return ['Available tools:', '', ...entries].join('\n');
}

// ============================================================================
// Parse Monolithic Prompts into Sections
// ============================================================================

/**
 * Split a monolithic role prompt into structured sections.
 * Uses the existing `={20,}` separator convention.
 *
 * Automatically detects section type from heading:
 *   `# IDENTITY`       → identity
 *   `# PRIME DIRECTIVES`, `# DIRECTIVES`, `# GUIDELINES` → directives
 *   `# TOOL STRATEGY`, `# TOOLS`, `# AVAILABLE CAPABILITIES` → toolStrategy
 *   `# OUTPUT FORMAT`, `# OUTPUT` → outputFormat
 *   `# ANTI-PATTERNS`, `# ANTI_PATTERNS`, `# WHAT NOT TO DO` → antiPatterns
 *   `# EXAMPLES`, `# FEW-SHOT` → examples
 */
export function parseSections(prompt: string): RoleSections | null {
  const parts = prompt.split(SECTION_SEPARATOR_PATTERN);
  if (parts.length < 2) return null;

  const sections: Partial<RoleSections> = {};
  const extras: PromptSection[] = [];

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i].trim();
    if (!part) continue;

    // Extract section type from first heading
    const headingMatch = part.match(/^#\s+(.+)$/m);
    if (!headingMatch) {
      // No heading — treat as extra
      extras.push({ id: `section.${i}`, template: part });
      continue;
    }

    const heading = headingMatch[1].trim().toUpperCase();
    const section = determineSectionType(heading, part);

    if (!section) {
      extras.push({ id: `section.${i}`, template: part });
      continue;
    }

    if (section.key === 'identity') sections.identity = section.promptSection;
    else if (section.key === 'directives') sections.directives = section.promptSection;
    else if (section.key === 'toolStrategy') sections.toolStrategy = section.promptSection;
    else if (section.key === 'outputFormat') sections.outputFormat = section.promptSection;
    else if (section.key === 'antiPatterns') sections.antiPatterns = section.promptSection;
    else if (section.key === 'examples') sections.examples = section.promptSection;
    else extras.push(section.promptSection);
  }

  if (!sections.identity || !sections.directives) return null;

  return {
    identity: sections.identity!,
    directives: sections.directives!,
    toolStrategy: sections.toolStrategy || { id: 'toolStrategy.default', template: '' },
    ...sections,
    extras: extras.length > 0 ? extras : undefined,
  };
}

function determineSectionType(
  heading: string,
  content: string
): { key: keyof RoleSections; promptSection: PromptSection } | null {
  const id = `section.${heading.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
  const section: PromptSection = { id, template: content };

  if (heading === 'IDENTITY') return { key: 'identity', promptSection: section };
  if (['PRIME DIRECTIVES', 'DIRECTIVES', 'GUIDELINES', 'CORE DIRECTIVES'].includes(heading)) return { key: 'directives', promptSection: section };
  if (['TOOL STRATEGY', 'TOOLS', 'AVAILABLE CAPABILITIES', 'CAPABILITIES', 'TOOL USAGE'].includes(heading)) {
    // Extract tool references from content for availability filtering
    const toolRefs = extractToolReferences(content);
    if (toolRefs.length > 0) section.requiredTools = toolRefs;
    return { key: 'toolStrategy', promptSection: section };
  }
  if (['OUTPUT FORMAT', 'OUTPUT', 'RESPONSE FORMAT'].includes(heading)) return { key: 'outputFormat', promptSection: section };
  if (['ANTI-PATTERNS', 'ANTI_PATTERNS', 'WHAT NOT TO DO', 'AVOID', 'ANTI-PATTERNS TO AVOID'].includes(heading)) return { key: 'antiPatterns', promptSection: section };
  if (['EXAMPLES', 'FEW-SHOT', 'FEW SHOT', 'INLINE EXAMPLES'].includes(heading)) return { key: 'examples', promptSection: section };

  return null;
}

/**
 * Extract tool IDs referenced in a section's content.
 * Looks for patterns like `file.read`, `web.search`, **file.write**, etc.
 */
function extractToolReferences(content: string): string[] {
  const tools = new Set<string>();

  // Pattern: `tool.name` or **tool.name** or tool.name (backtick/bold/plain)
  const patterns = [
    /[`*]{1,2}((?:file|sandbox|web|repo|memory|project|workspace|task|automation)\.[a-z0-9-]+)[`*]{1,2}/gi,
    /((?:file|sandbox|web|repo|memory|project|workspace|task|automation)\.[a-z0-9-]+)/gi,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      const id = match[1].toLowerCase();
      // Verify it's a real capability
      if (ALL_CAPABILITIES.some(c => c.id === id)) {
        tools.add(id);
      }
    }
  }

  return Array.from(tools);
}

// ============================================================================
// Section Cache — parsed once per role
// ============================================================================

const SECTION_CACHE = new Map<string, RoleSections | null>();

/**
 * Get parsed sections for a role. Cached after first parse.
 */
export function getRoleSections(role: AgentRole): RoleSections | null {
  if (SECTION_CACHE.has(role)) return SECTION_CACHE.get(role) || null;

  const prompt = SYSTEM_PROMPTS[role];
  if (!prompt) {
    SECTION_CACHE.set(role, null);
    return null;
  }

  const sections = parseSections(prompt);
  SECTION_CACHE.set(role, sections);
  return sections;
}

/**
 * Invalidate the section cache for a role (or all roles if no role given).
 */
export function invalidateSectionCache(role?: AgentRole): void {
  if (role) {
    SECTION_CACHE.delete(role);
  } else {
    SECTION_CACHE.clear();
  }
}

// ============================================================================
// Composition
// ============================================================================

/**
 * Render a PromptSection (handles string or template function).
 */
function renderSection(section: PromptSection | string, ctx: PromptContext): string {
  if (typeof section === 'string') return section;
  if (typeof section.template === 'function') return section.template(ctx);
  return section.template;
}

/**
 * Compose a role prompt from structured sections.
 *
 * This is the primary API for runtime prompt assembly. It:
 * 1. Takes section overrides (or uses defaults from the role)
 * 2. Renders each section (supporting template functions)
 * 3. Joins with separators
 * 4. Returns the final prompt string
 */
export function composeRole(
  role: AgentRole,
  options: ComposeRoleOptions = {}
): string {
  const sections = getRoleSections(role);
  if (!sections) {
    // Fallback: return raw prompt if parsing failed
    return SYSTEM_PROMPTS[role] || '';
  }

  const separator = options.separator || DEFAULT_SEPARATOR;
  const ctx: PromptContext = {
    availableTools: options.context?.availableTools || [],
    roleName: role,
    ...options.context,
  };

  const parts: string[] = [];

  // Identity (required)
  const identity = options.identity || sections.identity;
  if (identity) parts.push(renderSection(identity, ctx));

  // Directives (required)
  const directives = options.directives || sections.directives;
  if (directives) parts.push(renderSection(directives, ctx));

  // Tool strategy (optional — empty string means skip entirely)
  const toolStrategy = options.toolStrategy;
  if (toolStrategy === undefined) {
    // No override — use default from parsed sections
    if (sections.toolStrategy) parts.push(renderSection(sections.toolStrategy, ctx));
  } else if (typeof toolStrategy === 'string') {
    if (toolStrategy !== '') parts.push(toolStrategy);
  } else {
    // PromptSection — render (empty templates are harmless)
    parts.push(renderSection(toolStrategy, ctx));
  }

  // Output format
  const outputFormat = options.outputFormat || sections.outputFormat;
  if (outputFormat) parts.push(renderSection(outputFormat, ctx));

  // Anti-patterns
  const antiPatterns = options.antiPatterns || sections.antiPatterns;
  if (antiPatterns) parts.push(renderSection(antiPatterns, ctx));

  // Examples
  const examples = options.examples || sections.examples;
  if (examples) parts.push(renderSection(examples, ctx));

  // Extra sections
  if (options.extras) {
    for (const extra of options.extras) {
      const section = typeof extra === 'string' ? { id: 'extra', template: extra } : extra;
      parts.push(renderSection(section, ctx));
    }
  } else if (sections.extras) {
    for (const extra of sections.extras) {
      parts.push(renderSection(extra, ctx));
    }
  }

  return parts.join(separator);
}

/**
 * Compose a role prompt with a dynamic tool block.
 * Convenience wrapper that replaces the toolStrategy section with
 * a dynamically generated one based on available tools.
 *
 * This is the recommended API for production use — it ensures tool
 * references are always in sync with the capability registry.
 */
export function composeRoleWithTools(
  role: AgentRole,
  options: {
    /** Tool IDs available to this role. Empty = include all capabilities. */
    availableTools?: string[];
    /** Explicitly excluded tool IDs. */
    excludedTools?: string[];
    /** Show metadata hints in tool descriptions. */
    showMetadata?: boolean;
    /** Additional composition options. */
  } & Omit<ComposeRoleOptions, 'toolStrategy'> = {}
): string {
  const {
    availableTools = [],
    excludedTools = [],
    showMetadata = false,
    ...composeOpts
  } = options;

  const toolBlock = generateDynamicToolBlock({
    allowedTools: availableTools,
    excludedTools,
    showMetadata,
  });

  return composeRole(role, {
    ...composeOpts,
    // Empty string = skip tool strategy section entirely
    toolStrategy: toolBlock || '',
    context: {
      availableTools,
      ...composeOpts.context,
    },
  });
}

/**
 * Compose a prompt from multiple roles (cross-role composition).
 * Each role contributes its sections; directives are merged,
 * tool strategies are deduplicated, identity takes the primary role.
 */
export function composeMultiRole(
  primaryRole: AgentRole,
  secondaryRoles: AgentRole[],
  options: ComposeRoleOptions = {}
): string {
  const primary = getRoleSections(primaryRole);
  if (!primary) return SYSTEM_PROMPTS[primaryRole] || '';

  // Merge directives from all roles
  const allDirectives = [primary.directives, ...secondaryRoles.map(r => getRoleSections(r)?.directives).filter(Boolean)];
  const mergedDirectives = allDirectives.join('\n\n');

  // Merge tool strategies (deduplicated)
  const allToolSections = [primary.toolStrategy, ...secondaryRoles.map(r => getRoleSections(r)?.toolStrategy).filter(Boolean)];
  const mergedTools = allToolSections.map(s => renderSection(s!, { availableTools: [], roleName: primaryRole })).join('\n\n');

  return composeRole(primaryRole, {
    directives: { id: 'directives.merged', template: mergedDirectives },
    toolStrategy: { id: 'toolStrategy.merged', template: mergedTools },
    ...options,
  });
}

// ============================================================================
// Backwards Compatibility — Register existing sections
// ============================================================================

/**
 * Initialize the section registry by parsing all existing role prompts.
 * Called automatically on first import.
 */
function initializeSectionRegistry(): void {
  for (const role of Object.keys(SYSTEM_PROMPTS) as AgentRole[]) {
    const sections = getRoleSections(role);
    if (sections) {
      // Register each section for A/B testability
      registerSection({ ...sections.identity, id: `${role}.identity` });
      registerSection({ ...sections.directives, id: `${role}.directives` });
      if (sections.toolStrategy) registerSection({ ...sections.toolStrategy, id: `${role}.toolStrategy` });
      if (sections.outputFormat) registerSection({ ...sections.outputFormat, id: `${role}.outputFormat` });
      if (sections.antiPatterns) registerSection({ ...sections.antiPatterns, id: `${role}.antiPatterns` });
      if (sections.examples) registerSection({ ...sections.examples, id: `${role}.examples` });
    }
  }
}

// Auto-initialize on import
initializeSectionRegistry();

// ============================================================================
// Exports
// ============================================================================

export {
  // Re-export existing types for backwards compatibility
  AgentRole,
} from './system-prompts';
