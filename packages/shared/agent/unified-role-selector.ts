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
  // ── Core roles (priority 1-27) ──────────────────────────────────────

  // Highly specific roles first
  {
    role: 'debugger' as AgentRole, source: 'core', patterns: [
      /\bdebug(?:ging)?\b/, /\bstack\s*trace\b/, /\bexception\b/, /\bcrash(?:es|ing)?\b/,
      /\bfails?\b/, /\bfailing\b/, /\bbroken\b/, /\bnot\s+working\b/, /\bbug\b/,
      /\berror\s+(?:message|code|handling)\b/, /\btroubleshoot(?:ing)?\b/,
    ],
  },
  {
    role: 'architect' as AgentRole, source: 'core', patterns: [
      /\barchitecture\b/, /\barchitect\b/, /\bsystem\s*design\b/, /\bhigh.?level\s*design\b/,
      /\bHLD\b/, /\bcomponent\s*design\b/, /\bscal(?:able|ing)\s*(?:system|architecture)\b/,
      /\bmicroservices?\b/, /\bdesign\s+(?:pattern|system)\b/, /\bADR\b/,
    ],
  },
  {
    role: 'securityAuditor' as AgentRole, source: 'core', patterns: [
      /\bsecurity\b/, /\bvulnerab(?:le|ility)\b/, /\bCVE\b/, /\bexploit\b/,
      /\bpenetration\b/, /\bOWASP\b/, /\binjection\b/, /\bXSS\b/, /\bCSRF\b/,
      /\bSQL\s*injection\b/, /\bauthentication\s*bypass\b/, /\baudit\s*(?:log|trail)\b/,
    ],
  },
  {
    role: 'threatModeler' as AgentRole, source: 'core', patterns: [
      /\bthreat\s*model(?:ing)?\b/, /\bSTRIDE\b/, /\battack\s*(?:surface|vector|tree)\b/,
      /\brisk\s*assessment\b/, /\bDREAD\b/,
    ],
  },
  {
    role: 'reviewer' as AgentRole, source: 'core', patterns: [
      /\bPR\s*review\b/, /\bcode\s*review\b/, /\baudit\s*(?:the\s*)?code\b/,
      /\b(?:review|critique)\s*(?:this|my|the)\s*(?:code|PR|pull\s*request|patch|diff)\b/,
      /\bquality\s*(?:gate|check)\b/,
    ],
  },
  {
    role: 'tester' as AgentRole, source: 'core', patterns: [
      /\bunit\s*test\b/, /\bintegration\s*test\b/, /\be2e\s*test\b/,
      /\btest\s*(?:case|suite|plan|strategy|coverage)\b/,
      /\bTDD\b/, /\bBDD\b/, /\bregression\s*test\b/,
      /\bassert(?:ion)?\b/, /\bmock(?:ing)?\b/, /\bstub(?:bing)?\b/,
    ],
  },
  {
    role: 'performanceEngineer' as AgentRole, source: 'core', patterns: [
      /\bperformance\b/, /\blatency\b/, /\bthroughput\b/, /\bprofiling\b/,
      /\bbottleneck\b/, /\boptimiz(?:e|ation)\s*(?:speed|performance)\b/,
      /\bp99\b/, /\bp50\b/, /\bresponse\s*time\b/, /\bmemory\s*leak\b/,
    ],
  },
  {
    role: 'devopsEngineer' as AgentRole, source: 'core', patterns: [
      /\bCI(?:\/CD)?\b/, /\bpipeline\b/, /\bdeploy(?:ment)?\b/, /\bDocker\b/,
      /\bKubernetes\b/, /\bk8s\b/, /\binfrastructure\b/, /\bTerraform\b/,
      /\bHelm\b/, /\bGitOps\b/, /\bcontainer(?:ization)?\b/,
    ],
  },
  {
    role: 'sre' as AgentRole, source: 'core', patterns: [
      /\bSRE\b/, /\breliability\b/, /\buptime\b/, /\bSLO\b/, /\bSLA\b/,
      /\bincident\s*(?:response|management)?\b/, /\bmonitoring\b/, /\balert(?:ing)?\b/,
      /\bon.?call\b/, /\bpost.?mortem\b/, /\berror\s*budget\b/,
    ],
  },
  {
    role: 'databaseArchitect' as AgentRole, source: 'core', patterns: [
      /\bdatabase\b/, /\bschema\b/, /\bSQL\b/, /\bmigration\b/, /\bindex(?:ing)?\b/,
      /\bquery\b/, /\btable\b/, /\bPostgreSQL\b/, /\bMySQL\b/, /\bMongoDB\b/,
      /\bnormaliz(?:e|ation)\b/, /\bdenormaliz(?:e|ation)\b/, /\bERD\b/,
    ],
  },
  {
    role: 'apiDesigner' as AgentRole, source: 'core', patterns: [
      /\bAPI\b/, /\bREST(?:ful)?\b/, /\bGraphQL\b/, /\bendpoint\b/,
      /\broute\b/, /\brequest\b/, /\bresponse\b/, /\bHTTP\b/,
      /\bOpenAPI\b/, /\bSwagger\b/, /\bRPC\b/, /\bgRPC\b/,
    ],
  },
  {
    role: 'uiuxDesigner' as AgentRole, source: 'core', patterns: [
      /\bUI\b/, /\bUX\b/, /\bdesign\b/, /\bfrontend\b/, /\bcomponent\b/,
      /\blayout\b/, /\bCSS\b/, /\bstyling\b/, /\baccessibility\b/,
      /\bresponsive\b/, /\bwireframe\b/, /\bmockup\b/,
    ],
  },
  {
    role: 'dataAnalyst' as AgentRole, source: 'core', patterns: [
      /\bdata\b/, /\banalyz(?:e|is)\b/, /\bstatistics\b/, /\bmetrics?\b/,
      /\bdashboard\b/, /\breport(?:ing)?\b/, /\bSQL\b/, /\bchart\b/,
      /\bvisualiz(?:e|ation)\b/, /\bBI\b/, /\bETL\b/,
    ],
  },
  {
    role: 'reverseEngineer' as AgentRole, source: 'core', patterns: [
      /\breverse\s*engineer\b/, /\bdecompil(?:e|ation)\b/, /\blegacy\s*code\b/,
      /\bundocumented\b/, /\bdisassembl(?:e|y)\b/, /\bno\s*documentation\b/,
    ],
  },
  {
    role: 'codeArchaeologist' as AgentRole, source: 'core', patterns: [
      /\bgit\s*blame\b/, /\bhistory\b/, /\blegacy\b/, /\bwhen\s*was\b/,
      /\bwho\s*wrote\b/, /\bcode\s*history\b/, /\barchaeolog(?:y|ist)\b/,
    ],
  },
  {
    role: 'codeMigration' as AgentRole, source: 'core', patterns: [
      /\bmigrat(?:e|ion)\b/, /\bport(?:ing)?\b/, /\bupgrade\s*version\b/,
      /\bPython\s*2.*3\b/, /\bAngular.*React\b/, /\bmonolith.*microservice\b/,
    ],
  },
  {
    role: 'documenter' as AgentRole, source: 'core', patterns: [
      /\bdocument(?:ation)?\b/, /\bwrite\s*docs?\b/, /\bREADME\b/,
      /\bAPI\s*docs?\b/, /\bJSDoc\b/, /\brunbook\b/, /\bwiki\b/,
    ],
  },
  {
    role: 'releaseManager' as AgentRole, source: 'core', patterns: [
      /\brelease\b/, /\bversion(?:ing)?\b/, /\bchangelog\b/,
      /\bsemantic\s*versioning\b/, /\bsemver\b/, /\bdeploy(?:ment)?\s*(?:strategy|plan)\b/,
    ],
  },
  {
    role: 'planner' as AgentRole, source: 'core', patterns: [
      /\b(?:project|sprint|release|iteration)\s*plan(?:ning)?\b/,
      /\broadmap\b/, /\bmilestone\b/, /\bdecompose\b/,
      /\btask\s*breakdown\b/, /\bWBS\b/, /\bGantt\b/,
    ],
  },
  {
    role: 'projectManager' as AgentRole, source: 'core', patterns: [
      /\bproject\b/, /\btimeline\b/, /\bdeadline\b/, /\bstakeholder\b/,
      /\bbacklog\b/, /\bvelocity\b/, /\bburn.?down\b/, /\bstatus\s*report\b/,
    ],
  },
  {
    role: 'researcher' as AgentRole, source: 'core', patterns: [
      /\bresearch\b/, /\binvestigate\b/, /\bfind\b/, /\bsearch\b/,
      /\bwhat\s*is\b/, /\bhow\s*does\b/, /\bcompare\b/, /\balternatives?\b/,
    ],
  },
  {
    role: 'refiner' as AgentRole, source: 'core', patterns: [
      /\brefin(?:e|ement)\b/, /\bimprov(?:e|ment)\b/, /\bclean\s*up\b/,
      /\boptimize\s*code\b/, /\bsimplify\b/,
    ],
  },
  {
    role: 'complianceOfficer' as AgentRole, source: 'core', patterns: [
      /\bGDPR\b/, /\bHIPAA\b/, /\bSOC\s*2\b/, /\bcompliance\b/,
      /\bregulation\b/, /\baudit\b/, /\bprivacy\b/, /\bPCI\b/,
    ],
  },
  {
    role: 'knowledgeCurator' as AgentRole, source: 'core', patterns: [
      /\bknowledge\b/, /\bcurat(?:e|ion)\b/, /\bwiki\b/, /\borganiz(?:e|ation)\b/,
      /\btaxonomy\b/, /\bcatalog\b/, /\bknowledge\s*base\b/,
    ],
  },
  {
    role: 'mentor' as AgentRole, source: 'core', patterns: [
      /\bteach\b/, /\blearn\b/, /\bexplain\b/, /\btutorial\b/,
      /\bhow\s*to\b/, /\bbeginner\b/, /\bmentor\b/,
    ],
  },
  {
    role: 'simplifier' as AgentRole, source: 'core', patterns: [
      /\bsimplify\b/, /\brefactor\b/, /\breduce\s*complexity\b/,
      /\bDRY\b/, /\bKISS\b/, /\bYAGNI\b/,
    ],
  },
  // Default core role — catches code/filesystem requests without specific keywords
  {
    role: 'coder' as AgentRole, source: 'core', patterns: [
      /\bcode\b/, /\bimplement\b/, /\bwrite\b/, /\bfunction\b/, /\bclass\b/,
      /\bmodule\b/, /\bfix\b/, /\bfeature\b/, /\bprogram(?:ming)?\b/,
      /\bscript\b/, /\bapp\b/, /\bapplication\b/, /\bpatch\b/, /\bPR\b/,
      /\bcommit\b/, /\bpush\b/, /\bmerge\b/, /\bdiff\b/, /\bpatch\b/,
    ],
  },

  // ── Supplementary roles (priority 28-36) ────────────────────────────
  {
    role: 'chaosEngineer' as SupplementaryAgentRole, source: 'supplementary', patterns: [
      /\bchaos\b/, /\bresilien(?:ce|t)\b/, /\bfailure\s*injection\b/,
      /\bfault\s*tolerance\b/, /\bstress\s*test\b/,
    ],
  },
  {
    role: 'mlEngineer' as SupplementaryAgentRole, source: 'supplementary', patterns: [
      /\bmachine\s*learning\b/, /\bML\b/, /\bmodel\s*(?:train|deploy|evaluat)\b/,
      /\bneural\b/, /\bAI\b/, /\bdeep\s*learning\b/, /\binference\b/,
      /\bLLM\b/, /\btransformer\b/, /\bfine.?tun(?:e|ing)\b/,
    ],
  },
  {
    role: 'platformEngineer' as SupplementaryAgentRole, source: 'supplementary', patterns: [
      /\bplatform\b/, /\bdeveloper\s*experience\b/, /\bDX\b/,
      /\binternal\s*tool\b/, /\bgolden\s*path\b/, /\bIDP\b/,
    ],
  },
  {
    role: 'blockchainAuditor' as SupplementaryAgentRole, source: 'supplementary', patterns: [
      /\bblockchain\b/, /\bsmart\s*contract\b/, /\bSolidity\b/,
      /\bEthereum\b/, /\bDeFi\b/, /\bNFT\b/, /\bWeb3\b/, /\bcrypto\b/,
    ],
  },
  {
    role: 'embeddedEngineer' as SupplementaryAgentRole, source: 'supplementary', patterns: [
      /\bembedded\b/, /\bIoT\b/, /\bmicrocontroller\b/, /\bfirmware\b/,
      /\bArduino\b/, /\bresource\s*constrained\b/, /\bRTOS\b/,
    ],
  },
  {
    role: 'buildEngineer' as SupplementaryAgentRole, source: 'supplementary', patterns: [
      /\bbuild\b/, /\bbundle\b/, /\bwebpack\b/, /\besbuild\b/,
      /\bcompil(?:e|ation)\b/, /\bpipeline\b/, /\btree\s*shaking\b/,
      /\bVite\b/, /\bRollup\b/,
    ],
  },
  {
    role: 'accessibilitySpecialist' as SupplementaryAgentRole, source: 'supplementary', patterns: [
      /\bWCAG\b/, /\bARIA\b/, /\bscreen\s*reader\b/, /\ba11y\b/,
      /\bdisabilit(?:y|ies)\b/, /\bkeyboard\s*nav(?:igation)?\b/,
    ],
  },
  {
    role: 'localizationEngineer' as SupplementaryAgentRole, source: 'supplementary', patterns: [
      /\bi18n\b/, /\blocali[zs]ation\b/, /\btranslat(?:e|ion)\b/,
      /\blocale\b/, /\bRTL\b/, /\bmultilingual\b/, /\bICU\b/,
    ],
  },
  {
    role: 'growthEngineer' as SupplementaryAgentRole, source: 'supplementary', patterns: [
      /\bA\/B\s*test\b/, /\bgrowth\b/, /\bconversion\b/, /\banalytics\b/,
      /\bfunnel\b/, /\bexperiment\b/, /\bmetric\b/, /\bCRO\b/,
    ],
  },

  // ── General v1 roles (priority 37-48) ───────────────────────────────
  {
    role: 'legalAnalyst' as GeneralDomainRole, source: 'general', patterns: [
      /\blegal\b/, /\blaw\b/, /\bcontract\b/, /\blitigation\b/,
      /\bregulation\b/, /\bcompliance\b/,
    ],
  },
  {
    role: 'financialAnalyst' as GeneralDomainRole, source: 'general', patterns: [
      /\bfinance\b/, /\binvestment\b/, /\bstock\b/, /\bportfolio\b/,
      /\bvaluation\b/, /\bbudget(?:ing)?\b/, /\bprofit\b/, /\brevenue\b/,
    ],
  },
  {
    role: 'businessStrategist' as GeneralDomainRole, source: 'general', patterns: [
      /\bbusiness\b/, /\bstrateg(?:y|ic)\b/, /\bmarket\b/, /\bcompetition\b/,
      /\bSWOT\b/, /\bgrowth\s*strategy\b/, /\bP&L\b/,
    ],
  },
  {
    role: 'creativeWriter' as GeneralDomainRole, source: 'general', patterns: [
      /\bcreative\b/, /\bstory\b/, /\bfiction\b/, /\bpoem\b/,
      /\bnarrative\b/, /\bwriting\b/, /\bblog\s*post\b/, /\bcopy\b/,
    ],
  },
  {
    role: 'marketingStrategist' as GeneralDomainRole, source: 'general', patterns: [
      /\bmarketing\b/, /\bcampaign\b/, /\bbrand(?:ing)?\b/, /\bSEO\b/,
      /\bcontent\s*marketing\b/, /\badvertising\b/, /\bsocial\s*media\b/,
    ],
  },
  {
    role: 'uxResearcher' as GeneralDomainRole, source: 'general', patterns: [
      /\bUX\s*research\b/, /\buser\s*research\b/, /\busability\b/,
      /\buser\s*testing\b/, /\bpersona\b/, /\binterview\b/,
    ],
  },
  {
    role: 'educator' as GeneralDomainRole, source: 'general', patterns: [
      /\beducat(?:e|ion|or)\b/, /\bteach(?:ing)?\b/, /\bcurriculum\b/,
      /\blesson\b/, /\bcourse\b/, /\blearning\s*objective\b/,
    ],
  },
  {
    role: 'supplyChainAnalyst' as GeneralDomainRole, source: 'general', patterns: [
      /\bsupply\s*chain\b/, /\blogistics\b/, /\binventory\b/,
      /\bprocurement\b/, /\bwarehouse\b/, /\bfreight\b/,
    ],
  },
  {
    role: 'hrTalentSpecialist' as GeneralDomainRole, source: 'general', patterns: [
      /\bHR\b/, /\bhir(?:e|ing)\b/, /\brecruit(?:ment|ing)\b/,
      /\btalent\b/, /\binterview\b/, /\bperformance\s*review\b/,
    ],
  },
  {
    role: 'investigativeJournalist' as GeneralDomainRole, source: 'general', patterns: [
      /\bjournalis(?:m|t)\b/, /\binvestigation\b/, /\bfact\s*check\b/,
      /\bsource\b/, /\bexpos[eé]\b/, /\breporting\b/,
    ],
  },
  {
    role: 'policyAnalyst' as GeneralDomainRole, source: 'general', patterns: [
      /\bpolicy\b/, /\blegislation\b/, /\bgovernment\b/,
      /\bpublic\s*policy\b/, /\bregulatory\b/, /\breform\b/,
    ],
  },
  {
    role: 'translator' as GeneralDomainRole, source: 'general', patterns: [
      /\btranslat(?:e|ion|or)\b/, /\blanguage\b/, /\blocali[zs]e\b/,
      /\binterpret(?:er)?\b/, /\bmultilingual\b/,
    ],
  },

  // ── General v2 roles (priority 49-58) ───────────────────────────────
  {
    role: 'salesStrategist' as GeneralDomainRoleV2, source: 'general-v2', patterns: [
      /\bsales\b/, /\bpipeline\b/, /\blead\b/, /\bprospect\b/,
      /\bCRM\b/, /\bclosing\b/, /\bcommission\b/, /\bquota\b/,
    ],
  },
  {
    role: 'productManager' as GeneralDomainRoleV2, source: 'general-v2', patterns: [
      /\bproduct\s*(?:manager|management)\b/, /\bPM\b/, /\broadmap\b/,
      /\bfeature\s*prioriti[sz]ation\b/, /\buser\s*story\b/, /\bbacklog\b/,
    ],
  },
  {
    role: 'dataJournalist' as GeneralDomainRoleV2, source: 'general-v2', patterns: [
      /\bdata\s*journalism\b/, /\binfographic\b/, /\bstorytell(?:ing)?\b/,
    ],
  },
  {
    role: 'prSpecialist' as GeneralDomainRoleV2, source: 'general-v2', patterns: [
      /\bPR\b/, /\bpublic\s*relations\b/, /\bpress\s*release\b/,
      /\bmedia\b/, /\bcrisis\s*communication\b/,
    ],
  },
  {
    role: 'grantWriter' as GeneralDomainRoleV2, source: 'general-v2', patterns: [
      /\bgrant\b/, /\bproposal\b/, /\bfunding\b/, /\bnonprofit\b/,
      /\bRFP\b/, /\bfundraising\b/,
    ],
  },
  {
    role: 'negotiator' as GeneralDomainRoleV2, source: 'general-v2', patterns: [
      /\bnegotiat(?:e|ion|or)\b/, /\bdeal\b/, /\bcontract\b/,
      /\bagreement\b/, /\bmediat(?:e|or|ion)\b/,
    ],
  },
  {
    role: 'eventPlanner' as GeneralDomainRoleV2, source: 'general-v2', patterns: [
      /\bevent\b/, /\bconference\b/, /\bwedding\b/,
      /\bplanning\s*(?:event|party)\b/, /\blogistics\b/,
    ],
  },
  {
    role: 'realEstateAnalyst' as GeneralDomainRoleV2, source: 'general-v2', patterns: [
      /\breal\s*estate\b/, /\bproperty\b/, /\bmortgage\b/,
      /\bappraisal\b/, /\bhousing\b/,
    ],
  },
  {
    role: 'insuranceAnalyst' as GeneralDomainRoleV2, source: 'general-v2', patterns: [
      /\binsurance\b/, /\bclaim\b/, /\bunderwriting\b/,
      /\bactuarial\b/, /\bpolicy\b/,
    ],
  },
  {
    role: 'chef' as GeneralDomainRoleV2, source: 'general-v2', patterns: [
      /\brecipe\b/, /\bcook(?:ing)?\b/, /\bculinary\b/,
      /\bfood\b/, /\bmenu\b/, /\bkitchen\b/, /\brestaurant\b/,
    ],
  },

  // ── General v3 roles (priority 59-68) ───────────────────────────────
  {
    role: 'sportsAnalyst' as GeneralDomainRoleV3, source: 'general-v3', patterns: [
      /\bsports?\b/, /\bathlete\b/, /\bgame\s*analysis\b/,
      /\bteam\b/, /\btournament\b/, /\bcoach(?:ing)?\b/,
    ],
  },
  {
    role: 'musicProducer' as GeneralDomainRoleV3, source: 'general-v3', patterns: [
      /\bmusic\b/, /\bproduct(?:ion|er)\b/, /\baudio\b/,
      /\brecording\b/, /\bmix(?:ing)?\b/, /\bsong\b/, /\bbeat\b/,
    ],
  },
  {
    role: 'fashionDesigner' as GeneralDomainRoleV3, source: 'general-v3', patterns: [
      /\bfashion\b/, /\bcloth(?:ing|es)\b/, /\bdesign\b/,
      /\btextile\b/, /\btrend\b/, /\bapparel\b/,
    ],
  },
  {
    role: 'urbanPlanner' as GeneralDomainRoleV3, source: 'general-v3', patterns: [
      /\burban\b/, /\bcity\b/, /\bzoning\b/, /\binfrastructure\b/,
      /\btransportation\b/, /\bmunicipal\b/,
    ],
  },
  {
    role: 'agriculturalSpecialist' as GeneralDomainRoleV3, source: 'general-v3', patterns: [
      /\bagriculture\b/, /\bfarm(?:ing)?\b/, /\bcrop\b/,
      /\blivestock\b/, /\bsoil\b/, /\birrigation\b/, /\bharvest\b/,
    ],
  },
  {
    role: 'psychologist' as GeneralDomainRoleV3, source: 'general-v3', patterns: [
      /\bpsycholog(?:y|ist)\b/, /\btherapy\b/, /\bmental\s*health\b/,
      /\bbehavio(?:r|ur)\b/, /\bcounsel(?:ing|or)\b/,
    ],
  },
  {
    role: 'historian' as GeneralDomainRoleV3, source: 'general-v3', patterns: [
      /\bhistory\b/, /\bhistorical\b/, /\barchive\b/,
      /\bera\b/, /\bcentury\b/, /\bancient\b/, /\bmedieval\b/,
    ],
  },
  {
    role: 'gisCartographer' as GeneralDomainRoleV3, source: 'general-v3', patterns: [
      /\bGIS\b/, /\bmap(?:ping)?\b/, /\bcartograph(?:y|er)\b/,
      /\bgeospatial\b/, /\bcoordinate\b/, /\bGPS\b/,
    ],
  },
  {
    role: 'emergencyManager' as GeneralDomainRoleV3, source: 'general-v3', patterns: [
      /\bemergency\b/, /\bdisaster\b/, /\bcrisis\b/,
      /\bevacuation\b/, /\bFEMA\b/, /\bpreparedness\b/,
    ],
  },
  {
    role: 'maritimeLogistics' as GeneralDomainRoleV3, source: 'general-v3', patterns: [
      /\bmaritime\b/, /\bshipping\b/, /\bport\b/,
      /\bvessel\b/, /\bnautical\b/, /\bocean\s*freight\b/, /\bharbor\b/,
    ],
  },

  // ── General v4 roles (priority 69-76) ───────────────────────────────
  {
    role: 'investigativeResearcher' as GeneralDomainRoleV4, source: 'general-v4', patterns: [
      /\binvestigat(?:e|ion|ive)\b/, /\bdeep\s*dive\b/,
      /\buncover\b/, /\bforensics\b/, /\bdossier\b/,
    ],
  },
  {
    role: 'scientist' as GeneralDomainRoleV4, source: 'general-v4', patterns: [
      /\bscience\b/, /\bscient(?:ist|ific)\b/, /\bexperiment\b/,
      /\bhypothesis\b/, /\bresearch\b/, /\blab(?:oratory)?\b/,
    ],
  },
  {
    role: 'businessAdvisor' as GeneralDomainRoleV4, source: 'general-v4', patterns: [
      /\badvis(?:or|e|ory)\b/, /\bconsultant\b/, /\bstrategy\b/,
    ],
  },
  {
    role: 'philosopher' as GeneralDomainRoleV4, source: 'general-v4', patterns: [
      /\bphilosoph(?:y|er|ical)\b/, /\bethics\b/, /\blogic\b/,
      /\bexistential\b/, /\breasoning\b/,
    ],
  },
  {
    role: 'anthropologist' as GeneralDomainRoleV4, source: 'general-v4', patterns: [
      /\banthropolog(?:y|ist|ical)\b/, /\bculture\b/,
      /\bsociety\b/, /\bhuman\s*behavio(?:r|ur)\b/, /\bethnograph(?:y|ic)\b/,
    ],
  },
  {
    role: 'economist' as GeneralDomainRoleV4, source: 'general-v4', patterns: [
      /\beconom(?:y|ics|ist|ic)\b/, /\bmarket\b/, /\binflation\b/,
      /\bGDP\b/, /\bfiscal\b/, /\bmonetary\b/, /\bmacro.?economic\b/,
    ],
  },
  {
    role: 'actuary' as GeneralDomainRoleV4, source: 'general-v4', patterns: [
      /\bactuar(?:y|ial)\b/, /\brisk\s*(?:assessment|analysis)\b/,
      /\bprobability\b/, /\bstatistics\b/,
    ],
  },
  {
    role: 'environmentalConsultant' as GeneralDomainRoleV4, source: 'general-v4', patterns: [
      /\bsustainab(?:le|ility)\b/, /\bclimate\s*(?:change|crisis|action|policy)\b/,
      /\becolog(?:y|ical)\b/, /\bgreen\s*(?:energy|building|infrastructure)\b/,
      /\bcarbon\s*(?:footprint|neutral|offset|credit)\b/,
      /\bconservation\b/, /\bbiodiversity\b/,
    ],
  },
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
  const text = (opts.taskDescription || '').toLowerCase();

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

  const rawForSource = (): string => {
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
  };

  try {
    let prompt = '';

    if (source === 'core') {
      // Core roles support section-aware composition with dynamic tool block.
      prompt = composeRoleWithTools(role as AgentRole, {
        availableTools: opts.availableTools || [],
        extras: opts.extras?.map((s, i) => ({ id: `extra.${i}`, template: s })),
      });
    } else {
      // Non-core sets are raw strings today (no section decomposition).
      prompt = rawForSource();
      if (opts.extras?.length) {
        prompt += '\n\n' + opts.extras.join('\n\n');
      }
    }

    // Safety cap
    if (prompt.length > maxLength) {
      prompt = prompt.slice(0, maxLength);
    }

    return prompt;
  } catch {
    // Best-effort fallback: raw prompt from whichever set the role came from.
    return rawForSource();
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
      },
      {
        forceRole: trimmedRole as UnifiedRole,
        availableTools: options?.availableTools ?? [
          'file.read', 'file.write', 'file.append', 'file.delete',
          'file.list', 'file.search', 'repo.search', 'web.search',
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
