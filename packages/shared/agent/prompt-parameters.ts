/**
 * Prompt Parameters / Response Modifiers
 *
 * Optional configuration that can be appended to any agent role's system prompt
 * to modify response style, depth, tone, and behavior. These are NOT defaults —
 * they are triggered by UI configuration or explicit request parameters.
 *
 * Usage:
 * ```ts
 * import { PromptParameters, ResponseDepth, ExpertiseLevel, ReasoningMode, applyPromptModifiers } from '@bing/shared/agent/prompt-parameters';
 *
 * const params: PromptParameters = {
 *   responseDepth: ResponseDepth.Comprehensive,
 *   expertiseLevel: ExpertiseLevel.Expert,
 *   reasoningMode: ReasoningMode.Deliberative,
 *   citationStrictness: CitationStrictness.AllClaims,
 * };
 *
 * const modifierSuffix = applyPromptModifiers(params);
 * const fullPrompt = baseRolePrompt + modifierSuffix;
 * ```
 */

// ============================================================================
// Enumerations
// ============================================================================

/**
 * Response depth and verbosity
 * Controls how thoroughly and extensively the agent responds.
 */
export enum ResponseDepth {
  /** Minimal — direct answer, no elaboration, 1-3 sentences */
  Minimal = 'minimal',
  /** Brief — answer with key context, ~1 paragraph */
  Brief = 'brief',
  /** Standard — answer with supporting detail, ~2-3 paragraphs (DEFAULT) */
  Standard = 'standard',
  /** Detailed — answer with evidence, examples, and nuance, ~1 page */
  Detailed = 'detailed',
  /** Comprehensive — thorough treatment with all relevant dimensions, multiple sections */
  Comprehensive = 'comprehensive',
  /** Exhaustive — leave no stone unturned; every angle, every caveat, every source */
  Exhaustive = 'exhaustive',
}

/**
 * Assumed expertise level of the audience
 * Controls technical depth, jargon usage, and explanation granularity.
 */
export enum ExpertiseLevel {
  /** Layperson — explain all terms, use analogies, avoid jargon entirely */
  Layperson = 'layperson',
  /** Informed — general knowledge, define specialized terms, some jargon OK */
  Informed = 'informed',
  /** Practitioner — working knowledge in the field, standard terminology expected */
  Practitioner = 'practitioner',
  /** Expert — deep domain knowledge, advanced concepts, no hand-holding */
  Expert = 'expert',
  /** World-Class — peer-level discourse, cutting-edge, assume mastery */
  WorldClass = 'world-class',
}

/**
 * Reasoning mode — how the agent should approach its thinking process.
 */
export enum ReasoningMode {
  /** Direct — give the answer immediately, minimal reasoning shown */
  Direct = 'direct',
  /** Structured — organize thinking into clear steps or sections */
  Structured = 'structured',
  /** Analytical — break down components, examine each systematically */
  Analytical = 'analytical',
  /** Deliberative — think step-by-step, consider alternatives, show reasoning chain */
  Deliberative = 'deliberative',
  /** Dialectical — present thesis, antithesis, and synthesis; explore tensions */
  Dialectical = 'dialectical',
  /** Socratic — question assumptions, probe with questions before answering */
  Socratic = 'socratic',
}

/**
 * How strictly claims must be supported with citations or evidence.
 */
export enum CitationStrictness {
  /** None — no citations needed; general knowledge is sufficient */
  None = 'none',
  /** KeyClaims — cite non-obvious or potentially disputed claims */
  KeyClaims = 'key-claims',
  /** AllClaims — every factual claim should have a source or basis noted */
  AllClaims = 'all-claims',
  /** Academic — formal citations for everything, peer-reviewed sources preferred */
  Academic = 'academic',
}

/**
 * Tone and register of the response.
 */
export enum Tone {
  /** Formal — professional, precise, no contractions, academic register */
  Formal = 'formal',
  /** Professional — business-appropriate, clear, respectful */
  Professional = 'professional',
  /** Conversational — natural, approachable, some contractions, direct address */
  Conversational = 'conversational',
  /** Casual — relaxed, colloquial, like talking to a knowledgeable friend */
  Casual = 'casual',
  /** Authoritative — confident, decisive, commanding tone */
  Authoritative = 'authoritative',
  /** Tentative — careful, hedged, acknowledging uncertainty */
  Tentative = 'tentative',
}

/**
 * Creativity vs. factual strictness.
 */
export enum CreativityLevel {
  /** StrictlyFactual — no speculation, no hypotheticals, only verified information */
  StrictlyFactual = 'strictly-factual',
  /** EvidenceBased — grounded in evidence but can draw reasonable inferences */
  EvidenceBased = 'evidence-based',
  /** Balanced — mix of established facts and informed analysis */
  Balanced = 'balanced',
  /** Exploratory — open to hypotheses, alternative theories, and speculation (clearly labeled) */
  Exploratory = 'exploratory',
  /** Creative — generative, imaginative, brainstorming mode */
  Creative = 'creative',
}

