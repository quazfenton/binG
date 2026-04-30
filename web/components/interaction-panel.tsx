"use client";
//fix
import React from "react";
import { useState, useRef, useCallback, useEffect, useMemo } from "react";

// Tabs that need taller height when opened
const TALL_TABS = ['images', 'extras', 'shell'];
const DEFAULT_TAB_HEIGHT = 'min-h-[200px]';
const TALL_TAB_HEIGHT = 'min-h-[400px]';
const EXPAND_TRANSITION = 'transition-all duration-300 ease-out';
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
import { toast } from "sonner";
import { FileMentionMenu } from "./file-mention-menu";
import { useFileMentionAutocomplete } from "@/hooks/use-file-mention-autocomplete";
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
import Upload from "lucide-react/dist/esm/icons/upload";
import FolderSync from "lucide-react/dist/esm/icons/folder-sync";
import Palette from "lucide-react/dist/esm/icons/palette";
import Music from "lucide-react/dist/esm/icons/music";
import Zap from "lucide-react/dist/esm/icons/zap";
import Film from "lucide-react/dist/esm/icons/film";
import Camera from "lucide-react/dist/esm/icons/camera";
import MapIcon from "lucide-react/dist/esm/icons/map";
import BarChart2 from "lucide-react/dist/esm/icons/bar-chart-2";
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
import Link from "lucide-react/dist/esm/icons/link";
import Mic from "lucide-react/dist/esm/icons/mic";
import MicOff from "lucide-react/dist/esm/icons/mic-off";
import X from "lucide-react/dist/esm/icons/x";
import ArrowUp from "lucide-react/dist/esm/icons/arrow-up";
import ChevronRight from "lucide-react/dist/esm/icons/chevron-right";
import BookOpen from "lucide-react/dist/esm/icons/book-open";
import Archive from "lucide-react/dist/esm/icons/archive";
import Monitor from "lucide-react/dist/esm/icons/monitor";
import VNCConnectionTab from "./vnc-connection-tab";
import type { LLMProviderConfig } from "../lib/chat/llm-providers-types";
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
import GitHubTrendingExplorerPlugin from "./plugins/github-trending-explorer-plugin";
import WorldMonitorEmbedPlugin from "./plugins/world-monitor-embed-plugin";
import WikipediaEmbedPlugin from "./plugins/wikipedia-embed-plugin";
import ArchiveOrgEmbedPlugin from "./plugins/archive-org-embed-plugin";
import OpenStreetMapEmbedPlugin from "./plugins/openstreetmap-embed-plugin";
import DuckDuckGoEmbedPlugin from "./plugins/duckduckgo-embed-plugin";
import CodeSandboxEmbedPlugin from "./plugins/codesandbox-embed-plugin";
import StackBlitzEmbedPlugin from "./plugins/stackblitz-embed-plugin";
import GenericEmbedPlugin from "./plugins/generic-embed-plugin";
import GlitchEmbedPlugin from "./plugins/glitch-embed-plugin";
import ObservableEmbedPlugin from "./plugins/observable-embed-plugin";
import HuggingFaceSpacesPlugin from "./plugins/huggingface-spaces-plugin";
import InteractiveStoryboardPlugin from "./plugins/interactive-storyboard-plugin";
import CloudStoragePlugin from "./plugins/cloud-storage-plugin";
import PStreamEmbedPlugin from "./plugins/pstream-embed-plugin";
import E2BDesktopPlugin from "./plugins/e2b-desktop-plugin";
import VercelMediaEmbedPlugin from "./plugins/vercel-media-embed-plugin";
import IntegrationPanel from "./integrations/IntegrationPanel";
import { useVirtualFilesystem, type AttachedVirtualFile } from "../hooks/use-virtual-filesystem";
import { usePanel } from "../contexts/panel-context";
import { pluginMigrationService, PluginCategorizer } from "../lib/plugins/plugin-migration";
import { secureRandom } from "../lib/utils";
import Layout from "lucide-react/dist/esm/icons/layout";
import DevOpsCommandCenterPlugin from "./plugins/devops-command-center-plugin";
import AIPromptLibraryPlugin from "./plugins/ai-prompt-library-plugin";
import APIPlaygroundProPlugin from "./plugins/api-playground-pro-plugin";
import CloudStorageProPlugin from "./plugins/cloud-storage-pro-plugin";
import CodeSandboxPlugin from "./plugins/code-sandbox-plugin";
import CreativeStudioPlugin from "./plugins/creative-studio-plugin";
import DataScienceWorkbenchPlugin from "./plugins/data-science-workbench-plugin";
import GitHubExplorerAdvancedPlugin from "./plugins/git-explorer-pro-plugin";
import HuggingFaceSpacesProPlugin from "./plugins/huggingface-spaces-pro-plugin";
import JsonValidatorPlugin from "./plugins/json-validator-plugin";
import UrlUtilitiesPlugin from "./plugins/url-utilities-plugin";
import WikiKnowledgeBasePlugin from "./plugins/wiki-knowledge-base-plugin";
import ImageGenerationTab from "./image-generation-tab";
import SquareSplitHorizontal from "lucide-react/dist/esm/icons/square-split-horizontal";
import Bell from "lucide-react/dist/esm/icons/bell";
import { ImportDialog } from "./file-import/import-dialog";
import { useVoiceSettings } from "../lib/voice/use-voice";
import { VoiceToggleButton } from "./voice/voice-toggle";
import { getSponsorAd, trackAdView, adsEnabled, type EthicalAdResponse } from "../lib/ads/ethical-ads-service";
import { ResponseStyleSelector } from "./response-style-selector";
import { ResponseStyleProvider, useResponseStyle } from "@/contexts/response-style-context";
// VoiceToggleButton already imported above
// import { VoiceToggleButton } from "./voice/voice-toggle";

// Pop-out plugin windows for Plugins tab
const popOutPlugins: Plugin[] = [
  {
    id: "codesandbox-embed",
    name: "CodeSandbox Embed",
    description: "Embed CodeSandbox projects for live code editing",
    icon: Code,
    component: CodeSandboxEmbedPlugin,
    category: "code",
    defaultSize: { width: 1000, height: 700 },
    minSize: { width: 700, height: 500 },
  },
  {
    id: "stackblitz-embed",
    name: "StackBlitz Embed",
    description: "Embed StackBlitz projects for web development",
    icon: Code,
    component: StackBlitzEmbedPlugin,
    category: "code",
    defaultSize: { width: 1000, height: 700 },
    minSize: { width: 700, height: 500 },
  },
  {
    id: "glitch-embed",
    name: "Glitch Projects",
    description: "Embed Glitch projects for live code editing and preview",
    icon: Code,
    component: GlitchEmbedPlugin,
    category: "code",
    defaultSize: { width: 1100, height: 800 },
    minSize: { width: 800, height: 600 },
  },
  {
    id: "observable-embed",
    name: "Observable Notebooks",
    description: "Embed Observable notebooks for interactive data visualization",
    icon: BarChart2,
    component: ObservableEmbedPlugin,
    category: "data",
    defaultSize: { width: 1100, height: 800 },
    minSize: { width: 800, height: 600 },
  },
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
    id: "pstream-embed",
    name: "Movies",
    description: "Watch movies and TV shows from pstream.net",
    icon: Film,
    component: PStreamEmbedPlugin,
    category: "media",
    defaultSize: { width: 1000, height: 700 },
    minSize: { width: 800, height: 600 },
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
    category: "code",
    defaultSize: { width: 800, height: 600 },
    minSize: { width: 600, height: 400 },
  },
  {
    id: "note-taker",
    name: "Note Taker",
    description: "Take and organize notes during conversations",
    icon: FileText,
    component: NoteTakerPlugin,
    category: "utility",
    defaultSize: { width: 600, height: 500 },
    minSize: { width: 400, height: 300 },
  },
  {
    id: "interactive-diagramming",
    name: "Interactive Diagramming",
    description: "Create diagrams and flowcharts",
    icon: CheckCircle,
    component: InteractiveDiagrammingPlugin,
    category: "utility",
    defaultSize: { width: 900, height: 700 },
    minSize: { width: 700, height: 500 },
  },
  {
    id: "devops-command-center",
    name: "DevOps Command Center",
    description: "Manage deployments and infrastructure",
    icon: Server,
    component: DevOpsCommandCenterPlugin,
    category: "code",
    defaultSize: { width: 1000, height: 800 },
    minSize: { width: 800, height: 600 },
  },
  {
    id: "e2b-desktop",
    name: "E2B Desktop",
    description: "Computer use desktop environment with VNC streaming",
    icon: Monitor,
    component: E2BDesktopPlugin,
    category: "media",
    defaultSize: { width: 1200, height: 800 },
    minSize: { width: 900, height: 600 },
  },
  {
    id: "vercel-media-embed",
    name: "Vercel Media Sites",
    description: "Embed custom Vercel sites with media content",
    icon: Globe,
    component: VercelMediaEmbedPlugin,
    category: "media",
    defaultSize: { width: 1100, height: 750 },
    minSize: { width: 900, height: 600 },
  },
];

