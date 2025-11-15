// Plugin Loader - Dynamically loads plugin components
import { Plugin } from '../components/plugins/plugin-manager';
import { getPluginConfigById } from './plugin-registry';

// Define all plugins with their dynamic imports
const pluginLoaders: Record<string, () => Promise<{ default: React.ComponentType<any> }>> = {
  'calculator': () => import('../components/plugins/calculator-plugin'),
  'json-validator': () => import('../components/plugins/json-validator-plugin'),
  'code-formatter': () => import('../components/plugins/code-formatter-plugin'),
  'ai-prompt-library': () => import('../components/plugins/ai-prompt-library-plugin'),
  'api-playground': () => import('../components/plugins/api-playground-pro-plugin'),
  'ai-agent-orchestrator': () => import('../components/plugins/ai-agent-orchestrator-plugin'),
  'ai-enhancer': () => import('../components/plugins/ai-enhancer-plugin'),
  'creative-studio': () => import('../components/plugins/creative-studio-plugin'),
  'data-science-workbench': () => import('../components/plugins/data-science-workbench-plugin'),
  'data-visualization': () => import('../components/plugins/data-visualization-builder-plugin'),
  'devops-command-center': () => import('../components/plugins/devops-command-center-plugin'),
  'github-explorer': () => import('../components/plugins/github-explorer-plugin'),
  'github-explorer-advanced': () => import('../components/plugins/github-explorer-advanced-plugin'),
  'huggingface-spaces': () => import('../components/plugins/huggingface-spaces-plugin'),
  'huggingface-spaces-pro': () => import('../components/plugins/huggingface-spaces-pro-plugin'),
  'hyperagent-scraper': () => import('../components/plugins/hyperagent-scraper-plugin'),
  'interactive-diagramming': () => import('../components/plugins/interactive-diagramming-plugin'),
  'interactive-storyboard': () => import('../components/plugins/interactive-storyboard-plugin'),
  'legal-document': () => import('../components/plugins/legal-document-plugin'),
  'mcp-connector': () => import('../components/plugins/mcp-connector-plugin'),
  'network-request': () => import('../components/plugins/network-request-builder-plugin'),
  'note-taker': () => import('../components/plugins/note-taker-plugin'),
  'regex-pattern-lab': () => import('../components/plugins/regex-pattern-lab-plugin'),
  'url-utilities': () => import('../components/plugins/url-utilities-plugin'),
  'webhook-debugger': () => import('../components/plugins/webhook-debugger-plugin'),
  'wiki-knowledge': () => import('../components/plugins/wiki-knowledge-base-plugin'),
};

// Function to load a plugin component by ID
export const loadPluginComponent = async (pluginId: string): Promise<React.ComponentType<any> | null> => {
  const loader = pluginLoaders[pluginId];
  if (!loader) {
    console.error(`Plugin component not found for ID: ${pluginId}`);
    return null;
  }

  try {
    const module = await loader();
    return module.default;
  } catch (error) {
    console.error(`Failed to load plugin component for ID: ${pluginId}`, error);
    return null;
  }
};

// Function to create a complete plugin object with component
export const createPluginWithComponent = async (pluginId: string): Promise<Plugin | null> => {
  const config = getPluginConfigById(pluginId);
  if (!config) {
    console.error(`Plugin configuration not found for ID: ${pluginId}`);
    return null;
  }

  const component = await loadPluginComponent(pluginId);
  if (!component) {
    return null;
  }

  return {
    ...config,
    component
  } as Plugin;
};

// Function to create multiple plugins with their components
export const createPluginsWithComponents = async (pluginIds: string[]): Promise<Plugin[]> => {
  const plugins = await Promise.all(
    pluginIds.map(id => createPluginWithComponent(id))
  );
  
  return plugins.filter((plugin): plugin is Plugin => plugin !== null);
};

// Function to get all available plugin IDs
export const getAllPluginIds = (): string[] => {
  return Object.keys(pluginLoaders);
};

// Function to check if a plugin exists
export const pluginExists = (pluginId: string): boolean => {
  return pluginLoaders.hasOwnProperty(pluginId);
};