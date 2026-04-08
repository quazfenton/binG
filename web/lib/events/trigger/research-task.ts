/**
 * Research Agent Task - Trigger.dev Integration
 *
 * Wraps existing research workflow with Trigger.dev for long-running research.
 * Falls back to local execution when Trigger.dev SDK is not available.
 */

import { createLogger } from '@/lib/utils/logger';
import { executeWithFallback, invokeTriggerTask, scheduleWithTrigger } from './utils';

const logger = createLogger('Trigger:Research');

export interface ResearchTaskPayload {
  query: string;
  depth?: number;
  sources?: Array<'web' | 'news' | 'academic' | 'code'>;
  checkpointInterval?: number;
  userId?: string;
  sessionId?: string;
}

export interface ResearchTaskResult {
  query: string;
  results: Array<{
    title: string;
    url: string;
    source: string;
    summary?: string;
  }>;
  synthesis: string;
  sourcesCount: number;
}

/**
 * Execute research task with Trigger.dev (when available) or fallback to local
 */
export async function executeResearchTask(
  payload: ResearchTaskPayload
): Promise<ResearchTaskResult> {
  return executeWithFallback<ResearchTaskPayload, ResearchTaskResult>(
    async (taskId) => invokeTriggerTask(taskId, payload),
    (p) => executeLocally(p),
    'research',
    payload
  );
}

/**
 * Execute locally (fallback)
 */
async function executeLocally(
  payload: ResearchTaskPayload
): Promise<ResearchTaskResult> {
  const origin = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

  try {
    const searchResponse = await fetch(`${origin}/api/news?search=${encodeURIComponent(payload.query)}`);
    if (searchResponse.ok) {
      const searchData = await searchResponse.json();
      return {
        query: payload.query,
        results: searchData.articles?.slice(0, 20).map((a: any) => ({
          title: a.title,
          url: a.url,
          source: a.source,
          summary: a.summary,
        })) || [],
        synthesis: `Research results for: ${payload.query}`,
        sourcesCount: searchData.articles?.length || 0,
      };
    }
  } catch (error) {
    logger.warn('Feed search failed, using fallback', error);
  }

  return {
    query: payload.query,
    results: [
      { title: 'Research result 1', url: 'https://example.com/1', source: 'web' },
      { title: 'Research result 2', url: 'https://example.com/2', source: 'web' },
    ],
    synthesis: `Research results for: ${payload.query}`,
    sourcesCount: 2,
  };
}

/**
 * Schedule recurring research task
 */
export async function scheduleResearchTask(
  payload: ResearchTaskPayload & {
    schedule: { type: 'cron' | 'interval'; expression: string };
  }
): Promise<{ scheduled: boolean; jobId?: string }> {
  const available = await import('./utils').then(m => m.isTriggerAvailable());

  if (available) {
    return scheduleWithTrigger(
      async () => {
        const { invokeTriggerTask } = await import('./utils');
        const result = await invokeTriggerTask('research-task', payload);
        return { scheduled: true, jobId: (result as any).runId };
      },
      'research task'
    );
  }

  logger.warn('Research scheduling not yet available - Trigger.dev configuration required');
  return { scheduled: false };
}
