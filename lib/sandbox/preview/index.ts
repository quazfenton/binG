/**
 * Preview Integration Index
 * 
 * Central export point for all preview provider integrations.
 * 
 * @example
 * ```typescript
 * import { previewProviders } from '@/lib/sandbox/preview';
 * 
 * // Use CodeSandbox preview
 * const url = await previewProviders.codeSandbox.getDevBoxPreviewUrl({
 *   sandboxId: 'abc123',
 *   port: 3000,
 *   apiKey: process.env.CODESANDBOX_API_KEY,
 * });
 * 
 * // Use Daytona preview
 * const daytonaUrl = await previewProviders.daytona.getWorkspacePreviewUrl({
 *   workspaceId: 'ws-123',
 *   port: 3000,
 *   apiKey: process.env.DAYTONA_API_KEY,
 * });
 * 
 * // Use Blaxel preview
 * const blaxelUrl = await previewProviders.blaxel.createBlaxelService({
 *   boxId: 'box-123',
 *   name: 'dev-server',
 *   command: 'npm run dev',
 *   port: 3000,
 *   apiKey: process.env.BLAXEL_API_KEY,
 * });
 * ```
 */

// Universal Preview Manager
export {
  PreviewManager,
  PreviewCache,
  PortManager,
  getPreviewManager,
  resetPreviewManager,
  type StartPreviewConfig,
  type PreviewResult,
  type PreviewCacheEntry,
} from '../preview-manager';

// CodeSandbox Integration
export {
  codeSandboxPreview,
  getCodeSandboxTemplate,
  getDefaultPort as getCodeSandboxDefaultPort,
  getDevBoxPreviewUrl,
  getSandboxPreviewUrl,
  checkPreviewAccessibility,
  createDevBoxServiceConfig,
  getFrameworkServiceConfig as getCodeSandboxFrameworkConfig,
  type CodeSandboxPreviewConfig,
  type CodeSandboxPreviewResult,
  type DevBoxServiceConfig,
} from './codesandbox-preview';

// Daytona Integration
export {
  daytonaPreview,
  getDefaultPort as getDaytonaDefaultPort,
  getWorkspacePreviewUrl,
  startDaytonaService,
  stopDaytonaService,
  listDaytonaServices,
  type DaytonaPreviewConfig,
  type DaytonaPreviewResult,
} from './daytona-preview';

// Blaxel Integration
export {
  blaxelPreview,
  getDefaultPort as getBlaxelDefaultPort,
  getServicePreviewUrl,
  createBlaxelService,
  executeBlaxelBatchJob,
  executeBlaxelAsync,
  listBlaxelServices,
  stopBlaxelService,
  getFrameworkServiceConfig as getBlaxelFrameworkConfig,
  type BlaxelPreviewConfig,
  type BlaxelPreviewResult,
  type BlaxelServiceConfig,
} from './blaxel-preview';

// Provider selection helper
// Import the actual preview objects from each provider
import { codeSandboxPreview as csPreview, getDefaultPort as csPort, getCodeSandboxTemplate as csTemplate } from './codesandbox-preview';
import { daytonaPreview as daytonaPrev, getDefaultPort as daytonaPort } from './daytona-preview';
import { blaxelPreview as blaxelPrev, getDefaultPort as blaxelPort } from './blaxel-preview';

export const previewProviders = {
  codeSandbox: csPreview,
  daytona: daytonaPrev,
  blaxel: blaxelPrev,
};

/**
 * Get default port for framework (tries all providers)
 */
export function getDefaultPort(framework: string, provider?: string): number {
  if (provider) {
    switch (provider) {
      case 'codesandbox':
        return csPort(framework);
      case 'daytona':
        return daytonaPort(framework);
      case 'blaxel':
        return blaxelPort(framework);
    }
  }

  // Default fallback
  const portMap: Record<string, number> = {
    'react': 3000,
    'vue': 8080,
    'next': 3000,
    'nextjs': 3000,
    'nuxt': 3000,
    'vite': 5173,
    'flask': 5000,
    'fastapi': 8000,
  };

  return portMap[framework] || 3000;
}

/**
 * Get template/provider-specific config for framework
 */
export function getProviderTemplate(
  framework: string,
  provider: 'codesandbox' | 'daytona' | 'blaxel'
): string | null {
  switch (provider) {
    case 'codesandbox':
      return csTemplate(framework);
    case 'daytona':
    case 'blaxel':
      // These providers use generic node/python images
      if (['flask', 'fastapi', 'django', 'streamlit', 'gradio'].includes(framework)) {
        return 'python';
      }
      return 'node';
    default:
      return null;
  }
}

export default previewProviders;
