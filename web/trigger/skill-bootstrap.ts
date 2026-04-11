/**
 * Skill Bootstrap Task — Trigger.dev v3
 *
 * Durable skill extraction from successful agent runs.
 * Retries on failure so skills aren't lost from transient errors.
 */
import { task } from "@trigger.dev/sdk/v3";
import { createLogger } from "@/lib/utils/logger";

const logger = createLogger("Trigger:SkillBootstrap");

export const skillBootstrapTask = task({
  id: "skill-bootstrap",
  maxDuration: 300,
  retry: { maxAttempts: 3, factor: 2, minTimeoutInMs: 2000, maxTimeoutInMs: 30000, randomize: true },
  run: async (payload: {
    successfulRun: {
      steps: Array<{ action: string; result: any; success: boolean }>;
      totalDuration: number;
      userId: string;
    };
    model?: string;
  }) => {
    const { handleSkillBootstrap } = await import("@/lib/events/handlers/bing-handlers");

    const mockEvent = {
      id: `skill-${Date.now()}`,
      type: "SKILL_BOOTSTRAP" as const,
      userId: payload.successfulRun.userId,
      payload: {
        successfulRun: payload.successfulRun,
        model: payload.model,
      },
      createdAt: Date.now().toString(),
      status: "pending" as const,
      retryCount: 0,
    };

    const result = await handleSkillBootstrap(mockEvent);

    logger.info("[skill-bootstrap] Skill extracted", {
      skillId: result.skillId,
      success: result.success,
    });

    return {
      success: result.success,
      skillId: result.skillId,
      skill: result.skill,
    };
  },
});
