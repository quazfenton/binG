/**
 * Unified Role Selector
 *
 * Consolidates the 6 prompt sets that previously lived as disconnected islands:
 *
 *   1. Core         — SYSTEM_PROMPTS (system-prompts.ts, 27 roles)
 *   2. Supplementary — SUPPLEMENTARY_PROMPTS (system-prompts-supplementary.ts, 9 roles)
 *   3. General v1   — GENERAL_PROMPTS (general-domain-prompts.ts, 12 roles)
 *   4. General v2   — GENERAL_PROMPTS_V2 (general-domain-prompts-v2.ts, 10 roles)
 *   5. General v3   — GENERAL_PROMPTS_V3 (general-domain-prompts-v3.ts, 10 roles)
 *   6. General v4   — GENERAL_PROMPTS_V4 (general-domain-prompts-v4.ts, 8 roles)
 *
 * Before this module:
 *   - `getAllPrompts()` was misleadingly named (returned only supplementary).
 *   - `role-redirector.analyzeContextAndSuggestRoles()` only knew 9 hard-coded core roles via keyword regex.
 *   - `composeRoleWithTools()` only composed from SYSTEM_PROMPTS sections.
 *   - The standard `/api/chat` flow only saw the generic VFS editing prompt;
 *     the rich role prompts were effectively dead code.
 *
 * This module provides:
 *   - `getAllRoleIds()`  — true union across all 6 sets
 *   - `getAllRolePrompts()` — true merged record of role -> prompt
 *   - `getRoleSource()` — which set a role belongs to
 *   - `pickRoleFromContext()` — keyword-based router that covers all 76 roles
 *   - `composeUnifiedRolePrompt()` — dispatches to composeRoleWithTools for
 *     core (section-aware), raw prompt for the other 5 sets
 *   - `selectAndComposeSystemPrompt()` — one-shot helper for callers
 */

import { SYSTEM_PROMPTS, type AgentRole } from './system-prompts';
import { composeRoleWithTools } from './prompt-composer';
import {
  SUPPLEMENTARY_PROMPTS,
  getSupplementaryPrompt,
  type SupplementaryAgentRole,
} from './system-prompts-supplementary';
import {
  GENERAL_PROMPTS,
  getGeneralPrompt,
  type GeneralDomainRole,
} from './general-domain-prompts';
import {
  GENERAL_PROMPTS_V2,
  getGeneralPromptV2,
  type GeneralDomainRoleV2,
} from './general-domain-prompts-v2';
import {
  GENERAL_PROMPTS_V3,
  getGeneralPromptV3,
  type GeneralDomainRoleV3,
} from './general-domain-prompts-v3';
import {
  GENERAL_PROMPTS_V4,
  getGeneralPromptV4,
  type GeneralDomainRoleV4,
} from './general-domain-prompts-v4';

// ============================================================================
// Types
// ============================================================================

/** Which prompt set a role belongs to. */
export type RoleSource = 'core' | 'supplementary' | 'general' | 'general-v2' | 'general-v3' | 'general-v4';

/** Union of ALL role identifiers across all 6 prompt sets. */
export type UnifiedRole =
  | AgentRole
  | SupplementaryAgentRole
  | GeneralDomainRole
  | GeneralDomainRoleV2
  | GeneralDomainRoleV3
  | GeneralDomainRoleV4;

/** Metadata about a resolved role. */
export interface UnifiedRoleInfo {
  role: UnifiedRole;
  source: RoleSource;
  /** Raw prompt (before composition). Composition callers should use
   * composeUnifiedRolePrompt instead of reading this directly. */
  rawPrompt: string;
}

/** Options for pickRoleFromContext. */
export interface PickRoleOptions {
  /** User's message / task description. */
  taskDescription: string;
  /** Task classification complexity (e.g. 'simple', 'moderate', 'complex'). */
  complexity?: string;
  /** Whether filesystem editing tools are available to the model. */
  enableFilesystemEdits?: boolean;
  /** Recent failure / error messages (≥2 biases toward debugger). */
  recentFailures?: string[];
}

/** Options for composeUnifiedRolePrompt. */
export interface ComposeUnifiedOptions {
  /** Tools available to the model (used for core roles only). */
  availableTools?: string[];
  /** Extra sections to append after the prompt. */
  extras?: string[];
  /** Maximum prompt length before truncation. Default 6000. */
  maxLength?: number;
}

/** Options for selectAndComposeSystemPrompt. */
export interface SelectAndComposeOptions extends ComposeUnifiedOptions {
  /** Override the auto-selected role. */
  forceRole?: UnifiedRole;
}

/** Return type of selectAndComposeSystemPrompt. */
export interface SelectAndComposeResult {
  role: string;
  source: RoleSource;
  prompt: string;
}

// ============================================================================
// Shared Validation Helper — Types
// ============================================================================

/** Options for normalizeAndValidateRole. */
export interface ValidateAndNormalizeOptions {
  /** Tools available to the model (used for core roles only). */
  availableTools?: string[];
  /** Maximum prompt length before truncation. Default 6000. */
  maxLength?: number;
  /** Whether filesystem editing tools are available. Default true. */
  enableFilesystemEdits?: boolean;
  /** Recent failure / error messages (≥2 biases toward debugger in auto-detect). */
  recentFailures?: string[];
}

/**
 * Return type of normalizeAndValidateRole.
 *
 * On `valid: false` the role wasn't recognized — consumer should abort adoption.
 * On `valid: true` composition was attempted; rolePrompt may be empty if it
 * failed (fallback: the role was still "adopted" for routing purposes).
 */
