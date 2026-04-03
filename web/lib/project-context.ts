/**
 * Project Context
 *
 * Provides project-scoped services and memory isolation.
 * Each project gets its own vector store, cache, and file context.
 *
 * @module project-context
 */

import { createVectorStore } from '@/lib/vector-memory/store';
import { getEmbeddingProvider } from '@/lib/vector-memory/embeddings';
import { RetrievalPipeline } from '@/lib/vector-memory/retrieval';
import type { VectorStore, EmbeddingProvider } from '@/lib/vector-memory/types';

const MAX_PROJECTS = 50; // LRU-style eviction limit

export interface ProjectContext {
  id: string;
  name: string;
  root?: string;
}

export interface ProjectServices {
  context: ProjectContext;
  vectorStore: VectorStore;
  retrieval: RetrievalPipeline;
}

const projectMap = new Map<string, { services: ProjectServices; lastAccessed: number }>();

/**
 * Get or create project-scoped services.
 * Evicts least-recently-used projects when the limit is reached.
 */
export function getProjectServices(ctx: ProjectContext): ProjectServices {
  const existing = projectMap.get(ctx.id);
  if (existing) {
    existing.lastAccessed = Date.now();
    return existing.services;
  }

  // Evict LRU project if at capacity
  if (projectMap.size >= MAX_PROJECTS) {
    let lruKey: string | null = null;
    let lruTime = Infinity;
    for (const [key, val] of projectMap.entries()) {
      if (val.lastAccessed < lruTime) {
        lruTime = val.lastAccessed;
        lruKey = key;
      }
    }
    if (lruKey) {
      projectMap.delete(lruKey);
    }
  }

  const vectorStore = createVectorStore();
  const embedder = getEmbeddingProvider();
  const retrieval = new RetrievalPipeline(vectorStore, embedder);

  const services: ProjectServices = { context: ctx, vectorStore, retrieval };
  projectMap.set(ctx.id, { services, lastAccessed: Date.now() });

  return services;
}

export function removeProjectServices(projectId: string): boolean {
  return projectMap.delete(projectId);
}

export function listProjects(): ProjectContext[] {
  return Array.from(projectMap.values()).map((entry) => entry.services.context);
}
