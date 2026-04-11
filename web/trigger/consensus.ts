/**
 * Multi-Agent Consensus Task — Trigger.dev v3
 *
 * Registered task that dispatches to the agent team consensus executor.
 * Uses durable execution so multi-agent deliberation survives restarts.
 */
import { task } from "@trigger.dev/sdk/v3";
import { createLogger } from "@/lib/utils/logger";

const logger = createLogger("Trigger:Consensus");

export const consensusTask = task({
  id: "consensus-task",
  maxDuration: 3600,
  retry: { maxAttempts: 3, factor: 2, minTimeoutInMs: 2000, maxTimeoutInMs: 30000, randomize: true },
  run: async (payload: {
    task: string;
    agents: Array<{ role: string; type: string; model?: string; weight?: number }>;
    workspaceDir: string;
    maxIterations?: number;
    timeout?: number;
    consensusThreshold?: number;
  }) => {
    logger.info("[consensus] Starting consensus task", {
      agentCount: payload.agents.length,
      task: payload.task,
    });

    const { createAgentTeam } = await import("@/lib/spawn/orchestration/agent-team");

    const team = await createAgentTeam({
      name: "Consensus Team",
      agents: payload.agents.map(a => ({
        role: a.role as any,
        type: a.type as any,
        model: a.model,
        weight: a.weight,
      })),
      workspaceDir: payload.workspaceDir,
      strategy: "consensus",
      maxIterations: payload.maxIterations || 3,
      timeout: payload.timeout || 60000,
    });

    const result = await team.execute({ task: payload.task });

    return {
      success: true,
      output: result.output,
      consensusScore: result.consensusScore || 0,
      contributions: (result.contributions || []).map(c => ({
        agentId: c.role || "unknown",
        contribution: c.content || "",
      })),
    };
  },
});