export type ValidateAndNormalizeResult =
  | {
      valid: false;
      /** The invalid role identifier (or null if empty). */
      roleAdopted: string | null;
      /** Human-readable error message. */
      message: string;
    }
  | {
      valid: true;
      /** The normalized (trimmed) role identifier. */
      roleAdopted: string;
      /** Composed system prompt for the role. */
      rolePrompt: string;
      /** Which prompt set the role belongs to. */
      roleSource: RoleSource | null;
      /** Human-readable confirmation or fallback message. */
      message: string;
    };

// ============================================================================
// Constants
// ============================================================================

const ALL_CORE_KEYS = Object.keys(SYSTEM_PROMPTS);
const ALL_SUPPLEMENTARY_KEYS = Object.keys(SUPPLEMENTARY_PROMPTS);
const ALL_GENERAL_KEYS = Object.keys(GENERAL_PROMPTS);
const ALL_GENERAL_V2_KEYS = Object.keys(GENERAL_PROMPTS_V2);
const ALL_GENERAL_V3_KEYS = Object.keys(GENERAL_PROMPTS_V3);
const ALL_GENERAL_V4_KEYS = Object.keys(GENERAL_PROMPTS_V4);

const DEFAULT_MAX_LENGTH = 6000;

// ============================================================================
// Keyword-based Role Patterns (ordered by priority — first match wins)
// ============================================================================

interface RolePattern {
  role: UnifiedRole;
  source: RoleSource;
  /** Regex patterns to match against the lowercased task description. */
  patterns: RegExp[];
}

/**
 * All 76 roles with keyword patterns, ordered by specificity.
 * More specific matches come first. General/catch-all at the end.
 */
