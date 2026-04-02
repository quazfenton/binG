/**
 * Top Panel API Service
 * 
 * API integration layer for all top panel tabs
 * Replaces mock data with real backend calls
 */

import { toast } from "sonner";

const API_BASE = "/api/top-panel";

// ============================================================================
// Art Gallery API
// ============================================================================

export interface GeneratedImage {
  id: string;
  prompt: string;
  url: string;
  thumbnail?: string;
  style: string;
  model: string;
  createdAt: number;
  likes: number;
  downloads: number;
  width: number;
  height: number;
  seed?: number;
  userId: string;
}

export interface GenerateImageRequest {
  prompt: string;
  style: string;
  model?: string;
  width?: number;
  height?: number;
  steps?: number;
  guidance?: number;
  seed?: number;
}

export const artGalleryAPI = {
  /**
   * Generate new image using AI
   */
  async generate(request: GenerateImageRequest): Promise<GeneratedImage> {
    const response = await fetch(`${API_BASE}/art/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || "Failed to generate image");
    }

    return response.json();
  },

  /**
   * Get user's generated images
   */
  async getImages(params?: { style?: string; limit?: number }): Promise<GeneratedImage[]> {
    const url = new URL(`${API_BASE}/art/images`);
    if (params?.style) url.searchParams.set("style", params.style);
    if (params?.limit) url.searchParams.set("limit", params.limit.toString());

    const response = await fetch(url.toString());
    if (!response.ok) throw new Error("Failed to fetch images");

    return response.json();
  },

  /**
   * Like an image
   */
  async likeImage(imageId: string): Promise<void> {
    const response = await fetch(`${API_BASE}/art/${imageId}/like`, {
      method: "POST",
    });

    if (!response.ok) throw new Error("Failed to like image");
  },

  /**
   * Download image
   */
  async downloadImage(image: GeneratedImage): Promise<void> {
    const response = await fetch(image.url);
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `art-${image.id}.png`;
    a.click();
    window.URL.revokeObjectURL(url);
  },

  /**
   * Delete image
   */
  async deleteImage(imageId: string): Promise<void> {
    const response = await fetch(`${API_BASE}/art/${imageId}`, {
      method: "DELETE",
    });

    if (!response.ok) throw new Error("Failed to delete image");
  },
};

// ============================================================================
// Music Visualizer API
// ============================================================================

export interface Track {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  coverUrl: string;
  audioUrl: string;
  liked: boolean;
  userId: string;
}

export interface Playlist {
  id: string;
  name: string;
  tracks: Track[];
  userId: string;
  createdAt: number;
}

export const musicAPI = {
  /**
   * Get user's playlists
   */
  async getPlaylists(): Promise<Playlist[]> {
    const response = await fetch(`${API_BASE}/music/playlists`);
    if (!response.ok) throw new Error("Failed to fetch playlists");
    return response.json();
  },

  /**
   * Get tracks from playlist
   */
  async getPlaylistTracks(playlistId: string): Promise<Track[]> {
    const response = await fetch(`${API_BASE}/music/playlists/${playlistId}/tracks`);
    if (!response.ok) throw new Error("Failed to fetch tracks");
    return response.json();
  },

  /**
   * Like a track
   */
  async likeTrack(trackId: string): Promise<void> {
    const response = await fetch(`${API_BASE}/music/${trackId}/like`, {
      method: "POST",
    });
    if (!response.ok) throw new Error("Failed to like track");
  },

  /**
   * Get audio stream URL
   */
  getStreamUrl(trackId: string): string {
    return `${API_BASE}/music/${trackId}/stream`;
  },
};

// ============================================================================
// Code Playground API
// ============================================================================

export interface CodeSnippet {
  id: string;
  name: string;
  language: string;
  code: string;
  output?: string;
  error?: string;
  createdAt: number;
  updatedAt: number;
  userId: string;
  isPublic: boolean;
}

export interface ExecuteCodeRequest {
  code: string;
  language: string;
  stdin?: string;
  timeout?: number;
}

export interface ExecuteCodeResponse {
  output: string;
  error?: string;
  exitCode: number;
  executionTime: number;
  memoryUsage?: number;
}

export const codePlaygroundAPI = {
  /**
   * Execute code in sandbox
   */
  async execute(request: ExecuteCodeRequest): Promise<ExecuteCodeResponse> {
    const response = await fetch(`${API_BASE}/code/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || "Execution failed");
    }

    return response.json();
  },

  /**
   * Save code snippet
   */
  async saveSnippet(snippet: Omit<CodeSnippet, "id" | "createdAt" | "updatedAt">): Promise<CodeSnippet> {
    const response = await fetch(`${API_BASE}/code/snippets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(snippet),
    });

    if (!response.ok) throw new Error("Failed to save snippet");
    return response.json();
  },

  /**
   * Get user's snippets
   */
  async getSnippets(): Promise<CodeSnippet[]> {
    const response = await fetch(`${API_BASE}/code/snippets`);
    if (!response.ok) throw new Error("Failed to fetch snippets");
    return response.json();
  },

  /**
   * Delete snippet
   */
  async deleteSnippet(snippetId: string): Promise<void> {
    const response = await fetch(`${API_BASE}/code/snippets/${snippetId}`, {
      method: "DELETE",
    });
    if (!response.ok) throw new Error("Failed to delete snippet");
  },

  /**
   * Get code templates
   */
  async getTemplates(language?: string): Promise<any[]> {
    const url = new URL(`${API_BASE}/code/templates`);
    if (language) url.searchParams.set("language", language);
    const response = await fetch(url.toString());
    if (!response.ok) throw new Error("Failed to fetch templates");
    return response.json();
  },
};

// ============================================================================
// Prompt Lab API
// ============================================================================

export interface PromptTemplate {
  id: string;
  name: string;
  description: string;
  template: string;
  category: string;
  tags: string[];
  variables: string[];
  createdAt: number;
  updatedAt: number;
  userId: string;
  isPublic: boolean;
  uses: number;
  rating: number;
}

export interface TestResult {
  id: string;
  promptId: string;
  input: string;
  output: string;
  model: string;
  tokens: number;
  latency: number;
  rating: number;
  timestamp: number;
}

export const promptLabAPI = {
  /**
   * Save prompt template
   */
  async saveTemplate(template: Omit<PromptTemplate, "id" | "createdAt" | "updatedAt" | "uses" | "rating">): Promise<PromptTemplate> {
    const response = await fetch(`${API_BASE}/prompts/templates`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(template),
    });

    if (!response.ok) throw new Error("Failed to save template");
    return response.json();
  },

  /**
   * Get templates
   */
  async getTemplates(category?: string): Promise<PromptTemplate[]> {
    const url = new URL(`${API_BASE}/prompts/templates`);
    if (category) url.searchParams.set("category", category);
    const response = await fetch(url.toString());
    if (!response.ok) throw new Error("Failed to fetch templates");
    return response.json();
  },

  /**
   * Test prompt
   */
  async testPrompt(request: { template: string; variables: Record<string, string>; model?: string }): Promise<TestResult> {
    const response = await fetch(`${API_BASE}/prompts/test`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });

    if (!response.ok) throw new Error("Failed to test prompt");
    return response.json();
  },

  /**
   * Get test history
   */
  async getTestHistory(promptId?: string): Promise<TestResult[]> {
    const url = new URL(`${API_BASE}/prompts/tests`);
    if (promptId) url.searchParams.set("promptId", promptId);
    const response = await fetch(url.toString());
    if (!response.ok) throw new Error("Failed to fetch test history");
    return response.json();
  },

  /**
   * Delete template
   */
  async deleteTemplate(templateId: string): Promise<void> {
    const response = await fetch(`${API_BASE}/prompts/templates/${templateId}`, {
      method: "DELETE",
    });
    if (!response.ok) throw new Error("Failed to delete template");
  },
};

// ============================================================================
// Mind Map API
// ============================================================================

export interface ThoughtNode {
  id: string;
  type: "thought" | "decision" | "action" | "result" | "question";
  content: string;
  timestamp: number;
  confidence?: number;
  tokens?: number;
  children?: string[];
  parentId?: string;
  status: "pending" | "active" | "completed" | "failed";
  metadata?: Record<string, any>;
}

export interface ReasoningChain {
  id: string;
  taskId: string;
  task: string;
  startTime: number;
  endTime?: number;
  nodes: ThoughtNode[];
  status: "running" | "completed" | "failed";
  totalTokens: number;
  totalThoughts: number;
  userId: string;
}

export const mindMapAPI = {
  /**
   * Get reasoning chains
   */
  async getChains(limit?: number): Promise<ReasoningChain[]> {
    const url = new URL(`${API_BASE}/mindmap/chains`);
    if (limit) url.searchParams.set("limit", limit.toString());
    const response = await fetch(url.toString());
    if (!response.ok) throw new Error("Failed to fetch reasoning chains");
    return response.json();
  },

  /**
   * Get chain details
   */
  async getChain(chainId: string): Promise<ReasoningChain> {
    const response = await fetch(`${API_BASE}/mindmap/chains/${chainId}`);
    if (!response.ok) throw new Error("Failed to fetch chain");
    return response.json();
  },

  /**
   * Export chain as JSON
   */
  async exportChain(chainId: string): Promise<Blob> {
    const response = await fetch(`${API_BASE}/mindmap/chains/${chainId}/export`);
    if (!response.ok) throw new Error("Failed to export chain");
    return response.blob();
  },
};

// ============================================================================
// Orchestration API
// ============================================================================

export interface AgentOption {
  id: string;
  name: string;
  type: "llm" | "tool" | "sandbox" | "orchestrator";
  provider: string;
  model?: string;
  active: boolean;
  priority: number;
  status: "online" | "offline" | "busy" | "error";
  lastActive?: number;
  executions: number;
  successRate: number;
}

export interface OrchestrationMode {
  id: string;
  name: string;
  description: string;
  active: boolean;
  config: Record<string, any>;
  providers: string[];
  features: string[];
}

export interface EventBusEvent {
  id: string;
  type: string;
  timestamp: number;
  source: string;
  target?: string;
  payload: any;
  status: "pending" | "processing" | "completed" | "failed";
  duration?: number;
}

export const orchestrationAPI = {
  /**
   * Get agents
   */
  async getAgents(): Promise<AgentOption[]> {
    const response = await fetch(`${API_BASE}/orchestration/agents`);
    if (!response.ok) throw new Error("Failed to fetch agents");
    return response.json();
  },

  /**
   * Toggle agent
   */
  async toggleAgent(agentId: string): Promise<void> {
    const response = await fetch(`${API_BASE}/orchestration/agents/${agentId}/toggle`, {
      method: "POST",
    });
    if (!response.ok) throw new Error("Failed to toggle agent");
  },

  /**
   * Get orchestration modes
   */
  async getModes(): Promise<OrchestrationMode[]> {
    const response = await fetch(`${API_BASE}/orchestration/modes`);
    if (!response.ok) throw new Error("Failed to fetch modes");
    return response.json();
  },

  /**
   * Activate mode
   */
  async activateMode(modeId: string): Promise<void> {
    const response = await fetch(`${API_BASE}/orchestration/modes/${modeId}/activate`, {
      method: "POST",
    });
    if (!response.ok) throw new Error("Failed to activate mode");
  },

  /**
   * Get event stream (SSE)
   */
  getEventStream(callback: (event: EventBusEvent) => void): () => void {
    const eventSource = new EventSource(`${API_BASE}/orchestration/events`);
    
    eventSource.onmessage = (event) => {
      callback(JSON.parse(event.data));
    };

    return () => eventSource.close();
  },

  /**
   * Export events
   */
  async exportEvents(): Promise<Blob> {
    const response = await fetch(`${API_BASE}/orchestration/events/export`);
    if (!response.ok) throw new Error("Failed to export events");
    return response.blob();
  },
};

// ============================================================================
// Workflows (n8n) API
// ============================================================================

export interface Workflow {
  id: string;
  name: string;
  active: boolean;
  lastRun?: number;
  nextRun?: number;
  trigger: "webhook" | "schedule" | "manual";
  schedule?: string;
  executions: number;
  successRate: number;
  avgDuration: number;
}

export interface WorkflowExecution {
  id: string;
  workflowId: string;
  workflowName: string;
  status: "success" | "error" | "running" | "waiting";
  startTime: number;
  endTime?: number;
  duration?: number;
  trigger: "manual" | "webhook" | "schedule" | "api";
}

export interface WorkflowSettings {
  n8nUrl: string;
  apiKey: string;
  autoRefresh: boolean;
  refreshInterval: number;
  showNotifications: boolean;
  compactMode: boolean;
}

export const workflowsAPI = {
  /**
   * Get workflows
   */
  async getWorkflows(): Promise<Workflow[]> {
    const response = await fetch(`${API_BASE}/workflows`);
    if (!response.ok) throw new Error("Failed to fetch workflows");
    return response.json();
  },

  /**
   * Toggle workflow
   */
  async toggleWorkflow(workflowId: string): Promise<void> {
    const response = await fetch(`${API_BASE}/workflows/${workflowId}/toggle`, {
      method: "POST",
    });
    if (!response.ok) throw new Error("Failed to toggle workflow");
  },

  /**
   * Run workflow
   */
  async runWorkflow(workflowId: string): Promise<void> {
    const response = await fetch(`${API_BASE}/workflows/${workflowId}/run`, {
      method: "POST",
    });
    if (!response.ok) throw new Error("Failed to run workflow");
  },

  /**
   * Get executions
   */
  async getExecutions(workflowId?: string): Promise<WorkflowExecution[]> {
    const url = new URL(`${API_BASE}/workflows/executions`);
    if (workflowId) url.searchParams.set("workflowId", workflowId);
    const response = await fetch(url.toString());
    if (!response.ok) throw new Error("Failed to fetch executions");
    return response.json();
  },

  /**
   * Save settings
   */
  async saveSettings(settings: WorkflowSettings): Promise<void> {
    const response = await fetch(`${API_BASE}/workflows/settings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings),
    });
    if (!response.ok) throw new Error("Failed to save settings");
  },

  /**
   * Get settings
   */
  async getSettings(): Promise<WorkflowSettings> {
    const response = await fetch(`${API_BASE}/workflows/settings`);
    if (!response.ok) throw new Error("Failed to fetch settings");
    return response.json();
  },
};
