"use client";
//fix
import type React from "react";
import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { Button } from "../components/ui/button";
import { Textarea } from "../components/ui/textarea";
import { Switch } from "../components/ui/switch";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "../components/ui/tabs";
import { Card, CardContent } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import type { Message, ConversationContext } from "../types";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import Send from "lucide-react/dist/esm/icons/send";
import Plus from "lucide-react/dist/esm/icons/plus";
import Sparkles from "lucide-react/dist/esm/icons/sparkles";
import Settings from "lucide-react/dist/esm/icons/settings";
import Accessibility from "lucide-react/dist/esm/icons/accessibility";
import HelpCircle from "lucide-react/dist/esm/icons/help-circle";
import History from "lucide-react/dist/esm/icons/history";
import Loader2 from "lucide-react/dist/esm/icons/loader-2";
import ImageIcon from "lucide-react/dist/esm/icons/image";
import Square from "lucide-react/dist/esm/icons/square";
import MessageSquare from "lucide-react/dist/esm/icons/message-square";
import AlertCircle from "lucide-react/dist/esm/icons/alert-circle";
import Code from "lucide-react/dist/esm/icons/code";
import GripHorizontal from "lucide-react/dist/esm/icons/grip-horizontal";
import Maximize2 from "lucide-react/dist/esm/icons/maximize-2";
import Minimize2 from "lucide-react/dist/esm/icons/minimize-2";
import ArrowDownToLine from "lucide-react/dist/esm/icons/arrow-down-to-line";
import Brain from "lucide-react/dist/esm/icons/brain";
import FileText from "lucide-react/dist/esm/icons/file-text";
import Calculator from "lucide-react/dist/esm/icons/calculator";
import Globe from "lucide-react/dist/esm/icons/globe";
import Palette from "lucide-react/dist/esm/icons/palette";
import Music from "lucide-react/dist/esm/icons/music";
import Zap from "lucide-react/dist/esm/icons/zap";
import Film from "lucide-react/dist/esm/icons/film";
import Camera from "lucide-react/dist/esm/icons/camera";
import MapIcon from "lucide-react/dist/esm/icons/map";
import Gamepad2 from "lucide-react/dist/esm/icons/gamepad-2";
import Shield from "lucide-react/dist/esm/icons/shield";
import Database from "lucide-react/dist/esm/icons/database";
import CheckCircle from "lucide-react/dist/esm/icons/check-circle";
import FileCode from "lucide-react/dist/esm/icons/file-code";
import Search from "lucide-react/dist/esm/icons/search";
import FolderPlus from "lucide-react/dist/esm/icons/folder-plus";
import Hash from "lucide-react/dist/esm/icons/hash";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw";
import Package from "lucide-react/dist/esm/icons/package";
import GitBranch from "lucide-react/dist/esm/icons/git-branch";
import Key from "lucide-react/dist/esm/icons/key";
import Cloud from "lucide-react/dist/esm/icons/cloud";
import Server from "lucide-react/dist/esm/icons/server";
import Scale from "lucide-react/dist/esm/icons/scale";
import Terminal from "lucide-react/dist/esm/icons/terminal";
import type { LLMProvider } from "../lib/api/llm-providers";
import { templateCache, cacheKey } from "../lib/cache";
import MultiModelComparison from "./multi-model-comparison";
import PluginManager, { type Plugin } from "./plugins/plugin-manager";
import AIEnhancerPlugin from "./plugins/ai-enhancer-plugin";
import CodeFormatterPlugin from "./plugins/code-formatter-plugin";
import CalculatorPlugin from "./plugins/calculator-plugin";
import NoteTakerPlugin from "./plugins/note-taker-plugin";
import InteractiveDiagrammingPlugin from "./plugins/interactive-diagramming-plugin";
import DataVisualizationBuilderPlugin from "./plugins/data-visualization-builder-plugin";
import NetworkRequestBuilderPlugin from "./plugins/network-request-builder-plugin";
import LegalDocumentPlugin from "./plugins/legal-document-plugin";
import GitHubExplorerPlugin from "./plugins/github-explorer-plugin";
import HuggingFaceSpacesPlugin from "./plugins/huggingface-spaces-plugin";
import InteractiveStoryboardPlugin from "./plugins/interactive-storyboard-plugin";
import CloudStoragePlugin from "./plugins/cloud-storage-plugin";
import IntegrationPanel from "./integrations/IntegrationPanel";
import { useInteractionCodeMode } from "../hooks/use-interaction-code-mode";
import { pluginMigrationService, PluginCategorizer } from "../lib/plugins/plugin-migration";
import { processResponse } from "../lib/mode-manager";
import { secureRandom, generateSecureId } from "../lib/utils";
import DevOpsCommandCenterPlugin from "./plugins/devops-command-center-plugin";

// Define available plugins for PluginManager
const availablePlugins: Plugin[] = [
  {
    id: "huggingface-spaces",
    name: "Hugging Face Spaces",
    description: "Generate images using Hugging Face Spaces models",
    icon: ImageIcon,
    component: HuggingFaceSpacesPlugin,
    category: "ai",
    defaultSize: { width: 800, height: 600 },
    minSize: { width: 600, height: 400 },
  },
  {
    id: "interactive-storyboard",
    name: "Storyboard Creator",
    description: "Create visual storyboards for films and animations",
    icon: Film,
    component: InteractiveStoryboardPlugin,
    category: "media",
    defaultSize: { width: 900, height: 700 },
    minSize: { width: 700, height: 500 },
  },
  {
    id: "cloud-storage",
    name: "Cloud Storage 5GB",
    description: "Access encrypted files from cloud providers",
    icon: Cloud,
    component: CloudStoragePlugin,
    category: "utility",
    defaultSize: { width: 800, height: 600 },
    minSize: { width: 600, height: 400 },
  },
  {
    id: "github-explorer",
    name: "GitHub Explorer",
    description: "Browse trending repositories and analyze code",
    icon: GitBranch,
    component: GitHubExplorerPlugin,
    category: "code",
    defaultSize: { width: 900, height: 700 },
    minSize: { width: 700, height: 500 },
  },
  {
    id: "legal-document",
    name: "Legal Document Generator",
    description: "Generate legal documents and analyze existing ones",
    icon: Scale,
    component: LegalDocumentPlugin,
    category: "utility",
    defaultSize: { width: 800, height: 600 },
    minSize: { width: 600, height: 400 },
  },
  {
    id: "data-visualization",
    name: "Data Visualization Builder",
    description: "Create interactive charts and graphs",
    icon: Database,
    component: DataVisualizationBuilderPlugin,
    category: "data",
    defaultSize: { width: 900, height: 700 },
    minSize: { width: 700, height: 500 },
  },
  {
    id: "network-request-builder",
    name: "Network Request Builder",
    description: "Build and test API requests",
    icon: Globe,
    component: NetworkRequestBuilderPlugin,
    category: "developer",
    defaultSize: { width: 800, height: 600 },
    minSize: { width: 600, height: 400 },
  },
  {
    id: "note-taker",
    name: "Note Taker",
    description: "Take and organize notes during conversations",
    icon: FileText,
    component: NoteTakerPlugin,
    category: "productivity",
    defaultSize: { width: 600, height: 500 },
    minSize: { width: 400, height: 300 },
  },
  {
    id: "interactive-diagramming",
    name: "Interactive Diagramming",
    description: "Create diagrams and flowcharts",
    icon: CheckCircle,
    component: InteractiveDiagrammingPlugin,
    category: "productivity",
    defaultSize: { width: 900, height: 700 },
    minSize: { width: 700, height: 500 },
  },
  {
    id: "devops-command-center",
    name: "DevOps Command Center",
    description: "Manage deployments and infrastructure",
    icon: Server,
    component: DevOpsCommandCenterPlugin,
    category: "developer",
    defaultSize: { width: 1000, height: 800 },
    minSize: { width: 800, height: 600 },
  },
];

