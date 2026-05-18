import { notFound } from 'next/navigation';
import { getEmbedConfig, isValidEmbedType, getAllEmbedTypes } from './embed-config';
import type { Metadata } from 'next';

// Pre-render all known embed types at build time for static export
export function generateStaticParams() {
  return getAllEmbedTypes().map((type) => ({ type }));
}

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
      data-embed-type={type}
    >
      <Component />
    </div>
  );
}

import APIPlaygroundProPlugin from '@/components/plugins/api-playground-pro-plugin';
import CloudProPlugin from '@/components/plugins/cloud-pro-plugin';
import DevOpsPlugin from '@/components/plugins/devops-plugin';
import DataWorkbenchPlugin from '@/components/plugins/data-workbench-plugin';
import CreativePlugin from '@/components/plugins/creative-plugin';
import GitHubPlugin from '@/components/plugins/github-plugin';
import GitHubAdvancedPlugin from '@/components/plugins/github-advanced-plugin';
import HFSpacesPlugin from '@/components/plugins/hf-spaces-plugin';
import HFSpacesProPlugin from '@/components/plugins/hf-spaces-pro-plugin';
import NetworkPlugin from '@/components/plugins/network-plugin';
import NotesPlugin from '@/components/plugins/notes-plugin';
import PromptsPlugin from '@/components/plugins/prompts-plugin';
import SandboxPlugin from '@/components/plugins/sandbox-plugin';
import WikiPlugin from '@/components/plugins/wiki-plugin';
import DefaultPlugin from '@/components/plugins/default-plugin';

/**
 * Load component based on config
 */
function loadComponent(componentName: string) {
  const componentMap: Record<string, any> = {
    'APIPlaygroundProPlugin': APIPlaygroundProPlugin,
    'CloudProPlugin': CloudProPlugin,
    'DevOpsPlugin': DevOpsPlugin,
    'DataWorkbenchPlugin': DataWorkbenchPlugin,
    'CreativePlugin': CreativePlugin,
    'GitHubPlugin': GitHubPlugin,
    'GitHubAdvancedPlugin': GitHubAdvancedPlugin,
    'HFSpacesPlugin': HFSpacesPlugin,
    'HFSpacesProPlugin': HFSpacesProPlugin,
    'NetworkPlugin': NetworkPlugin,
    'NotesPlugin': NotesPlugin,
    'PromptsPlugin': PromptsPlugin,
    'SandboxPlugin': SandboxPlugin,
    'WikiPlugin': WikiPlugin,
    'DefaultPlugin': DefaultPlugin,
  };

  const Component = componentMap[componentName];
  if (!Component) {
    return DefaultPlugin;
  }
  return Component;
}
