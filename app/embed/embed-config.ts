/**
 * Embed Pages Configuration
 * 
 * Centralized configuration for all embed page types.
 * Add new embed types here without creating new files.
 */

export interface EmbedConfig {
  title: string;
  description: string;
  component: string; // Component name to dynamically import
  theme: 'light' | 'dark' | 'auto';
  features: string[];
  allowedDomains?: string[]; // For iframe security
  metadata?: {
    ogImage?: string;
    ogTitle?: string;
    ogDescription?: string;
  };
}

export const EMBED_CONFIGS: Record<string, EmbedConfig> = {
  // API Development
  'api-pro': {
    title: 'API Development',
    description: 'Professional API development and testing environment',
    component: 'APIPlaygroundProPlugin',
    theme: 'dark',
    features: ['chat', 'code', 'test', 'docs'],
    metadata: {
      ogTitle: 'binG API Pro - Professional API Development',
      ogDescription: 'Build, test, and document APIs with AI assistance',
    },
  },

  // Cloud & DevOps
  'cloud-pro': {
    title: 'Cloud Professional',
    description: 'Cloud infrastructure management and deployment',
    component: 'CloudProPlugin',
    theme: 'dark',
    features: ['deploy', 'monitor', 'scale'],
  },

  'devops': {
    title: 'DevOps Command Center',
    description: 'CI/CD pipelines and infrastructure automation',
    component: 'DevOpsPlugin',
    theme: 'dark',
    features: ['pipeline', 'docker', 'kubernetes'],
  },

  // Data & Analytics
  'data-workbench': {
    title: 'Data Workbench',
    description: 'Data analysis and visualization workspace',
    component: 'DataWorkbenchPlugin',
    theme: 'light',
    features: ['analyze', 'visualize', 'export'],
  },

  // Creative & Design
  'creative': {
    title: 'Creative Studio',
    description: 'Design and creative workspace',
    component: 'CreativePlugin',
    theme: 'light',
    features: ['design', 'image', 'video'],
  },

  // GitHub Integration
  'github': {
    title: 'GitHub Integration',
    description: 'GitHub repository management and collaboration',
    component: 'GitHubPlugin',
    theme: 'dark',
    features: ['repo', 'pr', 'issues'],
  },

  'github-advanced': {
    title: 'GitHub Advanced',
    description: 'Advanced GitHub workflows and automation',
    component: 'GitHubAdvancedPlugin',
    theme: 'dark',
    features: ['workflow', 'actions', 'automation'],
  },

  // Hugging Face
  'hf-spaces': {
    title: 'Hugging Face Spaces',
    description: 'Deploy and test ML models',
    component: 'HFSpacesPlugin',
    theme: 'light',
    features: ['deploy', 'test', 'share'],
  },

  'hf-spaces-pro': {
    title: 'Hugging Face Pro',
    description: 'Professional ML model deployment',
    component: 'HFSpacesProPlugin',
    theme: 'dark',
    features: ['deploy', 'monitor', 'scale', 'api'],
  },

  // Network & Security
  'network': {
    title: 'Network Tools',
    description: 'Network analysis and security tools',
    component: 'NetworkPlugin',
    theme: 'dark',
    features: ['scan', 'monitor', 'security'],
  },

  // Knowledge & Documentation
  'notes': {
    title: 'Smart Notes',
    description: 'AI-powered note-taking and knowledge management',
    component: 'NotesPlugin',
    theme: 'light',
    features: ['note', 'organize', 'search'],
  },

  'prompts': {
    title: 'Prompt Library',
    description: 'Manage and share AI prompts',
    component: 'PromptsPlugin',
    theme: 'light',
    features: ['library', 'share', 'test'],
  },

  // Sandbox & Testing
  'sandbox': {
    title: 'Code Sandbox',
    description: 'Isolated code execution environment',
    component: 'SandboxPlugin',
    theme: 'dark',
    features: ['execute', 'test', 'debug'],
  },

  'wiki': {
    title: 'Project Wiki',
    description: 'Collaborative documentation and knowledge base',
    component: 'WikiPlugin',
    theme: 'light',
    features: ['docs', 'collaborate', 'version'],
  },

  // Default fallback
  'default': {
    title: 'binG Embed',
    description: 'Embedded workspace',
    component: 'DefaultPlugin',
    theme: 'auto',
    features: ['chat'],
  },
};

/**
 * Get embed configuration by type
 */
export function getEmbedConfig(type: string): EmbedConfig {
  return EMBED_CONFIGS[type] || EMBED_CONFIGS.default;
}

/**
 * Get all available embed types
 */
export function getAvailableEmbedTypes(): string[] {
  return Object.keys(EMBED_CONFIGS).filter(type => type !== 'default');
}

/**
 * Validate embed type
 * Uses Object.prototype.hasOwnProperty.call to avoid prototype pollution
 */
export function isValidEmbedType(type: string): boolean {
  return Object.prototype.hasOwnProperty.call(EMBED_CONFIGS, type);
}