// Plugin modules for Extras tab
const pluginModules = [
  {
    id: "ai-tutor",
    name: "AI Tutor",
    description: "Interactive learning assistant with step-by-step explanations",
    icon: Brain,
    color: "text-purple-400",
    action: (setInput: (value: string) => void) =>
      setInput(
        "Act as an expert tutor. Break down complex topics into digestible steps with examples and practice questions. Topic: ",
      ),
  },
  {
    id: "code-reviewer",
    name: "Code Reviewer",
    description: "Professional code review with best practices and optimizations",
    icon: Code,
    color: "text-blue-400",
    action: (setInput: (value: string) => void) =>
      setInput(
        "Review this code for best practices, performance, security, and maintainability. Provide specific suggestions:\n\n```\n// Paste your code here\n```",
      ),
  },
  {
    id: "data-analyst",
    name: "Data Analyst",
    description: "Analyze data patterns and generate insights with visualizations",
    icon: Database,
    color: "text-green-400",
    action: (setInput: (value: string) => void) =>
      setInput(
        "Analyze this data and provide insights, patterns, and recommendations. Create visualizations where helpful:\n\n",
      ),
  },
  {
    id: "creative-writer",
    name: "Creative Writer",
    description: "Craft engaging stories, scripts, and creative content",
    icon: FileText,
    color: "text-pink-400",
    action: (setInput: (value: string) => void) =>
      setInput(
        "Write a compelling story with vivid characters, engaging dialogue, and descriptive settings. Genre: ",
      ),
  },
  {
    id: "math-solver",
    name: "Math Solver",
    description: "Solve mathematical problems with step-by-step solutions",
    icon: Calculator,
    color: "text-orange-400",
    action: (setInput: (value: string) => void) =>
      setInput(
        "Solve this math problem step by step, explaining each step clearly:\n\n",
      ),
  },
  {
    id: "travel-planner",
    name: "Travel Planner",
    description: "Plan detailed itineraries and travel recommendations",
    icon: Globe,
    color: "text-cyan-400",
    action: (setInput: (value: string) => void) =>
      setInput(
        "Create a detailed travel itinerary for ",
      ),
  },
  {
    id: "legal-assistant",
    name: "Legal Assistant",
    description: "Generate legal documents and analyze existing ones",
    icon: Scale,
    color: "text-indigo-400",
    action: (setInput: (value: string) => void) =>
      setInput(
        "Draft a legal document or analyze this legal text: ",
      ),
  },
  {
    id: "image-generator",
    name: "HF Image Generator",
    description: "Generate images using Hugging Face Spaces models",
    icon: ImageIcon,
    color: "text-yellow-400",
    action: (setInput: (value: string) => void, onActiveTabChange?: (tab: string) => void, setPluginToOpen?: (id: string) => void) => {
      if (setPluginToOpen && onActiveTabChange) {
        setPluginToOpen("huggingface-spaces");
        onActiveTabChange("integrations");
      }
    },
  },
  {
    id: "github-explorer",
    name: "GitHub Explorer",
    description: "Browse trending repositories and analyze code",
    icon: GitBranch,
    color: "text-gray-400",
    action: (setInput: (value: string) => void, onActiveTabChange?: (tab: string) => void, setPluginToOpen?: (id: string) => void) => {
      if (setPluginToOpen && onActiveTabChange) {
        setPluginToOpen("github-explorer");
        onActiveTabChange("integrations");
      }
    },
  },
  {
    id: "cloud-storage",
    name: "Cloud Storage 5GB",
    description: "Access encrypted files from cloud providers",
    icon: Cloud,
    color: "text-sky-400",
    action: (setInput: (value: string) => void, onActiveTabChange?: (tab: string) => void, setPluginToOpen?: (id: string) => void) => {
      if (setPluginToOpen && onActiveTabChange) {
        setPluginToOpen("cloud-storage");
        onActiveTabChange("integrations");
      }
    },
  },
];

interface InteractionPanelProps {
  onSubmit: (content: string) => void;
  onNewChat: () => void;
  isProcessing: boolean;
  toggleAccessibility: () => void;
  toggleHistory: () => void;
  toggleCodePreview: () => void;
  toggleCodeMode?: () => void;
  onAcceptPendingDiffs?: () => void;
  onDismissPendingDiffs?: () => void;
  onStopGeneration?: () => void;
  onRetry?: () => void;
  currentProvider?: string;
  currentModel?: string;
  error?: string | null;
  input: string;
  setInput: (value: string) => void;
  availableProviders: LLMProvider[];
  onProviderChange: (provider: string, model: string) => void;
  hasCodeBlocks?: boolean;
  pendingDiffs?: { path: string; diff: string }[];
  activeTab?: "chat" | "code" | "extras" | "integrations" | "shell";
  onActiveTabChange?: (tab: "chat" | "code" | "extras" | "integrations" | "shell") => void;
  userId?: string;
}