/**
 * Risk posture for recommendations and advice.
 */
export enum RiskPosture {
  /** Conservative — prefer proven, safe, well-established approaches */
  Conservative = 'conservative',
  /** Balanced — weigh risk against reward; moderate risk acceptable for meaningful gain */
  Balanced = 'balanced',
  /** Aggressive — willing to take significant risks for high potential reward */
  Aggressive = 'aggressive',
}

/**
 * Output format preference.
 */
export enum OutputFormat {
  /** Prose — natural paragraphs, narrative flow */
  Prose = 'prose',
  /** Bulleted — bullet points for scannability */
  Bulleted = 'bulleted',
  /** Tabular — structured tables where possible */
  Tabular = 'tabular',
  /** Mixed — combination of prose, bullets, and tables as appropriate */
  Mixed = 'mixed',
  /** Outline — hierarchical outline format */
  Outline = 'outline',
  /** JSON — structured JSON output for programmatic consumption */
  JSON = 'json',
}

/**
 * Self-correction behavior.
 */
export enum SelfCorrection {
  /** None — no self-review; respond directly */
  None = 'none',
  /** Light — quick sanity check before responding */
  Light = 'light',
  /** Thorough — systematic review of accuracy, completeness, and consistency before output */
  Thorough = 'thorough',
  /** Iterative — draft, critique, revise cycle; show the refinement */
  Iterative = 'iterative',
}

/**
 * Confidence expression — how uncertainty should be communicated.
 */
export enum ConfidenceExpression {
  /** Definitive — state conclusions directly without hedging */
  Definitive = 'definitive',
  /** Calibrated — express confidence levels proportionally to evidence strength */
  Calibrated = 'calibrated',
  /** Cautious — default to uncertainty; highlight what's not known */
  Cautious = 'cautious',
}

// ============================================================================
// Prompt Parameter Configuration
// ============================================================================

/**
 * Complete prompt parameter configuration.
 * Any field can be omitted to use the role's default behavior.
 */
export interface PromptParameters {
  responseDepth?: ResponseDepth;
  expertiseLevel?: ExpertiseLevel;
  reasoningMode?: ReasoningMode;
  citationStrictness?: CitationStrictness;
  tone?: Tone;
  creativityLevel?: CreativityLevel;
  riskPosture?: RiskPosture;
  outputFormat?: OutputFormat;
  selfCorrection?: SelfCorrection;
  confidenceExpression?: ConfidenceExpression;
  /** Custom additional instructions appended as raw text */
  customInstructions?: string;
}

/**
 * Default parameters — when nothing is specified, these apply (implicit defaults).
 * In practice, most roles have their own implicit defaults built into their prompts.
 * This object represents the neutral baseline when modifiers are explicitly applied.
 *
 * NOTE: All fields are intentionally undefined (not set) so that no modifier text
 * is generated unless the user explicitly configures a parameter via the UI.
 */
export const DEFAULT_PROMPT_PARAMETERS: PromptParameters = {
  // All undefined — no modifier text generated by default
};

// ============================================================================
// Modifier Text Generators
// ============================================================================

/**
 * Generate the modifier text for a single parameter dimension.
 * Returns empty string if the parameter is not set.
 */
