'use client';

import { useMemo } from 'react';
import { secureRandom } from '@/lib/utils';

export const LEVEL_0_SUGGESTIONS: string[] = [
  'unique app ideas',
  'code a basic web app',
  'make an addicting web game',
  'show me something interesting',
  'explain quantum computing simply',
  'create a business plan',
  'write a short story',
  'design a logo concept',
  'plan a workout routine',
  'suggest healthy recipes',
  'debug this error',
  'optimize my workflow',
  'build a personal portfolio site',
  'teach me a new skill step by step',
  'create a data visualization',
  'design a mobile app mockup',
  'write a REST API spec',
  'generate a color palette',
  'plan a marketing campaign',
  'create a landing page design',
  'build a CLI tool',
  'set up a dev environment',
  'analyze a dataset',
  'create an interactive dashboard',
  'build a real-time chat app',
  'write a Docker Compose file',
  'design a microservices architecture',
  'plan a database schema',
];

export const LEVEL_1_SUGGESTIONS: string[] = [
  'run the project and show me a preview',
  'build upon this with more features',
  'refactor the code for better maintainability',
  'add tests for the existing functionality',
  'optimize performance and fix any bottlenecks',
  'fix any bugs or edge cases',
  'add error handling and input validation',
  'improve the UI and make it look polished',
  'add more comments and documentation',
  'make it responsive for mobile devices',
  'add environment variable configuration',
  'add input sanitization and security hardening',
  'extract reusable components or functions',
  'add loading states and skeleton screens',
  'add keyboard shortcuts and accessibility',
  'create a development seed script',
  'add request retry and offline support',
];

export const LEVEL_2_SUGGESTIONS: string[] = [
  'review the full codebase for best practices',
  'integrate with an external API or service',
  'set up authentication and user management',
  'add a database layer and persistence',
  'create a CI/CD pipeline',
  'deploy the application to production',
  'add comprehensive documentation and API docs',
  'implement monitoring and logging',
  'add state management and data flow',
  'create end-to-end integration tests',
  'set up feature flags and gradual rollout',
  'add rate limiting and request throttling',
  'implement caching with Redis or CDN',
  'add search functionality with indexing',
  'set up WebSocket for real-time updates',
  'create an admin dashboard and audit log',
  'add file upload and media processing',
  'implement role-based access control',
  'set up multi-tenancy support',
  'add internationalization and localization',
  'build a plugin or extension system',
  'set up data backup and disaster recovery',
  'add webhook integrations for external events',
  'implement A/B testing infrastructure',
];

export const NO_FILES_TECH: string[] = [
  'show me a complete code implementation',
  'walk through the implementation step by step',
  'what are the edge cases and how do I handle them?',
  'compare different libraries or approaches',
  'provide a working example I can run',
  'what is the best practice for this pattern?',
  'show the project structure I should use',
  'what dependencies and versions do I need?',
  'how do I test this in different environments?',
  'what are common pitfalls and gotchas?',
];

export const NO_FILES_CONCEPT: string[] = [
  'give me a real-world analogy to understand this',
  'explain the underlying principles and theory',
  'how does this compare to alternative approaches?',
  'what are the practical applications of this?',
  'summarize the key points with concrete examples',
  'what prerequisite knowledge do I need?',
  'how has this evolved or changed over time?',
  'what are the limitations or trade-offs?',
  'can you visualize or diagram this concept?',
  'what are common misconceptions about this?',
];

export const NO_FILES_CREATIVE: string[] = [
  'help me refine and expand this idea further',
  'suggest alternative directions or plot twists',
  'provide examples in different styles or genres',
  'help me structure this into a full piece',
  'what would make this more compelling?',
  'give me variations I can remix',
  'what tone or voice would work best here?',
  'help me develop the characters or setting',
  'what are the emotional beats I should hit?',
  'suggest imagery or sensory details to include',
];