const ROLE_PATTERNS: RolePattern[] = [
  // ── Core roles (priority 1-26, most specific first) ─────────────────

  // Highly specific roles first
  {
    role: 'debugger' as AgentRole, source: 'core', patterns: [
      /\bdebug(?:ging)?\b/i, /\bstack\s*trace\b/i, /\bexception\b/i, /\bcrash(?:es|ing)?\b/i,
      /\bfails?\b/i, /\bfailing\b/i, /\bbroken\b/i, /\bnot\s+working\b/i, /\bbug\b/i,
      /\berror\s+(?:message|code|handling)\b/i, /\btroubleshoot(?:ing)?\b/i,
    ],
  },
  {
    role: 'architect' as AgentRole, source: 'core', patterns: [
      /\barchitecture\b/i, /\barchitect\b/i, /\bsystem\s*design\b/i, /\bhigh.?level\s*design\b/i,
      /\bhld\b/i, /\bcomponent\s*design\b/i, /\bscal(?:able|ing)\s*(?:system|architecture)\b/i,
      /\bmicroservices?\b/i, /\bdesign\s+(?:pattern|system)\b/i, /\badr\b/i,
    ],
  },
  {
    role: 'securityAuditor' as AgentRole, source: 'core', patterns: [
      /\bsecurity\b/i, /\bvulnerab(?:le|ility)\b/i, /\bcve\b/i, /\bexploit\b/i,
      /\bpenetration\b/i, /\bowasp\b/i, /\binjection\b/i, /\bxss\b/i, /\bcsrf\b/i,
      /\bsql\s*injection\b/i, /\bauthentication\s*bypass\b/i, /\baudit\s*(?:log|trail)\b/i,
    ],
  },
  {
    role: 'threatModeler' as AgentRole, source: 'core', patterns: [
      /\bthreat\s*model(?:ing)?\b/i, /\bstride\b/i, /\battack\s*(?:surface|vector|tree)\b/i,
      /\brisk\s*assessment\b/i, /\bdread\b/i,
    ],
  },
  {
    role: 'reviewer' as AgentRole, source: 'core', patterns: [
      /\bpr\s*review\b/i, /\bcode\s*review\b/i, /\baudit\s*(?:the\s*)?code\b/i,
      /\b(?:review|critique)\s*(?:this|my|the)\s*(?:code|pr|pull\s*request|patch|diff)\b/i,
      /\bquality\s*(?:gate|check)\b/i,
    ],
  },
  {
    role: 'tester' as AgentRole, source: 'core', patterns: [
      /\bunit\s*test\b/i, /\bintegration\s*test\b/i, /\be2e\s*test\b/i,
      /\btest\s*(?:case|suite|plan|strategy|coverage)\b/i,
      /\btdd\b/i, /\bbdd\b/i, /\bregression\s*test\b/i,
      /\bassert(?:ion)?\b/i, /\bmock(?:ing)?\b/i, /\bstub(?:bing)?\b/i,
    ],
  },
  {
    role: 'performanceEngineer' as AgentRole, source: 'core', patterns: [
      /\bperformance\b/i, /\blatency\b/i, /\bthroughput\b/i, /\bprofiling\b/i,
      /\bbottleneck\b/i, /\boptimiz(?:e|ation)\s*(?:speed|performance)\b/i,
      /\bp99\b/i, /\bp50\b/i, /\bresponse\s*time\b/i, /\bmemory\s*leak\b/i,
    ],
  },
  {
    role: 'devopsEngineer' as AgentRole, source: 'core', patterns: [
      /\bci(?:\/cd)?\b/i, /\bpipeline\b/i, /\bdeploy(?:ment)?\b/i, /\bdocker(?:ize)?\b/i,
      /\bkubernetes\b/i, /\bk8s\b/i, /\binfrastructure\b/i, /\bterraform\b/i,
      /\bhelm\b/i, /\bgitops\b/i, /\bcontainer(?:ization)?\b/i,
    ],
  },
  {
    role: 'sre' as AgentRole, source: 'core', patterns: [
      /\bsre\b/i, /\breliability\b/i, /\buptime\b/i, /\bslo\b/i, /\bsla\b/i,
      /\bincident\s*(?:response|management)?\b/i, /\bmonitoring\b/i, /\balert(?:ing)?\b/i,
      /\bon.?call\b/i, /\bpost.?mortem\b/i, /\berror\s*budget\b/i,
    ],
  },
  {
    role: 'databaseArchitect' as AgentRole, source: 'core', patterns: [
      /\bdatabase\b/i, /\bschema\b/i, /\bsql\b/i, /\bmigration\b/i, /\bindex(?:ing)?\b/i,
      /\bquery\b/i, /\btable\b/i, /\bpostgresql\b/i, /\bmysql\b/i, /\bmongodb\b/i,
      /\bnormaliz(?:e|ation)\b/i, /\bdenormaliz(?:e|ation)\b/i, /\berd\b/i,
    ],
  },
  {
    role: 'documenter' as AgentRole, source: 'core', patterns: [
      /\bdocument(?:ation)?\b/i, /\bwrite\s*docs?\b/i, /\breadme\b/i,
      /\bapi\s*docs?\b/i, /\bjsdoc\b/i, /\brunbook\b/i, /\bwiki\b/i,
    ],
  },
  {
    role: 'apiDesigner' as AgentRole, source: 'core', patterns: [
      /\bapi\b/i, /\brest(?:ful)?\b/i, /\bgraphql\b/i, /\bendpoint\b/i,
      /\broute\b/i, /\brequest\b/i, /\bresponse\b/i, /\bhttp\b/i,
      /\bopenapi\b/i, /\bswagger\b/i, /\brpc\b/i, /\bgrpc\b/i,
    ],
  },
  {
    role: 'uiuxDesigner' as AgentRole, source: 'core', patterns: [
      /\bui\b/i, /\bux\b/i, /\bdesign\b/i, /\bfrontend\b/i,
      /\blayout\b/i, /\bcss\b/i, /\bstyling\b/i, /\baccessibility\b/i,
      /\bresponsive\b/i, /\bwireframe\b/i, /\bmockup\b/i,
    ],
  },
  {
    role: 'dataAnalyst' as AgentRole, source: 'core', patterns: [
      /\bdata\b/i, /\banalyz(?:e|is)\b/i, /\bstatistics\b/i, /\bmetrics?\b/i,
      /\bdashboard\b/i, /\breport(?:ing)?\b/i, /\bsql\b/i, /\bchart\b/i,
      /\bvisualiz(?:e|ation)\b/i, /\bbi\b/i, /\betl\b/i,
    ],
  },
  {
    role: 'refiner' as AgentRole, source: 'core', patterns: [
      /\brefin(?:e|ement)\b/i, /\brefactor(?:ing|ed|or)?\b/i, /\bimprov(?:e|ment)\b/i, /\bclean\s*up\b/i,
      /\boptimize\s*code\b/i, /\bsimplify\b/i,
    ],
  },
  {
    role: 'reverseEngineer' as AgentRole, source: 'core', patterns: [
      /\breverse\s*engineer\b/i, /\bdecompil(?:e|ation)\b/i, /\blegacy\s*code\b/i,
      /\bundocumented\b/i, /\bdisassembl(?:e|y)\b/i, /\bno\s*documentation\b/i,
    ],
  },
  {
    role: 'codeArchaeologist' as AgentRole, source: 'core', patterns: [
      /\bgit\s*blame\b/i, /\bhistory\b/i, /\blegacy\b/i, /\bwhen\s*was\b/i,
      /\bwho\s*wrote\b/i, /\bcode\s*history\b/i, /\barchaeolog(?:y|ist)\b/i,
    ],
  },
  {
    role: 'codeMigration' as AgentRole, source: 'core', patterns: [
      /\bmigrat(?:e|ion)\b/i, /\bport(?:ing)?\b/i, /\bupgrade\s*version\b/i,
      /\bpython\s*2.*3\b/i, /\bangular.*react\b/i, /\bmonolith.*microservice\b/i,
    ],
  },
  {
    role: 'releaseManager' as AgentRole, source: 'core', patterns: [
      /\brelease\b/i, /\bversion(?:ing)?\b/i, /\bchangelog\b/i,
      /\bsemantic\s*versioning\b/i, /\bsemver\b/i, /\bdeploy(?:ment)?\s*(?:strategy|plan)\b/i,
    ],
  },
  {
    role: 'planner' as AgentRole, source: 'core', patterns: [
      /\b(?:project|sprint|release|iteration)\s*plan(?:ning)?\b/i,
      /\bplan\b.*\b(?:sprint|project|release|iteration)\b/i,
      /\broadmap\b/i, /\bmilestone\b/i, /\bdecompose\b/i,
      /\btask\s*breakdown\b/i, /\bwbs\b/i, /\bgantt\b/i,
    ],
  },
  {
    role: 'projectManager' as AgentRole, source: 'core', patterns: [
      /\bproject\b/i, /\btimeline\b/i, /\bdeadline\b/i, /\bstakeholder\b/i,
      /\bbacklog\b/i, /\bvelocity\b/i, /\bburn.?down\b/i, /\bstatus\s*report\b/i,
    ],
  },
  {
    role: 'researcher' as AgentRole, source: 'core', patterns: [
      /\bresearch\b/i, /\binvestigate\b/i, /\bfind\b/i, /\bsearch\b/i,
      /\bwhat\s*is\b/i, /\bhow\s*does\b/i, /\bcompare\b/i, /\balternatives?\b/i,
    ],
  },
  {
    role: 'complianceOfficer' as AgentRole, source: 'core', patterns: [
      /\bgdpr\b/i, /\bhipaa\b/i, /\bsoc\s*2\b/i, /\bcompliance\b/i,
      /\bregulation\b/i, /\baudit\b/i, /\bprivacy\b/i, /\bpci\b/i,
    ],
  },
  {
    role: 'knowledgeCurator' as AgentRole, source: 'core', patterns: [
      /\bknowledge\b/i, /\bcurat(?:e|ion)\b/i, /\bwiki\b/i, /\borganiz(?:e|ation)\b/i,
      /\btaxonomy\b/i, /\bcatalog\b/i, /\bknowledge\s*base\b/i,
    ],
  },
  {
    role: 'mentor' as AgentRole, source: 'core', patterns: [
      /\bteach\b/i, /\blearn\b/i, /\bexplain\b/i, /\btutorial\b/i,
      /\bhow\s*to\b/i, /\bbeginner\b/i, /\bmentor\b/i,
    ],
  },
  {
    role: 'simplifier' as AgentRole, source: 'core', patterns: [
      /\bsimplify\b/i, /\brefactor\b/i, /\breduce\s*complexity\b/i,
      /\bdry\b/i, /\bkiss\b/i, /\byagni\b/i,
    ],
  },

  // ── Supplementary roles (priority 27-35) ────────────────────────────
  {
    role: 'chaosEngineer' as SupplementaryAgentRole, source: 'supplementary', patterns: [
      /\bchaos\b/i, /\bresilien(?:ce|t)\b/i, /\bfailure\s*injection\b/i,
      /\bfault\s*tolerance\b/i, /\bstress\s*test\b/i,
    ],
  },
  {
    role: 'mlEngineer' as SupplementaryAgentRole, source: 'supplementary', patterns: [
      /\bmachine\s*learning\b/i, /\bml\b/i, /\bmodel\s*(?:train|deploy|evaluat)\b/i,
      /\bneural\b/i, /\bai\b/i, /\bdeep\s*learning\b/i, /\binference\b/i,
      /\bllm\b/i, /\btransformer\b/i, /\bfine.?tun(?:e|ing)\b/i,
    ],
  },
  {
    role: 'platformEngineer' as SupplementaryAgentRole, source: 'supplementary', patterns: [
      /\bplatform\b/i, /\bdeveloper\s*experience\b/i, /\bdx\b/i,
      /\binternal\s*tool\b/i, /\bgolden\s*path\b/i, /\bidp\b/i,
    ],
  },
  {
    role: 'blockchainAuditor' as SupplementaryAgentRole, source: 'supplementary', patterns: [
      /\bblockchain\b/i, /\bsmart\s*contract\b/i, /\bsolidity\b/i,
      /\bethereum\b/i, /\bdefi\b/i, /\bnft\b/i, /\bweb3\b/i, /\bcrypto\b/i,
    ],
  },
  {
    role: 'embeddedEngineer' as SupplementaryAgentRole, source: 'supplementary', patterns: [
      /\bembedded\b/i, /\biot\b/i, /\bmicrocontroller\b/i, /\bfirmware\b/i,
      /\barduino\b/i, /\bresource\s*constrained\b/i, /\brtos\b/i,
    ],
  },
  {
    role: 'buildEngineer' as SupplementaryAgentRole, source: 'supplementary', patterns: [
      /\bbuild\b/i, /\bbundle\b/i, /\bwebpack\b/i, /\besbuild\b/i,
      /\bcompil(?:e|ation)\b/i, /\bpipeline\b/i, /\btree\s*shaking\b/i,
      /\bvite\b/i, /\brollup\b/i,
    ],
  },
  {
    role: 'accessibilitySpecialist' as SupplementaryAgentRole, source: 'supplementary', patterns: [
      /\bwcag\b/i, /\baria\b/i, /\bscreen\s*reader\b/i, /\ba11y\b/i,
      /\bdisabilit(?:y|ies)\b/i, /\bkeyboard\s*nav(?:igation)?\b/i,
    ],
  },
  {
    role: 'localizationEngineer' as SupplementaryAgentRole, source: 'supplementary', patterns: [
      /\bi18n\b/i, /\blocali[zs]ation\b/i, /\btranslat(?:e|ion)\b/i,
      /\blocale\b/i, /\brtl\b/i, /\bmultilingual\b/i, /\bicu\b/i,
    ],
  },
  {
    role: 'growthEngineer' as SupplementaryAgentRole, source: 'supplementary', patterns: [
      /\ba\/b\s*test\b/i, /\bgrowth\b/i, /\bconversion\b/i, /\banalytics\b/i,
      /\bfunnel\b/i, /\bexperiment\b/i, /\bmetric\b/i, /\bcro\b/i,
    ],
  },

  // ── General v1 roles (priority 36-47) ───────────────────────────────
  {
    role: 'legalAnalyst' as GeneralDomainRole, source: 'general', patterns: [
      /\blegal\b/i, /\blaw\b/i, /\bcontract\b/i, /\blitigation\b/i,
      /\bregulation\b/i, /\bcompliance\b/i,
    ],
  },
  {
    role: 'financialAnalyst' as GeneralDomainRole, source: 'general', patterns: [
      /\bfinance\b/i, /\binvestment\b/i, /\bstock\b/i, /\bportfolio\b/i,
      /\bvaluation\b/i, /\bbudget(?:ing)?\b/i, /\bprofit\b/i, /\brevenue\b/i,
    ],
  },
  {
    role: 'businessStrategist' as GeneralDomainRole, source: 'general', patterns: [
      /\bbusiness\b/i, /\bstrateg(?:y|ic)\b/i, /\bmarket\b/i, /\bcompetition\b/i,
      /\bswot\b/i, /\bgrowth\s*strategy\b/i, /\bp&l\b/i,
    ],
  },
  {
    role: 'creativeWriter' as GeneralDomainRole, source: 'general', patterns: [
      /\bcreative\b/i, /\bstory\b/i, /\bfiction\b/i, /\bpoem\b/i,
      /\bnarrative\b/i, /\bwriting\b/i, /\bblog\s*post\b/i, /\bcopy\b/i,
    ],
  },
  {
    role: 'marketingStrategist' as GeneralDomainRole, source: 'general', patterns: [
      /\bmarketing\b/i, /\bcampaign\b/i, /\bbrand(?:ing)?\b/i, /\bseo\b/i,
      /\bcontent\s*marketing\b/i, /\badvertising\b/i, /\bsocial\s*media\b/i,
    ],
  },
  {
    role: 'uxResearcher' as GeneralDomainRole, source: 'general', patterns: [
      /\bux\s*research\b/i, /\buser\s*research\b/i, /\busability\b/i,
      /\buser\s*testing\b/i, /\bpersona\b/i, /\binterview\b/i,
    ],
  },
  {
    role: 'educator' as GeneralDomainRole, source: 'general', patterns: [
      /\beducat(?:e|ion|or)\b/i, /\bteach(?:ing)?\b/i, /\bcurriculum\b/i,
      /\blesson\b/i, /\bcourse\b/i, /\blearning\s*objective\b/i,
    ],
  },
  {
    role: 'supplyChainAnalyst' as GeneralDomainRole, source: 'general', patterns: [
      /\bsupply\s*chain\b/i, /\blogistics\b/i, /\binventory\b/i,
      /\bprocurement\b/i, /\bwarehouse\b/i, /\bfreight\b/i,
    ],
  },
  {
    role: 'hrTalentSpecialist' as GeneralDomainRole, source: 'general', patterns: [
      /\bhr\b/i, /\bhir(?:e|ing)\b/i, /\brecruit(?:ment|ing)\b/i,
      /\btalent\b/i, /\binterview\b/i, /\bperformance\s*review\b/i,
    ],
  },
  {
    role: 'investigativeJournalist' as GeneralDomainRole, source: 'general', patterns: [
      /\bjournalis(?:m|t)\b/i, /\binvestigation\b/i, /\bfact\s*check\b/i,
      /\bsource\b/i, /\bexpos[eé]\b/i, /\breporting\b/i,
    ],
  },
  {
    role: 'policyAnalyst' as GeneralDomainRole, source: 'general', patterns: [
      /\bpolicy\b/i, /\blegislation\b/i, /\bgovernment\b/i,
      /\bpublic\s*policy\b/i, /\bregulatory\b/i, /\breform\b/i,
    ],
  },
  {
    role: 'translator' as GeneralDomainRole, source: 'general', patterns: [
      /\btranslat(?:e|ion|or)\b/i, /\blanguage\b/i, /\blocali[zs]e\b/i,
      /\binterpret(?:er)?\b/i, /\bmultilingual\b/i,
    ],
  },

  // ── General v2 roles (priority 48-57) ───────────────────────────────
  {
    role: 'salesStrategist' as GeneralDomainRoleV2, source: 'general-v2', patterns: [
      /\bsales\b/i, /\bpipeline\b/i, /\blead\b/i, /\bprospect\b/i,
      /\bcrm\b/i, /\bclosing\b/i, /\bcommission\b/i, /\bquota\b/i,
    ],
  },
  {
    role: 'productManager' as GeneralDomainRoleV2, source: 'general-v2', patterns: [
      /\bproduct\s*(?:manager|management)\b/i, /\bpm\b/i, /\broadmap\b/i,
      /\bfeature\s*prioriti[sz]ation\b/i, /\buser\s*story\b/i, /\bbacklog\b/i,
    ],
  },
  {
    role: 'dataJournalist' as GeneralDomainRoleV2, source: 'general-v2', patterns: [
      /\bdata\s*journalism\b/i, /\binfographic\b/i, /\bstorytell(?:ing)?\b/i,
    ],
  },
  {
    role: 'prSpecialist' as GeneralDomainRoleV2, source: 'general-v2', patterns: [
      /\bpr\b/i, /\bpublic\s*relations\b/i, /\bpress\s*release\b/i,
      /\bmedia\b/i, /\bcrisis\s*communication\b/i,
    ],
  },
  {
    role: 'grantWriter' as GeneralDomainRoleV2, source: 'general-v2', patterns: [
      /\bgrant\b/i, /\bproposal\b/i, /\bfunding\b/i, /\bnonprofit\b/i,
      /\brfp\b/i, /\bfundraising\b/i,
    ],
  },
  {
    role: 'negotiator' as GeneralDomainRoleV2, source: 'general-v2', patterns: [
      /\bnegotiat(?:e|ion|or)\b/i, /\bdeal\b/i, /\bcontract\b/i,
      /\bagreement\b/i, /\bmediat(?:e|or|ion)\b/i,
    ],
  },
  {
    role: 'eventPlanner' as GeneralDomainRoleV2, source: 'general-v2', patterns: [
      /\bevent\b/i, /\bconference\b/i, /\bwedding\b/i,
      /\bplanning\s*(?:event|party)\b/i, /\blogistics\b/i,
    ],
  },
  {
    role: 'realEstateAnalyst' as GeneralDomainRoleV2, source: 'general-v2', patterns: [
      /\breal\s*estate\b/i, /\bproperty\b/i, /\bmortgage\b/i,
      /\bappraisal\b/i, /\bhousing\b/i,
    ],
  },
  {
    role: 'insuranceAnalyst' as GeneralDomainRoleV2, source: 'general-v2', patterns: [
      /\binsurance\b/i, /\bclaim\b/i, /\bunderwriting\b/i,
      /\bactuarial\b/i, /\bpolicy\b/i,
    ],
  },
  {
    role: 'chef' as GeneralDomainRoleV2, source: 'general-v2', patterns: [
      /\brecipe\b/i, /\bcook(?:ing)?\b/i, /\bculinary\b/i,
      /\bfood\b/i, /\bmenu\b/i, /\bkitchen\b/i, /\brestaurant\b/i,
    ],
  },

  // ── General v3 roles (priority 58-67) ───────────────────────────────
  {
    role: 'sportsAnalyst' as GeneralDomainRoleV3, source: 'general-v3', patterns: [
      /\bsports?\b/i, /\bathlete\b/i, /\bgame\s*analysis\b/i,
      /\bteam\b/i, /\btournament\b/i, /\bcoach(?:ing)?\b/i,
    ],
  },
  {
    role: 'musicProducer' as GeneralDomainRoleV3, source: 'general-v3', patterns: [
      /\bmusic\b/i, /\bproduct(?:ion|er)\b/i, /\baudio\b/i,
      /\brecording\b/i, /\bmix(?:ing)?\b/i, /\bsong\b/i, /\bbeat\b/i,
    ],
  },
  {
    role: 'fashionDesigner' as GeneralDomainRoleV3, source: 'general-v3', patterns: [
      /\bfashion\b/i, /\bcloth(?:ing|es)\b/i, /\bdesign\b/i,
      /\btextile\b/i, /\btrend\b/i, /\bapparel\b/i,
    ],
  },
  {
    role: 'urbanPlanner' as GeneralDomainRoleV3, source: 'general-v3', patterns: [
      /\burban\b/i, /\bcity\b/i, /\bzoning\b/i, /\binfrastructure\b/i,
      /\btransportation\b/i, /\bmunicipal\b/i,
    ],
  },
  {
    role: 'agriculturalSpecialist' as GeneralDomainRoleV3, source: 'general-v3', patterns: [
      /\bagriculture\b/i, /\bfarm(?:ing)?\b/i, /\bcrop\b/i,
      /\blivestock\b/i, /\bsoil\b/i, /\birrigation\b/i, /\bharvest\b/i,
    ],
  },
  {
    role: 'psychologist' as GeneralDomainRoleV3, source: 'general-v3', patterns: [
      /\bpsycholog(?:y|ist)\b/i, /\btherapy\b/i, /\bmental\s*health\b/i,
      /\bbehavio(?:r|ur)\b/i, /\bcounsel(?:ing|or)\b/i,
    ],
  },
  {
    role: 'historian' as GeneralDomainRoleV3, source: 'general-v3', patterns: [
      /\bhistory\b/i, /\bhistorical\b/i, /\barchive\b/i,
      /\bera\b/i, /\bcentury\b/i, /\bancient\b/i, /\bmedieval\b/i,
    ],
  },
  {
    role: 'gisCartographer' as GeneralDomainRoleV3, source: 'general-v3', patterns: [
      /\bgis\b/i, /\bmap(?:ping)?\b/i, /\bcartograph(?:y|er)\b/i,
      /\bgeospatial\b/i, /\bcoordinate\b/i, /\bgps\b/i,
    ],
  },
  {
    role: 'emergencyManager' as GeneralDomainRoleV3, source: 'general-v3', patterns: [
      /\bemergency\b/i, /\bdisaster\b/i, /\bcrisis\b/i,
      /\bevacuation\b/i, /\bfema\b/i, /\bpreparedness\b/i,
    ],
  },
  {
    role: 'maritimeLogistics' as GeneralDomainRoleV3, source: 'general-v3', patterns: [
      /\bmaritime\b/i, /\bshipping\b/i, /\bport\b/i,
      /\bvessel\b/i, /\bnautical\b/i, /\bocean\s*freight\b/i, /\bharbor\b/i,
    ],
  },

  // ── General v4 roles (priority 68-75) ───────────────────────────────
  {
    role: 'investigativeResearcher' as GeneralDomainRoleV4, source: 'general-v4', patterns: [
      /\binvestigat(?:e|ion|ive)\b/i, /\bdeep\s*dive\b/i,
      /\buncover\b/i, /\bforensics\b/i, /\bdossier\b/i,
    ],
  },
  {
    role: 'scientist' as GeneralDomainRoleV4, source: 'general-v4', patterns: [
      /\bscience\b/i, /\bscient(?:ist|ific)\b/i, /\bexperiment\b/i,
      /\bhypothesis\b/i, /\bresearch\b/i, /\blab(?:oratory)?\b/i,
    ],
  },
  {
    role: 'businessAdvisor' as GeneralDomainRoleV4, source: 'general-v4', patterns: [
      /\badvis(?:or|e|ory)\b/i, /\bconsultant\b/i, /\bstrategy\b/i,
    ],
  },
  {
    role: 'philosopher' as GeneralDomainRoleV4, source: 'general-v4', patterns: [
      /\bphilosoph(?:y|er|ical)\b/i, /\bethics\b/i, /\blogic\b/i,
      /\bexistential\b/i, /\breasoning\b/i,
    ],
  },
  {
    role: 'anthropologist' as GeneralDomainRoleV4, source: 'general-v4', patterns: [
      /\banthropolog(?:y|ist|ical)\b/i, /\bculture\b/i,
      /\bsociety\b/i, /\bhuman\s*behavio(?:r|ur)\b/i, /\bethnograph(?:y|ic)\b/i,
    ],
  },
  {
    role: 'economist' as GeneralDomainRoleV4, source: 'general-v4', patterns: [
      /\beconom(?:y|ics|ist|ic)\b/i, /\bmarket\b/i, /\binflation\b/i,
      /\bgdp\b/i, /\bfiscal\b/i, /\bmonetary\b/i, /\bmacro.?economic\b/i,
    ],
  },
  {
    role: 'actuary' as GeneralDomainRoleV4, source: 'general-v4', patterns: [
      /\bactuar(?:y|ial)\b/i, /\brisk\s*(?:assessment|analysis)\b/i,
      /\bprobability\b/i, /\bstatistics\b/i,
    ],
  },
  {
    role: 'environmentalConsultant' as GeneralDomainRoleV4, source: 'general-v4', patterns: [
      /\bsustainab(?:le|ility)\b/i, /\bclimate\s*(?:change|crisis|action|policy)\b/i,
      /\becolog(?:y|ical)\b/i, /\bgreen\s*(?:energy|building|infrastructure)\b/i,
      /\bcarbon\s*(?:footprint|neutral|offset|credit)\b/i,
      /\bconservation\b/i, /\bbiodiversity\b/i,
    ],
  },

  // Default core role — catches code/filesystem requests without specific keywords
  {
    role: 'coder' as AgentRole, source: 'core', patterns: [
      /\bcode\b/i, /\bimplement\b/i, /\bwrite\b/i, /\bfunction\b/i, /\bclass\b/i,
      /\bmodule\b/i, /\bfix\b/i, /\bfeature\b/i, /\bprogram(?:ming)?\b/i,
      /\bscript\b/i, /\bapp\b/i, /\bapplication\b/i, /\bpatch\b/i, /\bpr\b/i,
      /\bcommit\b/i, /\bpush\b/i, /\bmerge\b/i, /\bdiff\b/i,
    ],    },
];

