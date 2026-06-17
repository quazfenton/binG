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
 */

import { ALL_CAPABILITIES, type CapabilityDefinition } from '@/lib/tools/capabilities';
import { SYSTEM_PROMPTS, type AgentRole } from './system-prompts';

// ============================================================================
// Q3 + Q5: audit-grade defaults — single source of truth for tests + renames.
// ============================================================================

/** Q3: default header for `generateDynamicToolBlock`'s options.header field. */

// @audit-Q3-Q5-composer-lift: DEFAULT_DYNAMIC_HEADER + RULES_BLOCK promoted from
// module-private consts to `export const` so the same single-source-of-truth
// criterion applied at the unified-agent-service.ts cascade lift also applies
// to the composer surface (cascade Q3 + Q5 cross-cut).
export const DEFAULT_DYNAMIC_HEADER = 'AVAILABLE CAPABILITIES';

/**
 * Q5: default 3-rule block emitted by `generateDynamicToolBlock` after the
 * capabilities list. Rule 4 (about metadata) is appended inline based on
 * `showMetadata` so the const stays composable.
 */
export const RULES_BLOCK = [
  '## Rules',
  '1. Use the MOST SPECIFIC tool for the job',
  '2. Chain tools logically: search → read → analyze → write',
  '3. NEVER fabricate tool output — always call the actual tool',
].join('\n');

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
// Core Functions
// ============================================================================

/**
 * Compose a full system prompt for a role with dynamic tool injection.
 */
export function composeRoleWithTools(
  role: AgentRole | undefined,
  options: Omit<ComposeRoleOptions, 'toolStrategy'> & { availableTools: string[] }
): string | null {
  // (1) Caller did NOT request a role override.
  if (role === undefined) return null;
  // (2) No canonical prompt registered for this role \u2014 configuration error.
  const sectionsForRole = getRoleSections(role);
  if (!sectionsForRole && !SYSTEM_PROMPTS[role]) {
    throw new Error(`[prompt-composer] no canonical prompt registered for role "${role}"`);
  }
  // (3) sections-missing: fall back to SYSTEM_PROMPTS[role] (guard (2) ensures it exists).
  if (!sectionsForRole) {
    return SYSTEM_PROMPTS[role]!;
  }
  const sections = sectionsForRole;

  // Filter tools to only include those available to this role
  const toolBlock = generateToolBlock(options.availableTools);

  return composeRole(role, {
    ...options,
    toolStrategy: {
      id: 'toolStrategy.dynamic',
      template: (ctx) => {
        const base = typeof sections.toolStrategy.template === 'function'
          ? sections.toolStrategy.template(ctx)
          : sections.toolStrategy.template;
        return `${base}\n\n${toolBlock}`;
      }
    }
  });
}

/**
 * Compose a role prompt from sections with optional overrides.
 */
export function composeRole(role: AgentRole | undefined, options: ComposeRoleOptions = {}): string | null {
  // (1) Caller did NOT request a role override.
  if (role === undefined) return null;
  // (2) No canonical prompt registered for this role \u2014 configuration error.
  const baseForRole = getRoleSections(role);
  if (!baseForRole && !SYSTEM_PROMPTS[role]) {
    throw new Error(`[prompt-composer] no canonical prompt registered for role "${role}"`);
  }
  // (3) sections-missing: fall back to SYSTEM_PROMPTS[role] (guard (2) ensures it exists).
  if (!baseForRole) {
    return SYSTEM_PROMPTS[role]!;
  }
  const base = baseForRole;

  const ctx: PromptContext = {
    roleName: String(role),
    availableTools: options.context?.availableTools ? options.context.availableTools as string[] : [],
    ...options.context,
  };

  const parts: string[] = [];

  // 1. Identity
  parts.push(renderSection(options.identity || base.identity, ctx));

  // 2. Directives
  parts.push(renderSection(options.directives || base.directives, ctx));

  // 3. Tool Strategy
  parts.push(renderSection(options.toolStrategy || base.toolStrategy, ctx));

  // 4. Optional Sections
  if (options.outputFormat || base.outputFormat) {
    parts.push(renderSection(options.outputFormat || base.outputFormat!, ctx));
  }
  if (options.antiPatterns || base.antiPatterns) {
    parts.push(renderSection(options.antiPatterns || base.antiPatterns!, ctx));
  }
  if (options.examples || base.examples) {
    parts.push(renderSection(options.examples || base.examples!, ctx));
  }

  // 5. Extras (Base)
  if (base.extras) {
    for (const extra of base.extras) {
      parts.push(renderSection(extra, ctx));
    }
  }

  // 6. Extras (Options)
  if (options.extras) {
    for (const extra of options.extras) {
      parts.push(renderSection(extra, ctx));
    }
  }

  return parts.join(options.separator || DEFAULT_SEPARATOR);
}

