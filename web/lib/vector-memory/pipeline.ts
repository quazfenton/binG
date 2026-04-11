/**
 * Pipeline Abstraction
 * 
 * Composable async pipeline for indexing, embedding, and retrieval flows.
 * Steps can be conditionally swapped based on platform capabilities.
 * 
 * @module vector-memory/pipeline
 */

import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('Pipeline');

export type PipelineStep<T> = (input: T) => Promise<T>;

export function createPipeline<T>(
  name: string,
  steps: PipelineStep<T>[]
): (input: T) => Promise<T> {
  return async (input: T) => {
    let result = input;
    for (let i = 0; i < steps.length; i++) {
      try {
        result = await steps[i](result);
      } catch (error) {
        logger.error(`Pipeline "${name}" failed at step ${i}`, error);
        throw error;
      }
    }
    return result;
  };
}

export type TaskNode = {
  id: string;
  run: () => Promise<void>;
  deps?: string[];
};

export async function runTaskGraph(nodes: TaskNode[]): Promise<void> {
  const completed = new Set<string>();

  async function runNode(node: TaskNode): Promise<void> {
    if (completed.has(node.id)) return;

    for (const dep of node.deps ?? []) {
      const depNode = nodes.find((n) => n.id === dep);
      if (depNode && !completed.has(dep)) {
        await runNode(depNode);
      }
    }

    await node.run();
    completed.add(node.id);
  }

  for (const node of nodes) {
    await runNode(node);
  }
}