export const NO_FILES_ADVICE: string[] = [
  'what factors should I consider before deciding?',
  'what are the pros and cons of each option?',
  'can you provide more context or background?',
  'what are some alternative approaches?',
  'what would you recommend and why?',
  'what are the risks and how can I mitigate them?',
  'what does success look like and how do I measure it?',
  'what resources or tools would help me get started?',
  'who are the key stakeholders I should involve?',
  'what timeline or milestones should I plan for?',
];

export const NO_FILES_GENERAL: string[] = [
  'go deeper into that explanation',
  'provide concrete examples',
  'explain the trade-offs and alternatives',
  'summarize the key takeaways',
  'what should I try next?',
  'compare different approaches',
  'walk me through it step by step',
  'give me a quick reference or cheat sheet',
  'what questions should I ask myself about this?',
  'connect this to other topics I might know',
];

export type QueryCategory = 'tech' | 'concept' | 'creative' | 'advice' | 'general';

export function categorizeQuery(prompt: string): QueryCategory {
  const lower = prompt.toLowerCase();

  const isCreative =
    /write|create|design|craft|compose|draft|story|poem|essay|blog|article|script|logo|art|image|music|song|lyrics|dialogue|narrative/.test(lower);
  const isTech =
    /code|implement|program|function|api|endpoint|app|web|app|debug|error|bug|fix|refactor|test|deploy|docker|database|server|client|frontend|backend|framework|library|npm|package|config|build|compile|syntax|variable|loop|class|function|component|hook|state|props/.test(lower);
  const isConcept =
    /explain|what is|how does|why|describe|define|understand|concept|theory|principle|meaning|difference between|compare|contrast|definition/.test(lower);
  const isAdvice =
    /should|recommend|advice|best|opinion|thoughts|suggest|tip|trick|strategy|approach|how (should|can|do) i|what (is the best|should i|would you)/.test(lower);

  if (isTech) return 'tech';
  if (isConcept) return 'concept';
  if (isCreative) return 'creative';
  if (isAdvice) return 'advice';
  return 'general';
}

function pickRandom<T>(items: T[], count: number): T[] {
  const shuffled = [...items].sort(() => 0.5 - secureRandom());
  return shuffled.slice(0, count);
}

const NO_FILES_POOLS: Record<QueryCategory, string[]> = {
  tech: NO_FILES_TECH,
  concept: NO_FILES_CONCEPT,
  creative: NO_FILES_CREATIVE,
  advice: NO_FILES_ADVICE,
  general: NO_FILES_GENERAL,
};

export interface UseChatSuggestionsOptions {
  hasFiles: boolean;
  messageCount: number;
  count?: number;
  lastUserPrompt?: string;
}

export function useChatSuggestions({
  hasFiles,
  messageCount,
  count = 4,
  lastUserPrompt,
}: UseChatSuggestionsOptions): string[] {
  return useMemo(() => {
    let pool: string[];

    if (hasFiles && messageCount >= 2) {
      const combined = [...LEVEL_1_SUGGESTIONS, ...LEVEL_2_SUGGESTIONS];
      pool = pickRandom(combined, count + 4);
    } else if (hasFiles && messageCount >= 1) {
      pool = pickRandom(LEVEL_1_SUGGESTIONS, count + 4);
    } else if (messageCount > 0 && lastUserPrompt) {
      const category = categorizeQuery(lastUserPrompt);
      const primary = NO_FILES_POOLS[category];
      const fallback = NO_FILES_GENERAL;
      const half = Math.ceil(count / 2);
      const primaryPicks = pickRandom(primary, half);
      const fallbackPicks = pickRandom(
        fallback.filter((s) => !primaryPicks.includes(s)),
        count - half,
      );
      pool = [...primaryPicks, ...fallbackPicks];
    } else if (messageCount > 0) {
      pool = pickRandom(NO_FILES_GENERAL, count + 4);
    } else {
      pool = pickRandom(LEVEL_0_SUGGESTIONS, count + 4);
    }

    return pickRandom(pool, count);
  }, [hasFiles, messageCount, count, lastUserPrompt]);
}
