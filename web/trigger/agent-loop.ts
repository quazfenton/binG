/**
 * Agent Loop Task — Trigger.dev v3
 *
 * Registered task that dispatches to the core agent loop.
 * Uses durable execution so long-running agent conversations survive
 * server restarts, with automatic retries on failure.
 */
import { task } from "@trigger.dev/sdk/v3";
import { createLogger } from "@/lib/utils/logger";

const logger = createLogger("Trigger:AgentLoop");

export const agentLoopTask = task({
  id: "agent-loop",
  // Allow up to 1 hour for complex multi-step agent conversations
  maxDuration: 3600,
  // Retry with exponential backoff
  retry: { maxAttempts: 3, factor: 2, minTimeoutInMs: 2000, maxTimeoutInMs: 30000, randomize: true },
  run: async (payload: {
    userMessage: string;
    sandboxId: string;
    userId?: string;
    conversationHistory?: any[];
  }) => {
    logger.info("[agent-loop] Starting agent loop via Trigger.dev", {
      sandboxId: payload.sandboxId,
      userId: payload.userId,
    });

    const { runAgentLoop } = await import("@/lib/orchestra/agent-loop");

    const result = await runAgentLoop({
      userMessage: payload.userMessage,
      sandboxId: payload.sandboxId,
      userId: payload.userId,
      conversationHistory: payload.conversationHistory,
    });

    logger.info("[agent-loop] Agent loop completed", {
      totalSteps: result.totalSteps,
    });

    return result;
  },
});