// ============================================================================
// Public API
// ============================================================================

/**
 * Get ALL role IDs across all 6 prompt sets.
 * Returns 76 unique role identifiers with zero collisions.
 */
export function getAllRoleIds(): UnifiedRole[] {
  return [
    ...ALL_CORE_KEYS,
    ...ALL_SUPPLEMENTARY_KEYS,
    ...ALL_GENERAL_KEYS,
    ...ALL_GENERAL_V2_KEYS,
    ...ALL_GENERAL_V3_KEYS,
    ...ALL_GENERAL_V4_KEYS,
  ] as UnifiedRole[];
}

/**
 * Get ALL role prompts across all 6 sets as a flat record.
 */
export function getAllRolePrompts(): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const key of ALL_CORE_KEYS) merged[key] = SYSTEM_PROMPTS[key as keyof typeof SYSTEM_PROMPTS];
  for (const key of ALL_SUPPLEMENTARY_KEYS) merged[key] = SUPPLEMENTARY_PROMPTS[key as keyof typeof SUPPLEMENTARY_PROMPTS];
  for (const key of ALL_GENERAL_KEYS) merged[key] = GENERAL_PROMPTS[key as keyof typeof GENERAL_PROMPTS];
  for (const key of ALL_GENERAL_V2_KEYS) merged[key] = GENERAL_PROMPTS_V2[key as keyof typeof GENERAL_PROMPTS_V2];
  for (const key of ALL_GENERAL_V3_KEYS) merged[key] = GENERAL_PROMPTS_V3[key as keyof typeof GENERAL_PROMPTS_V3];
  for (const key of ALL_GENERAL_V4_KEYS) merged[key] = GENERAL_PROMPTS_V4[key as keyof typeof GENERAL_PROMPTS_V4];
  return merged;
}

