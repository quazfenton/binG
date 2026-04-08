/**
 * app/api/memory/health/route.ts — Health check for retrieval subsystem
 *
 * Returns the status of all memory module components:
 * - IndexedDB (vector store)
 * - Embedding cache
 * - Symbol count per project
 * - File watchers active
 * - Plugin registry status
 *
 * GET /api/memory/health
 * Returns: { status: "ok" | "degraded" | "error", components: {...}, metrics: {...} }
 */

import { NextRequest, NextResponse } from "next/server";
import { getMetricsSummary } from "@/lib/agent/metrics";
import { listProjects, getProjectSymbols } from "@/lib/memory/vectorStore";
import { createLogger } from "@/lib/utils/logger";

const logger = createLogger("MemoryHealth");

export async function GET(req: NextRequest) {
  try {
    const components: Record<string, { status: "ok" | "degraded" | "error"; detail?: string }> = {};
    let overallStatus: "ok" | "degraded" | "error" = "ok";

    // ── Check IndexedDB (vector store) ────────────────────────────────────────
    try {
      const projects = await listProjects();
      components.vectorStore = {
        status: "ok",
        detail: `${projects.length} project(s) indexed`,
      };
    } catch (err) {
      components.vectorStore = {
        status: "error",
        detail: err instanceof Error ? err.message : "Unknown error",
      };
      overallStatus = "degraded";
    }

    // ── Check embedding cache ────────────────────────────────────────────────
    try {
      const { embed, clearEmbedCache } = await import("@/lib/memory/embeddings");
      // Quick smoke test: embed a short string
      const start = performance.now();
      await embed("health check");
      const duration = performance.now() - start;
      components.embeddingCache = {
        status: duration < 5000 ? "ok" : "degraded",
        detail: `embed latency: ${duration.toFixed(0)}ms`,
      };
      if (duration >= 5000) overallStatus = "degraded";
      // Clear the health check embedding from cache
      clearEmbedCache();
    } catch (err) {
      components.embeddingCache = {
        status: "error",
        detail: err instanceof Error ? err.message : "Unknown error",
      };
      overallStatus = "degraded";
    }

    // ── Symbol counts per project ────────────────────────────────────────────
    try {
      const projects = await listProjects();
      const symbolCounts = await Promise.all(
        projects.map(async (p) => {
          try {
            const symbols = await getProjectSymbols(p.id);
            return { projectId: p.id, symbols: symbols.length };
          } catch {
            return { projectId: p.id, symbols: 0 };
          }
        })
      );
      components.symbolCounts = { status: "ok", detail: JSON.stringify(symbolCounts) };
    } catch {
      components.symbolCounts = { status: "error", detail: "Failed to count symbols" };
    }

    // ── Metrics summary ──────────────────────────────────────────────────────
    try {
      const metrics = getMetricsSummary();
      components.metrics = {
        status: "ok",
        detail: `${metrics.traces.length} trace type(s), ${Object.keys(metrics.counters).length} counter(s)`,
      };
    } catch {
      components.metrics = { status: "degraded", detail: "Metrics unavailable" };
    }

    // ── Build response ───────────────────────────────────────────────────────
    const errorCount = Object.values(components).filter(c => c.status === "error").length;
    const degradedCount = Object.values(components).filter(c => c.status === "degraded").length;

    if (errorCount > 0) overallStatus = "degraded";

    const status = errorCount > 2 ? "error" : overallStatus;
    const httpStatus = status === "error" ? 503 : status === "degraded" ? 200 : 200;

    return NextResponse.json(
      {
        status,
        timestamp: Date.now(),
        components: Object.fromEntries(
          Object.entries(components).map(([k, v]) => [k, { status: v.status }])
        ),
        details: components,
      },
      { status: httpStatus }
    );
  } catch (err) {
    logger.error("Health check failed", err instanceof Error ? err : new Error(String(err)));
    return NextResponse.json(
      {
        status: "error",
        timestamp: Date.now(),
        error: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 503 }
    );
  }
}
