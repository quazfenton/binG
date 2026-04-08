/**
 * DAG Task — Trigger.dev v3
 *
 * Durable workflow execution for bash/tool DAGs with automatic retries.
 */
import { task } from "@trigger.dev/sdk/v3";
import { createLogger } from "@/lib/utils/logger";

const logger = createLogger("Trigger:DAG");

export const dagTask = task({
  id: "dag-task",
  maxDuration: 3600,
  retry: { maxAttempts: 3, factor: 2, minTimeoutInMs: 2000, maxTimeoutInMs: 30000, randomize: true },
  run: async (payload: {
    dag: {
      nodes: Array<{ id: string; type: string; command?: string; dependsOn: string[] }>;
      edges: Array<{ from: string; to: string }>;
    };
    agentId: string;
    workingDir: string;
    env?: Record<string, string>;
    maxRetries?: number;
    healOnFailure?: boolean;
    parallel?: boolean;
  }) => {
    logger.info("[dag-task] Starting DAG execution", {
      nodeCount: payload.dag.nodes.length,
      edgeCount: payload.dag.edges.length,
    });

    const { executeDAGSmart, executeDAGWithRetry } = await import("@/lib/bash/dag-executor");

    const ctx = {
      agentId: payload.agentId,
      workingDir: payload.workingDir,
      env: payload.env,
      results: {},
      optimize: true,
      parallel: payload.parallel !== false,
    };

    let result: any;
    if (payload.maxRetries && payload.maxRetries > 0) {
      result = await executeDAGWithRetry(payload.dag, ctx, payload.maxRetries);
    } else {
      result = await executeDAGSmart(payload.dag, ctx);
    }

    return {
      success: result.success ?? true,
      nodeResults: result.nodeResults || {},
      outputs: result.outputs || {},
      duration: result.duration || 0,
      errors: result.errors || [],
    };
  },
});