/**
 * Determine which prompt set a role belongs to.
 */
export function getRoleSource(role: string): RoleSource | null {
  if ((ALL_CORE_KEYS as readonly string[]).includes(role)) return 'core';
  if ((ALL_SUPPLEMENTARY_KEYS as readonly string[]).includes(role)) return 'supplementary';
  if ((ALL_GENERAL_KEYS as readonly string[]).includes(role)) return 'general';
  if ((ALL_GENERAL_V2_KEYS as readonly string[]).includes(role)) return 'general-v2';
  if ((ALL_GENERAL_V3_KEYS as readonly string[]).includes(role)) return 'general-v3';
  if ((ALL_GENERAL_V4_KEYS as readonly string[]).includes(role)) return 'general-v4';
  return null;
}

/**
 * Pick the best role for a task description using keyword matching.
 * Scans all 76 roles in priority order; returns the first match.
 * Falls back to 'coder' for code/filesystem requests, null otherwise.
 */
export function pickRoleFromContext(opts: PickRoleOptions): UnifiedRoleInfo | null {
  const text = opts.taskDescription || '';

  // Failure context biases toward debugger.
  if (opts.recentFailures && opts.recentFailures.length >= 2) {
    return {
      role: 'debugger' as AgentRole,
      source: 'core',
      rawPrompt: SYSTEM_PROMPTS['debugger'],
    };
  }

  for (const pattern of ROLE_PATTERNS) {
    for (const regex of pattern.patterns) {
      if (regex.test(text)) {
        const rawPrompt = getRawPrompt(pattern.role, pattern.source);
        return {
          role: pattern.role,
          source: pattern.source,
          rawPrompt,
        };
      }
    }
  }

  // No pattern matched.
  // For code/filesystem requests, default to coder.
  // For code/filesystem requests, default to coder.
  // Don't default for non-code requests even if complexity is present.
  if (opts.enableFilesystemEdits) {
    const role: AgentRole = 'coder';
    return {
      role,
      source: 'core',
      rawPrompt: SYSTEM_PROMPTS[role],
    };
  }

  return null;
}