function generateModifierText(key: string, value: string): string {
  const modifiers: Record<string, Record<string, string>> = {

    // ========================================
    // Response Depth
    // ========================================
    responseDepth: {
      minimal: `
============================================
# RESPONSE STYLE: MINIMAL
============================================
- Respond in 1-3 sentences maximum
- Give the direct answer only; no elaboration, no examples, no context
- If the answer is complex, provide the single most important point
- Omit all caveats, alternatives, and nuance unless directly asked`,

      brief: `
============================================
# RESPONSE STYLE: BRIEF
============================================
- Respond in approximately 1 paragraph
- Provide the answer with minimal supporting context
- Include only the most critical evidence or reasoning
- Omit extended examples, alternative views, and deep caveats
- If more depth is needed, note it in one sentence at the end`,

      detailed: `
============================================
# RESPONSE STYLE: DETAILED
============================================
- Be very thorough, verbosely robust, and think critically for a comprehensive and focused response
- Provide a complete treatment with evidence, examples, and nuance
- Address the primary answer, key supporting details, and important caveats
- Include relevant examples and concrete illustrations
- Note significant alternatives or competing viewpoints
- Length: approximately 1 page of substantive content`,

      comprehensive: `
============================================
# RESPONSE STYLE: COMPREHENSIVE
============================================
- Be extremely thorough, verbosely robust, and think critically for a comprehensive and focused response
- Provide an exhaustive treatment covering all relevant dimensions
- Address the primary question in depth with multiple layers of evidence
- Include concrete examples, case studies, and data where applicable
- Explore significant alternatives, competing viewpoints, and their merits
- Cover edge cases, exceptions, and important caveats
- Structure the response with clear sections and subheadings
- Length: multiple sections, as long as needed for completeness`,

      exhaustive: `
============================================
# RESPONSE STYLE: EXHAUSTIVE
============================================
- Leave no stone unturned. Be maximally thorough, verbosely robust, and think critically for the most comprehensive and focused response possible
- Cover every angle, every caveat, every source, every alternative interpretation
- Provide complete historical context, current state, and future implications
- Include all relevant evidence, data points, case studies, and counterexamples
- Map the full landscape of opinions, frameworks, and approaches
- Address every reasonable objection and provide your response
- Structure with detailed sections, sub-sections, and cross-references
- Length: as long as necessary to achieve complete coverage`,
    },

    // ========================================
    // Expertise Level
    // ========================================
    expertiseLevel: {
      layperson: `
============================================
# AUDIENCE: LAYPERSON
============================================
- Assume the reader has NO prior knowledge of this subject
- Explain ALL technical terms, jargon, and acronyms on first use
- Use analogies and everyday examples to make abstract concepts concrete
- Avoid jargon entirely; if a technical term is unavoidable, define it immediately
- Build from fundamentals; do not skip steps in reasoning
- Write as if explaining to an intelligent person outside the field`,

      informed: `
============================================
# AUDIENCE: INFORMED
============================================
- Assume the reader has general knowledge but is not a specialist
- Define specialized or field-specific terms on first use
- Standard terminology is acceptable with brief clarification
- Can reference well-known concepts without full explanation
- Provide enough context for the reader to follow the argument`,

      practitioner: `
============================================
# AUDIENCE: PRACTITIONER
============================================
- Assume the reader works in or adjacent to this field
- Standard professional terminology is expected and should be used
- No need to define common concepts or explain basics
- Focus on nuance, edge cases, and advanced applications
- Can reference established frameworks and methods by name`,

      expert: `
============================================
# AUDIENCE: EXPERT
============================================
- Assume the person asking this prompt is an expert of full knowledge and depth on the subject and requires a high level of expertise, mastery, and meticulous detail in your response which should be reviewed and ensured of accuracy, quality
- Use advanced, field-specific terminology without explanation
- Skip fundamentals entirely; focus on cutting-edge, nuanced, and unresolved aspects
- Engage with current debates, methodological controversies, and unresolved questions
- Reference specific studies, researchers, and schools of thought by name
- Treat the reader as a peer who can follow complex arguments without scaffolding
- Ensure accuracy and quality at a peer-review standard`,

      'world-class': `
============================================
# AUDIENCE: WORLD-CLASS EXPERT
============================================
- Assume the person asking this prompt is an expert of full knowledge and depth on the subject and requires a high level of expertise, mastery, and meticulous detail in your response which should be reviewed and ensured of accuracy, quality
- Treat the reader as a world-leading authority in the field
- Engage at the frontier of current knowledge; discuss open problems and active research
- Use the most precise, technical language available; no simplification
- Reference specific papers, theorems, datasets, and ongoing debates
- Contribute novel analysis, not just synthesis of existing knowledge
- Ensure accuracy and quality at a level that would withstand scrutiny by the top researchers in the field`,
    },

    // ========================================
    // Reasoning Mode
    // ========================================
    reasoningMode: {
      direct: `
============================================
# REASONING MODE: DIRECT
============================================
- Give the answer immediately, with minimal preamble
- Show only the conclusion; omit the reasoning process
- No step-by-step breakdown unless specifically requested
- If there are caveats, append them briefly at the end`,

      structured: `
============================================
# REASONING MODE: STRUCTURED
============================================
- Organize your thinking into clear sections and subheadings
- Present information in a logical, easy-to-follow structure
- Use headings, lists, and tables to make the organization explicit
- Each section should have a clear purpose and flow to the next`,

      analytical: `
============================================
# REASONING MODE: ANALYTICAL
============================================
- Break the question into its component parts and examine each systematically
- Identify the key variables, factors, or dimensions
- Analyze each component independently before synthesizing
- Show how the parts interact and what emerges from their combination`,

      deliberative: `
============================================
# REASONING MODE: DELIBERATIVE
============================================
- Think step-by-step through the problem; show your reasoning chain
- Consider multiple interpretations before settling on the best one
- Explicitly weigh evidence for and against each position
- State your assumptions and explain why they're reasonable
- Acknowledge where the reasoning is uncertain or could go wrong
- Arrive at a conclusion only after thorough examination of alternatives`,

      dialectical: `
============================================
# REASONING MODE: DIALECTICAL
============================================
- Present the strongest case for the primary position (thesis)
- Present the strongest case against it or for an alternative (antithesis)
- Synthesize the tension into a nuanced resolution (synthesis)
- Do not strawman any position; steelman every argument
- Let the reader see the full landscape of reasoning before your conclusion`,

      socratic: `
============================================
# REASONING MODE: SOCRATIC
============================================
- Before answering, identify and question the assumptions embedded in the question
- Probe the key terms: are they well-defined? Are they the right terms?
- Ask what would change the answer — what are the critical variables?
- Then provide your answer, informed by this deeper examination
- Note what the question itself might be missing or presuming`,
    },

    // ========================================
    // Citation Strictness
    // ========================================
    citationStrictness: {
      'key-claims': `
============================================
# CITATION STANDARD: KEY CLAIMS
============================================
- Cite sources for non-obvious, specific, or potentially disputed claims
- Common knowledge and well-established facts do not need citations
- When citing, provide the source name and, if possible, a URL or reference
- Distinguish between established facts and your analysis`,

      'all-claims': `
============================================
# CITATION STANDARD: ALL CLAIMS
============================================
- Every factual claim must be supported by a source or evidence basis
- Note the source inline: "[Source: organization/publication, year]" or URL
- If a claim cannot be sourced, explicitly note: "[Unverified]"
- Distinguish clearly between cited evidence, inference, and opinion
- When sources conflict, present the range of views and their relative weight`,

      academic: `
============================================
# CITATION STANDARD: ACADEMIC
============================================
- Use formal academic citation style (APA or numbered references)
- Prioritize peer-reviewed sources, official data, and primary documents
- Cite every claim that is not universally established common knowledge
- Include a reference list at the end of the response
- Note the limitations of cited studies (sample size, methodology, date)
- Prefer meta-analyses and systematic reviews over single studies`,
    },

    // ========================================
    // Tone
    // ========================================
    tone: {
      formal: `
============================================
# TONE: FORMAL
============================================
- Use formal, precise, academic language
- No contractions (do not, cannot, it is)
- Avoid colloquialisms, idioms, and casual expressions
- Maintain objective, impersonal register throughout
- Use passive voice where appropriate for emphasis on the subject matter`,

      professional: `
============================================
# TONE: PROFESSIONAL
============================================
- Use clear, business-appropriate language
- Respectful and precise; avoid slang and overly casual expressions
- Contractions are acceptable
- Direct and action-oriented where applicable
- Suitable for executive or stakeholder communication`,

      conversational: `
============================================
# TONE: CONVERSATIONAL
============================================
- Write as if speaking directly to the reader
- Use contractions, direct address ("you", "we"), and natural phrasing
- Avoid overly formal or stiff language
- Keep it approachable while maintaining accuracy and substance
- Use rhetorical questions and transitions that feel natural`,

      casual: `
============================================
# TONE: CASUAL
============================================
- Return a short quick answer in a casual, relaxed manner
- Write like you're texting or chatting with a knowledgeable friend
- Use contractions, colloquialisms, and informal phrasing freely
- Keep it light and approachable; skip formality entirely
- Substance matters, but delivery should feel effortless and natural`,

      authoritative: `
============================================
# TONE: AUTHORitative
============================================
- Speak with confidence and decisiveness
- Use strong, assertive language; avoid hedging where evidence supports it
- Frame recommendations as clear directives, not suggestions
- Project expertise and command of the subject
- When uncertainty exists, state it directly: "We don't yet know X"`,

      tentative: `
============================================
# TONE: TENTATIVE
============================================
- Default to careful, measured language
- Use hedging appropriately: "suggests," "appears to," "may indicate"
- Emphasize uncertainty and the limits of current knowledge
- Present multiple interpretations where the evidence is ambiguous
- Avoid overconfident claims when the evidence is thin`,
    },

    // ========================================
    // Creativity Level
    // ========================================
    creativityLevel: {
      'strictly-factual': `
============================================
# CREATIVITY: STRICTLY FACTUAL
============================================
- Only state verified, factual information
- No speculation, no hypotheticals, no "what if" scenarios
- If something is unknown, state "unknown" — do not speculate
- Clearly separate facts from the speaker's/author's opinions
- If asked for an opinion, frame it as "based on available evidence"`,

      'evidence-based': `
============================================
# CREATIVITY: EVIDENCE-BASED
============================================
- Ground all claims in evidence
- Reasonable inferences from established facts are acceptable
- When going beyond the data, label it clearly: "this suggests," "it is reasonable to infer"
- No pure speculation; every leap must be tethered to evidence`,

      balanced: `
============================================
# CREATIVITY: BALANCED
============================================
- Mix established facts with informed analysis
- Clearly label what is known vs. what is interpretation
- Exploratory thinking is welcome but must be distinguished from facts
- Include both the evidence-based answer and thoughtful extensions`,

      exploratory: `
============================================
# CREATIVITY: EXPLORATORY
============================================
- Go beyond established facts to explore hypotheses, alternatives, and possibilities
- Present speculative ideas but clearly label them as speculative
- Consider unconventional angles and interdisciplinary connections
- Use phrases like "one possibility is," "it's worth considering," "an emerging view"
- The goal is to expand the reader's thinking, not just report what's known`,

      creative: `
============================================
# CREATIVITY: CREATIVE
============================================
- Brainstorming mode: generate novel ideas, connections, and possibilities
- Prioritize originality and breadth over established certainty
- Label speculative content but do not let it limit the exploration
- Consider wild cards, edge cases, and unconventional perspectives
- The goal is generative thinking: what COULD be, not just what IS`,
    },

    // ========================================
    // Risk Posture
    // ========================================
    riskPosture: {
      conservative: `
============================================
# RISK POSTURE: CONSERVATIVE
============================================
- Favor proven, established, well-tested approaches
- Flag any recommendation that carries meaningful risk
- Default to the safer option when trade-offs are unclear
- Emphasize downside protection and contingency planning
- Note what could go wrong with every suggestion`,

      balanced: `
============================================
# RISK POSTURE: BALANCED
============================================
- Weigh risks against potential rewards fairly
- Moderate risk is acceptable for meaningful upside
- Present both the conservative and aggressive options with their trade-offs
- Recommend the approach with the best risk-adjusted expected value`,

      aggressive: `
============================================
# RISK POSTURE: AGGRESSIVE
============================================
- Favor high-upside options even if they carry significant risk
- Emphasize the cost of inaction or playing it too safe
- Recommend the approach with the highest potential return
- Note the risks but do not let them dominate the recommendation
- Acknowledge that big wins require accepting meaningful uncertainty`,
    },

    // ========================================
    // Output Format
    // ========================================
    outputFormat: {
      prose: `
============================================
# OUTPUT FORMAT: PROSE
============================================
- Write in flowing, well-structured paragraphs
- Avoid bullet points, tables, and lists unless absolutely necessary
- Use transitions to create narrative coherence between ideas
- Let the argument unfold naturally through prose`,

      bulleted: `
============================================
# OUTPUT FORMAT: BULLETED
============================================
- Present information as bullet points for maximum scannability
- Each bullet should be a complete thought
- Group related bullets under clear subheadings
- Keep bullets concise; use sub-bullets for supporting detail`,

      tabular: `
============================================
# OUTPUT FORMAT: TABULAR
============================================
- Present information in structured tables wherever possible
- Use tables for comparisons, rankings, metrics, and structured data
- Use prose only for context, interpretation, and recommendations
- Ensure tables are complete with clear column headers`,

      mixed: `
============================================
# OUTPUT FORMAT: MIXED
============================================
- Use the format that best serves the content: prose for context and argument, bullets for lists and criteria, tables for comparisons and data
- Let the structure follow the substance
- Default to clear section headings with appropriate format within each`,

      outline: `
============================================
# OUTPUT FORMAT: OUTLINE
============================================
- Present information as a hierarchical outline
- Use numbered and lettered levels (I, A, 1, a, i)
- Each node should be a concise phrase or sentence
- No prose paragraphs; structure only`,

      json: `
============================================
# OUTPUT FORMAT: JSON
============================================
- Return the response as valid, parseable JSON
- Use clear, descriptive keys
- Include all relevant information in the structured format
- No prose outside the JSON object
- Ensure the JSON is syntactically valid`,
    },

    // ========================================
    // Self-Correction
    // ========================================
    selfCorrection: {
      light: `
============================================
# SELF-CORRECTION: LIGHT
============================================
- Before responding, do a quick sanity check:
  - Does the answer actually address the question?
  - Are there any obvious factual errors?
- If something feels off, correct it before outputting`,

      thorough: `
============================================
# SELF-CORRECTION: THOROUGH
============================================
- Before outputting, systematically review your response:
  - ACCURACY: Are all factual claims correct? Flag any you're unsure about
  - COMPLETENESS: Did you address all parts of the question?
  - CONSISTENCY: Are there any internal contradictions?
  - RELEVANCE: Is every part of the response actually relevant?
  - CLARITY: Would someone unfamiliar with the topic understand this?
- If any check fails, revise before outputting`,

      iterative: `
============================================
# SELF-CORRECTION: ITERATIVE
============================================
- Draft your response, then critique it:
  - What are the weakest parts of this response?
  - What would an expert in the field challenge?
  - What important perspective is missing?
- Then revise based on your critique
- Output only the final, refined version`,
    },

    // ========================================
    // Confidence Expression
    // ========================================
    confidenceExpression: {
      definitive: `
============================================
# CONFIDENCE: DEFINITIVE
============================================
- State conclusions directly and without hedging
- When the evidence is strong, present it as settled
- Avoid phrases like "it seems," "possibly," "might" unless genuinely uncertain
- If you don't know something, say "I don't know" rather than hedging`,

      calibrated: `
============================================
# CONFIDENCE: CALIBRATED
============================================
- Express confidence proportionally to the strength of evidence
- Use language that reflects the quality of support: "strongly supported," "moderately likely," "uncertain"
- Distinguish clearly between well-established facts and areas of active debate
- Give numerical confidence or probability ranges where meaningful`,

      cautious: `
============================================
# CONFIDENCE: CAUTIOUS
============================================
- Default to expressing uncertainty
- Highlight what is NOT known as much as what IS known
- Use careful language: "the evidence suggests," "it appears," "current understanding holds"
- Note the conditions under which your answer might be wrong
- Emphasize the need for more data or further investigation`,
    },
  };

  return modifiers[key]?.[value] ?? '';
}

