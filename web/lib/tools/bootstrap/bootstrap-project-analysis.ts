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
 *
 * CRITICAL: In addition to ToolRegistry registration, this bootstrap also
 * registers a 'workspace-analysis' provider with the CapabilityRouter so that
 * capability execution via router.execute() can find it. Without this,
 * both the agent-loop and MCP-server execution paths would fail at runtime
 * because CapabilityRouter.initialize() only registers built-in providers
 * (VFS, ripgrep, terminal, etc.) — 'workspace-analysis' is not one of them.
 */

import type { ToolRegistry, RegisteredTool } from '../registry';
import type { BootstrapConfig } from '../bootstrap';
import {
  PROJECT_ANALYZE_CAPABILITY,
  PROJECT_LIST_SCRIPTS_CAPABILITY,
  PROJECT_DEPENDENCIES_CAPABILITY,
  PROJECT_STRUCTURE_CAPABILITY,
  WORKSPACE_CAS_STATS_CAPABILITY,
  WORKSPACE_IMAGE_STATS_CAPABILITY,
  WORKSPACE_AFFINITY_STATS_CAPABILITY,
  WORKSPACE_AFFINITY_CONFIG_CAPABILITY,
  WORKSPACEFS_SYNC_STATUS_CAPABILITY,
  WORKSPACEFS_R2_STATUS_CAPABILITY,
  WORKSPACEFS_MIGRATE_CAPABILITY,
  analyzeProject,
  listScripts,
  getDependencies,
  buildProjectStructure,
} from '../../tools/project-analysis';
import { createLogger } from '@/lib/utils/logger';
import { getCapabilityRouter } from '../router';

const logger = createLogger('Tools:ProjectAnalysis-Bootstrap');

/**
 * Register a provider for the CapabilityRouter so that
 * 'workspace.analyze', 'workspace.list_scripts', 'workspace.dependencies',
 * and 'workspace.structure' capabilities can be resolved at runtime via
 * router.execute().
 *
 * The CapabilityRouter does NOT auto-discover providers from the
 * ToolRegistry — they must be explicitly registered via registerProvider().
 */