/**
 * Compose a system prompt for a role, dispatching to the appropriate
 * composition strategy based on source.
 *
 * - Core roles: composeRoleWithTools (section-aware, dynamic tool block)
 * - All others: raw prompt string (no section decomposition available yet)
 */
export function composeUnifiedRolePrompt(
  role: string,
  opts: ComposeUnifiedOptions = {},
): string {
  const source = getRoleSource(role);
  if (!source) return '';

  const maxLength = opts.maxLength ?? DEFAULT_MAX_LENGTH;

  try {
    let prompt = '';

    if (source === 'core') {
      // Core roles support section-aware composition with dynamic tool block.
      prompt = composeRoleWithTools(role as AgentRole, {
        availableTools: opts.availableTools || [],
        extras: opts.extras?.map((s, i) => ({ id: `extra.${i}`, template: s })),
      }) ?? '';
    } else {
      // Non-core sets are raw strings today (no section decomposition).
      // Uses module-level getRawPrompt helper instead of duplicating switch logic.
      prompt = getRawPrompt(role as UnifiedRole, source);
      if (opts.extras?.length) {
        prompt += '\n\n' + opts.extras.join('\n\n');
      }
    }

    // Safety cap
    if (prompt.length > maxLength) {
      prompt = prompt.slice(0, maxLength);
    }

    return prompt;
  } catch {      // Best-effort fallback: raw prompt from whichever set the role came from.
    return getRawPrompt(role as UnifiedRole, source);
  }
}