// ============================================================================
// Main Modifier Application
// ============================================================================

/**
 * Quick presets for common UI configuration scenarios.
 * These are pre-built combinations that cover typical use cases.
 */
export const PROMPT_PRESETS = {
  /** Quick answer for casual user */
  QuickAnswer: {
    responseDepth: ResponseDepth.Minimal,
    expertiseLevel: ExpertiseLevel.Informed,
    reasoningMode: ReasoningMode.Direct,
    tone: Tone.Conversational,
    citationStrictness: CitationStrictness.None,
    outputFormat: OutputFormat.Prose,
  } as PromptParameters,

  /** Short, expert-level answer */
  ExpertBrief: {
    responseDepth: ResponseDepth.Brief,
    expertiseLevel: ExpertiseLevel.Expert,
    reasoningMode: ReasoningMode.Direct,
    tone: Tone.Professional,
    citationStrictness: CitationStrictness.None,
    outputFormat: OutputFormat.Prose,
  } as PromptParameters,

  /** Standard professional response */
  StandardProfessional: {
    responseDepth: ResponseDepth.Standard,
    expertiseLevel: ExpertiseLevel.Practitioner,
    reasoningMode: ReasoningMode.Structured,
    tone: Tone.Professional,
    citationStrictness: CitationStrictness.KeyClaims,
    outputFormat: OutputFormat.Mixed,
  } as PromptParameters,

  /** Deep expert analysis */
  DeepExpertAnalysis: {
    responseDepth: ResponseDepth.Comprehensive,
    expertiseLevel: ExpertiseLevel.Expert,
    reasoningMode: ReasoningMode.Analytical,
    tone: Tone.Formal,
    citationStrictness: CitationStrictness.AllClaims,
    selfCorrection: SelfCorrection.Thorough,
    confidenceExpression: ConfidenceExpression.Calibrated,
    outputFormat: OutputFormat.Mixed,
  } as PromptParameters,

  /** Maximum rigor — peer-review level */
  MaximumRigor: {
    responseDepth: ResponseDepth.Exhaustive,
    expertiseLevel: ExpertiseLevel.WorldClass,
    reasoningMode: ReasoningMode.Deliberative,
    tone: Tone.Formal,
    citationStrictness: CitationStrictness.Academic,
    selfCorrection: SelfCorrection.Iterative,
    confidenceExpression: ConfidenceExpression.Calibrated,
    creativityLevel: CreativityLevel.StrictlyFactual,
    outputFormat: OutputFormat.Mixed,
  } as PromptParameters,

  /** Casual explanation for beginners */
  CasualExplanation: {
    responseDepth: ResponseDepth.Detailed,
    expertiseLevel: ExpertiseLevel.Layperson,
    reasoningMode: ReasoningMode.Structured,
    tone: Tone.Casual,
    citationStrictness: CitationStrictness.None,
    creativityLevel: CreativityLevel.Exploratory,
    outputFormat: OutputFormat.Bulleted,
  } as PromptParameters,

  /** Brainstorming / ideation mode */
  Brainstorming: {
    responseDepth: ResponseDepth.Detailed,
    expertiseLevel: ExpertiseLevel.Practitioner,
    reasoningMode: ReasoningMode.Dialectical,
    tone: Tone.Conversational,
    creativityLevel: CreativityLevel.Creative,
    riskPosture: RiskPosture.Aggressive,
    outputFormat: OutputFormat.Bulleted,
  } as PromptParameters,

  /** Executive summary for decision-makers */
  ExecutiveSummary: {
    responseDepth: ResponseDepth.Standard,
    expertiseLevel: ExpertiseLevel.Informed,
    reasoningMode: ReasoningMode.Structured,
    tone: Tone.Authoritative,
    citationStrictness: CitationStrictness.KeyClaims,
    riskPosture: RiskPosture.Conservative,
    outputFormat: OutputFormat.Tabular,
  } as PromptParameters,

  /** Teaching / tutoring mode */
  Teaching: {
    responseDepth: ResponseDepth.Detailed,
    expertiseLevel: ExpertiseLevel.Layperson,
    reasoningMode: ReasoningMode.Deliberative,
    tone: Tone.Conversational,
    citationStrictness: CitationStrictness.KeyClaims,
    creativityLevel: CreativityLevel.EvidenceBased,
    outputFormat: OutputFormat.Mixed,
    selfCorrection: SelfCorrection.Thorough,
  } as PromptParameters,

  /** Research assistant mode — maximum thoroughness */
  ResearchAssistant: {
    responseDepth: ResponseDepth.Exhaustive,
    expertiseLevel: ExpertiseLevel.Practitioner,
    reasoningMode: ReasoningMode.Deliberative,
    tone: Tone.Formal,
    citationStrictness: CitationStrictness.AllClaims,
    selfCorrection: SelfCorrection.Thorough,
    confidenceExpression: ConfidenceExpression.Calibrated,
    outputFormat: OutputFormat.Mixed,
  } as PromptParameters,
};

