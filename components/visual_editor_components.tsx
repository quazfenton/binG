"use client"

import * as React from 'react';
import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button, ButtonProps } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import { Badge, BadgeProps } from './ui/badge';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Slider } from './ui/slider';
import { Switch } from './ui/switch';
import { Textarea } from './ui/textarea';
import { 
  Eye, Code, Layers, Package, Settings, Save, Undo, Redo,
  MousePointer, Move, RotateCw, Square, Type, Image,
  Palette, Download, Upload, Play, Pause, RefreshCw,
  AlertCircle, CheckCircle, Info, X, Grid, Zap, Smartphone,
  Monitor, Tablet, Paintbrush, Layout, Component, Database,
  FileCode, Globe, Cpu, Wrench, Maximize, Minimize, Copy,
  Trash2, MoreHorizontal, ChevronDown, ChevronRight,
  FolderOpen, FileText, Plus, Search, Filter, ArrowUp,
  ArrowDown, ArrowLeft, ArrowRight, RotateCcw, FlipHorizontal,
  FlipVertical, Align, AlignCenter, AlignLeft, AlignRight,
  Bold, Italic, Underline, Link, List, Hash, Quote, Lock, Unlock,
  Menu, Volume2, Circle, Sidebar
} from 'lucide-react';

// Enhanced ProjectStructure with better framework support
interface ProjectStructure {
  files: { [key: string]: string };
  framework: 'react' | 'vue' | 'angular' | 'svelte' | 'solid' | 'vanilla' | 'next' | 'nuxt' | 'gatsby' | 'vite' | 'astro' | 'remix';
  name?: string;
  dependencies?: string[];
  devDependencies?: string[];
  scripts?: { [key: string]: string };
  bundler?: 'webpack' | 'vite' | 'parcel' | 'rollup' | 'esbuild';
  packageManager?: 'npm' | 'yarn' | 'pnpm' | 'bun';
}

// Enhanced interfaces building on your existing ProjectStructure
interface VisualEditorProject extends ProjectStructure {
  visualConfig?: {
    componentMap: Map<string, ComponentMetadata>;
    styleSheets: string[];
    assets: Map<string, AssetReference>;
    layoutTree: LayoutNode[];
    editorState: EditorState;
    lastSyncTimestamp: number;
  }
}

interface ComponentMetadata {
  id: string;
  type: string;
  filePath: string;
  bounds: DOMRect;
  props: Record<string, any>;
  styles: Record<string, string>;
  children: string[];
  parent?: string;
  sourceLocation: { line: number; column: number; file: string };
  // Enhanced properties for advanced editing
  locked?: boolean;
  hidden?: boolean;
  responsive?: {
    mobile?: Partial<ComponentMetadata>;
    tablet?: Partial<ComponentMetadata>;
    desktop?: Partial<ComponentMetadata>;
  };
  animations?: AnimationConfig[];
  interactions?: InteractionConfig[];
  dataBinding?: DataBindingConfig;
  accessibility?: AccessibilityConfig;
  seo?: SEOConfig;
}

interface AnimationConfig {
  id: string;
  type: 'fade' | 'slide' | 'scale' | 'rotate' | 'bounce' | 'custom';
  trigger: 'hover' | 'click' | 'scroll' | 'load' | 'focus';
  duration: number;
  delay?: number;
  easing?: string;
  properties: Record<string, any>;
}

interface InteractionConfig {
  id: string;
  event: 'click' | 'hover' | 'focus' | 'scroll' | 'keypress';
  action: 'navigate' | 'toggle' | 'animate' | 'api-call' | 'custom';
  target?: string;
  parameters?: Record<string, any>;
}

interface DataBindingConfig {
  source: 'api' | 'state' | 'props' | 'local-storage' | 'url-params';
  endpoint?: string;
  property: string;
  transform?: string;
  fallback?: any;
}

interface AccessibilityConfig {
  ariaLabel?: string;
  ariaDescribedBy?: string;
  role?: string;
  tabIndex?: number;
  focusable?: boolean;
  screenReaderText?: string;
}

interface SEOConfig {
  title?: string;
  description?: string;
  keywords?: string[];
  ogImage?: string;
  canonical?: string;
}

interface AssetReference {
  id: string;
  filename: string;
  url: string;
  type: 'image' | 'video' | 'audio' | 'font' | 'document';
  size: number;
  metadata: Record<string, any>;
}

interface LayoutNode {
  id: string;
  component: ComponentMetadata;
  children: LayoutNode[];
  parent: LayoutNode | null;
}

interface EditorState {
  selectedTool: 'select' | 'move' | 'resize' | 'text' | 'image' | 'draw' | 'shape' | 'component';
  zoom: number;
  panOffset: { x: number; y: number };
  snapToGrid: boolean;
  showGuidelines: boolean;
  // Enhanced editor state
  viewport: 'desktop' | 'tablet' | 'mobile';
  theme: 'light' | 'dark' | 'auto';
  gridSize: number;
  showRulers: boolean;
  showBounds: boolean;
  showNames: boolean;
  livePreview: boolean;
  autoSave: boolean;
  collaborationMode: boolean;
  selectedLayer?: string;
  clipboardData?: ComponentMetadata[];
}

interface CodeBlockError {
  type: 'parse' | 'runtime' | 'sync';
  message: string;
  file?: string;
  line?: number;
  componentId?: string;
  id?: string;
}

// Placeholder for SelectionOverlay - assuming it's a component that needs to be imported or defined
// For now, providing a minimal definition to resolve type errors.
const SelectionOverlay = (props: any) => {
  return (
    <div className="absolute inset-0 pointer-events-none">
      {/* Render selection rectangles */}
    </div>
  );
};