async function registerCapabilityRouterProvider(): Promise<void> {
  const router = getCapabilityRouter();

  // Ensure router is initialized before registering custom provider
  if (!(router as any).initialized) {
    await router.initialize();
  }

  await router.registerCustomProvider({
    id: 'workspace-analysis',
    name: 'Workspace Analysis',
    capabilities: [
      'workspace.analyze',
      'workspace.list_scripts',
      'workspace.dependencies',
      'workspace.structure',
      'workspace.cas_stats',
      'workspace.image_stats',
      'workspace.affinity_stats',
      'workspace.affinity_config',
      'workspacefs.sync_status',
      'workspacefs.r2_status',
      'workspacefs.migrate_workspace',
    ],
    isAvailable: async () => {
      try {
        // Check if the project analysis module can be loaded
        await import('../../tools/project-analysis');
        return true;
      } catch {
        return false;
      }
    },
    execute: async (capabilityId: string, input: any, context: any) => {
      // Normalize ownerId: 'anonymous' -> 'anon:public', 'anon_timestamp' -> 'anon:timestamp'
      let ownerId = (typeof context?.userId === 'string' ? context.userId : 'anon:public');
      if (ownerId.startsWith('anon_')) {
        ownerId = ownerId.replace(/^anon_/, 'anon:');
      } else if (ownerId === 'anonymous') {
        ownerId = 'anon:public';
      }

      try {
        let output: any;
        switch (capabilityId) {
          case 'workspace.analyze':
            output = await analyzeProject(ownerId, {
              includeDependencies: input.includeDependencies ?? false,
            });
            break;
          case 'workspace.list_scripts':
            output = { scripts: await listScripts(ownerId) };
            break;
          case 'workspace.dependencies':
            output = await getDependencies(ownerId);
            break;
          case 'workspace.structure': {
            const { virtualFilesystem } = await import('@/lib/virtual-filesystem/virtual-filesystem-service');
            const workspace = await virtualFilesystem.exportWorkspace(ownerId);
            const filePaths = workspace.files.map(f => f.path);
            output = buildProjectStructure(filePaths, input.maxDepth ?? 5);
            if (input.summaryOnly) {
              output = {
                fileCount: output.fileCount,
                dirCount: output.dirCount,
                fileTypes: output.fileTypes,
                summary: output.summary,
                notableItems: output.notableItems,
              };
            }
            break;
          }
          case 'workspace.cas_stats': {
            const { getContentAddressableStorage } = await import('@/lib/storage/content-addressable-storage');
            const cas = getContentAddressableStorage();
            await cas.initialize();
            const stats = await cas.getStats();
            output = {
              ...stats,
              dedupRatio: stats.totalBlobs > 0 && stats.totalRefs > 0
                ? parseFloat((stats.totalRefs / stats.totalBlobs).toFixed(2))
                : null,
            };
            break;
          }
          case 'workspace.image_stats': {
            const { workspaceImageRegistry } = await import('@/lib/sandbox/workspace-image-registry');
            output = workspaceImageRegistry.getStats();
            break;
          }
          case 'workspace.affinity_stats': {
            const { sandboxOrchestrator } = await import('@/lib/sandbox/sandbox-orchestrator');
            output = sandboxOrchestrator.getAffinityStats();
            break;
          }
          case 'workspace.affinity_config': {
            const { sandboxOrchestrator } = await import('@/lib/sandbox/sandbox-orchestrator');
            output = sandboxOrchestrator.getAffinityConfig();
            break;
          }
          case 'workspacefs.sync_status': {
            const { workspaceFSSyncService } = await import('@/lib/sandbox/workspacefs-sync-service');
            const wsId = input.workspaceId || `${ownerId}:${context?.conversationId || 'default'}`;
            output = await workspaceFSSyncService.getSyncState(wsId, ownerId);
            break;
          }
          case 'workspacefs.r2_status': {
            const { workspaceFSSyncService } = await import('@/lib/sandbox/workspacefs-sync-service');
            output = workspaceFSSyncService.getR2Status();
            break;
          }
          case 'workspacefs.migrate_workspace': {
            const { workspaceFSSyncService } = await import('@/lib/sandbox/workspacefs-sync-service');
            output = await workspaceFSSyncService.syncForMigration(
              input.workspaceId,
              ownerId,
              input.fromProvider,
              input.toProvider,
              input.sourceSandboxId,
              input.destSandboxId,
            );
            break;
          }
          default:
            return { success: false, error: `Unknown capability: ${capabilityId}` };
        }
        return { success: true, output, data: output };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },
  });

  logger.info('Registered workspace-analysis provider in CapabilityRouter');
}

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
    WORKSPACE_CAS_STATS_CAPABILITY,
    WORKSPACE_IMAGE_STATS_CAPABILITY,
    WORKSPACE_AFFINITY_STATS_CAPABILITY,
    WORKSPACE_AFFINITY_CONFIG_CAPABILITY,
    WORKSPACEFS_SYNC_STATUS_CAPABILITY,
    WORKSPACEFS_R2_STATUS_CAPABILITY,
    WORKSPACEFS_MIGRATE_CAPABILITY,
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
        let ownerId = (typeof context.userId === 'string' ? context.userId : 'anon:public');
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
        let ownerId = (typeof context.userId === 'string' ? context.userId : 'anon:public');
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
        let ownerId = (typeof context.userId === 'string' ? context.userId : 'anon:public');
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
        let ownerId = (typeof context.userId === 'string' ? context.userId : 'anon:public');
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
    {
      name: 'workspace-analysis:cas-stats',
      capability: 'workspace.cas_stats',
      provider: 'workspace-analysis',
      handler: async (_args: any, _context: any) => {
        const { getContentAddressableStorage } = await import('@/lib/storage/content-addressable-storage');
        const cas = getContentAddressableStorage();
        await cas.initialize();
        const stats = await cas.getStats();
        return {
          ...stats,
          dedupRatio: stats.totalBlobs > 0 && stats.totalRefs > 0
            ? parseFloat((stats.totalRefs / stats.totalBlobs).toFixed(2))
            : null,
        };
      },
      metadata: {
        latency: 'low',
        cost: 'low',
        reliability: 0.99,
        tags: ['workspace', 'cas', 'storage', 'observability'],
      },
      permissions: [],
    },
    {
      name: 'workspace-analysis:image-stats',
      capability: 'workspace.image_stats',
      provider: 'workspace-analysis',
      handler: async (_args: any, _context: any) => {
        const { workspaceImageRegistry } = await import('@/lib/sandbox/workspace-image-registry');
        return workspaceImageRegistry.getStats();
      },
      metadata: {
        latency: 'low',
        cost: 'low',
        reliability: 0.99,
        tags: ['workspace', 'image', 'synthesis', 'phase7', 'cache'],
      },
      permissions: [],
    },
    {
      name: 'workspace-analysis:affinity-stats',
      capability: 'workspace.affinity_stats',
      provider: 'workspace-analysis',
      handler: async (_args: any, _context: any) => {
        const { sandboxOrchestrator } = await import('@/lib/sandbox/sandbox-orchestrator');
        return sandboxOrchestrator.getAffinityStats();
      },
      metadata: {
        latency: 'low',
        cost: 'low',
        reliability: 0.99,
        tags: ['workspace', 'affinity', 'phase6', 'binding', 'cache'],
      },
      permissions: [],
    },
    {
      name: 'workspace-analysis:affinity-config',
      capability: 'workspace.affinity_config',
      provider: 'workspace-analysis',
      handler: async (_args: any, _context: any) => {
        const { sandboxOrchestrator } = await import('@/lib/sandbox/sandbox-orchestrator');
        return sandboxOrchestrator.getAffinityConfig();
      },
      metadata: {
        latency: 'low',
        cost: 'low',
        reliability: 0.99,
        tags: ['workspace', 'affinity', 'phase6', 'config', 'ttl'],
      },
      permissions: [],
    },
    {
      name: 'workspacefs:sync-status',
      capability: 'workspacefs.sync_status',
      provider: 'workspace-analysis',
      handler: async (args: any, context: any) => {
        const { workspaceFSSyncService } = await import('@/lib/sandbox/workspacefs-sync-service');
        let ownerId = (typeof context?.userId === 'string' ? context.userId : 'anon:public');
        if (ownerId.startsWith('anon_')) ownerId = ownerId.replace(/^anon_/, 'anon:');
        else if (ownerId === 'anonymous') ownerId = 'anon:public';
        const wsId = args.workspaceId || `${ownerId}:${context?.conversationId || 'default'}`;
        return workspaceFSSyncService.getSyncState(wsId, ownerId);
      },
      metadata: {
        latency: 'low',
        cost: 'low',
        reliability: 0.99,
        tags: ['workspace', 'sync', 'phase9', 'r2', 'filesystem', 'observability'],
      },
      permissions: [],
    },
    {
      name: 'workspacefs:r2-status',
      capability: 'workspacefs.r2_status',
      provider: 'workspace-analysis',
      handler: async (_args: any, _context: any) => {
        const { workspaceFSSyncService } = await import('@/lib/sandbox/workspacefs-sync-service');
        return workspaceFSSyncService.getR2Status();
      },
      metadata: {
        latency: 'low',
        cost: 'low',
        reliability: 0.99,
        tags: ['workspace', 'r2', 'phase9', 'storage', 'cloud', 'observability'],
      },
      permissions: [],
    },
    {
      name: 'workspacefs:migrate',
      capability: 'workspacefs.migrate_workspace',
      provider: 'workspace-analysis',
      handler: async (args: any, context: any) => {
        const { workspaceFSSyncService } = await import('@/lib/sandbox/workspacefs-sync-service');
        let ownerId = (typeof context?.userId === 'string' ? context.userId : 'anon:public');
        if (ownerId.startsWith('anon_')) ownerId = ownerId.replace(/^anon_/, 'anon:');
        else if (ownerId === 'anonymous') ownerId = 'anon:public';
        return workspaceFSSyncService.syncForMigration(
          args.workspaceId,
          ownerId,
          args.fromProvider,
          args.toProvider,
          args.sourceSandboxId,
          args.destSandboxId,
        );
      },
      metadata: {
        latency: 'medium',
        cost: 'low',
        reliability: 0.95,
        tags: ['workspace', 'migration', 'phase9', 'provider', 'sync'],
      },
      permissions: ['sandbox:execute'],
    },
  ];

  for (const tool of tools) {
    await registry.registerTool(tool);
    count++;
  }

  // CRITICAL: Register provider with CapabilityRouter so that
  // router.execute() can resolve workspace-analysis capabilities.
  // Without this, both agent-loop and MCP-server paths fail at runtime.
  try {
    await registerCapabilityRouterProvider();
  } catch (error: any) {
    logger.warn('Failed to register workspace-analysis provider in CapabilityRouter', error.message);
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