/**
 * Type-safe preset key type.
 */
export type PromptPresetKey = keyof typeof PROMPT_PRESETS;

/**
 * Get a preset by name.
 */
export function getPreset(name: PromptPresetKey): PromptParameters {
  return { ...PROMPT_PRESETS[name] };
}

/**
 * Merge a preset with custom overrides.
 * Custom values override the preset's defaults.
 */
export function applyPresetWithOverrides(
  preset: PromptPresetKey,
  overrides: Partial<PromptParameters>,
): PromptParameters {
  return { ...PROMPT_PRESETS[preset], ...overrides };
}

/**
 * Merge two parameter configurations.
 * Second config overrides the first.
 */
export function mergePromptParameters(
  base: PromptParameters,
  overrides: PromptParameters,
): PromptParameters {
  return { ...base, ...overrides };
}

/**
 * Check if any modifiers are actually set (non-default).
 */
export function hasActiveModifiers(
  params: PromptParameters,
  defaults: PromptParameters = DEFAULT_PROMPT_PARAMETERS,
): boolean {
  for (const [key, value] of Object.entries(params)) {
    if (key === 'customInstructions') {
      if (value && (value as string).trim()) return true;
      continue;
    }
    if (value !== undefined && value !== defaults[key as keyof PromptParameters]) {
      return true;
    }
  }
  return false;
}