/**
 * Get pre-parsed sections for a role.
 */
export function getRoleSections(role: AgentRole): RoleSections | null {
  const prompt = SYSTEM_PROMPTS[role];
  if (!prompt) return null;
  return parseSections(prompt);
}

// ============================================================================
// Internal Helpers
// ============================================================================

function renderSection(section: PromptSection | string, ctx: PromptContext): string {
  if (typeof section === 'string') return section;
  return typeof section.template === 'function' ? section.template(ctx) : section.template;
}

/**
 * Generate a categorized markdown tool block from available tool IDs.
 */
export function generateToolBlock(toolIds: string[]): string {
  if (!toolIds || toolIds.length === 0) return '';

  const caps = ALL_CAPABILITIES.filter(c => toolIds.includes(c.id));
  if (caps.length === 0) return '';

  const groups: Record<string, CapabilityDefinition[]> = {};
  for (const cap of caps) {
    if (!groups[cap.category]) groups[cap.category] = [];
    groups[cap.category].push(cap);
  }

  const lines = ['# AVAILABLE CAPABILITIES', ''];

  for (const category of Object.keys(groups).sort()) {
    lines.push(`## ${CATEGORY_LABELS[category] || category}`);
    for (const cap of groups[category].sort((a, b) => a.id.localeCompare(b.id))) {
      lines.push(`- **${cap.id}** — ${cap.description}`);
    }
    lines.push('');
  }      // Q5: see RULES_BLOCK above — single source so renames + test assertions stay co-located.
      lines.push(RULES_BLOCK);

  return lines.join('\n');
}

/**
 * Split a monolithic role prompt into structured sections.
 * Robustly scans line-by-line to detect headings and handle variations in whitespace/formatting.
 */