// Enhanced Component Library Panel
const ComponentLibraryPanel = ({ framework, onComponentDrop }: {
  framework: string;
  onComponentDrop: (componentType: string, position: { x: number; y: number }) => void;
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set(['basic']));

  const componentCategories = {
    basic: {
      name: 'Basic Elements',
      icon: Square,
      components: [
        { type: 'div', name: 'Container', icon: Square, description: 'Basic container element' },
        { type: 'button', name: 'Button', icon: MousePointer, description: 'Interactive button' },
        { type: 'input', name: 'Input', icon: Type, description: 'Text input field' },
        { type: 'textarea', name: 'Textarea', icon: Type, description: 'Multi-line text input' },
        { type: 'img', name: 'Image', icon: Image, description: 'Image element' },
        { type: 'text', name: 'Text', icon: Type, description: 'Text element' },
        { type: 'link', name: 'Link', icon: Link, description: 'Hyperlink element' }
      ]
    },
    layout: {
      name: 'Layout',
      icon: Layout,
      components: [
        { type: 'header', name: 'Header', icon: Layout, description: 'Page header' },
        { type: 'nav', name: 'Navigation', icon: Layout, description: 'Navigation menu' },
        { type: 'main', name: 'Main', icon: Layout, description: 'Main content area' },
        { type: 'aside', name: 'Sidebar', icon: Layout, description: 'Sidebar content' },
        { type: 'footer', name: 'Footer', icon: Layout, description: 'Page footer' },
        { type: 'section', name: 'Section', icon: Layout, description: 'Content section' },
        { type: 'article', name: 'Article', icon: FileText, description: 'Article content' }
      ]
    },
    forms: {
      name: 'Form Elements',
      icon: FileText,
      components: [
        { type: 'form', name: 'Form', icon: FileText, description: 'Form container' },
        { type: 'select', name: 'Select', icon: ChevronDown, description: 'Dropdown select' },
        { type: 'checkbox', name: 'Checkbox', icon: Square, description: 'Checkbox input' },
        { type: 'radio', name: 'Radio', icon: Square, description: 'Radio button' },
        { type: 'range', name: 'Slider', icon: ArrowRight, description: 'Range slider' },
        { type: 'file', name: 'File Upload', icon: Upload, description: 'File upload input' }
      ]
    },
    media: {
      name: 'Media',
      icon: Image,
      components: [
        { type: 'video', name: 'Video', icon: Play, description: 'Video player' },
        { type: 'audio', name: 'Audio', icon: Play, description: 'Audio player' },
        { type: 'canvas', name: 'Canvas', icon: Paintbrush, description: 'Drawing canvas' },
        { type: 'svg', name: 'SVG', icon: Paintbrush, description: 'SVG graphics' },
        { type: 'iframe', name: 'Iframe', icon: Globe, description: 'Embedded content' }
      ]
    },
    advanced: {
      name: 'Advanced',
      icon: Zap,
      components: framework === 'react' ? [
        { type: 'react-component', name: 'Custom Component', icon: Component, description: 'Custom React component' },
        { type: 'react-hook', name: 'Hook Component', icon: Zap, description: 'Component with hooks' },
        { type: 'react-context', name: 'Context Provider', icon: Database, description: 'Context provider' },
        { type: 'react-portal', name: 'Portal', icon: Globe, description: 'React portal' }
      ] : framework === 'vue' ? [
        { type: 'vue-component', name: 'Vue Component', icon: Component, description: 'Custom Vue component' },
        { type: 'vue-directive', name: 'Directive', icon: Zap, description: 'Vue directive' },
        { type: 'vue-slot', name: 'Slot', icon: Square, description: 'Vue slot' }
      ] : [
        { type: 'web-component', name: 'Web Component', icon: Component, description: 'Custom web component' },
        { type: 'custom-element', name: 'Custom Element', icon: Zap, description: 'Custom HTML element' }
      ]
    }
  };

  const filteredCategories = Object.entries(componentCategories).reduce((acc, [key, category]) => {
    if (selectedCategory !== 'all' && key !== selectedCategory) return acc;
    
    const filteredComponents = category.components.filter(comp =>
      comp.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      comp.description.toLowerCase().includes(searchTerm.toLowerCase())
    );
    
    if (filteredComponents.length > 0) {
      acc[key] = { ...category, components: filteredComponents };
    }
    
    return acc;
  }, {} as typeof componentCategories);

  const toggleCategory = (categoryKey: string) => {
    const newExpanded = new Set(expandedCategories);
    if (newExpanded.has(categoryKey)) {
      newExpanded.delete(categoryKey);
    } else {
      newExpanded.add(categoryKey);
    }
    setExpandedCategories(newExpanded);
  };

  const handleDragStart = (e: React.DragEvent, componentType: string) => {
    e.dataTransfer.setData('component-type', componentType);
    e.dataTransfer.effectAllowed = 'copy';
  };

  return (
    <div className="h-1/2 border-b border-gray-700 flex flex-col">
      <div className="p-4 border-b border-gray-700">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-semibold text-white">Components</h3>
          <Badge variant="outline" className="text-xs">{framework}</Badge>
        </div>
        
        {/* Search */}
        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
          <Input
            placeholder="Search components..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10 bg-gray-800 border-gray-600 text-white"
          />
        </div>

        {/* Category Filter */}
        <Select value={selectedCategory} onValueChange={setSelectedCategory}>
          <SelectTrigger className="bg-gray-800 border-gray-600 text-white">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {Object.entries(componentCategories).map(([key, category]) => (
              <SelectItem key={key} value={key}>{category.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Component List */}
      <div className="flex-1 overflow-y-auto p-2">
        {Object.entries(filteredCategories).map(([categoryKey, category]) => (
          <div key={categoryKey} className="mb-2">
            <button
              onClick={() => toggleCategory(categoryKey)}
              className="w-full flex items-center justify-between p-2 text-left text-white hover:bg-gray-700 rounded"
            >
              <div className="flex items-center gap-2">
                <category.icon className="w-4 h-4" />
                <span className="text-sm font-medium">{category.name}</span>
              </div>
              {expandedCategories.has(categoryKey) ? 
                <ChevronDown className="w-4 h-4" /> : 
                <ChevronRight className="w-4 h-4" />
              }
            </button>
            
            {expandedCategories.has(categoryKey) && (
              <div className="ml-2 space-y-1">
                {category.components.map((component) => (
                  <div
                    key={component.type}
                    draggable
                    onDragStart={(e) => handleDragStart(e, component.type)}
                    className="flex items-center gap-2 p-2 text-gray-300 hover:bg-gray-700 rounded cursor-move group"
                    title={component.description}
                  >
                    <component.icon className="w-4 h-4 text-gray-400" />
                    <div className="flex-1">
                      <div className="text-sm">{component.name}</div>
                      <div className="text-xs text-gray-500 group-hover:text-gray-400">
                        {component.description}
                      </div>
                    </div>
                    <Plus className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

// Enhanced Property Inspector Panel
const PropertyInspectorPanel = ({ 
  selectedComponents, 
  project, 
  onPropertyChange 
}: {
  selectedComponents: Set<string>;
  project: VisualEditorProject;
  onPropertyChange: (componentId: string, property: string, value: any) => void;
}) => {
  const [activeTab, setActiveTab] = useState<'properties' | 'styles' | 'animations' | 'interactions' | 'accessibility'>('properties');
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['basic', 'layout']));

  const selectedComponent = selectedComponents.size === 1 
    ? project.visualConfig?.componentMap.get(Array.from(selectedComponents)[0])
    : null;

  const toggleSection = (section: string) => {
    const newExpanded = new Set(expandedSections);
    if (newExpanded.has(section)) {
      newExpanded.delete(section);
    } else {
      newExpanded.add(section);
    }
    setExpandedSections(newExpanded);
  };

  const renderPropertyInput = (property: string, value: any, type: string = 'text') => {
    if (!selectedComponent) return null;

    const handleChange = (newValue: any) => {
      onPropertyChange(selectedComponent.id, property, newValue);
    };

    switch (type) {
      case 'color':
        return (
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={value || '#000000'}
              onChange={(e) => handleChange(e.target.value)}
              className="w-8 h-8 rounded border border-gray-600"
            />
            <Input
              value={value || ''}
              onChange={(e) => handleChange(e.target.value)}
              className="flex-1 bg-gray-800 border-gray-600 text-white text-xs"
              placeholder="#000000"
            />
          </div>
        );
      case 'number':
        return (
          <Input
            type="number"
            value={value || ''}
            onChange={(e) => handleChange(Number(e.target.value))}
            className="bg-gray-800 border-gray-600 text-white text-xs"
          />
        );
      case 'select':
        return (
          <Select value={value || ''} onValueChange={handleChange}>
            <SelectTrigger className="bg-gray-800 border-gray-600 text-white text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {/* Options would be dynamically generated based on property */}
              <SelectItem value="auto">Auto</SelectItem>
              <SelectItem value="flex">Flex</SelectItem>
              <SelectItem value="grid">Grid</SelectItem>
              <SelectItem value="block">Block</SelectItem>
              <SelectItem value="inline">Inline</SelectItem>
            </SelectContent>
          </Select>
        );
      case 'boolean':
        return (
          <Switch
            checked={value || false}
            onCheckedChange={handleChange}
          />
        );
      case 'slider':
        return (
          <div className="space-y-2">
            <Slider
              value={[value || 0]}
              onValueChange={(values) => handleChange(values[0])}
              max={100}
              step={1}
              className="w-full"
            />
            <div className="text-xs text-gray-400 text-center">{value || 0}</div>
          </div>
        );
      default:
        return (
          <Input
            value={value || ''}
            onChange={(e) => handleChange(e.target.value)}
            className="bg-gray-800 border-gray-600 text-white text-xs"
          />
        );
    }
  };

  const renderPropertiesTab = () => {
    if (!selectedComponent) {
      return (
        <div className="text-center text-gray-400 py-8">
          <Settings className="w-12 h-12 mx-auto mb-4 opacity-50" />
          <p>Select a component to edit properties</p>
        </div>
      );
    }

    const propertySections = {
      basic: {
        name: 'Basic Properties',
        properties: [
          { key: 'id', label: 'ID', type: 'text' },
          { key: 'className', label: 'CSS Class', type: 'text' },
          { key: 'title', label: 'Title', type: 'text' },
          { key: 'hidden', label: 'Hidden', type: 'boolean' },
          { key: 'locked', label: 'Locked', type: 'boolean' }
        ]
      },
      layout: {
        name: 'Layout & Position',
        properties: [
          { key: 'position', label: 'Position', type: 'select' },
          { key: 'display', label: 'Display', type: 'select' },
          { key: 'width', label: 'Width', type: 'text' },
          { key: 'height', label: 'Height', type: 'text' },
          { key: 'top', label: 'Top', type: 'text' },
          { key: 'left', label: 'Left', type: 'text' },
          { key: 'zIndex', label: 'Z-Index', type: 'number' }
        ]
      },
      spacing: {
        name: 'Spacing',
        properties: [
          { key: 'margin', label: 'Margin', type: 'text' },
          { key: 'padding', label: 'Padding', type: 'text' },
          { key: 'gap', label: 'Gap', type: 'text' }
        ]
      },
      typography: {
        name: 'Typography',
        properties: [
          { key: 'fontSize', label: 'Font Size', type: 'text' },
          { key: 'fontFamily', label: 'Font Family', type: 'text' },
          { key: 'fontWeight', label: 'Font Weight', type: 'select' },
          { key: 'color', label: 'Text Color', type: 'color' },
          { key: 'textAlign', label: 'Text Align', type: 'select' },
          { key: 'lineHeight', label: 'Line Height', type: 'text' }
        ]
      },
      background: {
        name: 'Background & Border',
        properties: [
          { key: 'backgroundColor', label: 'Background Color', type: 'color' },
          { key: 'backgroundImage', label: 'Background Image', type: 'text' },
          { key: 'borderColor', label: 'Border Color', type: 'color' },
          { key: 'borderWidth', label: 'Border Width', type: 'text' },
          { key: 'borderRadius', label: 'Border Radius', type: 'text' }
        ]
      }
    };

    return (
      <div className="space-y-4">
        {Object.entries(propertySections).map(([sectionKey, section]) => (
          <div key={sectionKey} className="border border-gray-700 rounded-lg">
            <button
              onClick={() => toggleSection(sectionKey)}
              className="w-full flex items-center justify-between p-3 text-left text-white hover:bg-gray-700 rounded-t-lg"
            >
              <span className="text-sm font-medium">{section.name}</span>
              {expandedSections.has(sectionKey) ? 
                <ChevronDown className="w-4 h-4" /> : 
                <ChevronRight className="w-4 h-4" />
              }
            </button>
            
            {expandedSections.has(sectionKey) && (
              <div className="p-3 space-y-3 border-t border-gray-700">
                {section.properties.map((prop) => (
                  <div key={prop.key} className="space-y-1">
                    <Label className="text-xs text-gray-300">{prop.label}</Label>
                    {renderPropertyInput(
                      prop.key, 
                      selectedComponent.styles?.[prop.key] || selectedComponent.props?.[prop.key], 
                      prop.type
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    );
  };

  const renderStylesTab = () => {
    if (!selectedComponent) return null;

    return (
      <div className="space-y-4">
        <div className="border border-gray-700 rounded-lg p-3">
          <h4 className="text-sm font-medium text-white mb-3">Custom CSS</h4>
          <Textarea
            value={Object.entries(selectedComponent.styles || {})
              .map(([key, value]) => `${key}: ${value};`)
              .join('\n')}
            onChange={(e) => {
              // Parse CSS and update styles
              const styles: Record<string, string> = {};
              e.target.value.split('\n').forEach(line => {
                const [key, value] = line.split(':').map(s => s.trim());
                if (key && value) {
                  styles[key] = value.replace(';', '');
                }
              });
              onPropertyChange(selectedComponent.id, 'styles', styles);
            }}
            className="bg-gray-800 border-gray-600 text-white font-mono text-xs"
            rows={10}
            placeholder="property: value;"
          />
        </div>
      </div>
    );
  };

  const renderAnimationsTab = () => {
    if (!selectedComponent) return null;

    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-medium text-white">Animations</h4>
          <Button size="sm" variant="outline" className="text-xs">
            <Plus className="w-3 h-3 mr-1" />
            Add Animation
          </Button>
        </div>
        
        {selectedComponent.animations?.length ? (
          selectedComponent.animations.map((animation, index) => (
            <div key={animation.id} className="border border-gray-700 rounded-lg p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-white">{animation.type}</span>
                <Button size="sm" variant="ghost" className="text-red-400 hover:text-red-300">
                  <Trash2 className="w-3 h-3" />
                </Button>
              </div>
              <div className="space-y-2 text-xs">
                <div>Trigger: {animation.trigger}</div>
                <div>Duration: {animation.duration}ms</div>
              </div>
            </div>
          ))
        ) : (
          <div className="text-center text-gray-400 py-8">
            <Zap className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p className="text-xs">No animations added</p>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="h-1/2 flex flex-col">
      <div className="p-4 border-b border-gray-700">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-semibold text-white">Properties</h3>
          {selectedComponents.size > 0 && (
            <Badge variant="outline" className="text-xs">
              {selectedComponents.size} selected
            </Badge>
          )}
        </div>

        <Tabs value={activeTab} onValueChange={(value: any) => setActiveTab(value)}>
          <TabsList className="grid w-full grid-cols-4 bg-gray-800">
            <TabsTrigger value="properties" className="text-xs">Props</TabsTrigger>
            <TabsTrigger value="styles" className="text-xs">Styles</TabsTrigger>
            <TabsTrigger value="animations" className="text-xs">Animate</TabsTrigger>
            <TabsTrigger value="accessibility" className="text-xs">A11y</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <Tabs value={activeTab} onValueChange={(value: any) => setActiveTab(value)}>
          <TabsContent value="properties" className="mt-0">
            {renderPropertiesTab()}
          </TabsContent>
          <TabsContent value="styles" className="mt-0">
            {renderStylesTab()}
          </TabsContent>
          <TabsContent value="animations" className="mt-0">
            {renderAnimationsTab()}
          </TabsContent>
          <TabsContent value="accessibility" className="mt-0">
            <div className="text-center text-gray-400 py-8">
              <Settings className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p className="text-xs">Accessibility options coming soon</p>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};



// Enhanced Layers Panel
const LayersPanel = ({ 
  project, 
  selectedComponents, 
  onSelectionChange, 
  onComponentUpdate 
}: {
  project: VisualEditorProject;
  selectedComponents: Set<string>;
  onSelectionChange: (components: Set<string>) => void;
  onComponentUpdate: (id: string, updates: Partial<ComponentMetadata>) => void;
}) => {
  const [expandedLayers, setExpandedLayers] = useState<Set<string>>(new Set());
  const [searchTerm, setSearchTerm] = useState('');

  const toggleLayer = (layerId: string) => {
    const newExpanded = new Set(expandedLayers);
    if (newExpanded.has(layerId)) {
      newExpanded.delete(layerId);
    } else {
      newExpanded.add(layerId);
    }
    setExpandedLayers(newExpanded);
  };

  const components = Array.from(project.visualConfig?.componentMap.values() || []);
  const filteredComponents = components.filter(comp =>
    comp.type.toLowerCase().includes(searchTerm.toLowerCase()) ||
    comp.id.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleComponentClick = (componentId: string, event: React.MouseEvent) => {
    if (event.ctrlKey || event.metaKey) {
      // Multi-select
      const newSelection = new Set(selectedComponents);
      if (newSelection.has(componentId)) {
        newSelection.delete(componentId);
      } else {
        newSelection.add(componentId);
      }
      onSelectionChange(newSelection);
    } else {
      onSelectionChange(new Set([componentId]));
    }
  };

  const handleVisibilityToggle = (componentId: string) => {
    const component = project.visualConfig?.componentMap.get(componentId);
    if (component) {
      onComponentUpdate(componentId, { hidden: !component.hidden });
    }
  };

  const handleLockToggle = (componentId: string) => {
    const component = project.visualConfig?.componentMap.get(componentId);
    if (component) {
      onComponentUpdate(componentId, { locked: !component.locked });
    }
  };

  return (
    <div className="h-1/2 border-b border-gray-700 flex flex-col">
      <div className="p-4 border-b border-gray-700">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-semibold text-white">Layers</h3>
          <Badge variant="outline" className="text-xs">
            {filteredComponents.length}
          </Badge>
        </div>
        
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
          <Input
            placeholder="Search layers..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10 bg-gray-800 border-gray-600 text-white text-sm"
          />
        </div>
      </div>

      {/* Layers List */}
      <div className="flex-1 overflow-y-auto p-2">
        {filteredComponents.length === 0 ? (
          <div className="text-center text-gray-400 py-8">
            <Layers className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p className="text-xs">No components found</p>
          </div>
        ) : (
          <div className="space-y-1">
            {filteredComponents.map((component) => (
              <div
                key={component.id}
                className={`group flex items-center gap-2 p-2 rounded cursor-pointer transition-colors ${
                  selectedComponents.has(component.id)
                    ? 'bg-blue-600/20 border border-blue-500/50'
                    : 'hover:bg-gray-700'
                }`}
                onClick={(e) => handleComponentClick(component.id, e)}
              >
                {/* Component Icon */}
                <div className="w-4 h-4 flex-shrink-0">
                  {component.type === 'react-component' && <Component className="w-4 h-4 text-blue-400" />}
                  {component.type === 'div' && <Square className="w-4 h-4 text-gray-400" />}
                  {component.type === 'button' && <MousePointer className="w-4 h-4 text-green-400" />}
                  {component.type === 'img' && <Image className="w-4 h-4 text-purple-400" />}
                  {!['react-component', 'div', 'button', 'img'].includes(component.type) && 
                    <Square className="w-4 h-4 text-gray-400" />}
                </div>

                {/* Component Info */}
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-white truncate">
                    {component.type}
                  </div>
                  <div className="text-xs text-gray-400 truncate">
                    {component.id}
                  </div>
                </div>

                {/* Controls */}
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="w-6 h-6 p-0"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleVisibilityToggle(component.id);
                    }}
                    title={component.hidden ? "Show" : "Hide"}
                  >
                    {component.hidden ? 
                      <Eye className="w-3 h-3 text-gray-500" /> : 
                      <Eye className="w-3 h-3 text-white" />
                    }
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="w-6 h-6 p-0"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleLockToggle(component.id);
                    }}
                    title={component.locked ? "Unlock" : "Lock"}
                  >
                    {component.locked ? 
                      <Lock className="w-3 h-3 text-red-400" /> : 
                      <Unlock className="w-3 h-3 text-gray-400" />
                    }
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

// Enhanced Assets Panel
const AssetsPanel = ({ 
  project, 
  onAssetUpload, 
  onAssetInsert 
}: {
  project: VisualEditorProject;
  onAssetUpload: (files: FileList) => void;
  onAssetInsert: (asset: AssetReference) => void;
}) => {
  const [activeAssetTab, setActiveAssetTab] = useState<'images' | 'icons' | 'fonts' | 'files'>('images');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const assets = Array.from(project.visualConfig?.assets.values() || []);
  const filteredAssets = assets.filter(asset => {
    switch (activeAssetTab) {
      case 'images': return asset.type === 'image';
      case 'icons': return asset.filename.includes('icon') || asset.filename.includes('svg');
      case 'fonts': return asset.type === 'font';
      default: return true;
    }
  });

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files) {
      onAssetUpload(files);
    }
  };

  const sampleAssets = [
    { id: '1', filename: 'hero-image.jpg', type: 'image' as const, size: 245760, url: '/placeholder.svg' },
    { id: '2', filename: 'logo.svg', type: 'image' as const, size: 12800, url: '/placeholder.svg' },
    { id: '3', filename: 'icon-set.svg', type: 'image' as const, size: 8192, url: '/placeholder.svg' },
    { id: '4', filename: 'background.png', type: 'image' as const, size: 512000, url: '/placeholder.svg' },
  ];

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <div className="h-1/2 flex flex-col">
      <div className="p-4 border-b border-gray-700">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-semibold text-white">Assets</h3>
          <Button
            size="sm"
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            className="text-xs"
          >
            <Upload className="w-3 h-3 mr-1" />
            Upload
          </Button>
        </div>

        {/* Asset Type Tabs */}
        <Tabs value={activeAssetTab} onValueChange={(value: any) => setActiveAssetTab(value)}>
          <TabsList className="grid w-full grid-cols-4 bg-gray-800 h-8">
            <TabsTrigger value="images" className="text-xs">
              <Image className="w-3 h-3 mr-1" />
              Images
            </TabsTrigger>
            <TabsTrigger value="icons" className="text-xs">
              <Paintbrush className="w-3 h-3 mr-1" />
              Icons
            </TabsTrigger>
            <TabsTrigger value="fonts" className="text-xs">
              <Type className="w-3 h-3 mr-1" />
              Fonts
            </TabsTrigger>
            <TabsTrigger value="files" className="text-xs">
              <FileText className="w-3 h-3 mr-1" />
              Files
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*,audio/*,video/*,.pdf,.doc,.docx"
          onChange={handleFileUpload}
          className="hidden"
        />
      </div>

      {/* Assets List */}
      <div className="flex-1 overflow-y-auto p-2">
        {(filteredAssets.length === 0 && sampleAssets.length === 0) ? (
          <div className="text-center text-gray-400 py-8">
            <Package className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p className="text-xs mb-2">No assets uploaded</p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              className="text-xs"
            >
              <Upload className="w-3 h-3 mr-1" />
              Upload Assets
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            {/* Sample Assets for Demo */}
            {sampleAssets.map((asset) => (
              <div
                key={asset.id}
                className="group flex items-center gap-3 p-2 bg-gray-800 rounded hover:bg-gray-700 transition-colors"
              >
                {/* Asset Preview */}
                <div className="w-10 h-10 bg-gray-700 rounded flex items-center justify-center flex-shrink-0">
                  {asset.type === 'image' ? (
                    <img
                      src={asset.url}
                      alt={asset.filename}
                      className="w-full h-full object-cover rounded"
                    />
                  ) : (
                    <FileText className="w-4 h-4 text-gray-400" />
                  )}
                </div>

                {/* Asset Info */}
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-white truncate">
                    {asset.filename}
                  </div>
                  <div className="text-xs text-gray-400">
                    {formatFileSize(asset.size)}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="w-6 h-6 p-0"
                    onClick={() => onAssetInsert(asset as AssetReference)}
                    title="Insert Asset"
                  >
                    <Plus className="w-3 h-3" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="w-6 h-6 p-0"
                    title="More Options"
                  >
                    <MoreHorizontal className="w-3 h-3" />
                  </Button>
                </div>
              </div>
            ))}

            {/* Actual Project Assets */}
            {filteredAssets.map((asset) => (
              <div
                key={asset.id}
                className="group flex items-center gap-3 p-2 bg-gray-800 rounded hover:bg-gray-700 transition-colors"
              >
                <div className="w-10 h-10 bg-gray-700 rounded flex items-center justify-center flex-shrink-0">
                  {asset.type === 'image' ? (
                    <img
                      src={asset.url}
                      alt={asset.filename}
                      className="w-full h-full object-cover rounded"
                    />
                  ) : (
                    <FileText className="w-4 h-4 text-gray-400" />
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="text-sm text-white truncate">
                    {asset.filename}
                  </div>
                  <div className="text-xs text-gray-400">
                    {formatFileSize(asset.size)}
                  </div>
                </div>

                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="w-6 h-6 p-0"
                    onClick={() => onAssetInsert(asset)}
                    title="Insert Asset"
                  >
                    <Plus className="w-3 h-3" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="w-6 h-6 p-0"
                    title="Delete Asset"
                  >
                    <Trash2 className="w-3 h-3 text-red-400" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

// Placeholder for StatusBar
const StatusBar = (props: any) => {
  return (
    <div className="h-8 bg-gray-800 border-t border-gray-700 flex items-center justify-between px-4 text-sm text-gray-400">
      Status Bar
    </div>
  );
};

// Placeholder for ErrorToast
const ErrorToast = (props: any) => {
  return (
    <div className="absolute bottom-4 right-4 p-4 bg-red-600 text-white rounded-lg">
      Errors
    </div>
  );
};

// Placeholder for findComponentAtPoint
const findComponentAtPoint = (x: number, y: number, componentMap: Map<string, ComponentMetadata> | undefined): string | undefined => {
  if (!componentMap) return undefined;
  for (const [id, component] of componentMap.entries()) {
    if (x >= component.bounds.x && x <= (component.bounds.x + component.bounds.width) &&
        y >= component.bounds.y && y <= (component.bounds.y + component.bounds.height)) {
      return id;
    }
  }
  return undefined;
};

// Placeholder for syncVisualChangesToCode
const syncVisualChangesToCode = (componentId: string, updates: Partial<ComponentMetadata>) => {
  console.log(`Syncing changes for ${componentId}:`, updates);
  // Actual implementation would involve updating the code string in project.files
};

// Placeholder for debounceReparse
const debounceReparse = () => {
  console.log('Debouncing reparse...');
  // Actual implementation would involve a debounced call to re-parse components
};

// Placeholder for syncAllChangesToCode
const syncAllChangesToCode = () => {
  console.log('Syncing all changes to code...');
  // Actual implementation would involve iterating through all visual changes and updating code
};

// Placeholder for handleAssetUpload
const handleAssetUpload = (files: FileList) => {
  console.log('Handling asset upload:', files);
};

// Placeholder for handleAssetInsert
const handleAssetInsert = (asset: AssetReference) => {
  console.log('Handling asset insert:', asset);
};

// Placeholder for handleErrorClick
const handleErrorClick = (error: CodeBlockError) => {
  console.log('Handling error click:', error);
};

// Placeholder for dismissError
const dismissError = (errorId: string) => {
  console.log('Dismissing error:', errorId);
};

// Visual Canvas Component
interface VisualCanvasProps {
  project: VisualEditorProject;
  selectedComponents: Set<string>;
  editorState: EditorState;
  onSelectionChange: (selection: Set<string>) => void;
  onComponentUpdate: (componentId: string, updates: Partial<ComponentMetadata>) => void;
  onStateChange: (state: EditorState) => void;
  onComponentDrop: (componentType: string, position: { x: number; y: number }) => void;
  isLoading: boolean;
}

const VisualCanvas: React.FC<VisualCanvasProps> = ({
  project,
  selectedComponents,
  editorState,
  onSelectionChange,
  onComponentUpdate,
  onStateChange,
  onComponentDrop,
  isLoading
}) => {
  const canvasRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [previewHtml, setPreviewHtml] = useState<string>('');

  // Generate preview HTML from project
  useEffect(() => {
    const generatePreviewHtml = () => {
      try {
        const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Preview</title>
    <style>
        body { margin: 0; padding: 20px; font-family: system-ui, sans-serif; }
        .component { border: 1px dashed #ccc; padding: 10px; margin: 5px; min-height: 30px; }
        .selected { border-color: #007acc; background-color: rgba(0, 122, 204, 0.1); }
    </style>
</head>
<body>
    <div id="root">
        <h2>Visual Editor Preview</h2>
        <p>Project: ${project.name}</p>
        <p>Framework: ${project.framework}</p>
        ${project.visualConfig?.componentMap ? 
          Array.from(project.visualConfig.componentMap.values()).map(comp => 
            `<div class="component ${selectedComponents.has(comp.id) ? 'selected' : ''}" data-id="${comp.id}">
              ${comp.type} - ${comp.id}
            </div>`
          ).join('') : 
          '<p>No components yet. Drag components from the library to get started.</p>'
        }
    </div>
    <script>
        // Handle component selection
        document.addEventListener('click', (e) => {
            const component = e.target.closest('.component');
            if (component) {
                const componentId = component.dataset.id;
                window.parent.postMessage({ type: 'selectComponent', componentId }, '*');
            }
        });
    </script>
</body>
</html>`;
        setPreviewHtml(htmlContent);
      } catch (error: any) {
        console.error('Failed to generate preview HTML:', error);
        setPreviewHtml(`
<!DOCTYPE html>
<html><body>
  <div style="padding: 20px; text-align: center; color: #666;">
    <h3>Preview Error</h3>
    <p>Failed to generate preview: ${error?.message || 'Unknown error'}</p>
  </div>
</body></html>`);
      }
    };

    generatePreviewHtml();
  }, [project, selectedComponents]);

  // Handle messages from iframe
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data.type === 'selectComponent') {
        const componentId = event.data.componentId;
        onSelectionChange(new Set([componentId]));
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [onSelectionChange]);

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-gray-900">
        <div className="text-center">
          <RefreshCw className="h-8 w-8 animate-spin mx-auto mb-2 text-blue-400" />
          <p className="text-gray-400">Loading preview...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 bg-gray-900 relative overflow-hidden">
      <div className="absolute inset-0 p-4">
        <iframe
          ref={iframeRef}
          srcDoc={previewHtml}
          className="w-full h-full border border-gray-700 rounded-lg bg-white"
          title="Visual Editor Preview"
          sandbox="allow-scripts allow-same-origin"
        />
      </div>
    </div>
  );
};

// Code Editor Component
interface CodeEditorProps {
  project: VisualEditorProject;
  onCodeChange: (filePath: string, content: string) => void;
  errors: CodeBlockError[];
  selectedComponents: Set<string>;
}

const CodeEditor: React.FC<CodeEditorProps> = ({
  project,
  onCodeChange,
  errors,
  selectedComponents
}) => {
  const [activeFile, setActiveFile] = useState<string>('');
  const [fileContent, setFileContent] = useState<string>('');

  // Initialize with main file
  useEffect(() => {
    const mainFile = getMainFile(project.framework);
    if (project.files[mainFile]) {
      setActiveFile(mainFile);
      setFileContent(project.files[mainFile]);
    }
  }, [project]);

  const handleContentChange = (content: string) => {
    setFileContent(content);
    if (activeFile) {
      onCodeChange(activeFile, content);
    }
  };

  const fileList = Object.keys(project.files);

  return (
    <div className="flex-1 flex flex-col bg-gray-900">
      {/* File Tabs */}
      <div className="flex border-b border-gray-700 bg-gray-800">
        {fileList.map(filePath => (
          <button
            key={filePath}
            onClick={() => {
              setActiveFile(filePath);
              setFileContent(project.files[filePath] || '');
            }}
            className={`px-4 py-2 text-sm border-r border-gray-700 ${
              activeFile === filePath 
                ? 'bg-gray-900 text-white' 
                : 'text-gray-400 hover:text-white hover:bg-gray-700'
            }`}
          >
            {filePath.split('/').pop()}
          </button>
        ))}
      </div>

      {/* Code Editor */}
      <div className="flex-1 relative">
        <Textarea
          value={fileContent}
          onChange={(e) => handleContentChange(e.target.value)}
          className="absolute inset-0 w-full h-full resize-none border-0 bg-gray-900 text-gray-100 font-mono text-sm p-4"
          placeholder="Select a file to edit..."
        />
      </div>

      {/* Error Panel */}
      {errors.length > 0 && (
        <div className="border-t border-gray-700 bg-red-900/20 p-2 max-h-32 overflow-y-auto">
          {errors.map((error, index) => (
            <div key={index} className="flex items-center gap-2 text-red-400 text-sm py-1">
              <AlertCircle className="h-4 w-4" />
              <span>{error.message}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// Helper functions that would be implemented
const extractStyleSheets = (files: { [key: string]: string }): string[] => {
  return Object.entries(files)
    .filter(([filename]) => filename.endsWith('.css'))
    .map(([, content]) => content);
};

const buildLayoutTree = (components: ComponentMetadata[]): LayoutNode[] => {
  // Implementation for building component hierarchy
  return [];
};

const getMainFile = (framework: string): string => {
  switch (framework) {
    case 'react': return 'src/App.jsx';
    case 'vue': return 'src/App.vue';
    case 'angular': return 'src/app/app.component.ts';
    default: return 'index.html';
  }
};

const getDefaultProps = (componentType: string, framework: string): Record<string, any> => {
  // Return default props based on component type and framework
  return {};
};

const getDefaultStyles = (componentType: string): Record<string, string> => {
  return {
    position: 'absolute',
    width: '100px',
    height: '50px'
  };
};

// Enhanced Component Detector Class with multi-framework support
class ComponentDetector {
  constructor(private framework: string) {}

  async detectComponents(files: { [key: string]: string }): Promise<ComponentMetadata[]> {
    const components: ComponentMetadata[] = [];
    
    for (const [filePath, content] of Object.entries(files)) {
      try {
        switch (this.framework) {
          case 'react':
          case 'next':
          case 'gatsby':
            components.push(...this.parseReactComponents(content, filePath));
            break;
          case 'vue':
          case 'nuxt':
            components.push(...this.parseVueComponents(content, filePath));
            break;
          case 'angular':
            components.push(...this.parseAngularComponents(content, filePath));
            break;
          case 'svelte':
            components.push(...this.parseSvelteComponents(content, filePath));
            break;
          case 'solid':
            components.push(...this.parseSolidComponents(content, filePath));
            break;
          case 'astro':
            components.push(...this.parseAstroComponents(content, filePath));
            break;
          case 'remix':
            components.push(...this.parseRemixComponents(content, filePath));
            break;
          default:
            components.push(...this.parseVanillaComponents(content, filePath));
        }
      } catch (error) {
        console.warn(`Failed to parse components in ${filePath}:`, error);
      }
    }
    
    return components;
  }

  private parseReactComponents(code: string, filePath: string): ComponentMetadata[] {
    // Basic React component detection using regex (for demo)
    const components: ComponentMetadata[] = [];
    const functionMatches = code.match(/function\s+([A-Z][a-zA-Z0-9]*)/g) || [];
    const arrowMatches = code.match(/const\s+([A-Z][a-zA-Z0-9]*)\s*=\s*\(/g) || [];
    
    [...functionMatches, ...arrowMatches].forEach((match, index) => {
      const name = match.match(/([A-Z][a-zA-Z0-9]*)/)?.[1] || `Component${index}`;
      components.push({
        id: `comp_${name}_${Date.now()}_${index}`,
        type: 'react-component',
        filePath,
        bounds: new DOMRect(50 + index * 20, 50 + index * 20, 200, 100),
        props: {},
        styles: {},
        children: [],
        sourceLocation: { line: 1, column: 1, file: filePath }
      });
    });
    
    return components;
  }

  private parseVueComponents(code: string, filePath: string): ComponentMetadata[] {
    // Basic Vue component detection
    return [{
      id: `comp_vue_${Date.now()}`,
      type: 'vue-component',
      filePath,
      bounds: new DOMRect(50, 50, 200, 150),
      props: {},
      styles: {},
      children: [],
      sourceLocation: { line: 1, column: 1, file: filePath }
    }];
  }

  private parseAngularComponents(code: string, filePath: string): ComponentMetadata[] {
    const components: ComponentMetadata[] = [];
    
    // Parse Angular components
    const componentMatches = code.match(/@Component\s*\(\s*\{[\s\S]*?\}\s*\)\s*export\s+class\s+(\w+)/g) || [];
    
    componentMatches.forEach((match, index) => {
      const className = match.match(/export\s+class\s+(\w+)/)?.[1];
      if (className) {
        components.push({
          id: `comp_${className}_${Date.now()}_${index}`,
          type: 'angular-component',
          filePath,
          bounds: new DOMRect(50 + index * 20, 50 + index * 20, 200, 100),
          props: {},
          styles: {},
          children: [],
          sourceLocation: { line: 1, column: 1, file: filePath }
        });
      }
    });
    
    return components;
  }

  private parseSvelteComponents(code: string, filePath: string): ComponentMetadata[] {
    const components: ComponentMetadata[] = [];
    
    // Parse Svelte components (basic detection)
    if (filePath.endsWith('.svelte')) {
      const scriptMatches = code.match(/<script[^>]*>([\s\S]*?)<\/script>/g) || [];
      const componentName = filePath.split('/').pop()?.replace('.svelte', '') || 'SvelteComponent';
      
      components.push({
        id: `comp_${componentName}_${Date.now()}`,
        type: 'svelte-component',
        filePath,
        bounds: new DOMRect(50, 50, 200, 100),
        props: {},
        styles: {},
        children: [],
        sourceLocation: { line: 1, column: 1, file: filePath }
      });
    }
    
    return components;
  }

  private parseSolidComponents(code: string, filePath: string): ComponentMetadata[] {
    const components: ComponentMetadata[] = [];
    
    // Parse Solid.js components (similar to React but with different patterns)
    const functionMatches = code.match(/function\s+([A-Z][a-zA-Z0-9]*)/g) || [];
    const arrowMatches = code.match(/const\s+([A-Z][a-zA-Z0-9]*)\s*=\s*\(/g) || [];
    
    [...functionMatches, ...arrowMatches].forEach((match, index) => {
      const name = match.match(/([A-Z][a-zA-Z0-9]*)/)?.[1] || `SolidComponent${index}`;
      components.push({
        id: `comp_${name}_${Date.now()}_${index}`,
        type: 'solid-component',
        filePath,
        bounds: new DOMRect(50 + index * 20, 50 + index * 20, 200, 100),
        props: {},
        styles: {},
        children: [],
        sourceLocation: { line: 1, column: 1, file: filePath }
      });
    });
    
    return components;
  }

  private parseAstroComponents(code: string, filePath: string): ComponentMetadata[] {
    const components: ComponentMetadata[] = [];
    
    // Parse Astro components
    if (filePath.endsWith('.astro')) {
      const componentName = filePath.split('/').pop()?.replace('.astro', '') || 'AstroComponent';
      
      components.push({
        id: `comp_${componentName}_${Date.now()}`,
        type: 'astro-component',
        filePath,
        bounds: new DOMRect(50, 50, 200, 100),
        props: {},
        styles: {},
        children: [],
        sourceLocation: { line: 1, column: 1, file: filePath }
      });
    }
    
    return components;
  }

  private parseRemixComponents(code: string, filePath: string): ComponentMetadata[] {
    // Remix uses React components, so we can reuse React parsing
    return this.parseReactComponents(code, filePath);
  }

  private parseVanillaComponents(code: string, filePath: string): ComponentMetadata[] {
    if (!filePath.endsWith('.html')) return [];
    
    // Parse HTML elements as components
    const components: ComponentMetadata[] = [];
    const elementMatches = code.match(/<(\w+)[^>]*>/g) || [];
    
    elementMatches.forEach((match, index) => {
      const tagName = match.match(/<(\w+)/)?.[1];
      if (tagName && !['html', 'head', 'body', 'meta', 'title', 'script', 'style'].includes(tagName)) {
        components.push({
          id: `comp_${tagName}_${Date.now()}_${index}`,
          type: tagName,
          filePath,
          bounds: new DOMRect(50 + index * 10, 50 + index * 10, 150, 50),
          props: {},
          styles: {},
          children: [],
          sourceLocation: { line: 1, column: 1, file: filePath }
        });
      }
    });
    
    return components;
  }
}



// Component Renderer
function ComponentRenderer({
  component,
  isSelected,
  onUpdate,
  onDrag
}: {
  component: ComponentMetadata;
  isSelected: boolean;
  onUpdate: (updates: Partial<ComponentMetadata>) => void;
  onDrag: (deltaX: number, deltaY: number) => void;
}) {
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  const handleMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsDragging(true);
    setDragStart({ x: e.clientX, y: e.clientY });
  };

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (isDragging) {
      const deltaX = e.clientX - dragStart.x;
      const deltaY = e.clientY - dragStart.y;
      onDrag(deltaX, deltaY);
      setDragStart({ x: e.clientX, y: e.clientY });
    }
  }, [isDragging, dragStart, onDrag]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging, handleMouseMove, handleMouseUp]);

  const renderComponentContent = () => {
    switch (component.type) {
      case 'div':
      case 'react-component':
        return (
          <div className="w-full h-full bg-blue-100 border border-blue-300 rounded flex items-center justify-center text-xs text-blue-800">
            {component.type}
          </div>
        );
      case 'button':
        return (
          <button className="w-full h-full bg-gray-200 border border-gray-400 rounded text-xs">
            Button
          </button>
        );
      case 'img':
        return (
          <div className="w-full h-full bg-gray-200 border border-gray-400 rounded flex items-center justify-center text-xs text-gray-600">
            <Image className="w-4 h-4" />
          </div>
        );
      default:
        return (
          <div className="w-full h-full bg-gray-100 border border-gray-300 rounded flex items-center justify-center text-xs text-gray-600">
            {component.type}
          </div>
        );
    }
  };

  return (
    <div
      className={`absolute cursor-move ${isSelected ? 'ring-2 ring-blue-500' : ''}`}
      onMouseDown={handleMouseDown}
      style={{
        left: component.bounds.x,
        top: component.bounds.y,
        width: component.bounds.width,
        height: component.bounds.height
      }}
    >
      {renderComponentContent()}
    </div>
  );
}

// Main Visual Editor Component
interface VisualEditorProps {
  initialProject: ProjectStructure;
  onSaveToOriginal?: (updatedProject: ProjectStructure) => void;
  onClose?: () => void;
}

export default function VisualEditor({ initialProject, onSaveToOriginal, onClose }: VisualEditorProps) {
  const [project, setProject] = useState<VisualEditorProject>(initialProject);
  const [selectedComponents, setSelectedComponents] = useState<Set<string>>(new Set());
  const [editorMode, setEditorMode] = useState<'design' | 'code' | 'split'>('design');
  const [errors, setErrors] = useState<CodeBlockError[]>([]);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [editorState, setEditorState] = useState<EditorState>({
    selectedTool: 'select',
    zoom: 1,
    panOffset: { x: 0, y: 0 },
    snapToGrid: true,
    showGuidelines: true,
    viewport: 'desktop',
    theme: 'dark',
    gridSize: 20,
    showRulers: false,
    showBounds: false,
    showNames: false,
    livePreview: true,
    autoSave: true,
    collaborationMode: false
  });

  // Viewport controls for responsive preview
  const setViewport = (vp: EditorState['viewport']) =>
    setEditorState(prev => ({ ...prev, viewport: vp }));
  const zoomIn = () => setEditorState(prev => ({ ...prev, zoom: Math.min(2, prev.zoom + 0.1) }));
  const zoomOut = () => setEditorState(prev => ({ ...prev, zoom: Math.max(0.3, prev.zoom - 0.1) }));
  const [undoHistory, setUndoHistory] = useState<VisualEditorProject[]>([]);
  const [redoHistory, setRedoHistory] = useState<VisualEditorProject[]>([]);

  // Initialize visual editor
  useEffect(() => {
    initializeVisualEditor();
  }, []);

  const initializeVisualEditor = async () => {
    try {
      setIsPreviewLoading(true);
      
      // Parse components from code
      const componentDetector = new ComponentDetector(project.framework);
      const detectedComponents = await componentDetector.detectComponents(project.files);
      
      // Initialize visual config
      const visualConfig: VisualEditorProject['visualConfig'] = {
        componentMap: new Map(detectedComponents.map(comp => [comp.id, comp])),
        styleSheets: extractStyleSheets(project.files),
        assets: new Map(),
        layoutTree: buildLayoutTree(detectedComponents),
        editorState,
        lastSyncTimestamp: Date.now()
      };

      setProject(prev => ({ ...prev, visualConfig }));
      
      // Add to undo history
      setUndoHistory([initialProject]);
    } catch (error: any) {
      setErrors(prev => [...prev, {
        type: 'parse',
        message: `Failed to initialize visual editor: ${error?.message || 'Unknown error'}`,
        id: `error_${Date.now()}`
      }]);
    } finally {
      setIsPreviewLoading(false);
    }
  };

  const handleComponentDrop = useCallback((componentType: string, position: { x: number; y: number }) => {
    const newComponent: ComponentMetadata = {
      id: `comp_${Date.now()}`,
      type: componentType,
      filePath: getMainFile(project.framework),
      bounds: new DOMRect(position.x, position.y, 100, 50),
      props: getDefaultProps(componentType, project.framework),
      styles: getDefaultStyles(componentType),
      children: [],
      sourceLocation: { line: 1, column: 1, file: getMainFile(project.framework) }
    };

    setProject(prev => {
      const updated = { ...prev };
      if (updated.visualConfig) {
        updated.visualConfig.componentMap.set(newComponent.id, newComponent);
        updated.visualConfig.layoutTree = buildLayoutTree(Array.from(updated.visualConfig.componentMap.values()));
        updated.visualConfig.lastSyncTimestamp = Date.now();
      }
      return updated;
    });

    // Add to undo history
    addToUndoHistory();
  }, [project.framework]);

  const handleComponentUpdate = useCallback((componentId: string, updates: Partial<ComponentMetadata>) => {
    setProject(prev => {
      const updated = { ...prev };
      if (updated.visualConfig?.componentMap.has(componentId)) {
        const component = updated.visualConfig.componentMap.get(componentId)!;
        updated.visualConfig.componentMap.set(componentId, { ...component, ...updates });
        updated.visualConfig.lastSyncTimestamp = Date.now();
      }
      return updated;
    });

    // Sync changes back to code
    syncVisualChangesToCode(componentId, updates);
  }, []);

  const handlePropertyChange = useCallback((componentId: string, property: string, value: any) => {
    handleComponentUpdate(componentId, { 
      props: { ...project.visualConfig?.componentMap.get(componentId)?.props, [property]: value }
    });
  }, [handleComponentUpdate, project.visualConfig]);

  const handleCodeChange = useCallback((filePath: string, newCode: string) => {
    setProject(prev => ({
      ...prev,
      files: { ...prev.files, [filePath]: newCode }
    }));

    // Re-parse components after code change
    debounceReparse();
  }, []);

  const addToUndoHistory = () => {
    setUndoHistory(prev => [...prev.slice(-19), project]); // Keep last 20 states
    setRedoHistory([]); // Clear redo history
  };

  const undo = () => {
    if (undoHistory.length > 1) {
      const previousState = undoHistory[undoHistory.length - 2];
      setRedoHistory(prev => [project, ...prev.slice(0, 19)]);
      setUndoHistory(prev => prev.slice(0, -1));
      setProject(previousState);
    }
  };

  const redo = () => {
    if (redoHistory.length > 0) {
      const nextState = redoHistory[0];
      setUndoHistory(prev => [...prev, project]);
      setRedoHistory(prev => prev.slice(1));
      setProject(nextState);
    }
  };

  const saveProject = () => {
    // Sync visual changes back to code before saving
    syncAllChangesToCode();
    onSaveToOriginal?.(project);
  };

  return (
    <div className="h-screen w-screen bg-gray-900 flex flex-col">
      {/* Top Toolbar */}
      <VisualEditorToolbar 
        project={project}
        editorMode={editorMode}
        editorState={editorState}
        onModeChange={setEditorMode}
        onToolChange={(tool) => setEditorState(prev => ({ ...prev, selectedTool: tool }))}
        onSave={saveProject}
        onUndo={undo}
        onRedo={redo}
        onClose={onClose}
        canUndo={undoHistory.length > 1}
        canRedo={redoHistory.length > 0}
        errors={errors}
      />
      
      {/* Main Editor Area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Panel - Component Library & Inspector */}
        <div className="w-80 bg-gray-800 border-r border-gray-700 flex flex-col">
          <ComponentLibraryPanel 
            framework={project.framework}
            onComponentDrop={handleComponentDrop}
          />
          <PropertyInspectorPanel 
            selectedComponents={selectedComponents}
            project={project}
            onPropertyChange={handlePropertyChange}
          />
        </div>
        
        {/* Center - Visual Canvas */}
        <div className="flex-1 flex flex-col">
          {(editorMode === 'design' || editorMode === 'split') && (
            <div className={editorMode === 'split' ? 'h-1/2' : 'flex-1'}>
              <VisualCanvas 
                project={project}
                selectedComponents={selectedComponents}
                editorState={editorState}
                onSelectionChange={setSelectedComponents}
                onComponentUpdate={handleComponentUpdate}
                onStateChange={setEditorState}
                onComponentDrop={handleComponentDrop}
                isLoading={isPreviewLoading}
              />
            </div>
          )}
          
          {(editorMode === 'code' || editorMode === 'split') && (
            <div className={editorMode === 'split' ? 'h-1/2 border-t border-gray-700' : 'flex-1'}>
              <CodeEditor 
                project={project}
                onCodeChange={handleCodeChange}
                errors={errors}
                selectedComponents={selectedComponents}
              />
            </div>
          )}
        </div>
        
        {/* Right Panel - Layers & Assets */}
        <div className="w-64 bg-gray-800 border-l border-gray-700 flex flex-col">
          <LayersPanel 
            project={project}
            selectedComponents={selectedComponents}
            onSelectionChange={setSelectedComponents}
            onComponentUpdate={handleComponentUpdate}
          />
          <AssetsPanel 
            project={project}
            onAssetUpload={handleAssetUpload}
            onAssetInsert={handleAssetInsert}
          />
        </div>
      </div>
      
      {/* Bottom Status Bar */}
      <StatusBar 
        project={project}
        editorState={editorState}
        errors={errors}
        onErrorClick={handleErrorClick}
      />
      
      {/* Error Toast */}
      <ErrorToast errors={errors} onDismiss={dismissError} />
    </div>
  );
}

// Toolbar Component
function VisualEditorToolbar({ 
  project, 
  editorMode, 
  editorState, 
  onModeChange, 
  onToolChange, 
  onSave, 
  onUndo, 
  onRedo, 
  onClose,
  canUndo,
  canRedo,
  errors 
}: {
  project: VisualEditorProject;
  editorMode: 'design' | 'code' | 'split';
  editorState: EditorState;
  onModeChange: (mode: 'design' | 'code' | 'split') => void;
  onToolChange: (tool: EditorState['selectedTool']) => void;
  onSave: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onClose?: () => void;
  canUndo: boolean;
  canRedo: boolean;
  errors: CodeBlockError[];
}) {
  const errorCount = errors.filter(e => e.type === 'runtime').length;
  const warningCount = errors.filter(e => e.type === 'parse').length;

  return (
    <div className="h-14 bg-gray-800 border-b border-gray-700 flex items-center justify-between px-4">
      <div className="flex items-center gap-4">
        {/* Mode Switcher */}
        <div className="flex bg-gray-700 rounded-lg">
          <Button
            size="sm"
            variant={editorMode === 'design' ? 'default' : 'ghost'}
            onClick={() => onModeChange('design')}
            className="rounded-r-none"
          >
            <Eye className="w-4 h-4 mr-2" />
            Design
          </Button>
          <Button
            size="sm"
            variant={editorMode === 'split' ? 'default' : 'ghost'}
            onClick={() => onModeChange('split')}
            className="rounded-none border-x border-gray-600"
          >
            Split
          </Button>
          <Button
            size="sm"
            variant={editorMode === 'code' ? 'default' : 'ghost'}
            onClick={() => onModeChange('code')}
            className="rounded-l-none"
          >
            <Code className="w-4 h-4 mr-2" />
            Code
          </Button>
        </div>

        {/* Tool Palette */}
        {editorMode !== 'code' && (
          <div className="flex items-center gap-1 bg-gray-700 rounded-lg p-1">
            <ToolButton
              icon={MousePointer}
              tooltip="Select"
              active={editorState.selectedTool === 'select'}
              onClick={() => onToolChange('select')}
            />
            <ToolButton
              icon={Move}
              tooltip="Move"
              active={editorState.selectedTool === 'move'}
              onClick={() => onToolChange('move')}
            />
            <ToolButton
              icon={Square}
              tooltip="Resize"
              active={editorState.selectedTool === 'resize'}
              onClick={() => onToolChange('resize')}
            />
            <ToolButton
              icon={Type}
              tooltip="Text"
              active={editorState.selectedTool === 'text'}
              onClick={() => onToolChange('text')}
            />
            <ToolButton
              icon={Image}
              tooltip="Image"
              active={editorState.selectedTool === 'image'}
              onClick={() => onToolChange('image')}
            />
          </div>
        )}

        {/* Undo/Redo */}
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={onUndo}
            disabled={!canUndo}
            title="Undo"
          >
            <Undo className="w-4 h-4" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={onRedo}
            disabled={!canRedo}
            title="Redo"
          >
            <Redo className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Center - Project Info */}
      <div className="flex items-center gap-2">
        <Badge variant="outline">{project.framework}</Badge>
        <span className="text-sm text-gray-400">
          {project.visualConfig?.componentMap.size || 0} components
        </span>
        {errorCount > 0 && (
          <Badge variant="destructive" className="flex items-center gap-1">
            <AlertCircle className="w-3 h-3" />
            {errorCount}
          </Badge>
        )}
        {warningCount > 0 && (
          <Badge variant="secondary" className="flex items-center gap-1">
            <Info className="w-3 h-3" />
            {warningCount}
          </Badge>
        )}
      </div>

      {/* Right Actions */}
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          onClick={onSave}
          className="bg-blue-600 hover:bg-blue-700"
        >
          <Save className="w-4 h-4 mr-2" />
          Save
        </Button>
        {onClose && (
          <Button
            size="sm"
            variant="outline"
            onClick={onClose}
          >
            <X className="w-4 h-4" />
          </Button>
        )}
      </div>
    </div>
  );
}

// Tool Button Component
function ToolButton({ 
  icon: Icon, 
  tooltip, 
  active, 
  onClick 
}: { 
  icon: React.ComponentType<any>; 
  tooltip: string; 
  active: boolean; 
  onClick: () => void; 
}) {
  return (
    <Button
      size="sm"
      variant={active ? 'default' : 'ghost'}
      onClick={onClick}
      title={tooltip}
      className="w-8 h-8 p-0"
    >
      <Icon className="w-4 h-4" />
    </Button>
  );
}