// ============================================================================
// Modifier Text Composition Cache (O(1) lookup by parameter hash)
// ============================================================================

const PARAMETER_KEYS = [
  'responseDepth',
  'expertiseLevel',
  'reasoningMode',
  'citationStrictness',
  'tone',
  'creativityLevel',
  'riskPosture',
  'outputFormat',
  'selfCorrection',
  'confidenceExpression',
  'customInstructions',
] as const;

/**
 * Generate a stable cache key from parameter values.
 * Used to memoize modifier text and avoid re-generating identical text.
 */
function paramsCacheKey(params: PromptParameters): string {
  const parts: string[] = [];
  for (const key of PARAMETER_KEYS) {
    const value = params[key as keyof PromptParameters];
    if (value !== undefined) {
      // Include customInstructions in cache key (hash long strings to keep key short)
      if (key === 'customInstructions' && typeof value === 'string') {
        if (value.trim()) {
          let hash = 0;
          for (let i = 0; i < value.length; i++) {
            hash = ((hash << 5) - hash) + value.charCodeAt(i);
            hash = hash & hash;
          }
          parts.push(`${key}=hash:${Math.abs(hash)}`);
        }
      } else {
        parts.push(`${key}=${value}`);
      }
    }
  }
  return parts.length > 0 ? parts.join('&') : '__empty__';
}