/**
 * One-shot helper: pick a role from context AND compose the prompt.
 *
 * This is the primary entry point for callers like /api/chat.
 *
 * @returns { role, source, prompt } or null if no suitable role found.
 */
export function selectAndComposeSystemPrompt(
  taskInfo: {
    taskDescription: string;
    complexity?: string;
    enableFilesystemEdits?: boolean;
    /** Recent failure / error messages (≥2 biases toward debugger). */
    recentFailures?: string[];
  },
  opts: SelectAndComposeOptions = {},
): SelectAndComposeResult | null {
  const picked = opts.forceRole
    ? ((): UnifiedRoleInfo => {
        const source = getRoleSource(opts.forceRole! as string) || 'core';
        return {
          role: opts.forceRole!,
          source,
          rawPrompt: source === 'core'
            ? SYSTEM_PROMPTS[opts.forceRole as AgentRole] || ''
            : getRawPrompt(opts.forceRole!, source),
        };
      })()
    : pickRoleFromContext({
        taskDescription: taskInfo.taskDescription,
        complexity: taskInfo.complexity,
        enableFilesystemEdits: taskInfo.enableFilesystemEdits,
        recentFailures: taskInfo.recentFailures,
      });

  if (!picked) return null;

  const prompt = composeUnifiedRolePrompt(picked.role as string, {
    availableTools: opts.availableTools,
    extras: opts.extras,
    maxLength: opts.maxLength,
  });

  return {
    role: picked.role as string,
    source: picked.source,
    prompt,
  };
}

