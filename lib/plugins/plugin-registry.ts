/**
 * Plugin Registry with Enhanced Configuration
 */

import { 
  Calculator, 
  Code, 
  FileText, 
  Image, 
  Globe, 
  Database,
  Sparkles,
  Zap
} from 'lucide-react';

import { CalculatorPlugin } from '../../components/plugins/calculator-plugin';
import { CodeFormatterPlugin } from '../../components/plugins/code-formatter-plugin';
import { NoteTakerPlugin } from '../../components/plugins/note-taker-plugin';
import { JsonValidatorPlugin } from '../../components/plugins/json-validator-plugin';
import { UrlUtilitiesPlugin } from '../../components/plugins/url-utilities-plugin';
import type { Plugin } from '../../components/plugins/plugin-manager';

export const pluginRegistry: Plugin[] = [
  {
    id: 'calculator',
    name: 'Calculator',
    description: 'A powerful calculator with history and memory functions',
    icon: Calculator,
    component: CalculatorPlugin,
    category: 'utility',
    defaultSize: { width: 320, height: 480 },
    minSize: { width: 280, height: 400 },
    maxSize: { width: 400, height: 600 },
    enhanced: true,
    resourceLimits: {
      maxMemoryMB: 50,
      maxCpuPercent: 10,
      maxNetworkRequests: 0,
      maxStorageKB: 100,
      timeoutMs: 5000
    }
  },
  {
    id: 'code-formatter',
    name: 'Code Formatter',
    description: 'Format and beautify code in multiple languages',
    icon: Code,
    component: CodeFormatterPlugin,
    category: 'code',
    defaultSize: { width: 600, height: 500 },
    minSize: { width: 400, height: 300 },
    maxSize: { width: 800, height: 700 },
    enhanced: true,
    resourceLimits: {
      maxMemoryMB: 100,
      maxCpuPercent: 25,
      maxNetworkRequests: 5,
      maxStorageKB: 500,
      timeoutMs: 15000
    }
  },
  {
    id: 'note-taker',
    name: 'Note Taker',
    description: 'Take and organize notes with Markdown support',
    icon: FileText,
    component: NoteTakerPlugin,
    category: 'utility',
    defaultSize: { width: 700, height: 500 },
    minSize: { width: 500, height: 400 },
    maxSize: { width: 1000, height: 800 },
    enhanced: true,
    resourceLimits: {
      maxMemoryMB: 75,
      maxCpuPercent: 15,
      maxNetworkRequests: 0,
      maxStorageKB: 1024,
      timeoutMs: 10000
    }
  },
  // Example plugin with dependencies
  {
    id: 'advanced-calculator',
    name: 'Advanced Calculator',
    description: 'Scientific calculator with graphing capabilities',
    icon: Calculator,
    component: CalculatorPlugin, // Reusing for demo
    category: 'utility',
    defaultSize: { width: 400, height: 600 },
    minSize: { width: 350, height: 500 },
    maxSize: { width: 500, height: 800 },
    enhanced: true,
    resourceLimits: {
      maxMemoryMB: 150,
      maxCpuPercent: 30,
      maxNetworkRequests: 10,
      maxStorageKB: 2048,
      timeoutMs: 20000
    }
  },
  // Example plugin that could serve as a fallback
  {
    id: 'simple-calculator',
    name: 'Simple Calculator',
    description: 'Basic calculator functionality',
    icon: Calculator,
    component: CalculatorPlugin, // Reusing for demo
    category: 'utility',
    defaultSize: { width: 280, height: 400 },
    minSize: { width: 250, height: 350 },
    maxSize: { width: 350, height: 500 },
    enhanced: true,
    resourceLimits: {
      maxMemoryMB: 25,
      maxCpuPercent: 5,
      maxNetworkRequests: 0,
      maxStorageKB: 50,
      timeoutMs: 3000
    }
  },
  // New utility plugins
  {
    id: 'json-validator',
    name: 'JSON Validator',
    description: 'Validate, format, and analyze JSON data',
    icon: FileText,
    component: JsonValidatorPlugin,
    category: 'utility',
    defaultSize: { width: 600, height: 500 },
    minSize: { width: 500, height: 400 },
    maxSize: { width: 800, height: 700 },
    enhanced: true,
    resourceLimits: {
      maxMemoryMB: 100,
      maxCpuPercent: 20,
      maxNetworkRequests: 0,
      maxStorageKB: 512,
      timeoutMs: 10000
    }
  },
  {
    id: 'url-utilities',
    name: 'URL Utilities',
    description: 'Validate, shorten, and analyze URLs',
    icon: Globe,
    component: UrlUtilitiesPlugin,
    category: 'utility',
    defaultSize: { width: 500, height: 600 },
    minSize: { width: 400, height: 500 },
    maxSize: { width: 700, height: 800 },
    enhanced: true,
    resourceLimits: {
      maxMemoryMB: 75,
      maxCpuPercent: 15,
      maxNetworkRequests: 10,
      maxStorageKB: 256,
      timeoutMs: 15000
    }
  }
];

export const getPluginById = (id: string): Plugin | undefined => {
  return pluginRegistry.find(plugin => plugin.id === id);
};

export const getPluginsByCategory = (category: string): Plugin[] => {
  return pluginRegistry.filter(plugin => plugin.category === category);
};

export const getEnhancedPlugins = (): Plugin[] => {
  return pluginRegistry.filter(plugin => plugin.enhanced);
};

export const getLegacyPlugins = (): Plugin[] => {
  return pluginRegistry.filter(plugin => !plugin.enhanced);
};