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

const projectMap = new Map<string, ProjectServices>();

export function getProjectServices(ctx: ProjectContext): ProjectServices {
  let services = projectMap.get(ctx.id);
  if (services) return services;

  const vectorStore = createVectorStore();
  const embedder = getEmbeddingProvider();
  const retrieval = new RetrievalPipeline(vectorStore, embedder);

  services = { context: ctx, vectorStore, retrieval };
  projectMap.set(ctx.id, services);

  return services;
}

export function removeProjectServices(projectId: string): boolean {
  return projectMap.delete(projectId);
}

export function listProjects(): ProjectContext[] {
  return Array.from(projectMap.values()).map((s) => s.context);
}