const MODIFIER_CACHE = new Map<string, string>();

/**
 * Apply prompt modifiers to generate a suffix that modifies any base prompt.
 * Uses a composition cache for O(1) lookup of previously generated text.
 *
 * @param params - The prompt parameter configuration (any field optional)
 * @returns A string to append to the base role prompt
 */
export function applyPromptModifiers(params: PromptParameters): string {
  const cacheKey = paramsCacheKey(params);
  const cached = MODIFIER_CACHE.get(cacheKey);
  if (cached !== undefined) return cached;

  const result = _applyPromptModifiersInternal(params);
  MODIFIER_CACHE.set(cacheKey, result);
  return result;
}

function _applyPromptModifiersInternal(params: PromptParameters): string {
  const parts: string[] = [];

  // Generate modifier text for each set parameter
  for (const [key, value] of Object.entries(params)) {
    if (key === 'customInstructions') continue;
    if (value === undefined || value === null) continue;

    const modifierText = generateModifierText(key, value);
    if (modifierText) {
      parts.push(modifierText);
    }
  }

  // Append custom instructions if provided
  if (params.customInstructions?.trim()) {
    parts.push(`
============================================
# CUSTOM INSTRUCTIONS
============================================
${params.customInstructions.trim()}
`);
  }

  if (parts.length === 0) return '';

  const result = `
${parts.join('\n')}
`;
  return result;
}

