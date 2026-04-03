/**
 * Spec Generator Prompt
 * 
 * Engineered to return structured JSON with improvement plans
 * Used for dual-path inference system
 * 
 * @see https://github.com/quazfenton/binG/docs/sdk/PHASE_1_MODEL_RANKER.md
 */

export interface Spec {
  /** Primary goal of the improvement plan */
  goal: string
  
  /** Sections of improvements */
  sections: {
    /** Section title */
    title: string
    /** Actionable tasks */
    tasks: string[]
    /** Optional priority (1-5, 1 = highest) */
    priority?: number
  }[]
  
  /** Optional execution strategy */
  execution_strategy?: string
  
  /** Optional clarification questions */
  clarification_questions?: string[]
}

/**
 * Build spec generator prompt
 * 
 * @param userInput - Original user request
 * @param context - Optional additional context
 * @returns Messages array for LLM call
 */
export function buildSpecPrompt(
  userInput: string,
  context?: string
): Array<{ role: 'system' | 'user'; content: string }> {
  return [
    {
      role: 'system',
      content: `You are an elite software architect and code quality expert.

Your job:
Take a user request and assume an AI gave a mediocre/subpar implementation.

Generate a structured improvement plan that will significantly enhance the result.

STRICT RULES:
- No fluff or generic advice
- No explanations unless absolutely necessary
- Focus on EXECUTION and IMPLEMENTATION
- Prefer depth over breadth
- Be specific and actionable
- Return ONLY valid JSON (no markdown, no code blocks)

EVALUATION CRITERIA:
- Would this plan make the output measurably better?
- Are the tasks specific enough to execute immediately?
- Does this address real gaps, not just cosmetic changes?

FORMAT (strict JSON):
{
  "goal": "Primary improvement objective",
  "sections": [
    {
      "title": "Section name",
      "tasks": ["Specific task 1", "Specific task 2"],
      "priority": 1
    }
  ],
  "execution_strategy": "How to approach improvements",
  "clarification_questions": ["Question to user if needed"]
}

EXAMPLE INPUT:
"Build a Next.js portfolio website"

EXAMPLE OUTPUT:
{
  "goal": "Transform basic portfolio into production-ready showcase with modern UX",
  "sections": [
    {
      "title": "Component Architecture",
      "tasks": [
        "Create reusable layout components (Header, Footer, MainLayout)",
        "Implement atomic design pattern for UI components",
        "Add TypeScript interfaces for all props",
        "Set up component storybook for documentation"
      ],
      "priority": 1
    },
    {
      "title": "Interactive Features",
      "tasks": [
        "Add smooth scroll animations with Framer Motion",
        "Implement dark/light theme toggle with persistence",
        "Create interactive project cards with hover effects",
        "Add contact form with real-time validation"
      ],
      "priority": 2
    },
    {
      "title": "Performance Optimization",
      "tasks": [
        "Implement next/image for optimized image loading",
        "Add lazy loading for below-fold content",
        "Configure proper caching headers",
        "Set up bundle analysis and code splitting"
      ],
      "priority": 3
    }
  ],
  "execution_strategy": "Start with component architecture, then add features incrementally, optimize last",
  "clarification_questions": []
}`
    },
    {
      role: 'user',
      content: context 
        ? `Request: ${userInput}\n\nContext: ${context}`
        : userInput
    }
  ]
}

/**
 * Validate spec structure
 * 
 * @param spec - Spec to validate
 * @returns True if valid, false otherwise
 */
export function validateSpec(spec: any): spec is Spec {
  if (!spec || typeof spec !== 'object') {
    return false
  }
  
  if (!spec.goal || typeof spec.goal !== 'string') {
    return false
  }
  
  // Goal must be meaningful length
  if (spec.goal.length < 10) {
    return false
  }
  
  if (!Array.isArray(spec.sections)) {
    return false
  }
  
  if (spec.sections.length === 0) {
    return false
  }
  
  for (const section of spec.sections) {
    if (!section.title || typeof section.title !== 'string') {
      return false
    }
    
    if (!Array.isArray(section.tasks)) {
      return false
    }
    
    if (section.tasks.length === 0) {
      return false
    }
    
    // Each task must be meaningful length
    if (!section.tasks.every(t => typeof t === 'string' && t.length > 5)) {
      return false
    }
    
    if (section.priority && (typeof section.priority !== 'number' || section.priority < 1 || section.priority > 5)) {
      return false
    }
  }
  
  // Optional fields validation
  if (spec.execution_strategy && typeof spec.execution_strategy !== 'string') {
    return false
  }
  
  if (spec.clarification_questions && !Array.isArray(spec.clarification_questions)) {
    return false
  }
  
  return true
}

/**
 * Get spec quality score (1-10)
 * 
 * @param spec - Spec to score
 * @returns Quality score (0 if invalid)
 */
export function scoreSpec(spec: Spec | null): number {
  if (!spec || !validateSpec(spec)) {
    return 0
  }
  
  let score = 0
  
  // Goal clarity (0-2 points)
  if (spec.goal && spec.goal.length > 20) score += 2
  else if (spec.goal && spec.goal.length > 10) score += 1
  
  // Section quality (0-4 points)
  const goodSections = spec.sections.filter(s => 
    s.tasks.length >= 2 && 
    s.tasks.every(t => t.length > 10)
  )
  score += Math.min(goodSections.length, 4)
  
  // Execution strategy (0-2 points)
  if (spec.execution_strategy && spec.execution_strategy.length > 30) score += 2
  else if (spec.execution_strategy && spec.execution_strategy.length > 15) score += 1
  
  // Prioritization (0-2 points)
  const prioritizedSections = spec.sections.filter(s => s.priority)
  if (prioritizedSections.length > 0) {
    score += Math.min((prioritizedSections.length / spec.sections.length) * 2, 2)
  }
  
  return Math.min(score, 10)
}

/**
 * Get spec complexity score (1-5)
 * 
 * @param spec - Spec to score
 * @returns Complexity score
 */
export function getSpecComplexity(spec: Spec): number {
  const totalTasks = spec.sections.reduce((sum, s) => sum + s.tasks.length, 0)
  
  if (totalTasks <= 5) return 1
  if (totalTasks <= 10) return 2
  if (totalTasks <= 20) return 3
  if (totalTasks <= 30) return 4
  return 5
}
