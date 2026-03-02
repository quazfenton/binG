"use client";

import * as React from "react";
import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useReducer,
  useMemo,
} from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { Slider } from "../components/ui/slider";
import { Switch } from "../components/ui/switch";
import { Textarea } from "../components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import {
  Eye,
  Code,
  Layers,
  Package,
  Settings,
  Save,
  Undo,
  Redo,
  MousePointer,
  Move,
  Square,
  Type,
  Image,
  Palette,
  Download,
  Upload,
  Play,
  RefreshCw,
  AlertCircle,
  Info,
  X,
  Grid,
  Zap,
  Smartphone,
  Monitor,
  Tablet,
  Paintbrush,
  Layout,
  Component,
  Database,
  FileCode,
  Globe,
  Plus,
  Search,
  ChevronDown,
  ChevronRight,
  FileText,
  Lock,
  Unlock,
  Trash2,
  MoreHorizontal,
  Link,
  ArrowRight,
} from "lucide-react";

// ─────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────

export interface ProjectStructure {
  files: { [key: string]: string };
  framework:
    | "react"
    | "vue"
    | "angular"
    | "svelte"
    | "solid"
    | "vanilla"
    | "next"
    | "nuxt"
    | "gatsby"
    | "vite"
    | "astro"
    | "remix";
  name?: string;
  dependencies?: string[];
  devDependencies?: string[];
  scripts?: { [key: string]: string };
  bundler?: "webpack" | "vite" | "parcel" | "rollup" | "esbuild";
  packageManager?: "npm" | "yarn" | "pnpm" | "bun";
}

interface ComponentBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface AnimationConfig {
  id: string;
  type: "fade" | "slide" | "scale" | "rotate" | "bounce" | "custom";
  trigger: "hover" | "click" | "scroll" | "load" | "focus";
  duration: number;
  delay?: number;
}

interface ComponentMetadata {
  id: string;
  type: string;
  filePath: string;
  bounds: ComponentBounds;
  props: Record<string, unknown>;
  styles: Record<string, string>;
  children: string[];
  parent?: string;
  sourceLocation: { line: number; column: number; file: string };
  locked?: boolean;
  hidden?: boolean;
  animations?: AnimationConfig[];
}

interface AssetReference {
  id: string;
  filename: string;
  url: string;
  type: "image" | "video" | "audio" | "font" | "document";
  size: number;
  metadata: Record<string, unknown>;
}

interface LayoutNode {
  id: string;
  component: ComponentMetadata;
  children: LayoutNode[];
  parent: LayoutNode | null;
}

interface EditorState {
  selectedTool: "select" | "move" | "resize" | "text" | "image" | "shape";
  zoom: number;
  panOffset: { x: number; y: number };
  snapToGrid: boolean;
  showGuidelines: boolean;
  viewport: "desktop" | "tablet" | "mobile";
  gridSize: number;
  showBounds: boolean;
  livePreview: boolean;
  autoSave: boolean;
}

interface VisualEditorProject extends ProjectStructure {
  visualConfig?: {
    componentMap: Map<string, ComponentMetadata>;
    styleSheets: string[];
    assets: Map<string, AssetReference>;
    layoutTree: LayoutNode[];
    lastSyncTimestamp: number;
  };
}

interface CodeBlockError {
  id: string;
  type: "parse" | "runtime" | "sync";
  message: string;
  file?: string;
  line?: number;
}

interface VisualEditorProps {
  initialProject: ProjectStructure;
  onSaveToOriginal?: (updatedProject: ProjectStructure) => void;
  onClose?: () => void;
}

// ─────────────────────────────────────────────────────────────
// UNDO/REDO REDUCER
// ─────────────────────────────────────────────────────────────

interface HistoryState {
  past: VisualEditorProject[];
  present: VisualEditorProject;
  future: VisualEditorProject[];
}

type HistoryAction =
  | { type: "SET"; payload: VisualEditorProject }
  | { type: "UNDO" }
  | { type: "REDO" };

function historyReducer(state: HistoryState, action: HistoryAction): HistoryState {
  switch (action.type) {
    case "SET":
      return {
        past: [...state.past.slice(-19), state.present],
        present: action.payload,
        future: [],
      };
    case "UNDO":
      if (state.past.length === 0) return state;
      return {
        past: state.past.slice(0, -1),
        present: state.past[state.past.length - 1],
        future: [state.present, ...state.future.slice(0, 19)],
      };
    case "REDO":
      if (state.future.length === 0) return state;
      return {
        past: [...state.past, state.present],
        present: state.future[0],
        future: state.future.slice(1),
      };
    default:
      return state;
  }
}

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────

function extractStyleSheets(files: { [key: string]: string }): string[] {
  return Object.entries(files)
    .filter(([filename]) => filename.endsWith(".css"))
    .map(([, content]) => content);
}

function buildLayoutTree(components: ComponentMetadata[]): LayoutNode[] {
  const roots: LayoutNode[] = [];
  const nodeMap = new Map<string, LayoutNode>();
  components.forEach((comp) => {
    nodeMap.set(comp.id, { id: comp.id, component: comp, children: [], parent: null });
  });
  nodeMap.forEach((node) => {
    if (node.component.parent) {
      const parent = nodeMap.get(node.component.parent);
      if (parent) {
        node.parent = parent;
        parent.children.push(node);
        return;
      }
    }
    roots.push(node);
  });
  return roots;
}

function getMainFile(framework: string): string {
  switch (framework) {
    case "react":
    case "vite":
      return "src/App.jsx";
    case "next":
      return "pages/index.tsx";
    case "vue":
    case "nuxt":
      return "src/App.vue";
    case "angular":
      return "src/app/app.component.ts";
    case "svelte":
      return "src/App.svelte";
    default:
      return "index.html";
  }
}

function getDefaultStyles(): Record<string, string> {
  return { position: "absolute", width: "120px", height: "48px" };
}

function getDefaultProps(_type: string, _framework: string): Record<string, unknown> {
  return {};
}

function findComponentAtPoint(
  x: number,
  y: number,
  componentMap: Map<string, ComponentMetadata> | undefined
): string | undefined {
  if (!componentMap) return undefined;
  let topmost: string | undefined;
  let topmostZ = -Infinity;
  componentMap.forEach((comp, id) => {
    if (
      x >= comp.bounds.x &&
      x <= comp.bounds.x + comp.bounds.width &&
      y >= comp.bounds.y &&
      y <= comp.bounds.y + comp.bounds.height
    ) {
      const z = Number(comp.styles.zIndex ?? 0);
      if (z >= topmostZ) {
        topmostZ = z;
        topmost = id;
      }
    }
  });
  return topmost;
}

/** Naive code patcher: injects/updates inline style on a JSX element */
function syncVisualChangesToCode(
  project: VisualEditorProject,
  componentId: string,
  updates: Partial<ComponentMetadata>
): VisualEditorProject {
  if (!updates.styles && !updates.props) return project;
  // For now we mark the file as dirty — real AST patching is a Phase 2 task
  return {
    ...project,
    visualConfig: project.visualConfig
      ? {
          ...project.visualConfig,
          lastSyncTimestamp: Date.now(),
        }
      : undefined,
  };
}

// ─────────────────────────────────────────────────────────────
// COMPONENT DETECTOR
// ─────────────────────────────────────────────────────────────

class ComponentDetector {
  constructor(private framework: string) {}