/**
 * Clear the modifier text composition cache.
 * Useful when modifier definitions change.
 */
export function clearModifierCache(): void {
  MODIFIER_CACHE.clear();
}

// ============================================================================
// Debug Header Generation (for observability and debugging)
// ============================================================================

/**
 * Generate a compact debug header value describing active parameters.
 * Suitable for inclusion in HTTP response headers.
 * Format: "preset=DeepExpertAnalysis|depth=comprehensive|expertise=expert|..."
 */
export function generateDebugHeaderValue(
  params: PromptParameters,
  presetKey?: string | null,
): string {
  const parts: string[] = [];

  if (presetKey) {
    parts.push(`preset=${presetKey}`);
  }

  for (const key of PARAMETER_KEYS) {
    if (key === 'customInstructions') continue;
    const value = params[key as keyof PromptParameters];
    if (value !== undefined && value !== (DEFAULT_PROMPT_PARAMETERS as any)[key]) {
      parts.push(`${key.replace(/([A-Z])/g, '-$1').toLowerCase()}=${value}`);
    }
  }

  return parts.length > 0 ? parts.join('|') : 'default';
}

// ============================================================================
// Telemetry Hooks (non-blocking, privacy-respecting usage analytics)
// ============================================================================

export interface TelemetryEvent {
  type: 'response_style_applied';
  presetKey: string | null;
  parameters: Record<string, string>;
  timestamp: number;
  hasCustomInstructions: boolean;
}

export type TelemetryCallback = (event: TelemetryEvent) => void;

const TELEMETRY_CALLBACKS = new Set<TelemetryCallback>();

/**
 * Register a telemetry callback to receive usage analytics events.
 * The callback is called synchronously when prompt modifiers are applied.
 * Callbacks are non-blocking and should not throw.
 *
 * @returns An unsubscribe function
 */
export function onTelemetryEvent(callback: TelemetryCallback): () => void {
  TELEMETRY_CALLBACKS.add(callback);
  return () => { TELEMETRY_CALLBACKS.delete(callback); };
}

/**
 * Emit a telemetry event for the given parameters.
 * Called internally by applyPromptModifiers.
 */
export function emitTelemetryEvent(
  params: PromptParameters,
  presetKey?: string | null,
): void {
  if (TELEMETRY_CALLBACKS.size === 0) return;

  const parameters: Record<string, string> = {};
  for (const key of PARAMETER_KEYS) {
    if (key === 'customInstructions') continue;
    const value = params[key as keyof PromptParameters];
    if (value !== undefined) {
      parameters[key] = String(value);
    }
  }

  const event: TelemetryEvent = {
    type: 'response_style_applied',
    presetKey: presetKey ?? null,
    parameters,
    timestamp: Date.now(),
    hasCustomInstructions: !!params.customInstructions?.trim(),
  };

  // Fire-and-forget: callbacks should not throw, but guard anyway
  for (const callback of TELEMETRY_CALLBACKS) {
    try { callback(event); } catch { /* ignore */ }
  }
}

// ============================================================================
// Preset Composition (build custom presets from parameter fragments)
// ============================================================================

export interface PresetFragment {
  /** Human-readable name for this fragment */
  name: string;
  /** Parameters to set */
  params: Partial<PromptParameters>;
}

/**
 * Compose a custom preset from multiple named fragments.
 * Later fragments override earlier ones for overlapping keys.
 * Useful for building presets from modular, reusable pieces.
 *
 * @example
 * ```ts
 * const composed = composePreset(
 *   { name: 'deep', params: { responseDepth: ResponseDepth.Comprehensive } },
 *   { name: 'expert', params: { expertiseLevel: ExpertiseLevel.Expert } },
 *   { name: 'formal', params: { tone: Tone.Formal } },
 * );
 * // Result: { responseDepth: 'comprehensive', expertiseLevel: 'expert', tone: 'formal' }
 * ```
 */
export function composePreset(...fragments: PresetFragment[]): PromptParameters {
  const composed: PromptParameters = {};
  for (const fragment of fragments) {
    Object.assign(composed, fragment.params);
  }
  return composed;
}