export default function InteractionPanel({
  onSubmit,
  onNewChat,
  isProcessing,
  toggleAccessibility,
  toggleHistory,
  toggleCodePreview,
  toggleCodeMode,
  onStopGeneration,
  onRetry,
  currentProvider = "openrouter",
  currentModel = "deepseek/deepseek-r1-0528:free",
  error,
  input,
  setInput,
  availableProviders,
  onProviderChange,
  hasCodeBlocks = false,
  pendingDiffs = [],
  onAcceptPendingDiffs,
  onDismissPendingDiffs,
  activeTab = "chat",
  onActiveTabChange,
  userId,
}: InteractionPanelProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const codeTextareaRef = useRef<HTMLTextAreaElement>(null);
  const dragHandleRef = useRef<HTMLDivElement>(null);

  // Plugin state
  const [pluginToOpen, setPluginToOpen] = useState<string | null>(null);

  // Panel state
  const [panelHeight, setPanelHeight] = useState(() => {
    if (typeof window !== "undefined" && window.innerWidth <= 768) {
      return Math.min(250, window.innerHeight * 0.4);
    }
    return 320; // Increased from 280 to ensure input is always visible
  });
  const [isDragging, setIsDragging] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const prevPanelHeightRef = useRef<number | null>(null);

  // Handle plugin result
  const handlePluginResult = (pluginId: string, result: any) => {
    console.log(`Plugin ${pluginId} result:`, result);
    if (typeof result === "string") {
      setInput(result);
    } else if (result?.content) {
      setInput(result.content);
    }
  };

  // Adjust panel height on window/viewport resize (mobile orientation + keyboard)
  useEffect(() => {
    let t: number | undefined;

    const adjustForViewport = () => {
      // Debounce rapid resize events
      window.clearTimeout(t);
      t = window.setTimeout(() => {
        const vw = window.visualViewport;
        const viewportH = vw?.height ?? window.innerHeight;

        if (window.innerWidth <= 768) {
          const maxMobileHeight = Math.min(250, viewportH * 0.4);
          setPanelHeight((prev) =>
            prev > maxMobileHeight ? maxMobileHeight : prev,
          );

          // Keep textarea in view when keyboard opens
          if (document.activeElement === textareaRef.current) {
            textareaRef.current?.scrollIntoView({
              behavior: "smooth",
              block: "nearest",
            });
          }
        }
      }, 100);
    };

    window.addEventListener("resize", adjustForViewport);
    // Listen to visualViewport if available (iOS/Android keyboards)
    if (typeof window !== "undefined" && (window as any).visualViewport) {
      const vv = (window as any).visualViewport as VisualViewport;
      vv.addEventListener("resize", adjustForViewport);
      vv.addEventListener("scroll", adjustForViewport);
      return () => {
        window.removeEventListener("resize", adjustForViewport);
        vv.removeEventListener("resize", adjustForViewport);
        vv.removeEventListener("scroll", adjustForViewport);
        if (t) window.clearTimeout(t);
      };
    }

    return () => {
      window.removeEventListener("resize", adjustForViewport);
      if (t) window.clearTimeout(t);
    };
  }, [panelHeight]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Ctrl+K to focus input
      if (event.ctrlKey && event.key === "k") {
        event.preventDefault();
        onActiveTabChange?.("chat"); // Switch to chat tab
        setTimeout(() => {
          textareaRef.current?.focus();
        }, 100);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Mobile: Focus input on mount and when tapping the panel background
  useEffect(() => {
    if (typeof window !== "undefined" && window.innerWidth <= 768) {
      setTimeout(() => {
        textareaRef.current?.focus();
      }, 400);
    }
  }, []);
  // Code Mode Integration
  const [codeModeState, codeModeActions] = useInteractionCodeMode();
  // pending diffs come from parent via props now

  // Initialize plugin migration service
  useEffect(() => {
    // Perform the migration: move Advanced AI Plugins to Extra tab
    const advancedAIPluginIds = ['advanced-ai-plugins'];
    const modularToolsIds = ['modular-tools'];
    
    // Update tab configurations
    pluginMigrationService.movePluginsToTab(advancedAIPluginIds, 'extra');
    pluginMigrationService.movePluginsToTab(modularToolsIds, 'plugins');
    
    // Validate the structure
    const isValid = pluginMigrationService.validateTabStructure();
    if (!isValid) {
      console.warn('Plugin tab structure validation failed');
    }
  }, []);

  // Plugin System
  const availablePlugins: Plugin[] = [
    {
      id: "ai-enhancer",
      name: "Prompt Enhancer",
      description: "Enhance and improve text with AI",
      icon: Sparkles,
      component: AIEnhancerPlugin,
      category: "ai",
      defaultSize: { width: 500, height: 600 },
      minSize: { width: 400, height: 400 },
    },
    {
      id: "code-formatter",
      name: "Code Formatter",
      description: "Format and beautify code",
      icon: Code,
      component: CodeFormatterPlugin,
      category: "code",
      defaultSize: { width: 600, height: 700 },
      minSize: { width: 500, height: 500 },
    },
    {
      id: "calculator",
      name: "Calculator",
      description: "Perform calculations",
      icon: Calculator,
      component: CalculatorPlugin,
      category: "utility",
      defaultSize: { width: 350, height: 500 },
      minSize: { width: 300, height: 400 },
    },
    {
      id: "note-taker",
      name: "Notes",
      description: "Take and manage notes",
      icon: FileText,
      component: NoteTakerPlugin,
      category: "utility",
      defaultSize: { width: 800, height: 600 },
      minSize: { width: 600, height: 400 },
    },
    {
      id: "interactive-diagramming",
      name: "Diagramming Tool",
      description: "Create and edit diagrams like flowcharts and architecture.",
      icon: GitBranch,
      component: InteractiveDiagrammingPlugin,
      category: "design",
      defaultSize: { width: 800, height: 700 },
      minSize: { width: 600, height: 500 },
    },
    {
      id: "data-visualization-builder",
      name: "Data Visualizer",
      description: "Interactively build charts and graphs from data.",
      icon: Database,
      component: DataVisualizationBuilderPlugin,
      category: "data",
      defaultSize: { width: 850, height: 650 },
      minSize: { width: 650, height: 450 },
    },
    {
      id: "network-request-builder",
      name: "API Tester",
      description: "Construct and send HTTP requests.",
      icon: Globe,
      component: NetworkRequestBuilderPlugin,
      category: "utility",
      defaultSize: { width: 700, height: 600 },
      minSize: { width: 500, height: 400 },
    },
    {
      id: "legal-document",
      name: "Legal Document Generator",
      description: "Generate legal documents and analyze existing ones",
      icon: Scale,
      component: LegalDocumentPlugin,
      category: "utility",
      defaultSize: { width: 800, height: 600 },
      minSize: { width: 600, height: 400 },
    },
    {
      id: "interactive-storyboard",
      name: "Storyboard Creator",
      description: "Create visual storyboards for films and animations",
      icon: Film,
      component: InteractiveStoryboardPlugin,
      category: "media",
      defaultSize: { width: 900, height: 700 },
      minSize: { width: 700, height: 500 },
    },
    {
      id: "huggingface-spaces",
      name: "HF Image Generator",
      description: "Generate images using Hugging Face Spaces models",
      icon: ImageIcon,
      component: HuggingFaceSpacesPlugin,
      category: "ai",
      defaultSize: { width: 800, height: 600 },
      minSize: { width: 600, height: 400 },
    },
    {
      id: "github-explorer",
      name: "GitHub Explorer",
      description: "Browse trending repositories and analyze code",
      icon: GitBranch,
      component: GitHubExplorerPlugin,
      category: "code",
      defaultSize: { width: 900, height: 700 },
      minSize: { width: 700, height: 500 },
    },
    {
      id: "cloud-storage",
      name: "Cloud Storage 5GB",
      description: "Access encrypted files from cloud providers",
      icon: Cloud,
      component: CloudStoragePlugin,
      category: "utility",
      defaultSize: { width: 800, height: 600 },
      minSize: { width: 600, height: 400 },
    },
  ];

  const [showFileSelector, setShowFileSelector] = useState(false);
  const [showMultiModelComparison, setShowMultiModelComparison] =
    useState(false);

  // Simple chat suggestions (randomized on mount)
  const chatSuggestions = useMemo(() => {
    const suggestions = [
      "unique app ideas",
      "code a basic web app",
      "make an addicting web game",
      "show me something interesting",
      "explain quantum computing simply",
      "create a business plan",
      "write a short story",
      "design a logo concept",
      "plan a workout routine",
      "suggest healthy recipes",
      "debug this error",
      "optimize my workflow",
    ];
    return [...suggestions].sort(() => 0.5 - secureRandom()).slice(0, 4);
  }, []);

  // Code-specific prompt templates
  const codeTemplates = [
    {
      title: "Component Creation",
      template: "Create a [framework] component that [functionality]. Include:\n- TypeScript types\n- Props interface\n- Error handling\n- Unit tests\n- Documentation",
    },
    {
      title: "API Development",
      template: "Build a [language] API for [purpose] with:\n- RESTful endpoints\n- Input validation\n- Error handling\n- Authentication\n- Database integration\n- API documentation",
    },
    {
      title: "Full Stack App",
      template: "Create a full-stack [type] application with:\n- Frontend: [frontend-tech]\n- Backend: [backend-tech]\n- Database: [database]\n- Authentication\n- Responsive design\n- Deployment configuration",
    },
    {
      title: "Code Review",
      template: "Review this code for:\n- Performance optimizations\n- Security vulnerabilities\n- Best practices\n- Code quality\n- Potential bugs\n- Refactoring suggestions\n\n[paste your code here]",
    },
  ];

  // Plugin modules with randomization
  const pluginModules = useMemo(() => {
    const modules = [
      {
        id: "ai-tutor",
        name: "AI Tutor",
        description:
          "Interactive learning assistant with step-by-step explanations",
        icon: Brain,
        color: "text-purple-400",
        action: () =>
          setInput(
            "Act as an expert tutor. Break down complex topics into digestible steps with examples and practice questions. Topic: ",
          ),
      },
      {
        id: "code-reviewer",
        name: "Code Reviewer",
        description:
          "Professional code review with best practices and optimizations",
        icon: Code,
        color: "text-blue-400",
        action: () =>
          setInput(
            "Review this code for best practices, performance, security, and maintainability. Provide specific suggestions:\n\n```\n// Paste your code here\n```",
          ),
      },
      {
        id: "multi-model-compare",
        name: "Multi-Model Compare",
        description: "Compare responses from multiple AI models simultaneously",
        icon: Zap,
        color: "text-yellow-400",
        action: () => setShowMultiModelComparison(true),
      },
      {
        id: "document-analyzer",
        name: "Document Analyzer",
        description: "Analyze and summarize documents, extract key insights",
        icon: FileText,
        color: "text-green-400",
        action: () =>
          setInput(
            "Analyze this document and provide: 1) Executive summary 2) Key findings 3) Different perspectives 4) Recent developments 5) Reliable sources. Topic: ",
          ),
      },
      {
        id: "math-solver",
        name: "Math Solver",
        description:
          "Step-by-step mathematical problem solving with visualizations",
        icon: Calculator,
        color: "text-orange-400",
        action: () =>
          setInput(
            "Solve this mathematical problem step-by-step with clear explanations and visual representations where helpful:\n\n",
          ),
      },
      {
        id: "research-assistant",
        name: "Research Assistant",
        description:
          "Comprehensive research with sources, analysis, and citations",
        icon: Globe,
        color: "text-cyan-400",
        action: () =>
          setInput(
            "Research this topic comprehensively. Provide: 1) Overview 2) Key findings 3) Different perspectives 4) Recent developments 5) Reliable sources. Topic: ",
          ),
      },
      {
        id: "data-analyst",
        name: "Data Analyst",
        description:
          "Analyze datasets, create visualizations, and extract insights",
        icon: Database,
        color: "text-indigo-400",
        action: () =>
          setInput(
            "Analyze this data and provide insights, trends, and visualizations. Include statistical analysis and actionable recommendations:\n\n",
          ),
      },
      {
        id: "creative-writer",
        name: "Creative Writer",
        description: "Generate creative content, stories, and marketing copy",
        icon: Palette,
        color: "text-pink-400",
        action: () =>
          setInput(
            "Create engaging creative content. Specify the type (story, blog post, marketing copy, etc.) and key requirements:\n\nContent type: \nTone: \nAudience: \nKey points: ",
          ),
      },
      {
        id: "music-composer",
        name: "Music Composer",
        description:
          "Generate musical compositions, lyrics, and audio concepts",
        icon: Music,
        color: "text-yellow-400",
        action: () =>
          setInput(
            "Help me create music. Provide chord progressions, melody ideas, lyrics, or composition structure for:\n\nGenre: \nMood: \nInstruments: \nTheme: ",
          ),
      },
      {
        id: "image-prompter",
        name: "Image Prompter",
        description: "Generate detailed prompts for AI image generation",
        icon: Camera,
        color: "text-red-400",
        action: () =>
          setInput(
            "Create a detailed image generation prompt for: \n\nSubject: \nStyle: \nLighting: \nComposition: \nMood: ",
          ),
      },
      {
        id: "travel-planner",
        name: "Travel Planner",
        description:
          "Plan trips with itineraries, recommendations, and logistics",
        icon: MapIcon,
        color: "text-emerald-400",
        action: () =>
          setInput(
            "Plan a detailed travel itinerary including: 1) Daily schedule 2) Accommodations 3) Transportation 4) Activities 5) Budget estimates 6) Local tips\n\nDestination: \nDuration: \nBudget: \nInterests: ",
          ),
      },
      {
        id: "game-designer",
        name: "Game Designer",
        description:
          "Design games, mechanics, narratives, and interactive experiences",
        icon: Gamepad2,
        color: "text-violet-400",
        action: () =>
          setInput(
            "Design a game concept including: 1) Core mechanics 2) Player objectives 3) Progression system 4) Art style 5) Target audience\n\nGame type: \nPlatform: \nTheme: ",
          ),
      },
      {
        id: "business-strategist",
        name: "Business Strategist",
        description:
          "Business analysis, strategy development, and market insights",
        icon: Sparkles,
        color: "text-amber-400",
        action: () =>
          setInput(
            "Provide strategic business analysis including: 1) Market analysis 2) Competitive landscape 3) SWOT analysis 4) Growth opportunities 5) Action plan\n\nBusiness/Industry: ",
          ),
      },
      {
        id: "api-designer",
        name: "API Designer",
        description:
          "Design RESTful APIs, GraphQL schemas, and API documentation",
        icon: Globe,
        color: "text-teal-400",
        action: () =>
          setInput(
            "Design a comprehensive API including: 1) Endpoint structure 2) Request/response schemas 3) Authentication methods 4) Error handling 5) Rate limiting 6) Documentation\n\nAPI Purpose: \nData Models: \nAuthentication Type: ",
          ),
      },
      {
        id: "security-auditor",
        name: "Security Auditor",
        description:
          "Security analysis, vulnerability assessment, and best practices",
        icon: Settings,
        color: "text-red-500",
        action: () =>
          setInput(
            "Perform security analysis including: 1) Vulnerability assessment 2) Security best practices 3) Compliance requirements 4) Risk mitigation strategies 5) Security implementation guide\n\nSystem/Application: \nSecurity Level Required: \nCompliance Standards: ",
          ),
      },
      {
        id: "performance-optimizer",
        name: "Performance Optimizer",
        description:
          "Code optimization, performance analysis, and bottleneck identification",
        icon: Zap,
        color: "text-yellow-500",
        action: () =>
          setInput(
            "Analyze and optimize performance including: 1) Code profiling 2) Bottleneck identification 3) Optimization strategies 4) Caching solutions 5) Monitoring recommendations\n\nCode/System: \nPerformance Goals: \nCurrent Issues: ",
          ),
      },
      {
        id: "devops-engineer",
        name: "DevOps Engineer",
        description:
          "CI/CD pipelines, infrastructure as code, and deployment strategies",
        icon: Settings,
        color: "text-blue-500",
        action: () =>
          setInput(
            "Design DevOps solution including: 1) CI/CD pipeline 2) Infrastructure as Code 3) Deployment strategies 4) Monitoring & logging 5) Scaling solutions\n\nTech Stack: \nCloud Provider: \nDeployment Requirements: ",
          ),
      },
      {
        id: "ux-designer",
        name: "UX Designer",
        description:
          "User experience design, wireframes, and usability analysis",
        icon: Palette,
        color: "text-purple-500",
        action: () =>
          setInput(
            "Create UX design including: 1) User journey mapping 2) Wireframes & mockups 3) Usability principles 4) Accessibility guidelines 5) Design system recommendations\n\nTarget Users: \nPlatform: \nKey Features: ",
          ),
      },
      {
        id: "database-architect",
        name: "Database Architect",
        description:
          "Design database schemas, optimize queries, and data modeling",
        icon: Database,
        color: "text-green-500",
        action: () =>
          setInput(
            "Design database architecture including: 1) Entity relationship diagram 2) Table schemas with constraints 3) Indexing strategy 4) Query optimization 5) Migration scripts\n\nData Requirements: \nExpected Scale: \nDatabase Type: ",
          ),
      },
      {
        id: "test-engineer",
        name: "Test Engineer",
        description:
          "Create comprehensive test suites, automation, and QA strategies",
        icon: CheckCircle,
        color: "text-emerald-500",
        action: () =>
          setInput(
            "Create testing strategy including: 1) Unit test cases 2) Integration tests 3) E2E test scenarios 4) Test automation setup 5) Performance testing\n\nApplication Type: \nTesting Framework: \nCoverage Goals: ",
          ),
      },
      {
        id: "ai-trainer",
        name: "AI/ML Engineer",
        description:
          "Machine learning models, data pipelines, and AI solutions",
        icon: Brain,
        color: "text-cyan-500",
        action: () =>
          setInput(
            "Design AI/ML solution including: 1) Data preprocessing pipeline 2) Model architecture 3) Training strategy 4) Evaluation metrics 5) Deployment plan\n\nProblem Type: \nData Available: \nPerformance Requirements: ",
          ),
      },
      {
        id: "code-generator",
        name: "Code Generator",
        description: "Generate complete applications with multiple files",
        icon: FileCode,
        color: "text-blue-400",
        action: () =>
          setInput(
            "Generate a complete application with the following structure:\n\n```\nProject Structure:\n- Frontend (React/Vue/Angular)\n- Backend (Node.js/Python/Go)\n- Database schema\n- API endpoints\n- Configuration files\n- Documentation\n```\n\nApplication Type: \nTech Stack: \nFeatures Required: ",
          ),
      },
      {
        id: "file-analyzer",
        name: "File Analyzer",
        description: "Analyze and optimize existing code files",
        icon: Search,
        color: "text-orange-500",
        action: () =>
          setInput(
            "Analyze the provided code and generate:\n\n1. **Code Quality Report**\n   - Performance bottlenecks\n   - Security vulnerabilities\n   - Best practice violations\n\n2. **Optimization Suggestions**\n   - Refactoring opportunities\n   - Performance improvements\n   - Memory optimization\n\n3. **Enhanced Version**\n   - Optimized code with comments\n   - Unit tests\n   - Documentation\n\nPaste your code below:\n```\n\n```",
          ),
      },
      {
        id: "project-scaffolder",
        name: "Project Scaffolder",
        description: "Create complete project templates with best practices",
        icon: FolderPlus,
        color: "text-green-400",
        action: () =>
          setInput(
            "Create a complete project scaffold including:\n\n📁 **Project Structure**\n- Organized folder hierarchy\n- Configuration files\n- Environment setup\n\n🔧 **Development Tools**\n- Build scripts\n- Linting configuration\n- Testing setup\n\n📚 **Documentation**\n- README with setup instructions\n- API documentation\n- Contributing guidelines\n\nProject Type: \nFramework: \nDeployment Target: ",
          ),
      },
      {
        id: "regex-builder",
        name: "Regex Builder",
        description: "Build and test complex regular expressions",
        icon: Hash,
        color: "text-yellow-500",
        action: () =>
          setInput(
            "Create a regex pattern for:\n\n**Pattern Requirements:**\n- What you want to match\n- What you want to exclude\n- Specific format requirements\n\n**Output will include:**\n- Regex pattern with explanation\n- Test cases with examples\n- Code snippets for different languages\n- Alternative approaches\n\nDescribe what you want to match: ",
          ),
      },
      {
        id: "data-transformer",
        name: "Data Transformer",
        description: "Convert data between formats (JSON, CSV, XML, etc.)",
        icon: RefreshCw,
        color: "text-purple-400",
        action: () =>
          setInput(
            "Transform data between formats:\n\n**Supported Formats:**\n- JSON ↔ CSV ↔ XML ↔ YAML\n- Database schemas\n- API responses\n- Configuration files\n\n**Features:**\n- Format validation\n- Structure optimization\n- Data cleaning\n- Schema generation\n\nSource Format: \nTarget Format: \nPaste your data:\n```\n\n```",
          ),
      },
      {
        id: "docker-composer",
        name: "Docker Composer",
        description: "Generate Docker configurations and compose files",
        icon: Package,
        color: "text-blue-600",
        action: () =>
          setInput(
            "Generate Docker configuration:\n\n🐳 **Docker Setup**\n- Multi-stage Dockerfile\n- Docker Compose with services\n- Environment configuration\n- Volume and network setup\n\n📦 **Services to Include**\n- Application containers\n- Database services\n- Caching layers\n- Reverse proxy\n\n🔧 **Production Ready**\n- Health checks\n- Resource limits\n- Security best practices\n- Logging configuration\n\nApplication Stack: \nServices Needed: \nEnvironment: ",
          ),
      },
      {
        id: "git-workflow",
        name: "Git Workflow",
        description: "Generate Git hooks, workflows, and automation scripts",
        icon: GitBranch,
        color: "text-orange-600",
        action: () =>
          setInput(
            "Create Git workflow automation:\n\n🌿 **Branch Strategy**\n- Branching model (GitFlow/GitHub Flow)\n- Branch protection rules\n- Merge strategies\n\n🔄 **CI/CD Pipeline**\n- GitHub Actions / GitLab CI\n- Automated testing\n- Deployment workflows\n\n🪝 **Git Hooks**\n- Pre-commit hooks\n- Commit message validation\n- Code quality checks\n\n📋 **Templates**\n- PR/MR templates\n- Issue templates\n- Contributing guidelines\n\nRepository Type: \nCI/CD Platform: \nTeam Size: ",
          ),
      },
      {
        id: "env-manager",
        name: "Environment Manager",
        description:
          "Generate environment configurations and secrets management",
        icon: Key,
        color: "text-indigo-500",
        action: () =>
          setInput(
            "Setup environment management:\n\n🔐 **Environment Variables**\n- Development, staging, production configs\n- Secret management strategy\n- Environment validation\n\n🛡️ **Security**\n- API key rotation\n- Encrypted secrets\n- Access control\n\n📁 **Configuration Files**\n- .env templates\n- Docker environment files\n- Kubernetes secrets\n- Cloud provider configs\n\n🔄 **Deployment**\n- Environment promotion\n- Configuration drift detection\n- Rollback strategies\n\nDeployment Platform: \nSecrets to Manage: \nEnvironments Needed: ",
          ),
      },
      {
        id: "huggingface-spaces",
        name: "HF Spaces ImageGen",
        description: "Embed Hugging Face Spaces image generation models",
        icon: ImageIcon,
        color: "text-yellow-400",
        action: () =>
          setInput(
            "Generate images using Hugging Face Spaces:\n\n🎨 **Available Models:**\n- DALL-E Mini/Mega\n- Stable Diffusion variants\n- Midjourney-style models\n- Artistic style transfer\n- Face generation models\n\n⚡ **Zero GPU Hosting:**\n- Free GPU access\n- Instant model loading\n- No setup required\n- Community models\n\n🖼️ **Image Generation:**\n- Text-to-image\n- Image-to-image\n- Style transfer\n- Upscaling\n- Inpainting\n\n**Prompt:** Describe the image you want to generate\n**Style:** (realistic, artistic, cartoon, etc.)\n**Dimensions:** (512x512, 1024x1024, etc.)\n\nDescribe your image: ",
          ),
      },
      {
        id: "github-explorer",
        name: "GitHub Explorer",
        description: "Browse trending repos with retro game-like interface",
        icon: GitBranch,
        color: "text-green-400",
        action: () =>
          setInput(
            "🕹️ **GITHUB ARCADE** 🕹️\n\n```\n┌─────────────────────────────────────┐\n│  🎮 SELECT TRENDING REPOSITORY 🎮   │\n├─────────────────────────────────────┤\n│ [A] 🔥 React 19 - Latest Features  │\n│ [B] ⚡ Vite 5.0 - Lightning Fast   │\n│ [C] 🤖 LangChain - AI Chains       │\n│ [D] 🎨 Tailwind CSS - Utility CSS  │\n│ [E] 📦 Next.js 14 - Full Stack     │\n│ [F] 🔧 TypeScript - Type Safety    │\n│ [G] 🚀 Astro - Static Site Gen     │\n│ [H] 💾 Prisma - Database ORM       │\n└─────────────────────────────────────┘\n```\n\n🎯 **MISSION:** Select a repository to:\n- 📋 Auto-fetch README.md\n- 📦 Parse package.json\n- 🔍 Extract main scripts\n- 📝 Generate project analysis\n- 🛠️ Suggest improvements\n\n**Enter your choice (A-H) or specify a custom repo:**\nRepository: ",
          ),
      },
      {
        id: "cloud-storage",
        name: "Cloud Storage 5GB",
        description: "Setup cloud storage with 5GB free tier",
        icon: Cloud,
        color: "text-blue-400",
        action: () =>
          setInput(
            "☁️ **CLOUD STORAGE SETUP** (5GB Free)\n\n🗄️ **Storage Providers:**\n- Google Cloud Storage\n- AWS S3\n- Azure Blob Storage\n- DigitalOcean Spaces\n- Cloudflare R2\n\n📦 **Implementation Features:**\n- File upload/download API\n- Automatic backup system\n- CDN integration\n- Image optimization\n- Version control\n- Access permissions\n\n🔧 **Self-Hosting Option:**\n- MinIO server setup\n- Docker containerization\n- SSL/TLS encryption\n- Backup strategies\n\n**ENABLE_CLOUD_STORAGE = true** (set to false to disable)\n\nPreferred Provider: \nUse Case: \nSecurity Requirements: ",
          ),
      },
      {
        id: "vps-deployment",
        name: "VPS Deployment",
        description: "Deploy applications to VPS with automated setup",
        icon: Server,
        color: "text-purple-400",
        action: () =>
          setInput(
            "🖥️ **VPS DEPLOYMENT SYSTEM**\n\n🚀 **VPS Providers:**\n- DigitalOcean Droplets\n- Linode\n- Vultr\n- Hetzner Cloud\n- Google Compute Engine\n\n⚙️ **Automated Setup:**\n- Server provisioning\n- Docker installation\n- Nginx reverse proxy\n- SSL certificate (Let's Encrypt)\n- Firewall configuration\n- Monitoring setup\n\n🔄 **CI/CD Pipeline:**\n- GitHub Actions integration\n- Automated deployments\n- Health checks\n- Rollback capabilities\n- Log aggregation\n\n**ENABLE_VPS_DEPLOYMENT = true** (set to false to disable)\n\nApplication Type: \nTraffic Expected: \nBudget Range: ",
          ),
      },
    ];

    // Randomize order using the same approach as template suggestions
    return [...modules].sort(() => secureRandom() - 0.5);
  }, [setInput]);

  // Sample images for the images tab
  const sampleImages = [
    {
      id: 1,
      url: "/placeholder.svg?height=200&width=300",
      title: "Neural Network Latent Visualization",
    },
    {
      id: 2,
      url: "/placeholder.svg?height=200&width=300",
      title: "Data Flow Diagram",
    },
    {
      id: 3,
      url: "/placeholder.svg?height=200&width=300",
      title: "AI Agent Architecture",
    },
    {
      id: 4,
      url: "/placeholder.svg?height=200&width=300",
      title: "Interface Concept",
    },
  ];

  // Calculate bottom position based on panel state
  const bottomPosition = "env(safe-area-inset-bottom, 0px)";

  return (
    <>
      <div
        className={`fixed bg-black/60 backdrop-blur-md border border-white/10 transition-all duration-200 z-50 left-0 right-0 border-t`}
        style={{
          bottom: bottomPosition,
          height: isMinimized
            ? "60px"
            : isExpanded
              ? `min(${panelHeight * 1.5}px, calc(100dvh - env(safe-area-inset-top, 0px) - 60px))`
              : `min(${panelHeight}px, calc(100dvh - env(safe-area-inset-top, 0px) - 60px))`,
          maxHeight: "calc(100dvh - env(safe-area-inset-top, 0px) - 60px)",
        }}
        onClick={(e) => {
          if (
            window.innerWidth <= 768 &&
            textareaRef.current &&
            e.target instanceof HTMLElement &&
            !["TEXTAREA", "INPUT", "BUTTON", "SELECT"].includes(e.target.tagName)
          ) {
            textareaRef.current.focus();
          }
        }}
      >
        {/* Drag Handle - Full width resize bar */}
        <div
          ref={dragHandleRef}
          className={`w-full absolute top-0 left-0 right-0 h-[4px] transition-all duration-200 ${
            isDragging ? 'bg-white/40 cursor-ns-resize' : 'bg-transparent cursor-default'
          }`}
          style={{ zIndex: 50 }}
          onMouseDown={(e) => {
            setIsDragging(true);
            const startY = e.clientY;
            const startHeight = panelHeight;

            const handleMouseMove = (e: MouseEvent) => {
              const delta = startY - e.clientY;
              setPanelHeight(Math.max(240, Math.min(600, startHeight + delta)));
            };

            const handleMouseUp = () => {
              setIsDragging(false);
              document.removeEventListener("mousemove", handleMouseMove);
              document.removeEventListener("mouseup", handleMouseUp);
            };

            document.addEventListener("mousemove", handleMouseMove);
            document.addEventListener("mouseup", handleMouseUp);
          }}
          onMouseEnter={(e) => {
            if (!isDragging) {
              e.currentTarget.classList.add('bg-white/20');
            }
          }}
          onMouseLeave={(e) => {
            if (!isDragging) {
              e.currentTarget.classList.remove('bg-white/20');
            }
          }}
        />

        <div className="p-2 sm:p-3 h-full overflow-hidden flex flex-col relative" style={{ cursor: 'default' }}>
          {/* Expand/Minimize Button - Far Top Right Corner */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsExpanded(!isExpanded)}
            className="absolute top-1 right-1 w-6 h-6 p-0 text-gray-400 hover:text-white hover:bg-white/10 z-[60]"
            title={isExpanded ? "Collapse height" : "Expand height"}
            disabled={isMinimized}
          >
            {isExpanded ? (
              <Minimize2 className="w-3 h-3" />
            ) : (
              <Maximize2 className="w-3 h-3" />
            )}
          </Button>

          {/* Header - Compact layout */}
          <div className="flex justify-between items-center mb-1 mt-5 px-1">
            <div className="flex items-center gap-2">
              <div className="">
                <Sparkles className="h-3 w-3 text-white" />
              </div>
              <span className="text-sm font-medium text-white/80">
                compute
              </span>
            </div>
            <div className="flex items-center gap-2">
              <GripHorizontal className="w-4 h-4 text-gray-500" />
            </div>
          </div>

          {!isMinimized && (
            <Tabs value={activeTab} onValueChange={(value) => onActiveTabChange?.(value as "chat" | "code" | "extras" | "integrations" | "shell")} className="flex-1 flex flex-col min-h-0">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-4 gap-2">
                <div className="flex items-center gap-2 sm:gap-4 flex-wrap">
                  <TabsList className="bg-black/40">
                    <TabsTrigger value="chat" className="text-xs sm:text-sm">
                      <MessageSquare className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
                      <span className="hidden sm:inline">Chat</span>
                    </TabsTrigger>
                    <TabsTrigger value="code" className="text-xs sm:text-sm">
                      <Code className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
                      <span className="hidden sm:inline">Code</span>
                    </TabsTrigger>
                    <TabsTrigger value="extras" className="text-xs sm:text-sm">
                      <ImageIcon className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
                      <span className="hidden sm:inline">Extra</span>
                    </TabsTrigger>
                    <TabsTrigger value="integrations" className="text-xs sm:text-sm">
                      <Zap className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
                      <span className="hidden sm:inline">Plugins</span>
                    </TabsTrigger>
                    <TabsTrigger value="shell" className="text-xs sm:text-sm">
                      <Terminal className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
                      <span className="hidden sm:inline">Shell</span>
                    </TabsTrigger>
                  </TabsList>
                </div>

                <div className="flex space-x-1 sm:space-x-2 flex-shrink-0">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={onNewChat}
                    title="New Chat"
                    className="h-8 w-8 sm:h-10 sm:w-10 p-0 bg-black/40 border-white/20 hover:bg-white/10"
                  >
                    <Plus className="h-3 w-3 sm:h-4 sm:w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={toggleHistory}
                    title="Chat History"
                    className="h-8 w-8 sm:h-10 sm:w-10 p-0 bg-black/40 border-white/20 hover:bg-white/10"
                  >
                    <History className="h-3 w-3 sm:h-4 sm:w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={toggleAccessibility}
                    title="Accessibility Options"
                    className="h-8 w-8 sm:h-10 sm:w-10 p-0 bg-black/40 border-white/20 hover:bg-white/10"
                  >
                    <Accessibility className="h-3 w-3 sm:h-4 sm:w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={toggleCodePreview}
                    title="Code Preview"
                    className={`h-8 w-8 sm:h-10 sm:w-10 p-0 bg-black/40 border-white/20 hover:bg-white/10 ${
                      hasCodeBlocks
                        ? "ring-2 ring-white/30 shadow-lg shadow-white/20 animate-pulse"
                        : ""
                    }`}
                  >
                    <Code
                      className={`h-3 w-3 sm:h-4 sm:w-4 ${
                        hasCodeBlocks ? "text-white" : ""
                      }`}
                    />
                  </Button>
                </div>
              </div>

              {/* Provider/Model Selection - Restored */}
              <div className="flex items-center gap-2 mb-3 text-xs text-white/60">
                <Select
                  value={`${currentProvider}:${currentModel}`}
                  onValueChange={(value) => {
                    const [provider, ...modelParts] = value.split(":");
                    const model = modelParts.join(":");
                    onProviderChange(provider, model);
                  }}
                >
                  <SelectTrigger className="w-[280px] bg-black/40 border-white/20">
                    <SelectValue placeholder="Select a model" />
                  </SelectTrigger>
                  <SelectContent>
                    {/* Only show available providers (with API keys configured) */}
                    {availableProviders
                      .filter(p => p.isAvailable !== false)
                      .map((provider) => (
                        <SelectGroup key={provider.id}>
                          <SelectLabel>{provider.name}</SelectLabel>
                          {provider.models.map((model) => (
                            <SelectItem key={model} value={`${provider.id}:${model}`}>
                              {model}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      ))}
                    {/* Show message if no providers configured */}
                    {availableProviders.filter(p => p.isAvailable !== false).length === 0 && (
                      <SelectItem value="none" disabled>
                        No providers configured - add API keys to .env
                      </SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </div>

              {/* Tab Content Sections */}
              <TabsContent value="chat" className="m-0 flex-1 flex flex-col min-h-0">
                {/* Suggestions - Compact row */}
                <div className="flex flex-wrap gap-2 mb-2 shrink-0">
                  {chatSuggestions.map((suggestion, index) => (
                    <Button
                      key={index}
                      variant="secondary"
                      size="sm"
                      className="text-xs bg-black/20 hover:bg-black/40 transition-all duration-200 shrink-0"
                      onClick={() => {
                        setInput(suggestion);
                        textareaRef.current?.focus();
                      }}
                      disabled={isProcessing}
                    >
                      {suggestion}
                    </Button>
                  ))}
                </div>

                {/* Input Form - Always visible at bottom */}
                <form onSubmit={(e) => { e.preventDefault(); onSubmit(input); setInput(''); }} className="flex flex-col gap-2 flex-1 min-h-0">
                  <div className="relative flex-1 min-h-[60px]">
                    <Textarea
                      ref={textareaRef}
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      placeholder="Type your message..."
                      className="min-h-[60px] max-h-[120px] bg-white/5 border border-white/20 pr-12 resize-none text-base sm:text-sm focus:border-white/40 focus:ring-1 focus:ring-white/20 rounded-2xl"
                      rows={2}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          onSubmit(input);
                          setInput('');
                        }
                      }}
                      onFocus={() => {
                        // Scroll to input on mobile when focused
                        if (window.innerWidth <= 768 && textareaRef.current) {
                          setTimeout(() => {
                            textareaRef.current?.scrollIntoView({
                              behavior: "smooth",
                              block: "center",
                            });
                          }, 300);
                        }
                      }}
                      disabled={isProcessing}
                    />
                    <div className="absolute right-3 top-3 flex gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          setShowFileSelector(!showFileSelector);
                        }}
                        className="p-1.5 rounded-md bg-white/5 hover:bg-white/15 border border-white/10 transition-colors"
                        title="Attach Files"
                        disabled={isProcessing}
                      >
                        <FolderPlus className="w-4 h-4 text-blue-400" />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          onActiveTabChange?.("chat");
                          setPluginToOpen("cloud-storage");
                        }}
                        className="p-1.5 rounded-md bg-white/5 hover:bg-white/15 border border-white/10 transition-colors"
                        title="Open Cloud Storage Plugin"
                        disabled={isProcessing}
                      >
                        <Cloud className="w-4 h-4 text-blue-400" />
                      </button>
                    </div>

                    {showFileSelector && (
                      <div className="absolute right-0 top-10 w-64 bg-black/90 border border-white/20 rounded-lg shadow-lg z-10 p-2">
                        <h4 className="text-sm font-medium text-white/80">
                          Attach Files
                        </h4>
                        <div className="max-h-32 overflow-y-auto">
                          <div className="mb-3">
                            <h5 className="text-xs font-medium mb-1">
                              Project Files
                            </h5>
                            {[
                              "src/components/App.tsx",
                              "src/utils/helpers.ts",
                              "package.json",
                              "README.md",
                              "src/styles/globals.css",
                            ].map((file) => (
                              <div
                                key={file}
                                className="flex items-center gap-2 text-xs p-1 hover:bg-white/10 rounded"
                              >
                                <input
                                  type="checkbox"
                                  checked={selectedFiles.includes(file)}
                                  onChange={(e) => {
                                    if (e.target.checked) {
                                      setSelectedFiles([
                                        ...selectedFiles,
                                        file,
                                      ]);
                                    } else {
                                      setSelectedFiles(
                                        selectedFiles.filter((f) => f !== file),
                                      );
                                    }
                                  }}
                                />
                                <span className="truncate">{file}</span>
                              </div>
                            ))}
                          </div>

                          <div>
                            <h5 className="text-xs font-medium mb-1">
                              Cloud Storage
                            </h5>
                            <button
                              onClick={() => {
                                onActiveTabChange?.("chat");
                                setPluginToOpen("cloud-storage");
                              }}
                              className="text-xs w-full text-left p-2 bg-blue-500/20 hover:bg-blue-500/30 rounded"
                            >
                              <div className="flex items-center gap-2">
                                <Cloud className="w-4 h-4" />
                                <span>Select from Cloud Storage</span>
                              </div>
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                  {isProcessing && onStopGeneration ? (
                    <Button
                      type="button"
                      variant="destructive"
                      className="self-end min-w-[80px] bg-red-600/80 hover:bg-red-600 border border-red-500/50 rounded-2xl z-20"
                      onClick={onStopGeneration}
                    >
                      <Square className="h-4 w-4 mr-2" />
                      Stop
                    </Button>
                  ) : (
                    <Button
                      type="submit"
                      className="self-end min-w-[80px] bg-white/10 hover:bg-white/20 border border-white/20 rounded-2xl z-20"
                      disabled={isProcessing || !input.trim()}
                    >
                      {isProcessing ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <>
                          <Send className="h-4 w-4 mr-2" />
                          Send
                        </>
                      )}
                    </Button>
                  )}
                </form>
              </TabsContent>

              {/* Code Tab Content */}
              <TabsContent value="code" className="m-0 flex-1 flex flex-col min-h-0">
                {/* Code Templates - Compact row */}
                <div className="flex flex-wrap gap-2 mb-2 shrink-0">
                  {codeTemplates.map((template, index) => (
                    <Button
                      key={index}
                      variant="outline"
                      size="sm"
                      className="text-xs bg-black/20 hover:bg-black/40 border-white/20 text-left justify-start h-auto p-2 shrink-0"
                      onClick={() => setInput(template.template)}
                      disabled={isProcessing}
                    >
                      <div>
                        <div className="font-medium">{template.title}</div>
                      </div>
                    </Button>
                  ))}
                </div>

                <form onSubmit={(e) => { e.preventDefault(); onSubmit(input); setInput(''); }} className="flex flex-col gap-2 flex-1 min-h-0">
                  <div className="relative flex-1">
                    <Textarea
                      ref={codeTextareaRef}
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      placeholder="Describe your coding task in detail. Be specific about:\n• Framework/language preferences\n• Required features and functionality\n• Performance or security requirements\n• Testing and documentation needs"
                      className="min-h-[120px] max-h-[300px] bg-white/5 border border-white/20 pr-12 resize-none text-base sm:text-sm focus:border-white/40 focus:ring-1 focus:ring-white/20 rounded-2xl"
                      rows={6}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                        e.preventDefault();
                        onSubmit(input);
                        setInput('');
                      }
                    }}
                    onFocus={() => {
                      // Scroll to input on mobile when focused
                      if (
                        window.innerWidth <= 768 &&
                        codeTextareaRef.current
                      ) {
                        setTimeout(() => {
                          codeTextareaRef.current?.scrollIntoView({
                            behavior: "smooth",
                            block: "center",
                          });
                        }, 300); // Delay to allow keyboard to appear
                      }
                    }}
                    disabled={isProcessing}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const enhancePrompt = `Please enhance and improve this coding request to be more detailed and specific:\n\n"${input}"\n\nProvide an enhanced version that includes:
- Specific framework/language requirements
- Detailed feature specifications
- Performance and security considerations
- Code structure and architecture preferences
- Testing and documentation requirements`;
                      setInput(enhancePrompt);
                    }}
                    className="absolute right-3 top-3 p-1 rounded hover:bg-white/10 transition-colors"
                    title="Enhance this coding request"
                    disabled={!input.trim() || isProcessing}
                  >
                    <Code
                      className={`h-4 w-4 ${
                        input.trim() && !isProcessing
                          ? "text-blue-400 hover:text-blue-300"
                          : "text-gray-500"
                      }`}
                    />
                  </button>
                </div>

                {/* Send Button for Code Tab */}
                <div className="flex justify-end mt-2">
                  {isProcessing && onStopGeneration ? (
                    <Button
                      type="button"
                      variant="destructive"
                      className="self-end min-w-[80px] bg-red-600/80 hover:bg-red-600 border border-red-500/50 rounded-2xl z-20"
                      onClick={onStopGeneration}
                    >
                      <Square className="h-4 w-4 mr-2" />
                      Stop
                    </Button>
                  ) : (
                    <Button
                      type="submit"
                      className="self-end min-w-[80px] bg-white/10 hover:bg-white/20 border border-white/20 rounded-2xl z-20"
                      disabled={isProcessing || !input.trim()}
                    >
                      {isProcessing ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <>
                          <Send className="h-4 w-4 mr-2" />
                          Send
                        </>
                      )}
                    </Button>
                  )}
                </div>
                </form>
              </TabsContent>

              {/* Extras Tab Content */}
              <TabsContent value="extras" className="m-0 flex-1 overflow-auto">
                <Card className="bg-black/40 border-white/10">
                  <CardContent className="pt-6">
                    <div className="space-y-4">
                      {/* Quick Prompt Templates Section */}
                      <div className="text-center mb-4">
                        <h3 className="font-medium text-white mb-2">
                          Quick Prompt Templates
                        </h3>
                        <p className="text-xs text-white/60">
                          Click to insert a specialized prompt into the chat
                        </p>
                      </div>

                      <div className="grid grid-cols-2 gap-3 max-h-60 overflow-y-auto mb-6">
                        {pluginModules.map((plugin) => {
                          const IconComponent = plugin.icon;
                          return (
                            <button
                              key={plugin.id}
                              onClick={() => {
                                plugin.action(setInput, onActiveTabChange, setPluginToOpen);
                                toast.success(
                                  `${plugin.name} prompt loaded! Check the chat input.`,
                                );
                              }}
                              className="flex flex-col items-center gap-2 p-3 bg-black/30 hover:bg-black/50 border border-white/10 hover:border-white/20 rounded-lg transition-all duration-200 text-left group"
                            >
                              <div className="flex items-center gap-2 w-full">
                                <IconComponent
                                  className={`h-4 w-4 ${plugin.color} group-hover:scale-110 transition-transform`}
                                />
                                <span className="font-medium text-sm text-white truncate">
                                  {plugin.name}
                                </span>
                              </div>
                              <p className="text-xs text-white/60 line-clamp-2 w-full">
                                {plugin.description}
                              </p>
                            </button>
                          );
                        })}
                      </div>

                      {/* Pop-out Plugin Windows Section */}
                      <div className="text-center mb-4 pt-4 border-t border-white/10">
                        <h3 className="font-medium text-white mb-2">
                          Plugin Windows
                        </h3>
                        <p className="text-xs text-white/60">
                          Click to open a plugin in a pop-out window
                        </p>
                      </div>

                      <div className="grid grid-cols-2 gap-3 max-h-80 overflow-y-auto">
                        {availablePlugins.map((plugin) => {
                          const IconComponent = plugin.icon;
                          return (
                            <button
                              key={plugin.id}
                              onClick={() => {
                                setPluginToOpen(plugin.id);
                                toast.success(
                                  `${plugin.name} window opened!`,
                                );
                              }}
                              className="flex flex-col items-center gap-2 p-3 bg-black/30 hover:bg-black/50 border border-white/10 hover:border-white/20 rounded-lg transition-all duration-200 text-left group"
                            >
                              <div className="flex items-center gap-2 w-full">
                                <IconComponent
                                  className={`h-4 w-4 ${plugin.category === 'ai' ? 'text-purple-400' : plugin.category === 'code' ? 'text-blue-400' : plugin.category === 'utility' ? 'text-green-400' : plugin.category === 'design' ? 'text-pink-400' : plugin.category === 'data' ? 'text-indigo-400' : plugin.category === 'media' ? 'text-yellow-400' : 'text-gray-400'} group-hover:scale-110 transition-transform`}
                                />
                                <span className="font-medium text-sm text-white truncate">
                                  {plugin.name}
                                </span>
                              </div>
                              <p className="text-xs text-white/60 line-clamp-2 w-full">
                                {plugin.description}
                              </p>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              {/* Integrations Tab Content */}
              <TabsContent value="integrations" className="m-0 flex-1 overflow-auto">
                <Card className="bg-black/40 border-white/10">
                  <CardContent className="pt-6">
                    <div className="space-y-3">
                      <div className="flex items-center gap-2 mb-2">
                        <Zap className="h-4 w-4 text-yellow-400" />
                        <span className="text-sm font-medium">
                          Modular Tools
                        </span>
                      </div>
                      <div className="mb-3">
                        <p className="text-xs text-white/60 mb-2">
                          Pop-out plugin windows for advanced functionality:
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              {/* Shell Tab Content */}
              <TabsContent value="shell" className="m-0 flex-1 overflow-auto">
                <Card className="bg-white/5 border-white/10 h-full">
                  <CardContent className="pt-4 h-full flex flex-col">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-2">
                        <Terminal className="h-4 w-4 text-green-400" />
                        <span className="text-sm font-medium">Sandbox Terminal</span>
                      </div>
                    </div>
                    <div className="flex-1 flex items-center justify-center bg-black/40 rounded-lg p-8 font-mono text-sm text-white/60">
                      <div className="text-center">
                        <Terminal className="w-12 h-12 mx-auto mb-4 opacity-50" />
                        <p>Terminal is open below</p>
                        <p className="text-white/40 text-xs mt-2">Type commands to execute in an isolated environment</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
            {/* PluginManager for pop-out windows - single instance outside Tabs */}
            <PluginManager
              availablePlugins={availablePlugins}
              onPluginResult={handlePluginResult}
              openPluginId={pluginToOpen}
              onOpenComplete={() => setPluginToOpen(null)}
            />
          )}
        </div>
      </div>
    </>
  );
}
