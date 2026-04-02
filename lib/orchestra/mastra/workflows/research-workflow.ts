/**
 * Research Workflow
 *
 * Multi-step research workflow with source collection, analysis, and synthesis.
 * Implements planner → researcher → analyst → synthesizer pattern.
 *
 * @module orchestra/mastra/workflows/research-workflow
 */

import { createWorkflow, createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import { getModel } from '../models/model-router';

// ===========================================
// Schema Definitions
// ===========================================

export const ResearchInput = z.object({
  topic: z.string().describe('Research topic or question'),
  depth: z.number().min(1).max(10).default(5).describe('Research depth (1-10)'),
  sources: z.array(z.string()).optional().describe('Initial source URLs'),
  ownerId: z.string().describe('Workspace owner ID'),
});

export const ResearchPlan = z.object({
  questions: z.array(z.string()).describe('Key research questions'),
  sources: z.array(z.object({
    url: z.string(),
    relevance: z.number(),
    type: z.string(),
  })),
  methodology: z.string(),
});

export const SourceAnalysis = z.object({
  url: z.string(),
  summary: z.string(),
  keyPoints: z.array(z.string()),
  credibility: z.number().min(0).max(1),
  relevance: z.number().min(0).max(1),
});

export const ResearchSynthesis = z.object({
  executiveSummary: z.string(),
  findings: z.array(z.string()),
  sources: z.array(z.string()),
  confidence: z.number().min(0).max(1),
  limitations: z.array(z.string()).optional(),
});

// ===========================================
// Step Definitions
// ===========================================

/**
 * Step 1: Research Planner
 *
 * Creates research plan with questions and sources
 */
export const researchPlannerStep = createStep({
  id: 'research-planner',
  inputSchema: ResearchInput,
  outputSchema: z.object({
    plan: ResearchPlan,
    ownerId: z.string(),
  }),
  execute: async ({ inputData }) => {
    const { topic, depth, sources, ownerId } = inputData;
    const agent = getModel('reasoning');

    const response = await agent.generate([
      {
        role: 'system',
        content: `You are a research planning agent. Create a comprehensive research plan.

Output JSON format:
{
  "questions": ["Key research question 1", "Key research question 2"],
  "sources": [
    {
      "url": "https://example.com",
      "relevance": 0.9,
      "type": "academic" | "news" | "blog" | "documentation"
    }
  ],
  "methodology": "Description of research approach"
}

Consider:
- Academic sources for technical topics
- News sources for current events
- Documentation for technical specifications
- Multiple perspectives for controversial topics`,
      },
      { role: 'user', content: `Research topic: ${topic}\nDepth: ${depth}\nInitial sources: ${sources?.join(', ') || 'None'}` },
    ]);

    const plan = JSON.parse(response.text.trim());

    return { plan, ownerId };
  },
  retries: 2,
});

/**
 * Step 2: Source Researcher
 *
 * Collects information from identified sources
 */
export const researcherStep = createStep({
  id: 'researcher',
  inputSchema: ResearchInput.extend({
    plan: ResearchPlan,
  }).extend({
    questions: z.array(z.string()),
  }),
  outputSchema: z.object({
    analyses: z.array(SourceAnalysis),
    collectedData: z.string(),
    topic: z.string(),
    questions: z.array(z.string()),
    plan: ResearchPlan,
    ownerId: z.string(),
  }),
  execute: async ({ inputData }) => {
    const { topic, plan, ownerId, questions } = inputData;
    const agent = getModel('fast');
    const analyses: Array<{ url: string; summary: string; keyPoints: string[]; credibility: number; relevance: number }> = [];

    // Simulate source analysis (in production, would fetch actual URLs)
    for (const source of plan.sources.slice(0, 5)) {
      try {
        const response = await agent.generate([
          {
            role: 'system',
            content: `Analyze this research source and extract key information.

Output JSON format:
{
  "summary": "Brief summary of content",
  "keyPoints": ["Key point 1", "Key point 2"],
  "credibility": 0.8,
  "relevance": 0.9
}`,
          },
          { role: 'user', content: `Source: ${source.url}\nType: ${source.type}\nTopic: ${questions.join(', ')}` },
        ]);

        const analysis = JSON.parse(response.text.trim());
        analyses.push({
          url: source.url,
          ...analysis,
        });
      } catch (error) {
        console.warn('Failed to analyze source:', source.url, error);
      }
    }

    const collectedData = analyses
      .map(a => `Source: ${a.url}\nSummary: ${a.summary}\nKey Points: ${a.keyPoints.join('\n')}`)
      .join('\n\n');

    return { analyses, collectedData, topic, questions, plan, ownerId };
  },
  retries: 1,
});

/**
 * Step 3: Data Analyst
 *
 * Analyzes collected information for patterns and insights
 */
export const analystStep = createStep({
  id: 'analyst',
  inputSchema: z.object({
    topic: z.string(),
    questions: z.array(z.string()),
    collectedData: z.string(),
    analyses: z.array(SourceAnalysis),
    plan: ResearchPlan,
    ownerId: z.string(),
  }),
  outputSchema: z.object({
    insights: z.array(z.string()),
    patterns: z.array(z.string()),
    contradictions: z.array(z.string()).optional(),
    gaps: z.array(z.string()).optional(),
    topic: z.string(),
    questions: z.array(z.string()),
    analyses: z.array(SourceAnalysis),
    plan: ResearchPlan,
    ownerId: z.string(),
  }),
  execute: async ({ inputData }) => {
    const { topic, questions, collectedData, analyses, plan, ownerId } = inputData;
    const agent = getModel('reasoning');

    const response = await agent.generate([
      {
        role: 'system',
        content: `You are a research analyst. Analyze the collected data and identify insights, patterns, contradictions, and gaps.

Output JSON format:
{
  "insights": ["Key insight 1", "Key insight 2"],
  "patterns": ["Pattern 1", "Pattern 2"],
  "contradictions": ["Contradiction 1 (optional)"],
  "gaps": ["Gap 1 (optional)"]
}

Consider:
- Consensus across multiple sources
- Conflicting information
- Missing perspectives
- Quality of evidence`,
      },
      { role: 'user', content: `Topic: ${topic}\nQuestions: ${questions.join(', ')}\n\nData:\n${collectedData}` },
    ]);

    const result = JSON.parse(response.text.trim());

    return {
      ...result,
      topic,
      questions,
      analyses,
      plan,
      ownerId,
    };
  },
  retries: 2,
});

/**
 * Step 4: Synthesizer
 *
 * Synthesizes analysis into comprehensive research report
 */
export const synthesizerStep = createStep({
  id: 'synthesizer',
  inputSchema: z.object({
    topic: z.string(),
    questions: z.array(z.string()),
    insights: z.array(z.string()),
    patterns: z.array(z.string()),
    analyses: z.array(SourceAnalysis),
    plan: ResearchPlan,
    ownerId: z.string(),
  }),
  outputSchema: z.object({
    synthesis: ResearchSynthesis,
    insights: z.array(z.string()),
    analyses: z.array(SourceAnalysis),
    plan: ResearchPlan,
    topic: z.string(),
    questions: z.array(z.string()),
    ownerId: z.string(),
  }),
  execute: async ({ inputData }) => {
    const { topic, questions, insights, patterns, analyses, plan, ownerId } = inputData;
    const agent = getModel('reasoning');

    const response = await agent.generate([
      {
        role: 'system',
        content: `You are a research synthesizer. Create a comprehensive research synthesis.

Output JSON format:
{
  "executiveSummary": "2-3 paragraph summary",
  "findings": ["Finding 1", "Finding 2"],
  "sources": ["Source 1", "Source 2"],
  "confidence": 0.85,
  "limitations": ["Limitation 1 (optional)"]
}

Consider:
- Answer all research questions
- Weight findings by source credibility
- Acknowledge uncertainty
- Cite sources properly`,
      },
      { role: 'user', content: `Topic: ${topic}\nQuestions: ${questions.join('\n')}\n\nInsights: ${insights.join('\n')}\nPatterns: ${patterns.join('\n')}\nSources: ${analyses.map(a => `${a.url} (credibility: ${a.credibility})`).join('\n')}` },
    ]);

    const synthesis = JSON.parse(response.text.trim());

    return {
      synthesis,
      insights,
      analyses,
      plan,
      topic,
      questions,
      ownerId,
    };
  },
  retries: 2,
});

// ===========================================
// Workflow Definition
// ===========================================

export const researchWorkflow = createWorkflow({
  id: 'research',
  inputSchema: ResearchInput,
  outputSchema: z.object({
    synthesis: ResearchSynthesis,
    plan: ResearchPlan,
    analyses: z.array(SourceAnalysis),
    insights: z.array(z.string()),
    topic: z.string(),
    questions: z.array(z.string()),
    ownerId: z.string(),
  }),
  retryConfig: {
    attempts: 2,
    delay: 1000,
  },
})
  .then(researchPlannerStep)
  .then(researcherStep)
  .then(analystStep)
  .then(synthesizerStep)
  .commit();

export function getResearchWorkflow() {
  return researchWorkflow;
}