  async detectComponents(files: {
    [key: string]: string;
  }): Promise<ComponentMetadata[]> {
    const components: ComponentMetadata[] = [];
    for (const [filePath, content] of Object.entries(files)) {
      try {
        switch (this.framework) {
          case "react":
          case "next":
          case "gatsby":
          case "remix":
            components.push(...this.parseReactComponents(content, filePath));
            break;
          case "vue":
          case "nuxt":
            components.push(...this.parseVueComponents(content, filePath));
            break;
          case "angular":
            components.push(...this.parseAngularComponents(content, filePath));
            break;
          case "svelte":
            components.push(...this.parseSvelteComponents(content, filePath));
            break;
          default:
            components.push(...this.parseVanillaComponents(content, filePath));
        }
      } catch (err) {
        console.warn(`Failed to parse ${filePath}:`, err);
      }
    }
    return components;
  }

  private parseReactComponents(code: string, filePath: string): ComponentMetadata[] {
    const fnMatches = [...(code.matchAll(/function\s+([A-Z][a-zA-Z0-9]*)/g))];
    const arrowMatches = [...(code.matchAll(/const\s+([A-Z][a-zA-Z0-9]*)\s*=/g))];
    return [...fnMatches, ...arrowMatches].slice(0, 12).map((m, i) => ({
      id: `comp_${m[1] ?? `Component${i}`}_${Date.now()}_${i}`,
      type: "react-component",
      filePath,
      bounds: { x: 40 + i * 24, y: 40 + i * 24, width: 200, height: 80 },
      props: {},
      styles: {},
      children: [],
      sourceLocation: { line: 1, column: 1, file: filePath },
    }));
  }

  private parseVueComponents(code: string, filePath: string): ComponentMetadata[] {
    return [
      {
        id: `comp_vue_${Date.now()}`,
        type: "vue-component",
        filePath,
        bounds: { x: 50, y: 50, width: 220, height: 100 },
        props: {},
        styles: {},
        children: [],
        sourceLocation: { line: 1, column: 1, file: filePath },
      },
    ];
  }

  private parseAngularComponents(
    code: string,
    filePath: string
  ): ComponentMetadata[] {
    return [...(code.matchAll(/@Component[\s\S]*?export\s+class\s+(\w+)/g))].map(
      (m, i) => ({
        id: `comp_${m[1]}_${Date.now()}_${i}`,
        type: "angular-component",
        filePath,
        bounds: { x: 50 + i * 20, y: 50 + i * 20, width: 200, height: 80 },
        props: {},
        styles: {},
        children: [],
        sourceLocation: { line: 1, column: 1, file: filePath },
      })
    );
  }

  private parseSvelteComponents(
    _code: string,
    filePath: string
  ): ComponentMetadata[] {
    if (!filePath.endsWith(".svelte")) return [];
    const name =
      filePath.split("/").pop()?.replace(".svelte", "") ?? "SvelteComp";
    return [
      {
        id: `comp_${name}_${Date.now()}`,
        type: "svelte-component",
        filePath,
        bounds: { x: 50, y: 50, width: 200, height: 80 },
        props: {},
        styles: {},
        children: [],
        sourceLocation: { line: 1, column: 1, file: filePath },
      },
    ];
  }

  private parseVanillaComponents(
    code: string,
    filePath: string
  ): ComponentMetadata[] {
    if (!filePath.endsWith(".html")) return [];
    return [...(code.matchAll(/<([a-z][a-z0-9-]*)[^>]*>/g))]
      .filter(
        (m) =>
          !["html", "head", "body", "meta", "title", "script", "style", "link"].includes(
            m[1]
          )
      )
      .slice(0, 12)
      .map((m, i) => ({
        id: `comp_${m[1]}_${Date.now()}_${i}`,
        type: m[1],
        filePath,
        bounds: { x: 40 + i * 10, y: 40 + i * 10, width: 140, height: 48 },
        props: {},
        styles: {},
        children: [],
        sourceLocation: { line: 1, column: 1, file: filePath },
      }));
  }
}

// ─────────────────────────────────────────────────────────────
// TOOL BUTTON
// ─────────────────────────────────────────────────────────────

function ToolButton({
  icon: Icon,
  tooltip,
  active,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  tooltip: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={tooltip}
      className={`w-8 h-8 flex items-center justify-center rounded transition-all ${
        active
          ? "bg-[#3b82f6] text-white shadow-lg shadow-blue-500/30"
          : "text-[#8b949e] hover:text-white hover:bg-[#30363d]"
      }`}
    >
      <Icon className="w-4 h-4" />
    </button>
  );
}

