/**
 * Research Task — Trigger.dev v3
 *
 * Long-running research workflow with durable execution.
 * Survives server restarts and retries on failure.
 */
import { task } from "@trigger.dev/sdk/v3";
import { createLogger } from "@/lib/utils/logger";

const logger = createLogger("Trigger:Research");

export const researchTask = task({
  id: "research-task",
  maxDuration: 3600,
  retry: { maxAttempts: 3, factor: 2, minTimeoutInMs: 2000, maxTimeoutInMs: 30000, randomize: true },
  run: async (payload: {
    query: string;
    depth?: number;
    sources?: Array<'web' | 'news' | 'academic' | 'code'>;
    userId?: string;
    sessionId?: string;
  }) => {
    logger.info("[research-task] Starting research", {
      query: payload.query,
      depth: payload.depth,
    });

    const origin = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

    const searchResponse = await fetch(`${origin}/api/news?search=${encodeURIComponent(payload.query)}`);
    if (!searchResponse.ok) {
      throw new Error(`Search API returned ${searchResponse.status}`);
    }

    const searchData = await searchResponse.json();
    const articles = searchData.articles?.slice(0, 20) || [];

    return {
      query: payload.query,
      results: articles.map((a: any) => ({
        title: a.title,
        url: a.url,
        source: a.source,
        summary: a.summary,
      })),
      synthesis: `Research results for: ${payload.query}`,
      sourcesCount: articles.length,
    };
  },
});
