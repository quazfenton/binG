/**
 * Reflection Task — Trigger.dev v3
 *
 * Post-execution analysis via the reflection engine.
 */
import { task } from "@trigger.dev/sdk/v3";
import { createLogger } from "@/lib/utils/logger";
import { reflectionEngine } from "@/lib/orchestra/reflection-engine";

const logger = createLogger("Trigger:Reflection");

export const reflectionTask = task({
  id: "reflection-task",
  maxDuration: 300,
  retry: { maxAttempts: 2, factor: 2, minTimeoutInMs: 1000, maxTimeoutInMs: 10000, randomize: true },
  run: async (payload: {
    executionId: string;
    result: any;
    error?: string;
    history?: Array<{ action: string; result: any; timestamp: number }>;
    enableLLM?: boolean;
  }) => {
    const content = JSON.stringify({
      result: payload.result,
      error: payload.error,
      history: payload.history?.slice(-10),
    }, null, 2);

    const reflections = await reflectionEngine.reflect(content);
    const summary = reflectionEngine.synthesizeReflections(reflections);

    return {
      analysis: summary.overallScore > 0.8
        ? "Execution successful, minor improvements possible"
        : payload.error
        ? `Error analysis: ${payload.error}`
        : "Execution needs improvement",
      improvements: summary.prioritizedImprovements || [],
      overallScore: summary.overallScore,
      confidenceLevel: summary.confidenceLevel,
      timestamp: Date.now(),
    };
  },
});
