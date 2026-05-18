/**
 * Parser service — offloads heavy parsing to worker threads.
 *
 * Currently a stub: worker_threads are not compatible with Next.js static export builds.
 * When needed, implement using the standard Node.js worker_threads pattern
 * with a webpack loader configuration in next.config.mjs.
 */

class ParserService {
  private pendingTasks = new Map<string, { resolve: Function; reject: Function }>();

  public async runTask<T>(_type: string, _data: any): Promise<T> {
    throw new Error(
      'ParserService requires Node.js worker_threads runtime — ' +
      'not available in static export. Implement via webpack loader config when needed.'
    );
  }
}

export const parserService = new ParserService();
