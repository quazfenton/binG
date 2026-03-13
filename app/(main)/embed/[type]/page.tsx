import { notFound } from 'next/navigation';
import { getEmbedConfig, isValidEmbedType } from './embed-config';
import type { Metadata } from 'next';

interface EmbedPageProps {
  params: Promise<{ type: string }>;
}

/**
 * Generate metadata for embed page
 */
export async function generateMetadata({ params }: EmbedPageProps): Promise<Metadata> {
  const { type } = await params;
  
  if (!isValidEmbedType(type)) {
    return {
      title: 'Embed Not Found',
      description: 'The requested embed type does not exist',
    };
  }

  const config = getEmbedConfig(type);

  return {
    title: config.metadata?.ogTitle || `${config.title} - binG`,
    description: config.metadata?.ogDescription || config.description,
    openGraph: {
      title: config.metadata?.ogTitle || `${config.title} - binG`,
      description: config.metadata?.ogDescription || config.description,
      images: config.metadata?.ogImage ? [config.metadata.ogImage] : undefined,
    },
  };
}

/**
 * Dynamic embed page handler
 *
 * This config-driven system allows creating new embed types
 * by simply adding to embed-config.ts without creating new files.
 *
 * Usage: /embed/[type]
 * Examples:
 * - /embed/api-pro
 * - /embed/github
 * - /embed/sandbox
 */
export default async function EmbedPage({ params }: EmbedPageProps) {
  const { type } = await params;

  // Validate embed type
  if (!isValidEmbedType(type)) {
    notFound();
  }

  const config = getEmbedConfig(type);

  // Dynamically import the component
  const Component = await loadComponent(config.component);

  // Note: onClose is handled by the client component itself
  // Functions cannot be passed from server to client components
  return (
    <div
      className="w-screen h-screen"
      data-theme={config.theme}
      data-embed-type={type}
    >
      <Component />
    </div>
  );
}

/**
 * Load component dynamically based on config
 */
async function loadComponent(componentName: string) {
  const componentMap: Record<string, any> = {
    'APIPlaygroundProPlugin': () => import('@/components/plugins/api-playground-pro-plugin').then(m => m.default),
    'CloudProPlugin': () => import('@/components/plugins/cloud-pro-plugin').then(m => m.default),
    'DevOpsPlugin': () => import('@/components/plugins/devops-plugin').then(m => m.default),
    'DataWorkbenchPlugin': () => import('@/components/plugins/data-workbench-plugin').then(m => m.default),
    'CreativePlugin': () => import('@/components/plugins/creative-plugin').then(m => m.default),
    'GitHubPlugin': () => import('@/components/plugins/github-plugin').then(m => m.default),
    'GitHubAdvancedPlugin': () => import('@/components/plugins/github-advanced-plugin').then(m => m.default),
    'HFSpacesPlugin': () => import('@/components/plugins/hf-spaces-plugin').then(m => m.default),
    'HFSpacesProPlugin': () => import('@/components/plugins/hf-spaces-pro-plugin').then(m => m.default),
    'NetworkPlugin': () => import('@/components/plugins/network-plugin').then(m => m.default),
    'NotesPlugin': () => import('@/components/plugins/notes-plugin').then(m => m.default),
    'PromptsPlugin': () => import('@/components/plugins/prompts-plugin').then(m => m.default),
    'SandboxPlugin': () => import('@/components/plugins/sandbox-plugin').then(m => m.default),
    'WikiPlugin': () => import('@/components/plugins/wiki-plugin').then(m => m.default),
    'DefaultPlugin': () => import('@/components/plugins/default-plugin').then(m => m.default),
  };

  const loader = componentMap[componentName];
  
  if (!loader) {
    throw new Error(`Component "${componentName}" not found`);
  }

  const Component = await loader();
  return Component;
}