export function parseSections(prompt: string): RoleSections | null {
  const sections: Partial<RoleSections> = {};
  const extras: PromptSection[] = [];
  
  const lines = prompt.split('\n');
  let currentKey: Exclude<keyof RoleSections, 'extras'> | null = null;
  let currentBuffer: string[] = [];
  let currentHeading: string | null = null;

  const flush = () => {
    if (currentHeading && currentBuffer.length > 0) {
      const content = currentBuffer.join('\n').trim();
      if (content) {
        const id = `section.${currentHeading.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
        const section: PromptSection = { id, template: content };
        
        // Enhance tool strategy if needed
        if (currentKey === 'toolStrategy') {
          const toolRefs = extractToolReferences(content);
          if (toolRefs.length > 0) section.requiredTools = toolRefs;
        }
        
        if (currentKey) {
          sections[currentKey] = section;
        } else {
          extras.push(section);
        }
      }
    }
    currentBuffer = [];
  };

  for (const line of lines) {
    const headingMatch = line.match(/^#\s+(.+)$/);
    if (headingMatch) {
      flush();
      currentHeading = headingMatch[1].trim();
      const type = mapHeadingToSection(currentHeading.toUpperCase());
      currentKey = type;
      continue;
    }

    // Ignore banner lines but don't terminate sections
    if (line.trim().match(/^={10,}$/)) {
      continue;
    }

    if (currentHeading) {
      currentBuffer.push(line);
    }
  }
  flush();

  // Integrity validation: ensure required sections exist and have content
  if (!sections.identity?.template || !sections.directives?.template) {
    console.error('Prompt parsing failed: Missing or empty IDENTITY or DIRECTIVES section', { 
      hasIdentity: !!sections.identity?.template, 
      hasDirectives: !!sections.directives?.template 
    });
    return null;
  }

  return {
    identity: sections.identity,
    directives: sections.directives,
    toolStrategy: sections.toolStrategy || { id: 'toolStrategy.default', template: '' },
    ...sections,
    extras: extras.length > 0 ? extras : undefined,
  } as RoleSections;
}

function mapHeadingToSection(heading: string): Exclude<keyof RoleSections, 'extras'> | null {
  if (heading === 'IDENTITY') return 'identity';
  if (['PRIME DIRECTIVES', 'DIRECTIVES', 'GUIDELINES', 'CORE DIRECTIVES'].includes(heading)) return 'directives';
  if (['TOOL STRATEGY', 'TOOLS', 'AVAILABLE CAPABILITIES', 'CAPABILITIES', 'TOOL USAGE'].includes(heading)) return 'toolStrategy';
  if (['OUTPUT FORMAT', 'OUTPUT', 'RESPONSE FORMAT'].includes(heading)) return 'outputFormat';
  if (['ANTI-PATTERNS', 'ANTI_PATTERNS', 'WHAT NOT TO DO', 'AVOID', 'ANTI-PATTERNS TO AVOID'].includes(heading)) return 'antiPatterns';
  if (['EXAMPLES', 'FEW-SHOT', 'FEW SHOT', 'INLINE EXAMPLES'].includes(heading)) return 'examples';
  return null;
}

/**
 * Extract tool IDs referenced in a section's content.
 */
function extractToolReferences(content: string): string[] {
  const pattern = /`([a-z]+\.[a-z-_]+)`/g;
  const matches = [...content.matchAll(pattern)];
  return Array.from(new Set(matches.map(m => m[1])));
}
// ============================================================================
// Module-level section registry (private Map; exported via CRUD helpers)
// ============================================================================

const _sectionRegistry = new Map<string, PromptSection>();

/**
 * Register a section template by id. Used by tests + tooling to override
 * default section content at runtime.
 */
export function registerSection(section: PromptSection): void {
  _sectionRegistry.set(section.id, section);
}

/**
 * Retrieve a registered section template by id. Returns undefined for
 * unknown sections; caller's responsibility to fall back to defaults.
 */
export function getSectionTemplate(id: string): PromptSection | undefined {
  return _sectionRegistry.get(id);
}

/**
 * Clear the section template registry. Intended for testing or cache
 * invalidation lifecycles.
 */
export function invalidateSectionCache(): void {
  _sectionRegistry.clear();
}

// ============================================================================
// Dynamic Tool Block (with options) — wraps the ALL_CAPABILITIES filter
// ============================================================================

export interface DynamicToolBlockOptions {
  /** Subset of capability-ids to include; non-listed tools are excluded. */
  allowedTools?: string[];
  /** Subset of capability-ids to exclude; applied after allowedTools. */
  excludedTools?: string[];
  /** When true, append latency/cost/reliability hint to the Rules section. */
  showMetadata?: boolean;
  /** Section header override (default 'AVAILABLE CAPABILITIES'). */
  header?: string;
}

/**
 * Generate a categorized markdown tool block with optional filtering.
 * Empty string on zero matches (per test conventions).
 */
export function generateDynamicToolBlock(
  options: DynamicToolBlockOptions = {},
): string {
  const {
    allowedTools,
    excludedTools,
    showMetadata = false,
    // Q3: see DEFAULT_DYNAMIC_HEADER above — single source so renames are safe.
    header = DEFAULT_DYNAMIC_HEADER,
  } = options;
  // Bug #8 fix: detect allowedTools ∩ excludedTools overlap and warn (or throw in dev).
  // Without this guard, a tool listed in BOTH arrays is silently dropped because
  // the filter order runs `allowedTools` first then `excludedTools` excludes it again.
  // This ambiguity is easy to miss at call sites — fail loudly in dev, warn once in prod.
  if (allowedTools && excludedTools && allowedTools.length > 0 && excludedTools.length > 0) {
    const overlap = allowedTools.filter((id) => excludedTools.includes(id));
    if (overlap.length > 0) {
      const msg = `[prompt-composer] allowedTools and excludedTools overlap on ${overlap.length} id(s): ${overlap.join(', ')}. These are treated as excluded (filter order: allowed → excluded). Pass them in only ONE list to avoid silent filtering.`;
      if (process.env.NODE_ENV === 'production') {
        console.warn(msg);
      } else {
        throw new Error(msg);
      }
    }
  }
  let caps = ALL_CAPABILITIES;
  if (allowedTools) caps = caps.filter((c) => allowedTools.includes(c.id));
  if (excludedTools) caps = caps.filter((c) => !excludedTools.includes(c.id));
  if (caps.length === 0) return '';

  const groups: Record<string, CapabilityDefinition[]> = {};
  for (const cap of caps) {
    if (!groups[cap.category]) groups[cap.category] = [];
    groups[cap.category].push(cap);
  }

  const lines: string[] = [`# ${header}`, ''];
  for (const category of Object.keys(groups).sort()) {
    lines.push(`## ${CATEGORY_LABELS[category] || category}`);
    for (const cap of groups[category].sort((a, b) => a.id.localeCompare(b.id))) {
      lines.push(`- **${cap.id}** \u2014 ${cap.description || cap.name}`);
    }
    lines.push('');
  }

  lines.push('## Rules');
  lines.push('1. Use the MOST SPECIFIC tool for the job');
  lines.push('2. Chain tools logically: search \u2192 read \u2192 analyze \u2192 write');
  lines.push('3. NEVER fabricate tool output \u2014 always call the actual tool');
  if (showMetadata) {
    lines.push('4. Consider latency, cost, reliability when choosing tools');
  }

  return lines.join('\n');
}

// ============================================================================
// Tool Hints (compact list, single-line)
// ============================================================================

/**
 * Return a single-line summary of available tools for inclusion in
 * lighter-weight prompts. Returns '' when no tools are listed.
 */
export function generateToolHints(toolIds: string[]): string {
  if (!toolIds || toolIds.length === 0) return '';
  return `Available tools: ${toolIds.join(', ')}`;
}