// ─────────────────────────────────────────────────────────────
// TOOLBAR
// ─────────────────────────────────────────────────────────────

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
  errors,
}: {
  project: VisualEditorProject;
  editorMode: "design" | "code" | "split";
  editorState: EditorState;
  onModeChange: (m: "design" | "code" | "split") => void;
  onToolChange: (t: EditorState["selectedTool"]) => void;
  onSave: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onClose?: () => void;
  canUndo: boolean;
  canRedo: boolean;
  errors: CodeBlockError[];
}) {
  const runtimeErrors = errors.filter((e) => e.type === "runtime").length;
  const parseWarnings = errors.filter((e) => e.type === "parse").length;

  return (
    <div className="h-14 bg-[#161b22] border-b border-[#30363d] flex items-center justify-between px-4 flex-shrink-0">
      {/* Left */}
      <div className="flex items-center gap-3">
        {/* Mode switcher */}
        <div className="flex bg-[#21262d] rounded-lg border border-[#30363d] overflow-hidden">
          {(["design", "split", "code"] as const).map((m) => (
            <button
              key={m}
              onClick={() => onModeChange(m)}
              className={`px-3 h-8 text-xs font-medium flex items-center gap-1.5 transition-colors ${
                editorMode === m
                  ? "bg-[#3b82f6] text-white"
                  : "text-[#8b949e] hover:text-white hover:bg-[#30363d]"
              }`}
            >
              {m === "design" && <Eye className="w-3 h-3" />}
              {m === "code" && <Code className="w-3 h-3" />}
              {m === "split" && <Layout className="w-3 h-3" />}
              {m.charAt(0).toUpperCase() + m.slice(1)}
            </button>
          ))}
        </div>

        {/* Tool palette */}
        {editorMode !== "code" && (
          <div className="flex items-center gap-0.5 bg-[#21262d] rounded-lg border border-[#30363d] p-1">
            <ToolButton icon={MousePointer} tooltip="Select (V)" active={editorState.selectedTool === "select"} onClick={() => onToolChange("select")} />
            <ToolButton icon={Move} tooltip="Move (M)" active={editorState.selectedTool === "move"} onClick={() => onToolChange("move")} />
            <ToolButton icon={Square} tooltip="Shape (R)" active={editorState.selectedTool === "shape"} onClick={() => onToolChange("shape")} />
            <ToolButton icon={Type} tooltip="Text (T)" active={editorState.selectedTool === "text"} onClick={() => onToolChange("text")} />
            <ToolButton icon={Image} tooltip="Image (I)" active={editorState.selectedTool === "image"} onClick={() => onToolChange("image")} />
          </div>
        )}

        {/* Undo/Redo */}
        <div className="flex items-center gap-0.5">
          <button
            onClick={onUndo}
            disabled={!canUndo}
            title="Undo (⌘Z)"
            className="w-8 h-8 flex items-center justify-center rounded text-[#8b949e] hover:text-white hover:bg-[#30363d] disabled:opacity-30 disabled:cursor-not-allowed transition-all"
          >
            <Undo className="w-4 h-4" />
          </button>
          <button
            onClick={onRedo}
            disabled={!canRedo}
            title="Redo (⌘⇧Z)"
            className="w-8 h-8 flex items-center justify-center rounded text-[#8b949e] hover:text-white hover:bg-[#30363d] disabled:opacity-30 disabled:cursor-not-allowed transition-all"
          >
            <Redo className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Center */}
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-white">
          {project.name ?? "Untitled Project"}
        </span>
        <span className="text-[#3b82f6] text-xs bg-[#3b82f6]/10 px-2 py-0.5 rounded-full border border-[#3b82f6]/20">
          {project.framework}
        </span>
        <span className="text-xs text-[#8b949e]">
          {project.visualConfig?.componentMap.size ?? 0} components
        </span>
        {runtimeErrors > 0 && (
          <span className="flex items-center gap-1 text-xs text-red-400 bg-red-400/10 px-2 py-0.5 rounded-full">
            <AlertCircle className="w-3 h-3" />
            {runtimeErrors}
          </span>
        )}
        {parseWarnings > 0 && (
          <span className="flex items-center gap-1 text-xs text-yellow-400 bg-yellow-400/10 px-2 py-0.5 rounded-full">
            <Info className="w-3 h-3" />
            {parseWarnings}
          </span>
        )}
      </div>

      {/* Right */}
      <div className="flex items-center gap-2">
        <button
          onClick={onSave}
          className="flex items-center gap-1.5 px-3 h-8 bg-[#3b82f6] hover:bg-[#2563eb] text-white text-xs font-medium rounded-lg transition-colors"
        >
          <Save className="w-3.5 h-3.5" />
          Save
        </button>
        {onClose && (
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded text-[#8b949e] hover:text-white hover:bg-[#30363d] transition-all"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// COMPONENT LIBRARY PANEL
// ─────────────────────────────────────────────────────────────

const COMPONENT_CATEGORIES = {
  basic: {
    name: "Elements",
    icon: Square,
    items: [
      { type: "div", name: "Container", icon: Square },
      { type: "button", name: "Button", icon: MousePointer },
      { type: "input", name: "Input", icon: Type },
      { type: "textarea", name: "Textarea", icon: FileText },
      { type: "img", name: "Image", icon: Image },
      { type: "text", name: "Text", icon: Type },
      { type: "link", name: "Link", icon: Link },
    ],
  },
  layout: {
    name: "Layout",
    icon: Layout,
    items: [
      { type: "header", name: "Header", icon: Layout },
      { type: "nav", name: "Nav", icon: Layout },
      { type: "main", name: "Main", icon: Layout },
      { type: "aside", name: "Sidebar", icon: Layout },
      { type: "footer", name: "Footer", icon: Layout },
      { type: "section", name: "Section", icon: Layout },
    ],
  },
  forms: {
    name: "Forms",
    icon: FileText,
    items: [
      { type: "form", name: "Form", icon: FileText },
      { type: "select", name: "Select", icon: ChevronDown },
      { type: "checkbox", name: "Checkbox", icon: Square },
      { type: "radio", name: "Radio", icon: Square },
      { type: "range", name: "Slider", icon: ArrowRight },
      { type: "file", name: "File Upload", icon: Upload },
    ],
  },
  media: {
    name: "Media",
    icon: Image,
    items: [
      { type: "video", name: "Video", icon: Play },
      { type: "canvas", name: "Canvas", icon: Paintbrush },
      { type: "svg", name: "SVG", icon: Paintbrush },
      { type: "iframe", name: "Iframe", icon: Globe },
    ],
  },
} as const;

function ComponentLibraryPanel({
  framework,
  onComponentDrop,
}: {
  framework: string;
  onComponentDrop: (type: string, pos: { x: number; y: number }) => void;
}) {
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set(["basic"]));

  const toggle = (k: string) =>
    setExpanded((prev) => {
      const n = new Set(prev);
      n.has(k) ? n.delete(k) : n.add(k);
      return n;
    });

  const handleDragStart = (e: React.DragEvent, type: string) => {
    e.dataTransfer.setData("component-type", type);
    e.dataTransfer.effectAllowed = "copy";
  };

  return (
    <div className="flex flex-col border-b border-[#30363d]" style={{ height: "55%" }}>
      {/* Header */}
      <div className="px-4 pt-4 pb-3 border-b border-[#30363d]">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-semibold text-[#8b949e] uppercase tracking-wider">
            Components
          </span>
          <span className="text-[10px] text-[#3b82f6] bg-[#3b82f6]/10 px-1.5 py-0.5 rounded">
            {framework}
          </span>
        </div>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#484f58]" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search…"
            className="w-full pl-8 pr-3 h-7 bg-[#0d1117] border border-[#30363d] rounded text-xs text-white placeholder-[#484f58] focus:outline-none focus:border-[#3b82f6]"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto py-2 px-2">
        {Object.entries(COMPONENT_CATEGORIES).map(([key, cat]) => {
          const filtered = cat.items.filter((i) =>
            i.name.toLowerCase().includes(search.toLowerCase())
          );
          if (filtered.length === 0) return null;
          const CatIcon = cat.icon;
          return (
            <div key={key} className="mb-1">
              <button
                onClick={() => toggle(key)}
                className="w-full flex items-center gap-2 px-2 py-1.5 text-left text-[#8b949e] hover:text-white hover:bg-[#21262d] rounded text-xs transition-colors"
              >
                <CatIcon className="w-3 h-3" />
                <span className="flex-1 font-medium">{cat.name}</span>
                {expanded.has(key) ? (
                  <ChevronDown className="w-3 h-3" />
                ) : (
                  <ChevronRight className="w-3 h-3" />
                )}
              </button>

              {expanded.has(key) && (
                <div className="ml-2 mt-0.5 space-y-0.5">
                  {filtered.map((item) => {
                    const ItemIcon = item.icon;
                    return (
                      <div
                        key={item.type}
                        draggable
                        onDragStart={(e) => handleDragStart(e, item.type)}
                        className="flex items-center gap-2 px-2 py-1.5 rounded cursor-grab text-[#8b949e] hover:text-white hover:bg-[#21262d] group transition-colors"
                      >
                        <ItemIcon className="w-3.5 h-3.5 flex-shrink-0" />
                        <span className="text-xs">{item.name}</span>
                        <Plus className="w-3 h-3 ml-auto opacity-0 group-hover:opacity-60 transition-opacity" />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// PROPERTY INSPECTOR
// ─────────────────────────────────────────────────────────────

function PropertyInspectorPanel({
  selectedComponents,
  project,
  onPropertyChange,
}: {
  selectedComponents: Set<string>;
  project: VisualEditorProject;
  onPropertyChange: (id: string, prop: string, val: unknown) => void;
}) {
  const [activeTab, setActiveTab] = useState<"props" | "styles" | "animate">("props");

  const comp =
    selectedComponents.size === 1
      ? project.visualConfig?.componentMap.get(
          Array.from(selectedComponents)[0]
        )
      : null;

  if (!comp) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-[#484f58] gap-3 px-4">
        <Settings className="w-8 h-8 opacity-30" />
        <p className="text-xs text-center">Select a component to inspect its properties</p>
      </div>
    );
  }

  const set = (prop: string, val: unknown) => onPropertyChange(comp.id, prop, val);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Tab bar */}
      <div className="flex border-b border-[#30363d] px-2 pt-2 gap-1">
        {(["props", "styles", "animate"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setActiveTab(t)}
            className={`px-3 py-1.5 text-xs rounded-t transition-colors capitalize ${
              activeTab === t
                ? "text-white border-b-2 border-[#3b82f6]"
                : "text-[#8b949e] hover:text-white"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {activeTab === "props" && (
          <>
            <PropRow label="ID">
              <code className="text-[10px] text-[#3b82f6] bg-[#0d1117] px-1.5 py-0.5 rounded">
                {comp.id}
              </code>
            </PropRow>
            <PropRow label="Type">
              <span className="text-xs text-white">{comp.type}</span>
            </PropRow>
            <PropRow label="File">
              <span className="text-[10px] text-[#8b949e] truncate">{comp.filePath}</span>
            </PropRow>

            <Divider label="Position & Size" />

            <div className="grid grid-cols-2 gap-2">
              {(["x", "y", "width", "height"] as const).map((k) => (
                <PropRow key={k} label={k.toUpperCase()}>
                  <InlineNumberInput
                    value={comp.bounds[k]}
                    onChange={(v) => {
                      const newBounds = { ...comp.bounds, [k]: v };
                      onPropertyChange(comp.id, "bounds", newBounds);
                    }}
                    suffix="px"
                  />
                </PropRow>
              ))}
            </div>

            <Divider label="Visibility" />

            <PropRow label="Hidden">
              <Switch
                checked={comp.hidden ?? false}
                onCheckedChange={(v) => set("hidden", v)}
                className="data-[state=checked]:bg-[#3b82f6]"
              />
            </PropRow>
            <PropRow label="Locked">
              <Switch
                checked={comp.locked ?? false}
                onCheckedChange={(v) => set("locked", v)}
                className="data-[state=checked]:bg-[#3b82f6]"
              />
            </PropRow>
          </>
        )}

        {activeTab === "styles" && (
          <>
            <Divider label="Typography" />
            <PropRow label="Color">
              <ColorInput
                value={comp.styles.color ?? "#ffffff"}
                onChange={(v) => set("styles.color", v)}
              />
            </PropRow>
            <PropRow label="Font Size">
              <InlineTextInput
                value={comp.styles.fontSize ?? ""}
                onChange={(v) => set("styles.fontSize", v)}
                placeholder="16px"
              />
            </PropRow>
            <PropRow label="Font Weight">
              <select
                value={comp.styles.fontWeight ?? "400"}
                onChange={(e) => set("styles.fontWeight", e.target.value)}
                className="w-full h-6 bg-[#0d1117] border border-[#30363d] rounded text-xs text-white px-1 focus:outline-none focus:border-[#3b82f6]"
              >
                {["100","200","300","400","500","600","700","800","900","bold"].map((w) => (
                  <option key={w} value={w}>{w}</option>
                ))}
              </select>
            </PropRow>

            <Divider label="Background" />
            <PropRow label="Background">
              <ColorInput
                value={comp.styles.backgroundColor ?? "transparent"}
                onChange={(v) => set("styles.backgroundColor", v)}
              />
            </PropRow>

            <Divider label="Border" />
            <PropRow label="Radius">
              <InlineTextInput
                value={comp.styles.borderRadius ?? ""}
                onChange={(v) => set("styles.borderRadius", v)}
                placeholder="4px"
              />
            </PropRow>
            <PropRow label="Border">
              <InlineTextInput
                value={comp.styles.border ?? ""}
                onChange={(v) => set("styles.border", v)}
                placeholder="1px solid #ccc"
              />
            </PropRow>

            <Divider label="Raw CSS" />
            <textarea
              defaultValue={Object.entries(comp.styles)
                .map(([k, v]) => `${k}: ${v};`)
                .join("\n")}
              onBlur={(e) => {
                const parsed: Record<string, string> = {};
                e.target.value.split("\n").forEach((line) => {
                  const idx = line.indexOf(":");
                  if (idx > 0) {
                    const k = line.slice(0, idx).trim();
                    const v = line.slice(idx + 1).trim().replace(/;$/, "");
                    if (k && v) parsed[k] = v;
                  }
                });
                onPropertyChange(comp.id, "styles", parsed);
              }}
              rows={6}
              className="w-full bg-[#0d1117] border border-[#30363d] rounded text-[11px] font-mono text-white p-2 focus:outline-none focus:border-[#3b82f6] resize-none"
              placeholder="color: red;&#10;margin: 8px;"
            />
          </>
        )}

        {activeTab === "animate" && (
          <div className="flex flex-col items-center justify-center gap-3 py-8 text-[#484f58]">
            <Zap className="w-8 h-8 opacity-30" />
            <p className="text-xs text-center">Animation editor coming in Phase 2</p>
            <button className="text-xs text-[#3b82f6] hover:underline" disabled>
              + Add Animation
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function PropRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 min-h-[24px]">
      <span className="text-[10px] text-[#484f58] w-16 flex-shrink-0">{label}</span>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}

function Divider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 pt-1">
      <span className="text-[10px] text-[#484f58] uppercase tracking-wider whitespace-nowrap">
        {label}
      </span>
      <div className="flex-1 h-px bg-[#21262d]" />
    </div>
  );
}

function ColorInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <input
        type="color"
        value={value.startsWith("#") ? value : "#000000"}
        onChange={(e) => onChange(e.target.value)}
        className="w-5 h-5 rounded cursor-pointer border-0 bg-transparent"
      />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="flex-1 h-6 bg-[#0d1117] border border-[#30363d] rounded text-[11px] text-white px-1.5 focus:outline-none focus:border-[#3b82f6]"
      />
    </div>
  );
}

function InlineTextInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full h-6 bg-[#0d1117] border border-[#30363d] rounded text-[11px] text-white px-1.5 focus:outline-none focus:border-[#3b82f6] placeholder-[#484f58]"
    />
  );
}

function InlineNumberInput({
  value,
  onChange,
  suffix,
}: {
  value: number;
  onChange: (v: number) => void;
  suffix?: string;
}) {
  return (
    <div className="relative">
      <input
        type="number"
        value={Math.round(value)}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-6 bg-[#0d1117] border border-[#30363d] rounded text-[11px] text-white px-1.5 focus:outline-none focus:border-[#3b82f6] pr-6"
      />
      {suffix && (
        <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] text-[#484f58] pointer-events-none">
          {suffix}
        </span>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// LAYERS PANEL
// ─────────────────────────────────────────────────────────────

function LayersPanel({
  project,
  selectedComponents,
  onSelectionChange,
  onComponentUpdate,
}: {
  project: VisualEditorProject;
  selectedComponents: Set<string>;
  onSelectionChange: (s: Set<string>) => void;
  onComponentUpdate: (id: string, updates: Partial<ComponentMetadata>) => void;
}) {
  const [search, setSearch] = useState("");

  const components = useMemo(
    () => Array.from(project.visualConfig?.componentMap.values() ?? []),
    [project.visualConfig?.componentMap]
  );

  const filtered = useMemo(
    () =>
      components.filter(
        (c) =>
          c.type.toLowerCase().includes(search.toLowerCase()) ||
          c.id.toLowerCase().includes(search.toLowerCase())
      ),
    [components, search]
  );

  const handleClick = (id: string, e: React.MouseEvent) => {
    if (e.ctrlKey || e.metaKey) {
      const next = new Set(selectedComponents);
      next.has(id) ? next.delete(id) : next.add(id);
      onSelectionChange(next);
    } else {
      onSelectionChange(new Set([id]));
    }
  };

  return (
    <div className="flex flex-col border-b border-[#30363d]" style={{ height: "50%" }}>
      <div className="px-4 py-3 border-b border-[#30363d]">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-[#8b949e] uppercase tracking-wider">
            Layers
          </span>
          <span className="text-[10px] text-[#8b949e] bg-[#21262d] px-1.5 py-0.5 rounded">
            {filtered.length}
          </span>
        </div>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#484f58]" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search layers…"
            className="w-full pl-8 pr-3 h-7 bg-[#0d1117] border border-[#30363d] rounded text-xs text-white placeholder-[#484f58] focus:outline-none focus:border-[#3b82f6]"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto py-1 px-1">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-[#484f58]">
            <Layers className="w-6 h-6 opacity-30" />
            <p className="text-xs">No layers yet</p>
          </div>
        ) : (
          filtered.map((comp) => {
            const isSelected = selectedComponents.has(comp.id);
            return (
              <div
                key={comp.id}
                onClick={(e) => handleClick(comp.id, e)}
                className={`group flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer transition-colors ${
                  isSelected
                    ? "bg-[#1f3249] border border-[#3b82f6]/40"
                    : "hover:bg-[#21262d]"
                }`}
              >
                <Component
                  className={`w-3.5 h-3.5 flex-shrink-0 ${
                    isSelected ? "text-[#3b82f6]" : "text-[#484f58]"
                  }`}
                />
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-white truncate">{comp.type}</div>
                  <div className="text-[10px] text-[#484f58] truncate">{comp.id.slice(0, 20)}…</div>
                </div>
                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onComponentUpdate(comp.id, { hidden: !comp.hidden });
                    }}
                    className="w-5 h-5 flex items-center justify-center rounded hover:bg-[#30363d] transition-colors"
                    title={comp.hidden ? "Show" : "Hide"}
                  >
                    <Eye className={`w-3 h-3 ${comp.hidden ? "text-[#484f58]" : "text-[#8b949e]"}`} />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onComponentUpdate(comp.id, { locked: !comp.locked });
                    }}
                    className="w-5 h-5 flex items-center justify-center rounded hover:bg-[#30363d] transition-colors"
                    title={comp.locked ? "Unlock" : "Lock"}
                  >
                    {comp.locked ? (
                      <Lock className="w-3 h-3 text-yellow-400" />
                    ) : (
                      <Unlock className="w-3 h-3 text-[#8b949e]" />
                    )}
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// ASSETS PANEL
// ─────────────────────────────────────────────────────────────

function AssetsPanel({
  project,
  onAssetUpload,
  onAssetInsert,
}: {
  project: VisualEditorProject;
  onAssetUpload: (files: FileList) => void;
  onAssetInsert: (asset: AssetReference) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const assets = Array.from(project.visualConfig?.assets.values() ?? []);

  const fmt = (b: number) => {
    if (b === 0) return "0 B";
    const units = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(b) / Math.log(1024));
    return `${(b / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-4 py-3 border-b border-[#30363d] flex items-center justify-between">
        <span className="text-xs font-semibold text-[#8b949e] uppercase tracking-wider">
          Assets
        </span>
        <button
          onClick={() => fileRef.current?.click()}
          className="flex items-center gap-1 text-xs text-[#3b82f6] hover:text-blue-300 transition-colors"
        >
          <Upload className="w-3 h-3" />
          Upload
        </button>
        <input
          ref={fileRef}
          type="file"
          multiple
          accept="image/*,audio/*,video/*"
          className="hidden"
          onChange={(e) => e.target.files && onAssetUpload(e.target.files)}
        />
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {assets.length === 0 ? (
          <div
            onClick={() => fileRef.current?.click()}
            className="m-2 border border-dashed border-[#30363d] rounded-lg flex flex-col items-center justify-center py-8 gap-2 text-[#484f58] cursor-pointer hover:border-[#3b82f6] hover:text-[#3b82f6] transition-colors"
          >
            <Upload className="w-6 h-6 opacity-50" />
            <span className="text-xs">Drop assets here</span>
          </div>
        ) : (
          <div className="space-y-1">
            {assets.map((asset) => (
              <div
                key={asset.id}
                className="group flex items-center gap-2 p-2 rounded bg-[#21262d] hover:bg-[#30363d] transition-colors"
              >
                <div className="w-8 h-8 bg-[#0d1117] rounded flex items-center justify-center flex-shrink-0">
                  {asset.type === "image" ? (
                    <img src={asset.url} alt={asset.filename} className="w-full h-full object-cover rounded" />
                  ) : (
                    <FileText className="w-4 h-4 text-[#484f58]" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-white truncate">{asset.filename}</div>
                  <div className="text-[10px] text-[#484f58]">{fmt(asset.size)}</div>
                </div>
                <button
                  onClick={() => onAssetInsert(asset)}
                  className="opacity-0 group-hover:opacity-100 w-5 h-5 flex items-center justify-center rounded hover:bg-[#30363d] transition-all"
                  title="Insert"
                >
                  <Plus className="w-3 h-3 text-[#3b82f6]" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// COMPONENT RENDERER (on canvas)
// ─────────────────────────────────────────────────────────────

function ComponentRenderer({
  component,
  isSelected,
  onUpdate,
  onDrag,
  zoom,
}: {
  component: ComponentMetadata;
  isSelected: boolean;
  onUpdate: (u: Partial<ComponentMetadata>) => void;
  onDrag: (dx: number, dy: number) => void;
  zoom: number;
}) {
  const isDragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0 });

  const handleMouseDown = (e: React.MouseEvent) => {
    if (component.locked) return;
    e.stopPropagation();
    isDragging.current = true;
    dragStart.current = { x: e.clientX, y: e.clientY };

    const onMove = (ev: MouseEvent) => {
      if (!isDragging.current) return;
      onDrag(
        (ev.clientX - dragStart.current.x) / zoom,
        (ev.clientY - dragStart.current.y) / zoom
      );
      dragStart.current = { x: ev.clientX, y: ev.clientY };
    };
    const onUp = () => {
      isDragging.current = false;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  if (component.hidden) return null;

  const typeColors: Record<string, string> = {
    "react-component": "bg-[#1f3249] border-[#3b82f6]/40 text-[#3b82f6]",
    "vue-component": "bg-[#1a2e1a] border-[#22c55e]/40 text-[#22c55e]",
    button: "bg-[#2a1f1f] border-[#ef4444]/40 text-[#ef4444]",
    img: "bg-[#2a1a2e] border-[#a855f7]/40 text-[#a855f7]",
  };
  const colorClass =
    typeColors[component.type] ??
    "bg-[#21262d] border-[#30363d] text-[#8b949e]";

  return (
    <div
      onMouseDown={handleMouseDown}
      className={`absolute border rounded transition-shadow select-none ${colorClass} ${
        isSelected
          ? "ring-2 ring-[#3b82f6] ring-offset-1 ring-offset-[#0d1117] shadow-lg shadow-[#3b82f6]/20"
          : "hover:ring-1 hover:ring-[#3b82f6]/40"
      } ${component.locked ? "cursor-not-allowed opacity-60" : "cursor-move"}`}
      style={{
        left: component.bounds.x,
        top: component.bounds.y,
        width: component.bounds.width,
        height: component.bounds.height,
        ...component.styles,
      }}
    >
      <div className="w-full h-full flex items-center justify-center p-1 overflow-hidden">
        <span className="text-[10px] font-medium opacity-70 truncate">
          {component.type}
        </span>
      </div>
      {/* Resize handle */}
      {isSelected && !component.locked && (
        <div className="absolute -bottom-1 -right-1 w-3 h-3 bg-[#3b82f6] rounded-sm cursor-se-resize border border-[#0d1117]" />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// SELECTION OVERLAY
// ─────────────────────────────────────────────────────────────

function SelectionOverlay({
  selectedComponents,
  componentMap,
  zoom,
  panOffset,
}: {
  selectedComponents: string[];
  componentMap: Map<string, ComponentMetadata> | undefined;
  zoom: number;
  panOffset: { x: number; y: number };
}) {
  if (!componentMap) return null;
  const selected = selectedComponents
    .map((id) => componentMap.get(id))
    .filter(Boolean) as ComponentMetadata[];
  if (selected.length === 0) return null;

  const minX = Math.min(...selected.map((c) => c.bounds.x));
  const minY = Math.min(...selected.map((c) => c.bounds.y));
  const maxX = Math.max(...selected.map((c) => c.bounds.x + c.bounds.width));
  const maxY = Math.max(...selected.map((c) => c.bounds.y + c.bounds.height));

  const left = minX * zoom + panOffset.x;
  const top = minY * zoom + panOffset.y;
  const width = (maxX - minX) * zoom;
  const height = (maxY - minY) * zoom;

  return (
    <div
      className="absolute pointer-events-none border-2 border-[#3b82f6] border-dashed"
      style={{ left, top, width, height }}
    />
  );
}

// ─────────────────────────────────────────────────────────────
// VISUAL CANVAS
// ─────────────────────────────────────────────────────────────

function VisualCanvas({
  project,
  selectedComponents,
  editorState,
  onSelectionChange,
  onComponentUpdate,
  onStateChange,
  onComponentDrop,
  isLoading,
}: {
  project: VisualEditorProject;
  selectedComponents: Set<string>;
  editorState: EditorState;
  onSelectionChange: (s: Set<string>) => void;
  onComponentUpdate: (id: string, u: Partial<ComponentMetadata>) => void;
  onStateChange: React.Dispatch<React.SetStateAction<EditorState>>;
  onComponentDrop?: (type: string, pos: { x: number; y: number }) => void;
  isLoading: boolean;
}) {
  const canvasRef = useRef<HTMLDivElement>(null);

  const handleCanvasClick = (e: React.MouseEvent) => {
    if (e.target !== canvasRef.current) return;
    onSelectionChange(new Set());
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.08 : 0.08;
    onStateChange((prev) => ({
      ...prev,
      zoom: Math.max(0.1, Math.min(4, prev.zoom + delta)),
    }));
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const type = e.dataTransfer.getData("component-type");
    if (!type || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left - editorState.panOffset.x) / editorState.zoom;
    const y = (e.clientY - rect.top - editorState.panOffset.y) / editorState.zoom;
    onComponentDrop?.(type, { x, y });
  };

  const handleComponentDrag = (id: string, dx: number, dy: number) => {
    const comp = project.visualConfig?.componentMap.get(id);
    if (!comp) return;
    onComponentUpdate(id, {
      bounds: {
        ...comp.bounds,
        x: comp.bounds.x + dx,
        y: comp.bounds.y + dy,
      },
    });
  };

  const gridSize = editorState.gridSize * editorState.zoom;

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[#0d1117]">
        <div className="text-center">
          <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-3 text-[#3b82f6]" />
          <p className="text-sm text-[#8b949e]">Parsing components…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-[#0d1117] overflow-hidden">
      {/* Canvas toolbar */}
      <div className="h-10 bg-[#161b22] border-b border-[#30363d] flex items-center justify-between px-4 flex-shrink-0">
        <div className="flex items-center gap-3">
          {/* Viewport */}
          <div className="flex items-center gap-0.5 bg-[#21262d] rounded border border-[#30363d] p-0.5">
            {(["desktop", "tablet", "mobile"] as const).map((v) => {
              const VIcon = v === "desktop" ? Monitor : v === "tablet" ? Tablet : Smartphone;
              return (
                <button
                  key={v}
                  onClick={() => onStateChange((p) => ({ ...p, viewport: v }))}
                  title={v}
                  className={`w-7 h-6 flex items-center justify-center rounded transition-colors ${
                    editorState.viewport === v
                      ? "bg-[#3b82f6] text-white"
                      : "text-[#8b949e] hover:text-white"
                  }`}
                >
                  <VIcon className="w-3.5 h-3.5" />
                </button>
              );
            })}
          </div>

          {/* Zoom */}
          <div className="flex items-center gap-1.5 text-xs text-[#8b949e]">
            <button
              onClick={() => onStateChange((p) => ({ ...p, zoom: Math.max(0.1, p.zoom - 0.1) }))}
              className="w-5 h-5 flex items-center justify-center rounded hover:bg-[#21262d] hover:text-white transition-colors"
            >−</button>
            <span className="w-12 text-center tabular-nums">
              {Math.round(editorState.zoom * 100)}%
            </span>
            <button
              onClick={() => onStateChange((p) => ({ ...p, zoom: Math.min(4, p.zoom + 0.1) }))}
              className="w-5 h-5 flex items-center justify-center rounded hover:bg-[#21262d] hover:text-white transition-colors"
            >+</button>
            <button
              onClick={() => onStateChange((p) => ({ ...p, zoom: 1, panOffset: { x: 0, y: 0 } }))}
              className="text-[10px] px-1.5 hover:text-white transition-colors"
            >
              Fit
            </button>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs text-[#8b949e] cursor-pointer select-none">
            <Switch
              checked={editorState.snapToGrid}
              onCheckedChange={(v) => onStateChange((p) => ({ ...p, snapToGrid: v }))}
              className="data-[state=checked]:bg-[#3b82f6] scale-75"
            />
            <Grid className="w-3 h-3" />
            Grid
          </label>
          <label className="flex items-center gap-1.5 text-xs text-[#8b949e] cursor-pointer select-none">
            <Switch
              checked={editorState.showBounds}
              onCheckedChange={(v) => onStateChange((p) => ({ ...p, showBounds: v }))}
              className="data-[state=checked]:bg-[#3b82f6] scale-75"
            />
            Bounds
          </label>
          <label className="flex items-center gap-1.5 text-xs text-[#8b949e] cursor-pointer select-none">
            <Switch
              checked={editorState.livePreview}
              onCheckedChange={(v) => onStateChange((p) => ({ ...p, livePreview: v }))}
              className="data-[state=checked]:bg-[#3b82f6] scale-75"
            />
            <Eye className="w-3 h-3" />
            Live
          </label>
        </div>
      </div>

      {/* Canvas area */}
      <div
        ref={canvasRef}
        className={`flex-1 relative overflow-hidden ${
          editorState.selectedTool === "text" ? "cursor-text" :
          editorState.selectedTool === "move" ? "cursor-grab" :
          editorState.selectedTool === "shape" ? "cursor-crosshair" :
          "cursor-default"
        }`}
        onClick={handleCanvasClick}
        onWheel={handleWheel}
        onDrop={handleDrop}
        onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; }}
        style={{
          backgroundImage: editorState.snapToGrid
            ? `radial-gradient(circle, #30363d 1px, transparent 1px)`
            : undefined,
          backgroundSize: editorState.snapToGrid
            ? `${gridSize}px ${gridSize}px`
            : undefined,
          backgroundPosition: `${editorState.panOffset.x % gridSize}px ${editorState.panOffset.y % gridSize}px`,
        }}
      >
        {/* Transform wrapper */}
        <div
          style={{
            transform: `translate(${editorState.panOffset.x}px, ${editorState.panOffset.y}px) scale(${editorState.zoom})`,
            transformOrigin: "0 0",
            position: "absolute",
            top: 0,
            left: 0,
          }}
        >
          {project.visualConfig?.componentMap &&
            Array.from(project.visualConfig.componentMap.entries()).map(([id, comp]) => (
              <ComponentRenderer
                key={id}
                component={comp}
                isSelected={selectedComponents.has(id)}
                onUpdate={(u) => onComponentUpdate(id, u)}
                onDrag={(dx, dy) => handleComponentDrag(id, dx, dy)}
                zoom={editorState.zoom}
              />
            ))}
        </div>

        {/* Selection overlay */}
        {selectedComponents.size > 1 && (
          <SelectionOverlay
            selectedComponents={Array.from(selectedComponents)}
            componentMap={project.visualConfig?.componentMap}
            zoom={editorState.zoom}
            panOffset={editorState.panOffset}
          />
        )}

        {/* Empty state */}
        {(!project.visualConfig?.componentMap ||
          project.visualConfig.componentMap.size === 0) && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="text-center">
              <Layout className="w-12 h-12 mx-auto mb-3 text-[#30363d]" />
              <p className="text-sm text-[#484f58]">Drag components here</p>
              <p className="text-xs text-[#30363d] mt-1">
                or drop from the library on the left
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// CODE EDITOR
// ─────────────────────────────────────────────────────────────

function CodeEditor({
  project,
  onCodeChange,
}: {
  project: VisualEditorProject;
  onCodeChange: (path: string, code: string) => void;
}) {
  const fileNames = Object.keys(project.files);
  const [selectedFile, setSelectedFile] = useState(fileNames[0] ?? null);
  const [content, setContent] = useState(
    selectedFile ? (project.files[selectedFile] ?? "") : ""
  );

  useEffect(() => {
    if (selectedFile && project.files[selectedFile] !== undefined) {
      setContent(project.files[selectedFile]);
    }
  }, [project.files, selectedFile]);

  const handleChange = (val: string) => {
    setContent(val);
    if (selectedFile) onCodeChange(selectedFile, val);
  };

  return (
    <div className="flex-1 flex bg-[#0d1117] overflow-hidden">
      {/* File tree */}
      <div className="w-48 border-r border-[#30363d] flex flex-col flex-shrink-0">
        <div className="px-3 py-2.5 border-b border-[#30363d]">
          <span className="text-[10px] font-semibold text-[#8b949e] uppercase tracking-wider">
            Files
          </span>
        </div>
        <div className="flex-1 overflow-y-auto py-1">
          {fileNames.map((f) => (
            <button
              key={f}
              onClick={() => setSelectedFile(f)}
              className={`w-full text-left px-3 py-1.5 text-xs transition-colors flex items-center gap-2 ${
                selectedFile === f
                  ? "bg-[#1f3249] text-white border-l-2 border-[#3b82f6]"
                  : "text-[#8b949e] hover:bg-[#21262d] hover:text-white"
              }`}
            >
              <FileCode className="w-3 h-3 flex-shrink-0" />
              <span className="truncate">{f}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Editor */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {selectedFile && (
          <div className="px-4 py-2 border-b border-[#30363d] flex items-center gap-2">
            <span className="text-xs text-[#8b949e]">{selectedFile}</span>
          </div>
        )}
        {selectedFile ? (
          <textarea
            value={content}
            onChange={(e) => handleChange(e.target.value)}
            className="flex-1 bg-[#0d1117] text-[#e6edf3] font-mono text-xs p-4 resize-none focus:outline-none leading-relaxed"
            spellCheck={false}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center text-[#484f58] text-sm">
            Select a file
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// STATUS BAR
// ─────────────────────────────────────────────────────────────

function StatusBar({
  project,
  editorState,
  errors,
}: {
  project: VisualEditorProject;
  editorState: EditorState;
  errors: CodeBlockError[];
}) {
  const errCount = errors.filter((e) => e.type !== "parse").length;
  const warnCount = errors.filter((e) => e.type === "parse").length;

  return (
    <div className="h-7 bg-[#161b22] border-t border-[#30363d] flex items-center justify-between px-4 flex-shrink-0">
      <div className="flex items-center gap-4 text-[10px] text-[#484f58]">
        <span>{project.framework}</span>
        <span>{project.visualConfig?.componentMap.size ?? 0} components</span>
        <span>
          Zoom: {Math.round(editorState.zoom * 100)}%
        </span>
        <span>{editorState.viewport}</span>
      </div>
      <div className="flex items-center gap-3 text-[10px]">
        {errCount > 0 && (
          <span className="text-red-400 flex items-center gap-1">
            <AlertCircle className="w-3 h-3" /> {errCount} error{errCount > 1 ? "s" : ""}
          </span>
        )}
        {warnCount > 0 && (
          <span className="text-yellow-400 flex items-center gap-1">
            <Info className="w-3 h-3" /> {warnCount} warning{warnCount > 1 ? "s" : ""}
          </span>
        )}
        {errCount === 0 && warnCount === 0 && (
          <span className="text-[#22c55e]">Ready</span>
        )}
        <span className="text-[#484f58]">
          {new Date(project.visualConfig?.lastSyncTimestamp ?? Date.now()).toLocaleTimeString()}
        </span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// ERROR TOAST
// ─────────────────────────────────────────────────────────────

function ErrorToast({
  errors,
  onDismiss,
}: {
  errors: CodeBlockError[];
  onDismiss: (id: string) => void;
}) {
  const visible = errors.slice(0, 3);
  if (visible.length === 0) return null;

  return (
    <div className="absolute bottom-10 right-4 flex flex-col gap-2 z-50 max-w-sm">
      <AnimatePresence>
        {visible.map((err) => (
          <motion.div
            key={err.id}
            initial={{ opacity: 0, y: 12, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.96 }}
            className={`flex items-start gap-2 p-3 rounded-lg border text-xs shadow-lg backdrop-blur-sm ${
              err.type === "runtime"
                ? "bg-red-950/90 border-red-800 text-red-200"
                : err.type === "parse"
                ? "bg-yellow-950/90 border-yellow-800 text-yellow-200"
                : "bg-blue-950/90 border-blue-800 text-blue-200"
            }`}
          >
            <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="font-medium">{err.type}</div>
              <div className="opacity-80 text-[10px] mt-0.5">{err.message}</div>
            </div>
            <button
              onClick={() => onDismiss(err.id)}
              className="opacity-60 hover:opacity-100 transition-opacity"
            >
              <X className="w-3 h-3" />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// MAIN VISUAL EDITOR
// ─────────────────────────────────────────────────────────────

export default function VisualEditor({
  initialProject,
  onSaveToOriginal,
  onClose,
}: VisualEditorProps) {
  const [{ past, present: project, future }, dispatch] = useReducer(
    historyReducer,
    {
      past: [],
      present: initialProject as VisualEditorProject,
      future: [],
    }
  );

  const [selectedComponents, setSelectedComponents] = useState<Set<string>>(
    new Set()
  );
  const [editorMode, setEditorMode] = useState<"design" | "code" | "split">(
    "design"
  );
  const [editorState, setEditorState] = useState<EditorState>({
    selectedTool: "select",
    zoom: 1,
    panOffset: { x: 40, y: 40 },
    snapToGrid: true,
    showGuidelines: true,
    viewport: "desktop",
    gridSize: 20,
    showBounds: false,
    livePreview: true,
    autoSave: true,
  });
  const [errors, setErrors] = useState<CodeBlockError[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Initialize — parse components from code
  useEffect(() => {
    let cancelled = false;
    const init = async () => {
      try {
        setIsLoading(true);
        const detector = new ComponentDetector(project.framework);
        const detected = await detector.detectComponents(project.files);

        if (cancelled) return;

        const visualConfig: NonNullable<VisualEditorProject["visualConfig"]> = {
          componentMap: new Map(detected.map((c) => [c.id, c])),
          styleSheets: extractStyleSheets(project.files),
          assets: new Map(),
          layoutTree: buildLayoutTree(detected),
          lastSyncTimestamp: Date.now(),
        };

        dispatch({
          type: "SET",
          payload: { ...project, visualConfig },
        });
      } catch (err: unknown) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        setErrors((prev) => [
          ...prev,
          { id: `err_${Date.now()}`, type: "parse", message: msg },
        ]);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };
    init();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleComponentDrop = useCallback(
    (componentType: string, position: { x: number; y: number }) => {
      const newComp: ComponentMetadata = {
        id: `comp_${componentType}_${Date.now()}`,
        type: componentType,
        filePath: getMainFile(project.framework),
        bounds: {
          x: editorState.snapToGrid
            ? Math.round(position.x / editorState.gridSize) * editorState.gridSize
            : position.x,
          y: editorState.snapToGrid
            ? Math.round(position.y / editorState.gridSize) * editorState.gridSize
            : position.y,
          width: 120,
          height: 48,
        },
        props: getDefaultProps(componentType, project.framework),
        styles: getDefaultStyles(),
        children: [],
        sourceLocation: {
          line: 1,
          column: 1,
          file: getMainFile(project.framework),
        },
      };

      dispatch({
        type: "SET",
        payload: {
          ...project,
          visualConfig: project.visualConfig
            ? {
                ...project.visualConfig,
                componentMap: new Map([
                  ...project.visualConfig.componentMap,
                  [newComp.id, newComp],
                ]),
                layoutTree: buildLayoutTree([
                  ...Array.from(project.visualConfig.componentMap.values()),
                  newComp,
                ]),
                lastSyncTimestamp: Date.now(),
              }
            : undefined,
        },
      });

      setSelectedComponents(new Set([newComp.id]));
    },
    [project, editorState.snapToGrid, editorState.gridSize]
  );

  const handleComponentUpdate = useCallback(
    (componentId: string, updates: Partial<ComponentMetadata>) => {
      if (!project.visualConfig) return;
      const existing = project.visualConfig.componentMap.get(componentId);
      if (!existing) return;

      const updated = { ...existing, ...updates };
      const newMap = new Map(project.visualConfig.componentMap);
      newMap.set(componentId, updated);

      const newProject = syncVisualChangesToCode(
        {
          ...project,
          visualConfig: {
            ...project.visualConfig,
            componentMap: newMap,
            lastSyncTimestamp: Date.now(),
          },
        },
        componentId,
        updates
      );

      dispatch({ type: "SET", payload: newProject });
    },
    [project]
  );

  const handlePropertyChange = useCallback(
    (componentId: string, prop: string, val: unknown) => {
      if (prop === "bounds") {
        handleComponentUpdate(componentId, { bounds: val as ComponentBounds });
      } else if (prop.startsWith("styles.")) {
        const existing =
          project.visualConfig?.componentMap.get(componentId)?.styles ?? {};
        handleComponentUpdate(componentId, {
          styles: { ...existing, [prop.slice(7)]: String(val) },
        });
      } else if (prop === "styles") {
        handleComponentUpdate(componentId, { styles: val as Record<string, string> });
      } else {
        const existing =
          project.visualConfig?.componentMap.get(componentId)?.props ?? {};
        handleComponentUpdate(componentId, {
          props: { ...existing, [prop]: val },
        });
      }
    },
    [handleComponentUpdate, project.visualConfig]
  );

  const handleCodeChange = useCallback(
    (filePath: string, code: string) => {
      dispatch({
        type: "SET",
        payload: {
          ...project,
          files: { ...project.files, [filePath]: code },
        },
      });
    },
    [project]
  );

  const handleAssetUpload = useCallback((files: FileList) => {
    Array.from(files).forEach((file) => {
      const url = URL.createObjectURL(file);
      const asset: AssetReference = {
        id: `asset_${Date.now()}_${file.name}`,
        filename: file.name,
        url,
        type: file.type.startsWith("image/") ? "image" : "document",
        size: file.size,
        metadata: {},
      };
      dispatch({
        type: "SET",
        payload: {
          ...project,
          visualConfig: project.visualConfig
            ? {
                ...project.visualConfig,
                assets: new Map([
                  ...project.visualConfig.assets,
                  [asset.id, asset],
                ]),
              }
            : undefined,
        },
      });
    });
  }, [project]);

  const handleAssetInsert = useCallback(
    (asset: AssetReference) => {
      // Drop image asset at center of canvas
      handleComponentDrop("img", {
        x: 100 + Math.random() * 200,
        y: 100 + Math.random() * 200,
      });
    },
    [handleComponentDrop]
  );

  const dismissError = useCallback((id: string) => {
    setErrors((prev) => prev.filter((e) => e.id !== id));
  }, []);

  const handleSave = useCallback(() => {
    onSaveToOriginal?.(project);
  }, [project, onSaveToOriginal]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        dispatch({ type: "UNDO" });
      }
      if (
        ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "z") ||
        ((e.metaKey || e.ctrlKey) && e.key === "y")
      ) {
        e.preventDefault();
        dispatch({ type: "REDO" });
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        handleSave();
      }
      if (e.key === "Escape") setSelectedComponents(new Set());
      if (e.key === "v" && !e.metaKey && !e.ctrlKey)
        setEditorState((p) => ({ ...p, selectedTool: "select" }));
      if (e.key === "m" && !e.metaKey && !e.ctrlKey)
        setEditorState((p) => ({ ...p, selectedTool: "move" }));
      if (e.key === "t" && !e.metaKey && !e.ctrlKey)
        setEditorState((p) => ({ ...p, selectedTool: "text" }));
      if (e.key === "r" && !e.metaKey && !e.ctrlKey)
        setEditorState((p) => ({ ...p, selectedTool: "shape" }));
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleSave]);

  return (
    <div className="h-screen w-screen bg-[#0d1117] flex flex-col overflow-hidden font-sans">
      <VisualEditorToolbar
        project={project}
        editorMode={editorMode}
        editorState={editorState}
        onModeChange={setEditorMode}
        onToolChange={(t) => setEditorState((p) => ({ ...p, selectedTool: t }))}
        onSave={handleSave}
        onUndo={() => dispatch({ type: "UNDO" })}
        onRedo={() => dispatch({ type: "REDO" })}
        onClose={onClose}
        canUndo={past.length > 0}
        canRedo={future.length > 0}
        errors={errors}
      />

      <div className="flex-1 flex overflow-hidden">
        {/* Left panel */}
        <div className="w-64 flex-shrink-0 bg-[#161b22] border-r border-[#30363d] flex flex-col overflow-hidden">
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

        {/* Center */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {editorMode === "design" && (
            <VisualCanvas
              project={project}
              selectedComponents={selectedComponents}
              editorState={editorState}
              onSelectionChange={setSelectedComponents}
              onComponentUpdate={handleComponentUpdate}
              onStateChange={setEditorState}
              onComponentDrop={handleComponentDrop}
              isLoading={isLoading}
            />
          )}
          {editorMode === "code" && (
            <CodeEditor project={project} onCodeChange={handleCodeChange} />
          )}
          {editorMode === "split" && (
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="flex-1 overflow-hidden" style={{ maxHeight: "50%" }}>
                <VisualCanvas
                  project={project}
                  selectedComponents={selectedComponents}
                  editorState={editorState}
                  onSelectionChange={setSelectedComponents}
                  onComponentUpdate={handleComponentUpdate}
                  onStateChange={setEditorState}
                  onComponentDrop={handleComponentDrop}
                  isLoading={isLoading}
                />
              </div>
              <div className="flex-1 border-t border-[#30363d] overflow-hidden">
                <CodeEditor project={project} onCodeChange={handleCodeChange} />
              </div>
            </div>
          )}
        </div>

        {/* Right panel */}
        <div className="w-56 flex-shrink-0 bg-[#161b22] border-l border-[#30363d] flex flex-col overflow-hidden">
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

      <StatusBar project={project} editorState={editorState} errors={errors} />

      <ErrorToast errors={errors} onDismiss={dismissError} />
    </div>
  );
}
