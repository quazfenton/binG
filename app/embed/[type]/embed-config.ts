/**
 * Embed Configuration
 *
 * Central configuration for embeddable components
 * Add new embed types here to make them available at /embed/[type]
 */

export interface EmbedConfig {
  type: string;
  title: string;
  description: string;
  component: string;
  metadata?: {
    ogTitle?: string;
    ogDescription?: string;
    ogImage?: string;
  };
  settings?: {
    allowFullscreen?: boolean;
    minWidth?: number;
    minHeight?: number;
  };
}

const embedConfigs: Record<string, EmbedConfig> = {
  'api-pro': {
    type: 'api-pro',
    title: 'API Playground Pro',
    description: 'Professional API testing and exploration tool',
    component: 'APIPlaygroundProPlugin',
    metadata: {
      ogTitle: 'API Playground Pro - binG',
      ogDescription: 'Test and explore APIs with professional tools',
    },
    settings: {
      allowFullscreen: true,
      minWidth: 800,
      minHeight: 600,
    },
  },
  'cloud': {
    type: 'cloud',
    title: 'Cloud Manager',
    description: 'Manage cloud deployments and resources',
    component: 'CloudProPlugin',
    metadata: {
      ogTitle: 'Cloud Manager - binG',
      ogDescription: 'Deploy and manage cloud resources',
    },
    settings: {
      allowFullscreen: true,
      minWidth: 1024,
      minHeight: 768,
    },
  },
  'devops': {
    type: 'devops',
    title: 'DevOps Dashboard',
    description: 'CI/CD pipelines and deployment automation',
    component: 'DevOpsPlugin',
    metadata: {
      ogTitle: 'DevOps Dashboard - binG',
      ogDescription: 'Automate your development workflow',
    },
    settings: {
      allowFullscreen: true,
      minWidth: 1024,
      minHeight: 768,
    },
  },
  'data-workbench': {
    type: 'data-workbench',
    title: 'Data Workbench',
    description: 'Data analysis and visualization tools',
    component: 'DataWorkbenchPlugin',
    metadata: {
      ogTitle: 'Data Workbench - binG',
      ogDescription: 'Analyze and visualize your data',
    },
    settings: {
      allowFullscreen: true,
      minWidth: 1200,
      minHeight: 800,
    },
  },
  'creative': {
    type: 'creative',
    title: 'Creative Studio',
    description: 'AI-powered creative tools',
    component: 'CreativePlugin',
    metadata: {
      ogTitle: 'Creative Studio - binG',
      ogDescription: 'Generate images, music, and more with AI',
    },
    settings: {
      allowFullscreen: true,
      minWidth: 800,
      minHeight: 600,
    },
  },
  'github': {
    type: 'github',
    title: 'GitHub Integration',
    description: 'Manage repositories and pull requests',
    component: 'GitHubPlugin',
    metadata: {
      ogTitle: 'GitHub Integration - binG',
      ogDescription: 'Seamless GitHub workflow integration',
    },
    settings: {
      allowFullscreen: true,
      minWidth: 800,
      minHeight: 600,
    },
  },
  'github-advanced': {
    type: 'github-advanced',
    title: 'GitHub Advanced',
    description: 'Advanced GitHub features and automation',
    component: 'GitHubAdvancedPlugin',
    metadata: {
      ogTitle: 'GitHub Advanced - binG',
      ogDescription: 'Advanced GitHub automation and insights',
    },
    settings: {
      allowFullscreen: true,
      minWidth: 1024,
      minHeight: 768,
    },
  },
  'hf-spaces': {
    type: 'hf-spaces',
    title: 'Hugging Face Spaces',
    description: 'Deploy and test ML models',
    component: 'HFSpacesPlugin',
    metadata: {
      ogTitle: 'Hugging Face Spaces - binG',
      ogDescription: 'Deploy ML models to Hugging Face',
    },
    settings: {
      allowFullscreen: true,
      minWidth: 800,
      minHeight: 600,
    },
  },
  'hf-spaces-pro': {
    type: 'hf-spaces-pro',
    title: 'Hugging Face Spaces Pro',
    description: 'Professional Hugging Face deployment',
    component: 'HFSpacesProPlugin',
    metadata: {
      ogTitle: 'Hugging Face Spaces Pro - binG',
      ogDescription: 'Professional ML deployment tools',
    },
    settings: {
      allowFullscreen: true,
      minWidth: 1024,
      minHeight: 768,
    },
  },
  'network': {
    type: 'network',
    title: 'Network Tools',
    description: 'Network diagnostics and monitoring',
    component: 'NetworkPlugin',
    metadata: {
      ogTitle: 'Network Tools - binG',
      ogDescription: 'Monitor and diagnose network issues',
    },
    settings: {
      allowFullscreen: true,
      minWidth: 800,
      minHeight: 600,
    },
  },
  'notes': {
    type: 'notes',
    title: 'Notes',
    description: 'Take and organize notes',
    component: 'NotesPlugin',
    metadata: {
      ogTitle: 'Notes - binG',
      ogDescription: 'Organize your thoughts and ideas',
    },
    settings: {
      allowFullscreen: false,
      minWidth: 400,
      minHeight: 300,
    },
  },
  'prompts': {
    type: 'prompts',
    title: 'Prompt Library',
    description: 'Save and share AI prompts',
    component: 'PromptsPlugin',
    metadata: {
      ogTitle: 'Prompt Library - binG',
      ogDescription: 'Curated AI prompts for better results',
    },
    settings: {
      allowFullscreen: false,
      minWidth: 600,
      minHeight: 400,
    },
  },
  'sandbox': {
    type: 'sandbox',
    title: 'Sandbox',
    description: 'Isolated code execution environment',
    component: 'SandboxPlugin',
    metadata: {
      ogTitle: 'Sandbox - binG',
      ogDescription: 'Safe code execution sandbox',
    },
    settings: {
      allowFullscreen: true,
      minWidth: 800,
      minHeight: 600,
    },
  },
  'wiki': {
    type: 'wiki',
    title: 'Wiki',
    description: 'Documentation and knowledge base',
    component: 'WikiPlugin',
    metadata: {
      ogTitle: 'Wiki - binG',
      ogDescription: 'Project documentation and guides',
    },
    settings: {
      allowFullscreen: false,
      minWidth: 600,
      minHeight: 400,
    },
  },
  'default': {
    type: 'default',
    title: 'Embed',
    description: 'Embedded component',
    component: 'DefaultPlugin',
    metadata: {
      ogTitle: 'Embed - binG',
      ogDescription: 'Embedded component viewer',
    },
    settings: {
      allowFullscreen: true,
      minWidth: 800,
      minHeight: 600,
    },
  },
};

export function getEmbedConfig(type: string): EmbedConfig {
  return embedConfigs[type] || embedConfigs['default'];
}

export function isValidEmbedType(type: string): boolean {
  return type in embedConfigs;
}

export function getAllEmbedTypes(): string[] {
  return Object.keys(embedConfigs);
}