// ============================================================================
// Shared Validation Helper
// ============================================================================

/**
 * Validate a role string and, if valid, compose its system prompt.
 *
 * Consolidates the duplicated trim → isEmpty → isValid → compose pipeline
 * that previously lived independently in the MCP role_selection handler and
 * the AI SDK choose_role tool.
 *
 * @param rawRole       The raw role string from the caller (e.g. `args.role`).
 * @param taskDescription  Description/reason for the role switch.
 * @param options       Optional overrides for availableTools, maxLength, etc.
 */
export function normalizeAndValidateRole(
  rawRole: string,
  taskDescription: string,
  options?: ValidateAndNormalizeOptions,
): ValidateAndNormalizeResult {
  const trimmedRole = (rawRole || '').trim();

  if (!trimmedRole) {
    return {
      valid: false,
      roleAdopted: null,
      message: 'No role specified. Please provide a valid role name (e.g., debugger, architect, coder).',
    };
  }

  const validRoles = getAllRoleIds();
  const isValidRole = validRoles.includes(trimmedRole as UnifiedRole);
  if (!isValidRole) {
    return {
      valid: false,
      roleAdopted: trimmedRole,
      message: `Role "${trimmedRole}" is not recognized. Available roles include: ${validRoles.slice(0, 20).join(', ')}${validRoles.length > 20 ? ', ...and more' : ''}.`,
    };
  }

  try {
    const result = selectAndComposeSystemPrompt(
      {
        taskDescription,
        enableFilesystemEdits: options?.enableFilesystemEdits ?? true,
        recentFailures: options?.recentFailures,
      },
      {
        forceRole: trimmedRole as UnifiedRole,
        availableTools: options?.availableTools ?? [
          'file.read', 'file.write', 'file.append', 'file.delete',
          'file.list', 'repo.search', 'web.search',
        ],
        maxLength: options?.maxLength ?? 6000,
      },
    );

    return {
      valid: true,
      roleAdopted: trimmedRole,
      rolePrompt: result?.prompt || '',
      roleSource: result?.source || null,
      message: result
        ? `Role switched to ${trimmedRole} (${result.source}). New role context composed.`
        : `Role switched to ${trimmedRole} for: ${taskDescription}.`,
    };
  } catch {
    return {
      valid: true,
      roleAdopted: trimmedRole,
      rolePrompt: '',
      roleSource: null,
      message: `Role switched to ${trimmedRole} for: ${taskDescription}.`,
    };
  }
}

// ============================================================================
// Internal Helpers
// ============================================================================

function getRawPrompt(role: UnifiedRole, source: RoleSource): string {
  switch (source) {
    case 'core':
      return SYSTEM_PROMPTS[role as AgentRole] || '';
    case 'supplementary':
      return getSupplementaryPrompt(role as SupplementaryAgentRole);
    case 'general':
      return getGeneralPrompt(role as GeneralDomainRole);
    case 'general-v2':
      return getGeneralPromptV2(role as GeneralDomainRoleV2);
    case 'general-v3':
      return getGeneralPromptV3(role as GeneralDomainRoleV3);
    case 'general-v4':
      return getGeneralPromptV4(role as GeneralDomainRoleV4);
    default:
      return '';
  }
}