interface InteractionPanelProps {
  onSubmit: (content: string) => void;
  onNewChat: () => void;
  isProcessing: boolean;
  allowInputWhileProcessing?: boolean; // Allow typing even when processing
  toggleAccessibility: () => void;
  toggleHistory: () => void;
  toggleCodePreview: () => void;
  onStopGeneration?: () => void;
  onClearPendingInput?: () => void; // Callback to clear any pending queued input
  onRetry?: () => void;
  currentProvider?: string;
  currentModel?: string;
  error?: string | null;
  input: string;
  setInput: (value: string) => void;
  availableProviders: LLMProviderConfig[];
  onProviderChange: (provider: string, model: string) => void;
  hasCodeBlocks?: boolean;
  /** VFS MCP tool file edits (lights up code preview button even without markdown code blocks) */
  hasMcpFileEdits?: boolean;
  activeTab?: "chat" | "extras" | "integrations" | "shell" | "images" | "vnc";
  onActiveTabChange?: (tab: "chat" | "extras" | "integrations" | "shell" | "images" | "vnc") => void;
  userId?: string;
  onAttachedFilesChange?: (files: Record<string, AttachedVirtualFile>) => void;
  filesystemScopePath?: string;
  showResponseStyle?: boolean; // Controlled by settings toggle
  // Note: useDiffsPoller removed - file changes synced via filesystem-updated events + SSE
}

// Memoized provider selector component
const ProviderSelector = React.memo(function ProviderSelector({
  selectValue,
  availableProviders,
  onValueChange,
}: {
  selectValue: string;
  availableProviders: any[];
  onValueChange: (provider: string, model: string) => void;
}) {
  if (!selectValue || availableProviders.length === 0) return null;
  
  return (
    <div className="flex items-center gap-2 mb-2 text-xs text-white/60">
      <Select value={selectValue} onValueChange={(value) => {
        if (!value || value === "none") return;
        const [provider, ...modelParts] = value.split(":");
        const model = modelParts.join(":");
        onValueChange(provider, model);
      }}>
        <SelectTrigger className="w-full sm:w-[280px] border-white/20" style={{ backgroundColor: 'rgba(255, 255, 255, 0.08)' }}>
          <SelectValue placeholder="Select a model" />
        </SelectTrigger>
        <SelectContent>
          {availableProviders
            .filter((p: any) => p.isAvailable !== false)
            .map((provider) => (
              <SelectGroup key={provider.id}>
                <SelectLabel>{provider.name}</SelectLabel>
                {provider.models.map((model: ModelConfig | string) => {
                  const modelId = typeof model === "string" ? model : model.id;
                  return (
                    <SelectItem key={`${provider.id}:${modelId}`} value={`${provider.id}:${modelId}`}>
                      {modelId}
                    </SelectItem>
                  );
                })}
              </SelectGroup>
            ))}
          {availableProviders.filter((p: any) => p.isAvailable !== false).length === 0 && (
            <SelectItem value="none" disabled>
              No providers configured - add API keys to .env
            </SelectItem>
          )}
        </SelectContent>
      </Select>
    </div>
  );
});

/** Compact wrapper that provides the ResponseStyleProvider context for the selector */
const ResponseStyleSelectorCompact = React.memo(function ResponseStyleSelectorCompact() {
  return (
    <ResponseStyleProvider>
      <ResponseStyleSelector compact className="mb-2" />
    </ResponseStyleProvider>
  );
});

