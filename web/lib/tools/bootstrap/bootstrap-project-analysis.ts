/**
 * Register Project Analysis Tools
 *
 * Registers project-analysis tools as built-in capabilities:
 * - project.analyze      — Deep project analysis with structured JSON output
 * - project.list_scripts — All runnable scripts/tasks from any project type
 * - project.dependencies — Installed packages, version conflicts, issues
 * - project.structure    — Semantic file tree with notable items
 *
 * These replace the shallow buildProjectContext() + markdown blob approach
 * with queryable, structured MCP tools that the LLM can call on demand.
 */

import type { ToolRegistry } from '../registry';
import type { BootstrapConfig } from '../bootstrap';
import {
  PROJECT_ANALYZE_CAPABILITY,
  PROJECT_LIST_SCRIPTS_CAPABILITY,
  PROJECT_DEPENDENCIES_CAPABILITY,
  PROJECT_STRUCTURE_CAPABILITY,
  analyzeProject,
  listScripts,
  getDependencies,
  buildProjectStructure,
} from '../project-analysis';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('Tools:ProjectAnalysis-Bootstrap');

/**
 * Register project analysis tools
 *
 * @param registry - Tool registry instance
 * @param config - Bootstrap configuration
 * @returns Number of tools registered
 */
export async function registerProjectAnalysisTools(
  registry: ToolRegistry,
  config: BootstrapConfig,
): Promise<number> {
  let count = 0;

  // Register capabilities
  const capabilities = [
    PROJECT_ANALYZE_CAPABILITY,
    PROJECT_LIST_SCRIPTS_CAPABILITY,
    PROJECT_DEPENDENCIES_CAPABILITY,
    PROJECT_STRUCTURE_CAPABILITY,
  ];

  for (const capability of capabilities) {
    await registry.registerCapability(capability);
    count++;
  }

  // Register tool implementations
  const tools = [
    {
      name: 'project-analysis:analyze',
      capability: 'project.analyze',
      provider: 'project-analysis',
      handler: async (args: any, context: any) => {
        const ownerId = context.userId || 'anonymous';
        return analyzeProject(ownerId, {
          includeDependencies: args.includeDependencies ?? false,
        });
      },
      metadata: {
        latency: 'medium',
        cost: 'low',
        reliability: 0.99,
        tags: ['project', 'analyze', 'detection'],
      },
      permissions: ['file:read'],
    },
    {
      name: 'project-analysis:list-scripts',
      capability: 'project.list_scripts',
      provider: 'project-analysis',
      handler: async (_args: any, context: any) => {
        const ownerId = context.userId || 'anonymous';
        const scripts = await listScripts(ownerId);
        return { scripts };
      },
      metadata: {
        latency: 'low',
        cost: 'low',
        reliability: 0.99,
        tags: ['project', 'scripts', 'tasks'],
      },
      permissions: ['file:read'],
    },
    {
      name: 'project-analysis:dependencies',
      capability: 'project.dependencies',
      provider: 'project-analysis',
      handler: async (_args: any, context: any) => {
        const ownerId = context.userId || 'anonymous';
        return getDependencies(ownerId);
      },
      metadata: {
        latency: 'low',
        cost: 'low',
        reliability: 0.99,
        tags: ['project', 'dependencies', 'packages'],
      },
      permissions: ['file:read'],
    },
    {
      name: 'project-analysis:structure',
      capability: 'project.structure',
      provider: 'project-analysis',
      handler: async (args: any, context: any) => {
        const { virtualFilesystem } = await import('@/lib/virtual-filesystem/virtual-filesystem-service');
        const ownerId = context.userId || 'anonymous';
        const workspace = await virtualFilesystem.exportWorkspace(ownerId);
        const filePaths = workspace.files.map(f => f.path);

        const result = buildProjectStructure(filePaths, args.maxDepth ?? 5);

        // If summaryOnly, omit the full tree
        if (args.summaryOnly) {
          return {
            fileCount: result.fileCount,
            dirCount: result.dirCount,
            fileTypes: result.fileTypes,
            summary: result.summary,
            notableItems: result.notableItems,
          };
        }

        return result;
      },
      metadata: {
        latency: 'low',
        cost: 'low',
        reliability: 0.99,
        tags: ['project', 'structure', 'tree'],
      },
      permissions: ['file:read'],
    },
  ];

  for (const tool of tools) {
    await registry.registerTool(tool);
    count++;
  }

  logger.info(`Registered ${count} project analysis tools/capabilities`);
  return count;
}

/**
 * Unregister project analysis tools
 *
 * @param registry - Tool registry instance
 */
export async function unregisterProjectAnalysisTools(registry: ToolRegistry): Promise<void> {
  const tools = registry.getAllTools().filter(t => t.provider === 'project-analysis');
  for (const tool of tools) {
    await registry.unregisterTool(tool.name);
  }
  logger.info(`Unregistered ${tools.length} project analysis tools`);
}
