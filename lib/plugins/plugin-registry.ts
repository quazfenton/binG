// Plugin Registry for the Enhanced Plugin System
import { Plugin } from './plugin-manager';
import { Calculator, FileJson, Code, Brain, Globe, Database, Wrench, Github, Cpu, Layout, FileText, Settings, Network, StickyNote, Search, Link } from 'lucide-react';

// We'll dynamically import plugins when needed to keep this file lightweight
// Define plugin configuration objects that can be used to register plugins

export const REGISTERED_PLUGINS: Omit<Plugin, 'component'>[] = [
  {
    id: 'calculator',
    name: 'Calculator',
    description: 'Basic calculator with history',
    icon: Calculator,
    category: 'utility',
    defaultSize: { width: 350, height: 500 },
    minSize: { width: 250, height: 300 },
    enhanced: true,
    resourceLimits: {
      maxMemoryMB: 50,
      maxCpuPercent: 10,
      maxNetworkRequests: 0,
      maxStorageKB: 100,
      timeoutMs: 10000
    }
  },
  {
    id: 'json-validator',
    name: 'JSON Validator',
    description: 'Validate, format, and minify JSON',
    icon: FileJson,
    category: 'code',
    defaultSize: { width: 600, height: 600 },
    minSize: { width: 400, height: 300 },
    enhanced: true,
    resourceLimits: {
      maxMemoryMB: 100,
      maxCpuPercent: 15,
      maxNetworkRequests: 0,
      maxStorageKB: 100,
      timeoutMs: 20000
    }
  },
  {
    id: 'code-formatter',
    name: 'Code Formatter',
    description: 'Format code in various languages',
    icon: Code,
    category: 'code',
    defaultSize: { width: 700, height: 600 },
    minSize: { width: 400, height: 300 },
    enhanced: true
  },
  {
    id: 'ai-prompt-library',
    name: 'AI Prompt Library',
    description: 'Collection of AI prompts and workflows',
    icon: Brain,
    category: 'ai',
    defaultSize: { width: 900, height: 700 },
    minSize: { width: 600, height: 500 },
    enhanced: true
  },
  {
    id: 'api-playground',
    name: 'API Playground Pro',
    description: 'Test and explore APIs',
    icon: Globe,
    category: 'utility',
    defaultSize: { width: 1000, height: 700 },
    minSize: { width: 800, height: 600 },
    enhanced: true
  },
  // Add more plugins as they are fleshed out
  {
    id: 'ai-agent-orchestrator',
    name: 'AI Agent Orchestrator',
    description: 'Orchestrate multiple AI agents',
    icon: Cpu,
    category: 'ai',
    defaultSize: { width: 800, height: 600 },
    minSize: { width: 600, height: 400 },
    enhanced: true
  },
  {
    id: 'ai-enhancer',
    name: 'AI Enhancer',
    description: 'Enhance content with AI',
    icon: Brain,
    category: 'ai',
    defaultSize: { width: 700, height: 500 },
    minSize: { width: 500, height: 400 },
    enhanced: true
  },
  {
    id: 'creative-studio',
    name: 'Creative Studio',
    description: 'Creative tools and utilities',
    icon: Layout,
    category: 'media',
    defaultSize: { width: 900, height: 700 },
    minSize: { width: 700, height: 500 },
    enhanced: true
  },
  {
    id: 'data-science-workbench',
    name: 'Data Science Workbench',
    description: 'Data analysis and visualization tools',
    icon: Database,
    category: 'data',
    defaultSize: { width: 1000, height: 700 },
    minSize: { width: 800, height: 600 },
    enhanced: true
  },
  {
    id: 'data-visualization',
    name: 'Data Visualization Builder',
    description: 'Create charts and visualizations',
    icon: Layout,
    category: 'data',
    defaultSize: { width: 900, height: 700 },
    minSize: { width: 700, height: 500 },
    enhanced: true
  },
  {
    id: 'devops-command-center',
    name: 'DevOps Command Center',
    description: 'DevOps tools and utilities',
    icon: Wrench,
    category: 'utility',
    defaultSize: { width: 900, height: 700 },
    minSize: { width: 700, height: 500 },
    enhanced: true
  },
  {
    id: 'github-explorer',
    name: 'GitHub Explorer',
    description: 'Explore GitHub repositories',
    icon: Github,
    category: 'code',
    defaultSize: { width: 800, height: 600 },
    minSize: { width: 600, height: 400 },
    enhanced: true
  },
  {
    id: 'github-explorer-advanced',
    name: 'GitHub Explorer Pro',
    description: 'Advanced GitHub exploration tools',
    icon: Github,
    category: 'code',
    defaultSize: { width: 1000, height: 700 },
    minSize: { width: 800, height: 600 },
    enhanced: true
  },
  {
    id: 'huggingface-spaces',
    name: 'Hugging Face Spaces',
    description: 'Run and explore Hugging Face models',
    icon: Brain,
    category: 'ai',
    defaultSize: { width: 800, height: 600 },
    minSize: { width: 600, height: 400 },
    enhanced: true
  },
  {
    id: 'huggingface-spaces-pro',
    name: 'Hugging Face Spaces Pro',
    description: 'Advanced Hugging Face model tools',
    icon: Brain,
    category: 'ai',
    defaultSize: { width: 1000, height: 700 },
    minSize: { width: 800, height: 600 },
    enhanced: true
  },
  {
    id: 'hyperagent-scraper',
    name: 'HyperAgent Scraper',
    description: 'Advanced web scraping agent',
    icon: Search,
    category: 'utility',
    defaultSize: { width: 800, height: 600 },
    minSize: { width: 600, height: 400 },
    enhanced: true
  },
  {
    id: 'interactive-diagramming',
    name: 'Interactive Diagramming',
    description: 'Create interactive diagrams',
    icon: Layout,
    category: 'design',
    defaultSize: { width: 1000, height: 700 },
    minSize: { width: 800, height: 600 },
    enhanced: true
  },
  {
    id: 'interactive-storyboard',
    name: 'Interactive Storyboard',
    description: 'Create visual storyboards',
    icon: Layout,
    category: 'design',
    defaultSize: { width: 1200, height: 800 },
    minSize: { width: 800, height: 600 },
    enhanced: true
  },
  {
    id: 'legal-document',
    name: 'Legal Document Assistant',
    description: 'Assist with legal document creation',
    icon: FileText,
    category: 'utility',
    defaultSize: { width: 800, height: 600 },
    minSize: { width: 600, height: 400 },
    enhanced: true
  },
  {
    id: 'mcp-connector',
    name: 'MCP Connector',
    description: 'Connect to Model Context Protocol services',
    icon: Link,
    category: 'utility',
    defaultSize: { width: 700, height: 500 },
    minSize: { width: 500, height: 400 },
    enhanced: true
  },
  {
    id: 'network-request',
    name: 'Network Request Builder',
    description: 'Build and test network requests',
    icon: Network,
    category: 'utility',
    defaultSize: { width: 800, height: 600 },
    minSize: { width: 600, height: 400 },
    enhanced: true
  },
  {
    id: 'note-taker',
    name: 'Note Taker',
    description: 'Take and organize notes',
    icon: StickyNote,
    category: 'utility',
    defaultSize: { width: 700, height: 600 },
    minSize: { width: 500, height: 400 },
    enhanced: true
  },
  {
    id: 'regex-pattern-lab',
    name: 'Regex Pattern Lab',
    description: 'Test and build regex patterns',
    icon: Settings,
    category: 'code',
    defaultSize: { width: 800, height: 600 },
    minSize: { width: 600, height: 400 },
    enhanced: true
  },
  {
    id: 'url-utilities',
    name: 'URL Utilities',
    description: 'URL manipulation and analysis tools',
    icon: Link,
    category: 'utility',
    defaultSize: { width: 700, height: 500 },
    minSize: { width: 500, height: 400 },
    enhanced: true
  },
  {
    id: 'webhook-debugger',
    name: 'Webhook Debugger',
    description: 'Debug webhook requests',
    icon: Network,
    category: 'utility',
    defaultSize: { width: 900, height: 700 },
    minSize: { width: 700, height: 500 },
    enhanced: true
  },
  {
    id: 'wiki-knowledge',
    name: 'Wiki Knowledge Base',
    description: 'Access and search knowledge bases',
    icon: Search,
    category: 'data',
    defaultSize: { width: 900, height: 700 },
    minSize: { width: 700, height: 500 },
    enhanced: true
  }
];

// Function to get a plugin configuration by ID
export const getPluginConfigById = (id: string): (Omit<Plugin, 'component'>) | undefined => {
  return REGISTERED_PLUGINS.find(plugin => plugin.id === id);
};

// Function to get plugins by category
export const getPluginConfigsByCategory = (category: string): (Omit<Plugin, 'component'>)[] => {
  return REGISTERED_PLUGINS.filter(plugin => plugin.category === category);
};

// Function to get all plugin categories
export const getPluginCategories = (): string[] => {
  const categories = REGISTERED_PLUGINS.map(plugin => plugin.category);
  return [...new Set(categories)]; // Return unique categories
};