export default function InteractionPanel({
  onSubmit,
  onNewChat,
  isProcessing,
  allowInputWhileProcessing = false,
  toggleAccessibility,
  toggleHistory,
  toggleCodePreview,
  onStopGeneration,
  onClearPendingInput,
  onRetry: _onRetry,
  currentProvider = "openrouter",
  currentModel = "nvidia/nemotron-3-nano-30b-a3b:free",
  error: _error,
  input,
  setInput,
  availableProviders,
  onProviderChange,
  hasCodeBlocks = false,
  hasMcpFileEdits = false,
  activeTab = "chat",
  onActiveTabChange,
  onAttachedFilesChange,
  filesystemScopePath,
  showResponseStyle = false,
  // Note: useDiffsPoller removed - file changes synced via filesystem-updated events + SSE
}: InteractionPanelProps) {
  const { togglePanel, isOpen: isPanelOpen } = usePanel();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dragHandleRef = useRef<HTMLDivElement>(null);

  // Plugin state
  const [pluginToOpen, setPluginToOpen] = useState<string | null>(null);

  // Panel state
  const [panelHeight, setPanelHeight] = useState(() => {
    if (typeof window !== "undefined" && window.innerWidth <= 768) {
      return Math.min(380, window.innerHeight * 0.50);
    }
    return 280; // Slightly lower default height for better screen real estate
  });
  const [isDragging, setIsDragging] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  // First-visit notification for workspace panel
  const [showWorkspaceNotification, setShowWorkspaceNotification] = useState(() => {
    if (typeof window === "undefined") return false;
    const hasSeenNotification = localStorage.getItem("bing_workspace_panel_notification");
    return !hasSeenNotification;
  });

  // Refs for touch event handlers (needed for proper cleanup)
  const touchMoveHandler = useRef<((e: TouchEvent) => void) | null>(null);
  const touchEndHandler = useRef<(() => void) | null>(null);
  const dragStartY = useRef<number>(0);
  const dragStartHeight = useRef<number>(0);
  
  // Track tall tab transitions for smooth animation
  const [prevTab, setPrevTab] = useState<string | null>(null);
  const [isExpanding, setIsExpanding] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const prevPanelHeightRef = useRef<number | null>(null);

  // Import dialog state
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);

  // Queue for input while processing
  const [pendingInput, setPendingInput] = useState<string | null>(null);

  // Compute whether input should be disabled
  const isInputDisabled = isProcessing && !allowInputWhileProcessing;

  // Memoize select value to prevent infinite loop
  const selectValue = useMemo(() => {
    if (availableProviders.length === 0) return "";
    const currentValue = `${currentProvider}:${currentModel}`;
    const validValues = availableProviders
      .filter((p: any) => p.isAvailable !== false)
      .flatMap((p: any) => p.models.map((m: string) => `${p.id}:${m}`));
    return validValues.includes(currentValue) ? currentValue : "";
  }, [currentProvider, currentModel, availableProviders]);

  // Effect to restore pending input when processing completes
  // Don't auto-submit - user may have clicked Stop, so restore as draft for user to decide
  useEffect(() => {
    if (!isProcessing && pendingInput) {
      // Restore pending input to the input field instead of auto-submitting
      // This allows users to review/edit before manually sending after a Stop
      if (!input.trim()) {
        setInput(pendingInput);
      }
      setPendingInput(null);
    }
  }, [isProcessing, pendingInput, input, setInput]);

  // Expose a way to clear pending input from parent (e.g., when user manually sends)
  const clearPendingInput = useCallback(() => {
    setPendingInput(null);
    onClearPendingInput?.();
  }, [onClearPendingInput]);

  // Voice input
  const { isListening, startListening, stopListening, transcription } = useVoiceSettings();

  // Rotating sponsor ad (EthicalAds)
  const [sponsorAd, setSponsorAd] = useState<EthicalAdResponse | null>(null);

  useEffect(() => {
    if (!adsEnabled()) return;
    let cancelled = false;
    const loadAd = async () => {
      const ad = await getSponsorAd(['ai', 'chat', 'developer-tools']);
      if (!cancelled && ad) setSponsorAd(ad);
    };
    void loadAd();
    const interval = setInterval(loadAd, 60_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  useEffect(() => {
    if (transcription) {
      setInput(input + transcription);
    }
  }, [transcription, setInput]);

  const handleVoiceToggle = useCallback(() => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  }, [isListening, startListening, stopListening]);

  // Memoized handler for ProviderSelector
  const handleProviderSelect = useCallback((provider: string, model: string) => {
    onProviderChange(provider, model);
  }, [onProviderChange]);

  const getPanelMaxHeight = useCallback(() => {
    if (typeof window === "undefined") {
      return 600;
    }
    return Math.max(240, window.innerHeight - 60);
  }, []);

  const getPanelMinHeight = useCallback(() => {
    if (typeof window === "undefined") return 80;
    return window.innerWidth <= 768 ? 120 : 80; // Reduced from 320/240 to allow dragging down to match minimize button behavior
  }, []);

  const toggleMinimized = useCallback(() => {
    setIsMinimized((prev) => !prev);
  }, []);

  // Handle plugin result
  const handlePluginResult = (pluginId: string, result: any) => {
    console.log(`Plugin ${pluginId} result:`, result);
    if (typeof result === "string") {
      setInput(result);
    } else if (result?.content) {
      setInput(result.content);
    }
  };

  // Handle embed plugin opening from message links
  useEffect(() => {
    const handleOpenEmbed = (e: Event) => {
      const customEvent = e as CustomEvent;
      const { url, suggestedPlugin } = customEvent.detail || {};
      
      if (url) {
        // Open the suggested plugin or fallback to generic embed
        const pluginToOpen = suggestedPlugin || 'generic-embed';
        setPluginToOpen(pluginToOpen);
        
        // Store the URL in sessionStorage for the plugin to retrieve
        sessionStorage.setItem('embed-plugin-initial-url', url);
        
        toast.success(`Opening ${pluginToOpen.replace('-embed', '')} viewer`);
      }
    };

    window.addEventListener('open-embed-plugin', handleOpenEmbed as EventListener);
    return () => window.removeEventListener('open-embed-plugin', handleOpenEmbed as EventListener);
  }, []);

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
          const maxMobileHeight = Math.max(240, viewportH - 60);
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
  // Virtual filesystem integration
  const virtualFilesystem = useVirtualFilesystem(filesystemScopePath || "project");
  const selectedFilePaths = useMemo(
    () => Object.keys(virtualFilesystem.attachedFiles),
    [virtualFilesystem.attachedFiles],
  );
  const virtualFileNodes = useMemo(
    () => virtualFilesystem.nodes.filter((node) => node.type === 'file' || node.type === 'directory'),
    [virtualFilesystem.nodes],
  );

  useEffect(() => {
    onAttachedFilesChange?.(virtualFilesystem.attachedFiles);
  }, [onAttachedFilesChange, virtualFilesystem.attachedFiles]);

  const previousScopeRef = useRef(filesystemScopePath);
  useEffect(() => {
    if (previousScopeRef.current !== filesystemScopePath) {
      virtualFilesystem.clearAttachedFiles();
      previousScopeRef.current = filesystemScopePath;
    }
  }, [filesystemScopePath, virtualFilesystem]);

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

  // Gradual fade-out workspace notification
  const [workspaceNotifFading, setWorkspaceNotifFading] = useState(false);
  useEffect(() => {
    if (showWorkspaceNotification) {
      const fadeTimer = setTimeout(() => {
        setWorkspaceNotifFading(true);
      }, 5000);
      const removeTimer = setTimeout(() => {
        setShowWorkspaceNotification(false);
        setWorkspaceNotifFading(false);
        localStorage.setItem("bing_workspace_panel_notification", "seen");
      }, 9000);
      return () => {
        clearTimeout(fadeTimer);
        clearTimeout(removeTimer);
      };
    }
  }, [showWorkspaceNotification]);

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
    {
      id: "devops-command-center",
      name: "DevOps Command Center",
      description: "Manage deployments and infrastructure",
      icon: Server,
      component: DevOpsCommandCenterPlugin,
      category: "code",
      defaultSize: { width: 1000, height: 800 },
      minSize: { width: 800, height: 600 },
    },
    // Pro versions with advanced features
    {
      id: "cloud-storage-pro",
      name: "Cloud Storage Pro",
      description: "Advanced cloud storage with 10GB and multi-provider sync",
      icon: Cloud,
      component: CloudStorageProPlugin,
      category: "utility",
      defaultSize: { width: 900, height: 700 },
      minSize: { width: 700, height: 500 },
    },
    {
      id: "huggingface-spaces-pro",
      name: "HF Image Generator Pro",
      description: "Advanced image generation with multiple models and upscaling",
      icon: ImageIcon,
      component: HuggingFaceSpacesProPlugin,
      category: "ai",
      defaultSize: { width: 900, height: 700 },
      minSize: { width: 700, height: 500 },
    },
    {
      id: "api-playground-pro",
      name: "API Tester Pro",
      description: "Advanced API testing with collections and automation",
      icon: Globe,
      component: APIPlaygroundProPlugin,
      category: "code",
      defaultSize: { width: 900, height: 700 },
      minSize: { width: 700, height: 500 },
    },
    {
      id: "git-explorer-pro",
      name: "Codebase Explorer Pro",
      description: "Advanced codebase analytics and code search",
      icon: GitBranch,
      component: GitHubExplorerAdvancedPlugin,
      category: "code",
      defaultSize: { width: 1000, height: 800 },
      minSize: { width: 800, height: 600 },
    },
    {
      id: "github-trending-explorer",
      name: "GitHub Trending Explorer",
      description: "Discover hot OSS projects with visual GUI and one-click clone",
      icon: GitBranch,
      component: GitHubTrendingExplorerPlugin,
      category: "code",
      defaultSize: { width: 1100, height: 800 },
      minSize: { width: 900, height: 600 },
    },
    {
      id: "world-monitor-embed",
      name: "World Monitor",
      description: "Global service status monitoring and uptime tracking",
      icon: Globe,
      component: WorldMonitorEmbedPlugin,
      category: "utility",
      defaultSize: { width: 1000, height: 700 },
      minSize: { width: 800, height: 600 },
    },
    {
      id: "wikipedia-embed",
      name: "Wikipedia",
      description: "The free encyclopedia - browse and search articles",
      icon: BookOpen,
      component: WikipediaEmbedPlugin,
      category: "utility",
      defaultSize: { width: 1000, height: 700 },
      minSize: { width: 800, height: 600 },
    },
    {
      id: "archive-org-embed",
      name: "Internet Archive",
      description: "Wayback Machine and digital library",
      icon: Archive,
      component: ArchiveOrgEmbedPlugin,
      category: "utility",
      defaultSize: { width: 1000, height: 700 },
      minSize: { width: 800, height: 600 },
    },
    {
      id: "openstreetmap-embed",
      name: "OpenStreetMap",
      description: "Free wiki world map with search and navigation",
      icon: MapIcon,
      component: OpenStreetMapEmbedPlugin,
      category: "utility",
      defaultSize: { width: 1000, height: 700 },
      minSize: { width: 800, height: 600 },
    },
    {
      id: "duckduckgo-embed",
      name: "DuckDuckGo",
      description: "Privacy-focused web search",
      icon: Search,
      component: DuckDuckGoEmbedPlugin,
      category: "utility",
      defaultSize: { width: 1000, height: 700 },
      minSize: { width: 800, height: 600 },
    },
    {
      id: "codesandbox-embed",
      name: "CodeSandbox",
      description: "Online code editor and development environment",
      icon: Code,
      component: CodeSandboxEmbedPlugin,
      category: "code",
      defaultSize: { width: 1100, height: 750 },
      minSize: { width: 900, height: 600 },
    },
    {
      id: "stackblitz-embed",
      name: "StackBlitz",
      description: "Instant dev environments with WebContainers",
      icon: Terminal,
      component: StackBlitzEmbedPlugin,
      category: "code",
      defaultSize: { width: 1100, height: 750 },
      minSize: { width: 900, height: 600 },
    },
    {
      id: "generic-embed",
      name: "Universal Embed",
      description: "Embed any website - YouTube, Spotify, Reddit, Twitter, and more",
      icon: Globe,
      component: GenericEmbedPlugin,
      category: "utility",
      defaultSize: { width: 1100, height: 750 },
      minSize: { width: 900, height: 600 },
    },
    // Utility plugins
    {
      id: "code-sandbox",
      name: "Code Sandbox",
      description: "Live code execution and testing environment",
      icon: Code,
      component: CodeSandboxPlugin,
      category: "code",
      defaultSize: { width: 900, height: 700 },
      minSize: { width: 700, height: 500 },
    },
    {
      id: "creative-studio",
      name: "Creative Studio",
      description: "All-in-one creative tools for design and content",
      icon: Palette,
      component: CreativeStudioPlugin,
      category: "design",
      defaultSize: { width: 1000, height: 800 },
      minSize: { width: 800, height: 600 },
    },
    {
      id: "data-science-workbench",
      name: "Data Science Workbench",
      description: "Advanced data analysis and ML model building",
      icon: Database,
      component: DataScienceWorkbenchPlugin,
      category: "data",
      defaultSize: { width: 1100, height: 800 },
      minSize: { width: 900, height: 600 },
    },
    {
      id: "json-validator",
      name: "JSON Validator",
      description: "Validate and format JSON data",
      icon: CheckCircle,
      component: JsonValidatorPlugin,
      category: "utility",
      defaultSize: { width: 700, height: 600 },
      minSize: { width: 500, height: 400 },
    },
    {
      id: "url-utilities",
      name: "URL Utilities",
      description: "URL shortening, parsing, and validation tools",
      icon: Link,
      component: UrlUtilitiesPlugin,
      category: "utility",
      defaultSize: { width: 600, height: 500 },
      minSize: { width: 400, height: 350 },
    },
    {
      id: "wiki-knowledge-base",
      name: "Wiki Knowledge Base",
      description: "Search and browse Wikipedia knowledge",
      icon: FileText,
      component: WikiKnowledgeBasePlugin,
      category: "utility",
      defaultSize: { width: 800, height: 600 },
      minSize: { width: 600, height: 450 },
    },
    {
      id: "ai-prompt-library",
      name: "AI Prompt Library",
      description: "Browse and use pre-made AI prompts",
      icon: Brain,
      component: AIPromptLibraryPlugin,
      category: "ai",
      defaultSize: { width: 800, height: 600 },
      minSize: { width: 600, height: 450 },
    },
    {
      id: "pstream-embed",
      name: "Movies",
      description: "Watch movies and TV shows from pstream.net",
      icon: Film,
      component: PStreamEmbedPlugin,
      category: "media",
      defaultSize: { width: 1000, height: 700 },
      minSize: { width: 800, height: 600 },
    },
  ];

  const [showFileSelector, setShowFileSelector] = useState(false);
  const fileSelectorRef = useRef<HTMLDivElement>(null);

  // Close file selector when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        showFileSelector &&
        fileSelectorRef.current &&
        !fileSelectorRef.current.contains(event.target as Node)
      ) {
        setShowFileSelector(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showFileSelector]);

  useEffect(() => {
    if (showFileSelector) {
      void virtualFilesystem.listDirectory(virtualFilesystem.currentPath);
    }
  }, [showFileSelector, virtualFilesystem.currentPath, virtualFilesystem.listDirectory]);

  const handleToggleFileAttachment = useCallback(async (filePath: string, checked: boolean) => {
    try {
      if (checked) {
        await virtualFilesystem.attachFile(filePath);
      } else {
        virtualFilesystem.detachFile(filePath);
      }
    } catch (attachError) {
      const message = attachError instanceof Error ? attachError.message : 'Failed to attach file';
      toast.error(message);
    }
  }, [virtualFilesystem]);

  const handleUploadFilesToVirtualFilesystem = useCallback(async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const files = Array.from(event.target.files || []);
    if (files.length === 0) {
      return;
    }

    try {
      for (const file of files) {
        const uploadedPath = await virtualFilesystem.uploadBrowserFile(file, {
          targetDirectory: virtualFilesystem.currentPath,
        });
        await virtualFilesystem.attachFile(uploadedPath);
      }
      toast.success(`Attached ${files.length} file${files.length === 1 ? '' : 's'} from local device`);
    } catch (uploadError) {
      const message = uploadError instanceof Error ? uploadError.message : 'Failed to upload files';
      toast.error(message);
    } finally {
      event.target.value = '';
    }
  }, [virtualFilesystem]);

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

  // Extra modules for Extras tab (prompt templates, not full plugins)
  const extraModules = useMemo(() => {
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
            "Create a complete project scaffold including:\n\nðŸ“ **Project Structure**\n- Organized folder hierarchy\n- Configuration files\n- Environment setup\n\nðŸ”§ **Development Tools**\n- Build scripts\n- Linting configuration\n- Testing setup\n\nðŸ“š **Documentation**\n- README with setup instructions\n- API documentation\n- Contributing guidelines\n\nProject Type: \nFramework: \nDeployment Target: ",
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
            "Transform data between formats:\n\n**Supported Formats:**\n- JSON â†” CSV â†” XML â†” YAML\n- Database schemas\n- API responses\n- Configuration files\n\n**Features:**\n- Format validation\n- Structure optimization\n- Data cleaning\n- Schema generation\n\nSource Format: \nTarget Format: \nPaste your data:\n```\n\n```",
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
            "Generate Docker configuration:\n\nðŸ³ **Docker Setup**\n- Multi-stage Dockerfile\n- Docker Compose with services\n- Environment configuration\n- Volume and network setup\n\nðŸ“¦ **Services to Include**\n- Application containers\n- Database services\n- Caching layers\n- Reverse proxy\n\nðŸ”§ **Production Ready**\n- Health checks\n- Resource limits\n- Security best practices\n- Logging configuration\n\nApplication Stack: \nServices Needed: \nEnvironment: ",
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
            "Create Git workflow automation:\n\nðŸŒ¿ **Branch Strategy**\n- Branching model (GitFlow/GitHub Flow)\n- Branch protection rules\n- Merge strategies\n\nðŸ”„ **CI/CD Pipeline**\n- GitHub Actions / GitLab CI\n- Automated testing\n- Deployment workflows\n\nðŸª **Git Hooks**\n- Pre-commit hooks\n- Commit message validation\n- Code quality checks\n\nðŸ“‹ **Templates**\n- PR/MR templates\n- Issue templates\n- Contributing guidelines\n\nRepository Type: \nCI/CD Platform: \nTeam Size: ",
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
            "Setup environment management:\n\nðŸ” **Environment Variables**\n- Development, staging, production configs\n- Secret management strategy\n- Environment validation\n\nðŸ›¡ï¸ **Security**\n- API key rotation\n- Encrypted secrets\n- Access control\n\nðŸ“ **Configuration Files**\n- .env templates\n- Docker environment files\n- Kubernetes secrets\n- Cloud provider configs\n\nðŸ”„ **Deployment**\n- Environment promotion\n- Configuration drift detection\n- Rollback strategies\n\nDeployment Platform: \nSecrets to Manage: \nEnvironments Needed: ",
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
            "Generate images using Hugging Face Spaces:\n\nðŸŽ¨ **Available Models:**\n- DALL-E Mini/Mega\n- Stable Diffusion variants\n- Midjourney-style models\n- Artistic style transfer\n- Face generation models\n\nâš¡ **Zero GPU Hosting:**\n- Free GPU access\n- Instant model loading\n- No setup required\n- Community models\n\nðŸ–¼ï¸ **Image Generation:**\n- Text-to-image\n- Image-to-image\n- Style transfer\n- Upscaling\n- Inpainting\n\n**Prompt:** Describe the image you want to generate\n**Style:** (realistic, artistic, cartoon, etc.)\n**Dimensions:** (512x512, 1024x1024, etc.)\n\nDescribe your image: ",
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
            "ðŸ•¹ï¸ **GITHUB ARCADE** ðŸ•¹ï¸\n\n```\nâ”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”\nâ”‚  ðŸŽ® SELECT TRENDING REPOSITORY ðŸŽ®   â”‚\nâ”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤\nâ”‚ [A] ðŸ”¥ React 19 - Latest Features  â”‚\nâ”‚ [B] âš¡ Vite 5.0 - Lightning Fast   â”‚\nâ”‚ [C] ðŸ¤– LangChain - AI Chains       â”‚\nâ”‚ [D] ðŸŽ¨ Tailwind CSS - Utility CSS  â”‚\nâ”‚ [E] ðŸ“¦ Next.js 14 - Full Stack     â”‚\nâ”‚ [F] ðŸ”§ TypeScript - Type Safety    â”‚\nâ”‚ [G] ðŸš€ Astro - Static Site Gen     â”‚\nâ”‚ [H] ðŸ’¾ Prisma - Database ORM       â”‚\nâ””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜\n```\n\nðŸŽ¯ **MISSION:** Select a repository to:\n- ðŸ“‹ Auto-fetch README.md\n- ðŸ“¦ Parse package.json\n- ðŸ” Extract main scripts\n- ðŸ“ Generate project analysis\n- ðŸ› ï¸ Suggest improvements\n\n**Enter your choice (A-H) or specify a custom repo:**\nRepository: ",
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
            "â˜ï¸ **CLOUD STORAGE SETUP** (5GB Free)\n\nðŸ—„ï¸ **Storage Providers:**\n- Google Cloud Storage\n- AWS S3\n- Azure Blob Storage\n- DigitalOcean Spaces\n- Cloudflare R2\n\nðŸ“¦ **Implementation Features:**\n- File upload/download API\n- Automatic backup system\n- CDN integration\n- Image optimization\n- Version control\n- Access permissions\n\nðŸ”§ **Self-Hosting Option:**\n- MinIO server setup\n- Docker containerization\n- SSL/TLS encryption\n- Backup strategies\n\n**ENABLE_CLOUD_STORAGE = true** (set to false to disable)\n\nPreferred Provider: \nUse Case: \nSecurity Requirements: ",
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
            "ðŸ–¥ï¸ **VPS DEPLOYMENT SYSTEM**\n\nðŸš€ **VPS Providers:**\n- DigitalOcean Droplets\n- Linode\n- Vultr\n- Hetzner Cloud\n- Google Compute Engine\n\nâš™ï¸ **Automated Setup:**\n- Server provisioning\n- Docker installation\n- Nginx reverse proxy\n- SSL certificate (Let's Encrypt)\n- Firewall configuration\n- Monitoring setup\n\nðŸ”„ **CI/CD Pipeline:**\n- GitHub Actions integration\n- Automated deployments\n- Health checks\n- Rollback capabilities\n- Log aggregation\n\n**ENABLE_VPS_DEPLOYMENT = true** (set to false to disable)\n\nApplication Type: \nTraffic Expected: \nBudget Range: ",
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

  /* Main panel opacity changed from 60% to be more transparent */
  return (
    <> 
      <div
        className={`fixed bg-black/10 backdrop-blur-md border border-white/10 transition-all duration-200 z-50 left-0 right-0 border-t`}
        style={{
          bottom: bottomPosition,
          height: isMinimized
            ? "56px"
            : isExpanded
              ? "calc(100dvh - env(safe-area-inset-top, 0px) - 60px)"
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
        {/* Drag Handle - Full width resize bar (also touch area for mobile) */}
        <div
          ref={dragHandleRef}
          className={`w-full absolute top-0 left-0 right-0 h-[40px] transition-all duration-200 pointer-events-none ${
            isDragging
              ? 'bg-white/5 shadow-[0_0_12px_rgba(255,255,255,0.1)]'
              : 'bg-gradient-to-b from-white/10 to-transparent hover:from-white/15'
          }`}
          style={{ zIndex: 40 }}
          onDoubleClick={toggleMinimized}
        >
          {/* Touch target for drag - enabled on all screen sizes */}
          <div
            className={`absolute inset-0 pointer-events-auto cursor-ns-resize ${
              isDragging ? 'bg-gradient-to-b from-blue-400/8 to-transparent' : ''
            }`}
            onMouseDown={(e) => {
              // Only allow dragging from the very top area, not the button area
              if (e.clientX < 64) return; // Skip left 64px where button is
              
              e.preventDefault();
              setIsExpanded(false);
              setIsDragging(true);
              dragStartY.current = e.clientY;
              dragStartHeight.current = panelHeight;

              const handleMouseMove = (e: MouseEvent) => {
                const delta = dragStartY.current - e.clientY;
                setPanelHeight(
                  Math.max(getPanelMinHeight(), Math.min(getPanelMaxHeight(), dragStartHeight.current + delta)),
                );
              };

              const handleMouseUp = () => {
                setIsDragging(false);
                document.removeEventListener("mousemove", handleMouseMove);
                document.removeEventListener("mouseup", handleMouseUp);
              };

              document.addEventListener("mousemove", handleMouseMove);
              document.addEventListener("mouseup", handleMouseUp);
            }}
            onTouchStart={(e) => {
              // Prevent parent onClick from firing
              e.stopPropagation();
              // Mobile touch-and-hold drag support
              e.preventDefault();
              setIsExpanded(false);
              setIsDragging(true);
              dragStartY.current = e.touches[0].clientY;
              dragStartHeight.current = panelHeight;

              // CRITICAL: Remove any previously attached touch listeners first to prevent memory leaks
              if (touchMoveHandler.current) {
                document.removeEventListener("touchmove", touchMoveHandler.current, { passive: false } as EventListenerOptions);
              }
              if (touchEndHandler.current) {
                document.removeEventListener("touchend", touchEndHandler.current);
              }

              // Create touch move handler
              touchMoveHandler.current = (e: TouchEvent) => {
                e.preventDefault(); // Prevent page scroll while dragging
                const delta = dragStartY.current - e.touches[0].clientY;
                setPanelHeight(
                  Math.max(getPanelMinHeight(), Math.min(getPanelMaxHeight(), dragStartHeight.current + delta)),
                );
              };

              // Create touch end handler
              touchEndHandler.current = () => {
                setIsDragging(false);
                if (touchMoveHandler.current) {
                  document.removeEventListener("touchmove", touchMoveHandler.current, { passive: false } as EventListenerOptions);
                }
                if (touchEndHandler.current) {
                  document.removeEventListener("touchend", touchEndHandler.current);
                }
                touchMoveHandler.current = null;
                touchEndHandler.current = null;
              };

              document.addEventListener("touchmove", touchMoveHandler.current, { passive: false });
              document.addEventListener("touchend", touchEndHandler.current);
            }}
          >
            {/* Visual indicator for drag area */}
            <div className={`w-12 h-[4px] rounded-full mx-auto mt-2 transition-all duration-200 ${
              isDragging ? 'bg-blue-400/40 shadow-[0_0_6px_rgba(96,165,250,0.2)] w-16' : 'bg-white/30'
            }`} />
          </div>
        </div>

        <div className="p-2 sm:p-3 h-full flex flex-col relative" style={{ cursor: 'default' }}>
          {/* Experimental Workspace Toggle Button - Higher z-index for mobile */}
          <Button
            variant="ghost"
            size="sm"
            onClick={togglePanel}
            className={`absolute top-2 left-2 w-9 h-9 p-0 z-[70] transition-all duration-300 ${
              isPanelOpen
                ? "text-yellow-400 hover:bg-yellow-500/20 hover:text-yellow-300"
                : "text-gray-400 hover:text-white hover:bg-white/10"
            }`}
            title="Toggle experimental workspace panel"
          >
            <SquareSplitHorizontal className="w-5 h-5" />
          </Button>

          {/* First-Visit Notification for Workspace Panel */}
          {showWorkspaceNotification && (
            <div
              className="absolute bottom-full mb-2 left-2 z-[71] transition-opacity duration-[3500ms] ease-out"
              style={{
                opacity: workspaceNotifFading ? 0 : 1,
                animation: 'fade-in-slide-up 0.5s ease-out',
              }}
            >
              <div className="relative bg-gradient-to-r from-yellow-500/30 to-amber-500/30 backdrop-blur-sm rounded-lg p-3 shadow-md shadow-yellow-500/10 border border-yellow-400/15 max-w-[280px]">
                {/* Downward-pointing arrow toward the icon */}
                <div
                  className="absolute -bottom-1.5 left-3 w-3 h-3 rotate-45"
                  style={{
                    background: 'linear-gradient(135deg, rgba(234,179,8,0.3), rgba(245,158,11,0.3))',
                    borderRight: '1px solid rgba(250,204,21,0.15)',
                    borderBottom: '1px solid rgba(250,204,21,0.15)',
                  }}
                />
                <div className="flex items-start gap-2">
                  <Bell className="w-4 h-4 text-yellow-300/80 mt-0.5 flex-shrink-0" />
                  <div className="flex-1">
                    <p className="text-white/90 text-xs font-semibold">Workspace Panel</p>
                    <p className="text-yellow-200/70 text-[11px] mt-0.5 leading-relaxed">
                      Click the <SquareSplitHorizontal className="w-3 h-3 inline -mt-0.5 mx-0.5" /> icon to open the experimental workspace panel with file explorer, agent status, and more!
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      setShowWorkspaceNotification(false);
                      setWorkspaceNotifFading(false);
                      localStorage.setItem("bing_workspace_panel_notification", "seen");
                    }}
                    className="text-yellow-300/60 hover:text-white/90 transition-colors flex-shrink-0"
                    title="Dismiss"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
                {/* Progress bar showing time remaining */}
                <div className="mt-2 h-0.5 bg-yellow-400/15 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-yellow-300/50 rounded-full"
                    style={{
                      animation: 'shrink-width 8s linear',
                      width: '100%'
                    }}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Minimize Button */}
          <Button
            variant="ghost"
            size="sm"
            onClick={toggleMinimized}
            className="absolute top-1 right-1 w-6 h-6 p-0 text-gray-400 hover:text-white hover:bg-white/10 z-[60]"
            title={isMinimized ? "Reopen panel" : "Hide panel"}
          >
            {isMinimized ? (
              <ArrowDownToLine className="w-3 h-3 rotate-180" />
            ) : (
              <ArrowDownToLine className="w-3 h-3" />
            )}
          </Button>

          {/* Expand/Collapse Button - Bottom Right */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsExpanded(!isExpanded)}
            className="absolute bottom-1 right-1 w-6 h-6 p-0 text-gray-400 hover:text-white hover:bg-white/10 z-[60]"
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
          <div className="flex justify-between items-center mb-1 mt-3 sm:mt-5 px-1 ml-10" onDoubleClick={toggleMinimized}>
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

          {isMinimized && (
            <div className="mt-1 flex items-center justify-between px-1">
              <span className="text-xs text-white/70">Panel hidden</span>
              <Button
                variant="outline"
                size="sm"
                onClick={toggleMinimized}
                className="h-7 px-2 text-xs bg-black/40 border-white/20 hover:bg-white/10"
                title="Reopen interaction panel"
              >
                Reopen
              </Button>
            </div>
          )}

          {!isMinimized && (
            <Tabs
              value={activeTab}
              onValueChange={(value) => {
                // Handle height transition for tall tabs
                const newTab = value as string;
                const isNewTabTall = TALL_TABS.includes(newTab);
                const isCurrentTabTall = activeTab ? TALL_TABS.includes(activeTab) : false;

                // Auto-expand panel when switching to tall tabs (smooth animation)
                if (isNewTabTall && !isExpanded && !isCurrentTabTall) {
                  // Calculate target height for tall tabs (slightly higher than default)
                  const targetHeight = window.innerWidth <= 768 
                    ? Math.min(520, window.innerHeight * 0.65)  // Mobile: 65% of viewport
                    : 520;  // Desktop: fixed 520px (higher than default 320px)
                  
                  // Animate height change
                  const startHeight = panelHeight;
                  const startTime = performance.now();
                  const duration = 300; // 300ms smooth animation
                  
                  const animateHeight = (currentTime: number) => {
                    const elapsed = currentTime - startTime;
                    const progress = Math.min(elapsed / duration, 1);
                    
                    // Ease-out cubic bezier for smooth deceleration
                    const easeOut = 1 - Math.pow(1 - progress, 3);
                    
                    const currentHeight = startHeight + (targetHeight - startHeight) * easeOut;
                    setPanelHeight(currentHeight);
                    
                    if (progress < 1) {
                      requestAnimationFrame(animateHeight);
                    } else {
                      setIsExpanding(false);
                    }
                  };
                  
                  setIsExpanding(true);
                  requestAnimationFrame(animateHeight);
                }

                setPrevTab(activeTab || null);
                onActiveTabChange?.(value as "chat" | "images" | "extras" | "integrations" | "shell");
              }}
              className={`flex-1 flex flex-col min-h-0 transition-all duration-300 ease-out`}
            >
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-2 gap-2 sticky top-0 z-20 py-1">
                <div className="w-full sm:w-auto overflow-x-auto no-scrollbar">
                  <TabsList className="w-max min-w-full sm:min-w-0 sm:w-auto" style={{ backgroundColor: 'transparent' }}>
                    <TabsTrigger value="chat" className="text-xs sm:text-sm">
                      <MessageSquare className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
                      <span className="hidden sm:inline">Chat</span>
                    </TabsTrigger>
                    <TabsTrigger value="images" className="text-xs sm:text-sm">
                      <ImageIcon className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
                      <span className="hidden sm:inline">Images</span>
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

                <div className="grid grid-cols-6 gap-1 w-full sm:w-auto sm:flex sm:space-x-2 flex-shrink-0">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={onNewChat}
                    title="New Chat"
                    className="h-9 w-full sm:w-10 sm:h-10 p-0 bg-black/40 border-white/20 hover:bg-white/10"
                  >
                    <Plus className="h-3 w-3 sm:h-4 sm:w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={toggleHistory}
                    title="Chat History"
                    className="h-9 w-full sm:w-10 sm:h-10 p-0 bg-black/40 border-white/20 hover:bg-white/10"
                  >
                    <History className="h-3 w-3 sm:h-4 sm:w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={toggleAccessibility}
                    title="Accessibility Options"
                    className="h-9 w-full sm:w-10 sm:h-10 p-0 bg-black/40 border-white/20 hover:bg-white/10"
                  >
                    <Settings className="h-3 w-3 sm:h-4 sm:w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={toggleCodePreview}
                    title="Code Preview"
                    className={`h-9 w-full sm:w-10 sm:h-10 p-0 bg-black/40 border-white/20 hover:bg-white/10 ${
                      hasCodeBlocks || hasMcpFileEdits
                        ? "ring-2 ring-white/30 shadow-lg shadow-white/20 animate-pulse"
                        : ""
                    }`}
                  >
                    <Code
                      className={`h-3 w-3 sm:h-4 sm:w-4 ${
                        hasCodeBlocks || hasMcpFileEdits ? "text-white" : ""
                      }`}
                    />
                  </Button>
                </div>
              </div>

              {/* Provider/Model Selection - Restored */}
              <ProviderSelector
                selectValue={selectValue}
                availableProviders={availableProviders}
                onValueChange={handleProviderSelect}
              />

              {/* Response Style Selector (hidden by default, toggle in Settings) */}
              {showResponseStyle && <ResponseStyleSelectorCompact />}

              {/* Tab Content Sections */}
              <TabsContent value="chat" className={`m-0 flex-1 flex flex-col min-h-0 overflow-visible ${activeTab === 'chat' ? DEFAULT_TAB_HEIGHT : ''} ${activeTab && activeTab !== 'chat' && TALL_TABS.includes(activeTab) ? 'min-h-[200px]' : ''} ${EXPAND_TRANSITION}`}>
                {/* Suggestions - Compact row */}
                <div className="flex flex-wrap gap-2 mb-2 shrink-0">
                  {chatSuggestions.map((suggestion, index) => (
                    <Button
                      key={index}
                      variant="secondary"
                      size="sm"
                      className="text-xs transition-all duration-200 shrink-0"
                      style={{ backgroundColor: 'rgba(255, 255, 255, 0.08)', border: '1px solid rgba(255, 255, 255, 0.1)' }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.15)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.08)';
                      }}
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
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const trimmed = input.trim();
                    if (!trimmed) return;
                    // If processing and queuing allowed, queue instead of submitting
                    if (isProcessing && allowInputWhileProcessing) {
                      setPendingInput(trimmed);
                      setInput("");
                      return;
                    }
                    // Clear any pending input before submitting new one
                    setPendingInput(null);
                    onSubmit(trimmed);
                    setInput("");
                  }}
                  className="flex flex-col gap-2 flex-1 min-h-0 overflow-visible"
                >
                  <div className="relative flex-1 min-h-[60px] overflow-visible">
                    {/* @mention autocomplete menu */}
                    <FileMentionAutocompleteIntegration
                      input={input}
                      setInput={setInput}
                      onSubmit={onSubmit}
                      isInputDisabled={isInputDisabled}
                      isProcessing={isProcessing}
                      allowInputWhileProcessing={allowInputWhileProcessing}
                      setPendingInput={setPendingInput}
                      textareaRef={textareaRef}
                    />
                    <div className="absolute right-3 top-3 flex gap-1" style={{ zIndex: 10 }}>
                      <button
                        type="button"
                        onClick={async () => {
                          // On desktop, use native Tauri file dialog
                          if (process.env.DESKTOP_MODE === 'true' || process.env.DESKTOP_LOCAL_EXECUTION === 'true') {
                            try {
                              const { tauriDialogProvider } = await import('@/lib/hitl/tauri-dialog-provider');
                              if (tauriDialogProvider.isAvailable()) {
                                const result = await tauriDialogProvider.openFile({
                                  title: 'Attach Files to Chat',
                                  multiple: true,
                                });
                                if (result.success && result.data) {
                                  const paths = Array.isArray(result.data) ? result.data : [result.data];
                                  toast.info(`Selected ${paths.length} file(s) from desktop`);
                                  // Paths are strings â€” bridge to VFS attachment via drag-drop or path input
                                }
                                return;
                              }
                            } catch (e) {
                              console.warn('[InteractionPanel] Tauri file dialog failed, falling back', e);
                            }
                          }
                          // Fallback: show file selector panel
                          setShowFileSelector(!showFileSelector);
                        }}
                        className={`p-1.5 rounded-md border transition-colors relative ${
                          selectedFilePaths.length > 0
                            ? "bg-blue-500/20 border-blue-400/50 hover:bg-blue-500/30"
                            : "bg-white/5 border-white/10 hover:bg-white/15"
                        }`}
                        title="Attach Files"
                        disabled={isProcessing}
                        style={{ zIndex: 11 }}
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
                      <VoiceToggleButton />
                    </div>

                    {showFileSelector && (
                      <div
                        ref={fileSelectorRef}
                        className="absolute right-0 bottom-full mb-2 w-80 bg-black/98 border border-white/20 rounded-lg shadow-2xl z-50 p-3"
                        style={{ zIndex: 100000 }}
                      >
                        <div className="flex items-center justify-between mb-3 pb-2 border-b border-white/10">
                          <h4 className="text-sm font-medium text-white/80">
                            Attach Files ({selectedFilePaths.length})
                          </h4>
                          <div className="flex items-center gap-2">
                            {selectedFilePaths.length > 0 && (
                              <button
                                type="button"
                                onClick={() => { virtualFilesystem.clearAttachedFiles(); }}
                                className="text-[10px] text-red-400 hover:text-red-300 transition-colors mr-2"
                              >
                                Clear All
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => { setShowFileSelector(false); }}
                              className="text-white/50 hover:text-white/80"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        </div>

                        {/* Quick Upload Section */}
                        <div className="mb-3 pb-3 border-b border-white/10 space-y-2">
                          <button
                            type="button"
                            className="w-full px-3 py-2 bg-blue-600/20 hover:bg-blue-600/30 border border-blue-400/30 rounded text-xs text-blue-300 flex items-center justify-center gap-2 transition-colors"
                            onClick={() => fileInputRef.current?.click()}
                          >
                            <Plus className="w-3 h-3" />
                            Upload from Computer
                          </button>
                          <button
                            type="button"
                            className="w-full px-3 py-2 bg-purple-600/20 hover:bg-purple-600/30 border border-purple-400/30 rounded text-xs text-purple-300 flex items-center justify-center gap-2 transition-colors"
                            onClick={async () => {
                              // On desktop, use native Tauri folder dialog
                              if (process.env.DESKTOP_MODE === 'true' || process.env.DESKTOP_LOCAL_EXECUTION === 'true') {
                                try {
                                  const { tauriDialogProvider } = await import('@/lib/hitl/tauri-dialog-provider');
                                  if (tauriDialogProvider.isAvailable()) {
                                    const result = await tauriDialogProvider.openFolder({
                                      title: 'Select Folder to Import',
                                    });
                                    if (result.success && result.data) {
                                      const paths = Array.isArray(result.data) ? result.data : [result.data];
                                      toast.info(`Selected ${paths.length} folder(s) from desktop`);
                                    }
                                    return;
                                  }
                                } catch (e) {
                                  console.warn('[InteractionPanel] Tauri folder dialog failed, falling back', e);
                                }
                              }
                              setIsImportDialogOpen(true);
                            }}
                          >
                            <Upload className="w-3 h-3" />
                            Import Files/Folders
                          </button>
                        </div>

                        <input
                          ref={fileInputRef}
                          type="file"
                          multiple
                          className="hidden"
                          onChange={handleUploadFilesToVirtualFilesystem}
                        />

                        {/* Filesystem Navigation */}
                        <div className="mb-2 p-2 rounded bg-black/40 border border-white/10">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-[10px] text-white/60 truncate flex-1">
                              {virtualFilesystem.currentPath}
                            </span>
                            <div className="flex gap-1 ml-2">
                              <button
                                type="button"
                                onClick={() => {
                                  const current = virtualFilesystem.currentPath.replace(/\/+$/, "");
                                  const parts = current.split("/").filter(Boolean);
                                  if (parts.length > 1) {
                                    const parentPath = parts.slice(0, -1).join("/");
                                    void virtualFilesystem.listDirectory(parentPath || "project");
                                  }
                                }}
                                className="p-1 hover:bg-white/10 rounded"
                                title="Parent Directory"
                              >
                                <ArrowUp className="w-3 h-3 text-white/70" />
                              </button>
                              <button
                                type="button"
                                onClick={() => void virtualFilesystem.listDirectory(virtualFilesystem.currentPath)}
                                className="p-1 hover:bg-white/10 rounded"
                                title="Refresh"
                              >
                                <RefreshCw className="w-3 h-3 text-white/70" />
                              </button>
                            </div>
                          </div>
                          
                          <div className="flex justify-between items-center mb-1 px-1">
                            <span className="text-[9px] text-white/40 uppercase font-medium">Workspace Files</span>
                            <button
                              type="button"
                              onClick={async () => {
                                const filesOnly = virtualFileNodes.filter(
                                  (n) => n.type === "file" && !selectedFilePaths.includes(n.path)
                                );
                                try {
                                  for (const file of filesOnly) {
                                    await virtualFilesystem.attachFile(file.path);
                                  }
                                } catch (error) {
                                  const message = error instanceof Error ? error.message : "Failed to attach files";
                                  toast.error(message);
                                }
                              }}
                              className="text-[9px] text-blue-400 hover:text-blue-300 transition-colors"
                            >
                              Select All
                            </button>
                          </div>
                        </div>

                        {/* File List */}
                        <div className="max-h-48 overflow-y-auto pr-1 space-y-1">
                          {virtualFilesystem.isLoading && (
                            <div className="text-xs text-white/60 py-4 text-center">
                              <Loader2 className="w-4 h-4 mx-auto mb-1 animate-spin" />
                              Loading files...
                            </div>
                          )}
                          {!virtualFilesystem.isLoading && virtualFileNodes.length === 0 && (
                            <div className="text-xs text-white/50 py-4 text-center">
                              No files yet. Upload one or create files through chat.
                            </div>
                          )}
                          {virtualFileNodes.map((fileNode) => (
                            <div
                              key={fileNode.path}
                              className={`flex items-center gap-2 text-xs p-2 rounded cursor-pointer transition-colors ${
                                selectedFilePaths.includes(fileNode.path)
                                  ? "bg-blue-600/20 border border-blue-400/30"
                                  : "hover:bg-white/10 border border-transparent"
                              }`}
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                if (fileNode.type === "directory") {
                                  void virtualFilesystem.listDirectory(fileNode.path);
                                }
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={fileNode.type === "file" && selectedFilePaths.includes(fileNode.path)}
                                onChange={(event) => {
                                  event.stopPropagation();
                                  if (fileNode.type === "file") {
                                    void handleToggleFileAttachment(fileNode.path, event.target.checked);
                                  }
                                }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                }}
                                className="w-3 h-3"
                                disabled={fileNode.type === "directory"}
                              />
                              <FileText className="w-3 h-3 text-white/50 flex-shrink-0" />
                              <span className="truncate flex-1 text-white/80">{fileNode.name}</span>
                              {fileNode.type === "directory" && (
                                <ChevronRight className="w-3 h-3 text-white/30" />
                              )}
                            </div>
                          ))}
                        </div>

                        {/* Cloud Storage Section */}
                        <div className="mt-3 pt-3 border-t border-white/10">
                          <h5 className="text-[10px] font-medium mb-2 text-white/50 uppercase tracking-wider">
                            External Storage
                          </h5>
                          <button
                            type="button"
                            onClick={() => {
                              onActiveTabChange?.("chat");
                              setPluginToOpen("cloud-storage");
                            }}
                            className="w-full text-xs p-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded flex items-center gap-2 transition-colors"
                          >
                            <Cloud className="w-3 h-3 text-blue-400" />
                            <span className="text-white/70">Browse Cloud Storage</span>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2 self-end">
                    <VoiceToggleButton className="mb-0.5" />
                    {isProcessing && onStopGeneration ? (
                      <Button
                        type="button"
                        variant="destructive"
                        className="min-w-[80px] bg-red-600/80 hover:bg-red-600 border border-red-500/50 rounded-2xl z-20"
                        onClick={onStopGeneration}
                      >
                        <Square className="h-4 w-4 mr-2" />
                        Stop
                      </Button>
                    ) : (
                      <Button
                        type="submit"
                        className="min-w-[80px] bg-white/10 hover:bg-white/20 border border-white/20 rounded-2xl z-20"
                        disabled={isProcessing || !input.trim()}
                      >
                        {isProcessing ? (
                          <Loader2 className="h-4 w-4 thinking-spinner" />
                        ) : (
                          <>
                            <Send className="h-4 w-4 mr-2" />
                            Send
                          </>
                        )}
                      </Button>
                    )}
                  </div>

                  {/* Pending Input Indicator */}
                  {pendingInput && (
                    <div className="flex items-center justify-between px-2 py-1.5 bg-yellow-500/10 border border-yellow-400/30 rounded-lg">
                      <span className="text-xs text-yellow-300">
                        Message queued - will send after current response completes
                      </span>
                      <button
                        type="button"
                        onClick={clearPendingInput}
                        className="text-yellow-300 hover:text-white text-xs"
                      >
                        Cancel
                      </button>
                    </div>
                  )}

                  {/* Error Display */}
                  {_error && (
                    <div className="flex items-center gap-2 px-2 py-1.5 bg-red-500/10 border border-red-400/30 rounded-lg">
                      <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />
                      <span className="text-xs text-red-300 flex-1">{_error}</span>
                    </div>
                  )}
                </form>
              </TabsContent>

              {/* Images Tab Content - Taller height for image generation */}
              <TabsContent 
                value="images" 
                className={`m-0 flex-1 min-h-0 flex flex-col overflow-hidden ${activeTab === 'images' ? TALL_TAB_HEIGHT : DEFAULT_TAB_HEIGHT} ${EXPAND_TRANSITION}`}
              >
                <Card className="bg-black/40 border-white/10 flex-1 min-h-0">
                  <CardContent className="pt-0 h-full flex flex-col min-h-0 overflow-hidden">
                    <ImageGenerationTab 
                      onImageGenerated={(imageUrl) => {
                        toast.success("Image generated successfully!");
                      }}
                    />
                  </CardContent>
                </Card>
              </TabsContent>

              {/* Extras Tab Content - Taller height for prompt templates */}
              <TabsContent 
                value="extras" 
                className={`m-0 flex-1 min-h-0 flex flex-col overflow-hidden ${activeTab === 'extras' ? TALL_TAB_HEIGHT : DEFAULT_TAB_HEIGHT} ${EXPAND_TRANSITION}`}
              >
                <Card className="bg-black/40 border-white/10 flex-1 min-h-0">
                  <CardContent className="pt-6 h-full flex flex-col min-h-0">
                    <div className="space-y-4 flex-1 min-h-0 flex flex-col">
                      {/* Extras - Quick Prompt Templates */}
                      <div className="text-center mb-4">
                        <h3 className="font-medium text-white mb-2">
                          Extras
                        </h3>
                        <p className="text-xs text-white/60">
                          Click to insert a specialized prompt into the chat
                        </p>
                      </div>

                      <div className="grid grid-cols-2 gap-3 overflow-y-auto flex-1 min-h-0 content-start">
                        {extraModules.map((extra) => {
                          const IconComponent = extra.icon;
                          return (
                            <button
                              key={extra.id}
                              onClick={() => {
                                extra.action();
                                toast.success(
                                  `${extra.name} prompt loaded! Check the chat input.`,
                                );
                              }}
                              className="flex flex-col items-center gap-2 p-3 bg-black/30 hover:bg-black/50 border border-white/10 hover:border-white/20 rounded-lg transition-all duration-200 text-left group"
                            >
                              <div className="flex items-center gap-2 w-full">
                                <IconComponent
                                  className={`h-4 w-4 ${extra.color} group-hover:scale-110 transition-transform`}
                                />
                                <span className="font-medium text-sm text-white truncate">
                                  {extra.name}
                                </span>
                              </div>
                              <p className="text-xs text-white/60 line-clamp-2 w-full">
                                {extra.description}
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
              <TabsContent 
                value="integrations" 
                className={`m-0 flex-1 min-h-0 flex flex-col overflow-hidden ${activeTab === 'integrations' ? 'min-h-[350px]' : DEFAULT_TAB_HEIGHT} ${EXPAND_TRANSITION}`}
              >
                <Card className="bg-black/40 border-white/10 flex-1 min-h-0">
                  <CardContent className="pt-6 h-full flex flex-col min-h-0">
                    <div className="space-y-3 flex-1 min-h-0 overflow-y-auto">
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
                        {/* PluginManager for pop-out windows */}
                        <PluginManager
                          availablePlugins={availablePlugins}
                          onPluginResult={handlePluginResult}
                          openPluginId={pluginToOpen}
                          onOpenComplete={() => setPluginToOpen(null)}
                        />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              {/* Shell Tab Content - Taller height for terminal */}
              <TabsContent
                value="shell"
                className={`m-0 flex-1 overflow-auto ${activeTab === 'shell' ? TALL_TAB_HEIGHT : DEFAULT_TAB_HEIGHT} ${EXPAND_TRANSITION}`}
              >
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
          )}

          {/* Rotating sponsor ad bar â€” subtle, blends with panel aesthetic */}
          {sponsorAd && (
            <a
              href={sponsorAd.url}
              target="_blank"
              rel="noopener sponsored"
              className="block px-4 py-1.5 border-t border-white/5 bg-gradient-to-r from-purple-500/5 via-transparent to-cyan-500/5 text-[10px] text-white/30 hover:text-white/60 hover:from-purple-500/10 hover:to-cyan-500/10 transition-all duration-500"
              onClick={() => trackAdView(sponsorAd)}
            >
              <span className="uppercase tracking-wider opacity-50 mr-2">Sponsor</span>
              {sponsorAd.text}
            </a>
          )}
        </div>

        {/* Import Files Dialog */}
        <ImportDialog
          open={isImportDialogOpen}
          onOpenChange={setIsImportDialogOpen}
          sessionId={filesystemScopePath?.split('/').pop()}
          scopePath={filesystemScopePath}
          onImportComplete={(result) => {
            console.log('Import completed:', result);
          }}
        />
      </div>
    </>
  );
}

/**
 * File Mention Autocomplete Integration Component
 * 
 * Wraps the Textarea with @mention autocomplete functionality.
 * This component uses the useFileMentionAutocomplete hook to:
 * - Detect @mentions in the input
 * - Show autocomplete dropdown
 * - Handle keyboard navigation
 * - Insert selected files with @ syntax
 */
function FileMentionAutocompleteIntegration({
  input,
  setInput,
  onSubmit,
  isInputDisabled,
  isProcessing,
  allowInputWhileProcessing,
  setPendingInput,
  textareaRef,
}: {
  input: string;
  setInput: (value: string) => void;
  onSubmit: (content: string) => void;
  isInputDisabled: boolean;
  isProcessing: boolean;
  allowInputWhileProcessing: boolean;
  setPendingInput: (value: string | null) => void;
  textareaRef: React.RefObject<HTMLTextAreaElement>;
}) {
  const {
    showMenu,
    query,
    suggestions,
    selectedIndex,
    isLoading,
    handleInputChange,
    handleKeyDown,
    handleSelect,
  } = useFileMentionAutocomplete({
    input,
    setInput,
    onFileSelect: (files) => {
      // Files selected via @mention - they'll be sent with the message
      // The backend will detect @mentions in the text and prioritize them
    },
  });

  return (
    <>
      <Textarea
        ref={textareaRef}
        value={input}
        onChange={(e) => handleInputChange(e.target.value)}
        placeholder="Type your message... (use @ to mention files)"
        className="min-h-[60px] max-h-[120px] bg-white/5 border border-white/20 pr-12 resize-none text-base sm:text-sm focus:border-white/40 focus:ring-1 focus:ring-white/20 rounded-2xl"
        rows={2}
        onKeyDown={(e) => {
          // Let autocomplete handle navigation keys first
          const handled = handleKeyDown(e);
          if (handled) return;
          
          // Enter to submit
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            const trimmed = input.trim();
            if (!trimmed) return;
            // If processing and queuing allowed, queue instead of submitting
            if (isProcessing && allowInputWhileProcessing) {
              setPendingInput(trimmed);
              setInput("");
              return;
            }
            onSubmit(trimmed);
            setInput("");
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
        disabled={isInputDisabled}
      />
      
      {/* Autocomplete menu */}
      <FileMentionMenu
        visible={showMenu}
        query={query}
        suggestions={suggestions}
        selectedIndex={selectedIndex}
        isLoading={isLoading}
        onSelect={handleSelect}
        anchorEl={textareaRef.current}
      />
    </>
  );
}
