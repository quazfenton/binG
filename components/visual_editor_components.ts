// Visual Canvas Component
function VisualCanvas({ 
  project, 
  selectedComponents, 
  editorState, 
  onSelectionChange, 
  onComponentUpdate, 
  onStateChange,
  isLoading 
}: {
  project: VisualEditorProject;
  selectedComponents: Set<string>;
  editorState: EditorState;
  onSelectionChange: (components: Set<string>) => void;
  onComponentUpdate: (id: string, updates: Partial<ComponentMetadata>) => void;
  onStateChange: (state: Partial<EditorState>) => void;
  isLoading: boolean;
}) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const [dragState, setDragState] = useState<{
    isDragging: boolean;
    dragOffset: { x: number; y: number };
    draggedComponent?: string;
  }>({ isDragging: false, dragOffset: { x: 0, y: 0 } });

  const handleCanvasClick = (e: React.MouseEvent) => {
    if (editorState.selectedTool === 'select') {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;

      const x = (e.clientX - rect.left - editorState.panOffset.x) / editorState.zoom;
      const y = (e.clientY - rect.top - editorState.panOffset.y) / editorState.zoom;

      // Find component at position
      const componentAtPoint = findComponentAtPoint(x, y, project.visualConfig?.componentMap);
      
      if (componentAtPoint) {
        if (e.ctrlKey || e.metaKey) {
          // Multi-select
          const newSelection = new Set(selectedComponents);
          if (newSelection.has(componentAtPoint)) {
            newSelection.delete(componentAtPoint);
          } else {
            newSelection.add(componentAtPoint);
          }
          onSelectionChange(newSelection);
        } else {
          onSelectionChange(new Set([componentAtPoint]));
        }
      } else {
        onSelectionChange(new Set());
      }
    }
  };

  const handleComponentDrag = (componentId: string, deltaX: number, deltaY: number) => {
    const component = project.visualConfig?.componentMap.get(componentId);
    if (!component) return;

    const newBounds = new DOMRect(
      component.bounds.x + deltaX,
      component.bounds.y + deltaY,
      component.bounds.width,
      component.bounds.height
    );

    onComponentUpdate(componentId, { bounds: newBounds });
  };

  const handleZoom = (delta: number) => {
    const newZoom = Math.max(0.1, Math.min(3, editorState.zoom + delta));
    onStateChange({ zoom: newZoom });
  };

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-gray-900">
        <div className="text-center">
          <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-4 text-blue-400" />
          <p className="text-gray-400">Loading visual editor...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-gray-900">
      {/* Canvas Controls */}
      <div className="h-10 bg-gray-800 border-b border-gray-700 flex items-center justify-between px-4">
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-400">
            Zoom: {Math.round(editorState.zoom * 100)}%
          </span>
          <Button size="sm" variant="ghost" onClick={() => handleZoom(-0.1)}>-</Button>
          <Button size="sm" variant="ghost" onClick={() => handleZoom(0.1)}>+</Button>
          <Button size="sm" variant="ghost" onClick={() => onStateChange({ zoom: 1 })}>
            Reset
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-sm text-gray-400">
            <input
              type="checkbox"
              checked={editorState.snapToGrid}
              onChange={(e) => onStateChange({ snapToGrid: e.target.checked })}
            />
            Snap to Grid
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-400">
            <input
              type="checkbox"
              checked={editorState.showGuidelines}
              onChange={(e) => onStateChange({ showGuidelines: e.target.checked })}
            />
            Guidelines
          </label>
        </div>
      </div>

      {/* Canvas Area */}
      <div 
        ref={canvasRef}
        className="flex-1 relative overflow-hidden cursor-crosshair"
        onClick={handleCanvasClick}
        onWheel={(e) => {
          e.preventDefault();
          handleZoom(e.deltaY > 0 ? -0.1 : 0.1);
        }}
        style={{
          backgroundImage: editorState.snapToGrid 
            ? `radial-gradient(circle, #374151 1px, transparent 1px)`
            : undefined,
          backgroundSize: editorState.snapToGrid 
            ? `${20 * editorState.zoom}px ${20 * editorState.zoom}px`
            : undefined
        }}
      >
        {/* Component Renderer */}
        <div
          style={{
            transform: `scale(${editorState.zoom}) translate(${editorState.panOffset.x}px, ${editorState.panOffset.y}px)`,
            transformOrigin: '0 0'
          }}
        >
          {project.visualConfig?.componentMap && Array.from(project.visualConfig.componentMap.entries()).map(([id, component]) => (
            <ComponentRenderer
              key={id}
              component={component}
              isSelected={selectedComponents.has(id)}
              onUpdate={(updates) => onComponentUpdate(id, updates)}
              onDrag={(deltaX, deltaY) => handleComponentDrag(id, deltaX, deltaY)}
            />
          ))}
        </div>

        {/* Selection Overlay */}
        {selectedComponents.size > 0 && (
          <SelectionOverlay
            selectedComponents={Array.from(selectedComponents)}
            componentMap={project.visualConfig?.componentMap}
            zoom={editorState.zoom}
            panOffset={editorState.panOffset}
          />
        )}
      </div>
    </div>
  );
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
      className={`absolute cursor-move ${isSelected ? 'ring-2 ring-blue-500' : ''// visual-editor.tsx - Main Visual Editor Component
"use client"

import * as React from 'react';
import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Badge } from '../components/ui/badge';
import { 
  Eye, Code, Layers, Package, Settings, Save, Undo, Redo,
  MousePointer, Move, RotateCw, Square, Type, Image,
  Palette, Download, Upload, Play, Pause, RefreshCw,
  AlertCircle, CheckCircle, Info, X
} from 'lucide-react';

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
  selectedTool: 'select' | 'move' | 'resize' | 'text' | 'image';
  zoom: number;
  panOffset: { x: number; y: number };
  snapToGrid: boolean;
  showGuidelines: boolean;
}

interface CodeBlockError {
  type: 'parse' | 'runtime' | 'sync';
  message: string;
  file?: string;
  line?: number;
  componentId?: string;
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
    showGuidelines: true
  });
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
    } catch (error) {
      setErrors(prev => [...prev, {
        type: 'parse',
        message: `Failed to initialize visual editor: ${error.message}`
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
  editorMode: string;
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

// Component Detector Class
class ComponentDetector {
  constructor(private framework: string) {}

  async detectComponents(files: { [key: string]: string }): Promise<ComponentMetadata[]> {
    const components: ComponentMetadata[] = [];
    
    for (const [filePath, content] of Object.entries(files)) {
      try {
        switch (this.framework) {
          case 'react':
            components.push(...this.parseReactComponents(content, filePath));
            break;
          case 'vue':
            components.push(...this.parseVueComponents(content, filePath));
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
  
