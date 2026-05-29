/**
 * Register Workspace Analysis Tools
 *
 * Registers workspace-analysis tools as built-in capabilities:
 * - workspace.analyze      — Deep workspace analysis with structured JSON output
 * - workspace.list_scripts — All runnable scripts/tasks from any workspace type
 * - workspace.dependencies — Installed packages, version conflicts, issues
 * - workspace.structure    — Semantic file tree with notable items
 *
 * These replace the shallow buildProjectContext() + markdown blob approach
 * with queryable, structured MCP tools that the LLM can call on demand.
 */

import type { ToolRegistry, RegisteredTool } from '../registry';
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
} from '../../tools/project-analysis';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('Tools:ProjectAnalysis-Bootstrap');

/**
 * Register workspace analysis tools
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
  const tools: Array<Omit<RegisteredTool, 'inputSchema' | 'outputSchema'>> = [
    {
      name: 'workspace-analysis:analyze',
      capability: 'workspace.analyze',
      provider: 'workspace-analysis',
      handler: async (args: any, context: any) => {
        // Normalize ownerId: 'anonymous' -> 'anon:public', 'anon_timestamp' -> 'anon:timestamp'
        let ownerId = context.userId || 'anon:public';
        if (ownerId.startsWith('anon_')) {
          ownerId = ownerId.replace(/^anon_/, 'anon:');
        } else if (ownerId === 'anonymous') {
          ownerId = 'anon:public';
        }
        return analyzeProject(ownerId, {
          includeDependencies: args.includeDependencies ?? false,
        });
      },
      metadata: {
        latency: 'medium',
        cost: 'low',
        reliability: 0.99,
        tags: ['workspace', 'analyze', 'detection'],
      },
      permissions: ['file:read'],
    },
    {
      name: 'workspace-analysis:list-scripts',
      capability: 'workspace.list_scripts',
      provider: 'workspace-analysis',
      handler: async (_args: any, context: any) => {
        // Normalize ownerId: 'anonymous' -> 'anon:public', 'anon_timestamp' -> 'anon:timestamp'
        let ownerId = context.userId || 'anon:public';
        if (ownerId.startsWith('anon_')) {
          ownerId = ownerId.replace(/^anon_/, 'anon:');
        } else if (ownerId === 'anonymous') {
          ownerId = 'anon:public';
        }
        const scripts = await listScripts(ownerId);
        return { scripts };
      },
      metadata: {
        latency: 'low',
        cost: 'low',
        reliability: 0.99,
        tags: ['workspace', 'scripts', 'tasks'],
      },
      permissions: ['file:read'],
    },
    {
      name: 'workspace-analysis:dependencies',
      capability: 'workspace.dependencies',
      provider: 'workspace-analysis',
      handler: async (_args: any, context: any) => {
        // Normalize ownerId: 'anonymous' -> 'anon:public', 'anon_timestamp' -> 'anon:timestamp'
        let ownerId = context.userId || 'anon:public';
        if (ownerId.startsWith('anon_')) {
          ownerId = ownerId.replace(/^anon_/, 'anon:');
        } else if (ownerId === 'anonymous') {
          ownerId = 'anon:public';
        }
        return getDependencies(ownerId);
      },
      metadata: {
        latency: 'low',
        cost: 'low',
        reliability: 0.99,
        tags: ['workspace', 'dependencies', 'packages'],
      },
      permissions: ['file:read'],
    },
    {
      name: 'workspace-analysis:structure',
      capability: 'workspace.structure',
      provider: 'workspace-analysis',
      handler: async (args: any, context: any) => {
        const { virtualFilesystem } = await import('@/lib/virtual-filesystem/virtual-filesystem-service');
        // Normalize ownerId: 'anonymous' -> 'anon:public', 'anon_timestamp' -> 'anon:timestamp'
        let ownerId = context.userId || 'anon:public';
        if (ownerId.startsWith('anon_')) {
          ownerId = ownerId.replace(/^anon_/, 'anon:');
        } else if (ownerId === 'anonymous') {
          ownerId = 'anon:public';
        }
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
        tags: ['workspace', 'structure', 'tree'],
      },
      permissions: ['file:read'],
    },
  ];

  for (const tool of tools) {
    await registry.registerTool(tool);
    count++;
  }

  logger.info(`Registered ${count} workspace analysis tools/capabilities`);
  return count;
}

/**
 * Unregister workspace analysis tools
 *
 * @param registry - Tool registry instance
 */
export async function unregisterProjectAnalysisTools(registry: ToolRegistry): Promise<void> {
  const tools = registry.getAllTools().filter(t => t.provider === 'workspace-analysis');
  for (const tool of tools) {
    await registry.unregisterTool(tool.name);
  }
  logger.info(`Unregistered ${tools.length} workspace analysis tools`);
}
