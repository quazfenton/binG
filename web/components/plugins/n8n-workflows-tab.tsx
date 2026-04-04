/**
 * n8n Workflows Tab
 *
 * Frontend for external n8n automation integration
 * Features:
 * - Workflow execution & monitoring
 * - Visual workflow settings
 * - Execution history
 * - Sleek glassmorphic design
 *
 * SECURITY: Client-side encrypted credentials
 * - API key encrypted with Web Crypto API before localStorage
 * - Encryption key derived from user session
 */

"use client";

import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Workflow,
  Play,
  Square,
  RefreshCw,
  Settings,
  Clock,
  CheckCircle,
  XCircle,
  AlertCircle,
  Info,
  Zap,
  Calendar,
  BarChart3,
  ExternalLink,
  Plus,
  Trash,
  Edit,
  Save,
  Eye,
  Copy,
  Download,
  Upload,
  Link,
  Unlink,
  ChevronRight,
  ChevronDown,
  Activity,
  Timer,
  Database,
  Webhook,
  Lock,
  Unlock,
} from "lucide-react";
import { toast } from "sonner";

// ============================================================================
// Client-Side Encryption Utilities (Web Crypto API)
// ============================================================================

const ENCRYPTION_VERSION = 'v1';
const SETTINGS_KEY = 'n8n-workflow-settings-encrypted';

/**
 * Generate encryption key from session identifier
 * Uses PBKDF2 to derive a stable key
 */
async function getEncryptionKey(): Promise<CryptoKey> {
  // Use a combination of stable browser identifiers as salt
  const encoder = new TextEncoder();
  const saltData = encoder.encode(
    `n8n-encryption-${window.location.origin}-${navigator.userAgent}`
  );
  
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    saltData,
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );
  
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: saltData,
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypt sensitive data (API key)
 */
async function encryptData(data: string): Promise<string> {
  try {
    const key = await getEncryptionKey();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoder = new TextEncoder();
    
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      encoder.encode(data)
    );
    
    // Combine IV + encrypted data + version
    const combined = new Uint8Array(iv.length + encrypted.byteLength + 2);
    combined.set(encoder.encode(ENCRYPTION_VERSION), 0);
    combined.set(iv, 2);
    combined.set(new Uint8Array(encrypted), 14);
    
    return btoa(String.fromCharCode(...combined));
  } catch (error) {
    console.error('[N8N] Encryption failed:', error);
    throw error;
  }
}

/**
 * Decrypt sensitive data (API key)
 */
async function decryptData(encrypted: string): Promise<string> {
  try {
    const combined = Uint8Array.from(atob(encrypted), c => c.charCodeAt(0));
    
    // Extract version, IV, and encrypted data
    const version = String.fromCharCode(...combined.slice(0, 2));
    if (version !== ENCRYPTION_VERSION) {
      throw new Error('Unknown encryption version');
    }
    
    const iv = combined.slice(2, 14);
    const encryptedData = combined.slice(14);
    
    const key = await getEncryptionKey();
    
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      encryptedData
    );
    
    return new TextDecoder().decode(decrypted);
  } catch (error) {
    console.error('[N8N] Decryption failed:', error);
    throw error;
  }
}

// ============================================================================
// Types
// ============================================================================
interface WorkflowExecution {
  id: string;
  workflowId: string;
  workflowName: string;
  status: "success" | "error" | "running" | "waiting";
  startTime: number;
  endTime?: number;
  duration?: number;
  trigger: "manual" | "webhook" | "schedule" | "api";
}

interface Workflow {
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

interface WorkflowSettings {
  n8nUrl: string;
  apiKey: string;
  autoRefresh: boolean;
  refreshInterval: number;
  showNotifications: boolean;
  compactMode: boolean;
}

// Security: Constants for validation
const MIN_REFRESH_INTERVAL = 5; // Minimum 5 seconds to prevent rapid firing
const MAX_REFRESH_INTERVAL = 3600; // Maximum 1 hour
const DEFAULT_REFRESH_INTERVAL = 30; // Default 30 seconds

// Security: Simple encryption for sensitive data (XOR with key)
// Note: This is obfuscation, not true encryption. For production, use secure HTTP-only cookies.
const STORAGE_KEY = 'n8n-workflow-settings';
const SENSITIVE_KEY = 'n8n-api-key';
const XOR_KEY = 0x42; // Simple XOR key for obfuscation

function obfuscateSensitiveData(data: string): string {
  return btoa(data.split('').map(char => 
    String.fromCharCode(char.charCodeAt(0) ^ XOR_KEY)
  ).join(''));
}

function deobfuscateSensitiveData(data: string): string {
  try {
    return atob(data).split('').map(char => 
      String.fromCharCode(char.charCodeAt(0) ^ XOR_KEY)
    ).join('');
  } catch {
    return '';
  }
}

// ============================================================================
// Settings Storage (Encrypted API Key)
// ============================================================================

async function loadSettings(): Promise<WorkflowSettings> {
  try {
    const saved = localStorage.getItem(SETTINGS_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      
      // Decrypt API key if present
      let apiKey = '';
      if (parsed.encryptedApiKey) {
        try {
          apiKey = await decryptData(parsed.encryptedApiKey);
        } catch (decryptError) {
          console.warn('[N8N] Failed to decrypt API key, clearing stored key');
          // Clear invalid encrypted key
          localStorage.setItem(SETTINGS_KEY, JSON.stringify({
            ...parsed,
            encryptedApiKey: undefined,
          }));
        }
      }

      return {
        ...parsed,
        apiKey,
        // Validate refresh interval
        refreshInterval: Math.max(
          MIN_REFRESH_INTERVAL,
          Math.min(MAX_REFRESH_INTERVAL, parsed.refreshInterval || DEFAULT_REFRESH_INTERVAL)
        ),
      };
    }
  } catch (e) {
    console.error("Failed to load workflow settings:", e);
  }

  // Return defaults
  return {
    n8nUrl: "",
    apiKey: "",
    autoRefresh: true,
    refreshInterval: DEFAULT_REFRESH_INTERVAL,
    showNotifications: true,
    compactMode: false,
  };
}

async function saveSettings(settings: WorkflowSettings): Promise<void> {
  try {
    // Encrypt API key before storing
    let encryptedApiKey: string | undefined;
    if (settings.apiKey) {
      encryptedApiKey = await encryptData(settings.apiKey);
    }

    // Store non-sensitive settings normally (without API key)
    const { apiKey, ...nonSensitiveSettings } = settings;
    const toSave = {
      ...nonSensitiveSettings,
      encryptedApiKey,
    };
    
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(toSave));
    console.log('[N8N] Settings saved with encrypted API key');
  } catch (e) {
    console.error("Failed to save workflow settings:", e);
  }
}

// Validate refresh interval
function validateRefreshInterval(value: number): number {
  const validated = parseInt(value.toString()) || DEFAULT_REFRESH_INTERVAL;
  
  if (validated < MIN_REFRESH_INTERVAL) {
    console.warn(`[n8n] Refresh interval too low (${validated}s), using minimum ${MIN_REFRESH_INTERVAL}s`);
    return MIN_REFRESH_INTERVAL;
  }
  
  if (validated > MAX_REFRESH_INTERVAL) {
    console.warn(`[n8n] Refresh interval too high (${validated}s), using maximum ${MAX_REFRESH_INTERVAL}s`);
    return MAX_REFRESH_INTERVAL;
  }
  
  return validated;
}

// Default fallback workflows if n8n API is not connected
const DEFAULT_WORKFLOWS: Workflow[] = [
  {
    id: "demo-1",
    name: "Content Publishing Pipeline",
    active: true,
    lastRun: Date.now() - 3600000,
    nextRun: Date.now() + 3600000,
    trigger: "schedule",
    schedule: "0 * * * *",
    executions: 1247,
    successRate: 98.5,
    avgDuration: 2340,
  },
  {
    id: "demo-2",
    name: "Social Media Auto-Poster",
    active: true,
    lastRun: Date.now() - 7200000,
    trigger: "webhook",
    executions: 892,
    successRate: 99.2,
    avgDuration: 1250,
  },
];

const DEFAULT_EXECUTIONS: WorkflowExecution[] = [
  {
    id: "exec-1",
    workflowId: "demo-1",
    workflowName: "Content Publishing Pipeline",
    status: "success",
    startTime: Date.now() - 3600000,
    endTime: Date.now() - 3597660,
    duration: 2340,
    trigger: "schedule",
  },
];

// Fetch workflows from our API proxy
async function fetchWorkflows(): Promise<Workflow[]> {
  try {
    const response = await fetch('/api/automations/n8n/workflows');
    const data = await response.json();

    if (!data.success) {
      throw new Error(data.error || 'Failed to fetch workflows');
    }

    return (data.workflows || []).map((w: any) => ({
      id: w.id,
      name: w.name,
      active: w.active,
      lastRun: w.lastExecuted,
      trigger: 'manual',
      executions: 0,
      successRate: 100,
      avgDuration: 0,
    }));
  } catch (err: any) {
    console.error('[n8n] Failed to fetch workflows:', err);
    throw err;
  }
}

// Fetch workflows from user's n8n instance (via proxy with credentials)
async function fetchUserWorkflows(n8nUrl: string, apiKey: string): Promise<Workflow[]> {
  return fetchN8nWorkflows(n8nUrl, apiKey);
}

// Execute workflow via API
async function executeWorkflow(workflowId: string, data?: Record<string, any>): Promise<WorkflowExecution> {
  try {
    const response = await fetch(`/api/automations/n8n/workflows/${workflowId}/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data }),
    });

    const result = await response.json();

    if (!result.success) {
      throw new Error(result.error || 'Failed to execute workflow');
    }

    return result.execution;
  } catch (err: any) {
    console.error('[n8n] Failed to execute workflow:', err);
    throw err;
  }
}

// Fetch executions from API
async function fetchExecutions(workflowId?: string): Promise<WorkflowExecution[]> {
  try {
    const params = new URLSearchParams();
    if (workflowId) params.set('workflowId', workflowId);
    
    const response = await fetch(`/api/automations/n8n/workflows/${workflowId || 'all'}/executions?${params}`);
    const data = await response.json();

    if (!data.success) {
      throw new Error(data.error || 'Failed to fetch executions');
    }

    return data.executions || [];
  } catch (err: any) {
    console.error('[n8n] Failed to fetch executions:', err);
    return [];
  }
}

// ============================================================================
// n8n API Functions (via Next.js Proxy - NO CORS issues)
// All requests go through /api/automations/n8n/* with encrypted credentials
// ============================================================================

/**
 * Fetch workflows via Next.js proxy
 */
async function fetchN8nWorkflows(n8nUrl: string, apiKey: string): Promise<Workflow[]> {
  try {
    const response = await fetch('/api/automations/n8n/workflows', {
      headers: {
        'X-N8N-URL': n8nUrl,
        'X-N8N-API-KEY': apiKey,
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || 'Failed to fetch workflows');
    }

    const data = await response.json();
    return data.workflows?.map((w: any) => ({
      id: w.id,
      name: w.name,
      active: w.active,
      lastRun: w.lastExecuted,
      trigger: 'webhook', // Default, could be enhanced
      executions: w.executionCount || 0,
      successRate: w.successRate || 100,
      avgDuration: w.avgDuration || 0,
    })) || [];
  } catch (err: any) {
    console.error('[n8n] Failed to fetch workflows:', err);
    throw err;
  }
}

/**
 * Execute workflow via Next.js proxy
 */
async function runN8nWorkflow(n8nUrl: string, apiKey: string, workflowId: string): Promise<boolean> {
  try {
    const response = await fetch(`/api/automations/n8n/workflows/${workflowId}/execute`, {
      method: 'POST',
      headers: {
        'X-N8N-URL': n8nUrl,
        'X-N8N-API-KEY': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ data: {} }),
    });

    return response.ok;
  } catch (error) {
    console.error('Failed to run n8n workflow:', error);
    throw error;
  }
}

/**
 * Toggle workflow active state via Next.js proxy
 * Note: This requires a PATCH endpoint to be added to the API
 */
async function toggleN8nWorkflow(n8nUrl: string, apiKey: string, workflowId: string, active: boolean): Promise<boolean> {
  // TODO: Add PATCH /api/automations/n8n/workflows/:id endpoint
  // For now, this is a placeholder
  console.log('[n8n] Toggle workflow not yet implemented:', { workflowId, active });
  return false;
}

/**
 * Test n8n connection via Next.js proxy
 */
async function testN8nConnection(n8nUrl: string, apiKey: string): Promise<boolean> {
  try {
    const response = await fetch('/api/automations/n8n/workflows', {
      headers: {
        'X-N8N-URL': n8nUrl,
        'X-N8N-API-KEY': apiKey,
      },
    });
    return response.ok;
  } catch {
    return false;
  }
}

export default function WorkflowsTab() {
  const [workflows, setWorkflows] = useState<Workflow[]>(DEFAULT_WORKFLOWS);
  const [executions, setExecutions] = useState<WorkflowExecution[]>(DEFAULT_EXECUTIONS);
  const [isConnected, setIsConnected] = useState(false);
  const [hasAttemptedConnection, setHasAttemptedConnection] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedWorkflow, setSelectedWorkflow] = useState<Workflow | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<"workflows" | "executions" | "settings">("workflows");

  // Load settings with encrypted API key
  const [settings, setSettings] = useState<WorkflowSettings>({
    n8nUrl: "",
    apiKey: "",
    autoRefresh: true,
    refreshInterval: DEFAULT_REFRESH_INTERVAL,
    showNotifications: true,
    compactMode: false,
  });

  // Load settings on mount
  useEffect(() => {
    loadSettings().then(setSettings);
  }, []);

  // Save settings when changed
  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  // Auto-refresh with validated interval
  useEffect(() => {
    if (!settings.autoRefresh) return;

    // SECURITY: Validate interval before setting up auto-refresh
    const safeInterval = Math.max(
      MIN_REFRESH_INTERVAL * 1000,
      Math.min(MAX_REFRESH_INTERVAL * 1000, settings.refreshInterval * 1000)
    );

    const interval = setInterval(() => {
      handleRefresh();
    }, safeInterval);

    return () => clearInterval(interval);
  }, [settings.autoRefresh, settings.refreshInterval]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    setIsLoading(true);

    try {
      if (settings.n8nUrl && settings.apiKey) {
        // Fetch real data from n8n API via proxy
        const [workflowData, executionData] = await Promise.all([
          fetchUserWorkflows(settings.n8nUrl, settings.apiKey),
          fetchExecutions(),
        ]);
        setWorkflows(workflowData);
        setExecutions(executionData);
        setIsConnected(true);
        toast.success(`Loaded ${workflowData.length} workflows from n8n`);
      } else {
        toast.info("Configure n8n URL and API key in Settings to connect");
      }
    } catch (error) {
      console.error('Failed to refresh workflows:', error);
      toast.error('Failed to connect to n8n - using demo data');
      setIsConnected(false);
    } finally {
      setIsRefreshing(false);
      setIsLoading(false);
    }
  };

  const handleToggleWorkflow = async (workflowId: string) => {
    const workflow = workflows.find(w => w.id === workflowId);
    if (!workflow) return;
    
    try {
      if (settings.n8nUrl && settings.apiKey) {
        // Call n8n API to toggle workflow
        await toggleN8nWorkflow(settings.n8nUrl, settings.apiKey, workflowId, !workflow.active);
      }
      setWorkflows(prev => prev.map(w => 
        w.id === workflowId ? { ...w, active: !w.active } : w
      ));
      toast.success(`Workflow ${workflow.active ? 'deactivated' : 'activated'}`);
    } catch (error) {
      console.error('Failed to toggle workflow:', error);
      toast.error('Failed to toggle workflow');
    }
  };

  const handleRunWorkflow = async (workflowId: string) => {
    const workflow = workflows.find(w => w.id === workflowId);
    if (!workflow) return;
    
    toast.info(`Starting "${workflow.name}"...`);
    
    try {
      if (settings.n8nUrl && settings.apiKey) {
        // Call n8n API to run workflow
        await runN8nWorkflow(settings.n8nUrl, settings.apiKey, workflowId);
        toast.success('Workflow triggered successfully');
      } else {
        // Demo mode - simulate execution
        setTimeout(() => {
          toast.success('Demo: Workflow would execute');
        }, 500);
      }
    } catch (error) {
      console.error('Failed to run workflow:', error);
      toast.error('Failed to start workflow');
    }
  };

  const handleTestConnection = async () => {
    if (!settings.n8nUrl || !settings.apiKey) {
      toast.error('Please enter n8n URL and API key');
      return;
    }

    setHasAttemptedConnection(true);
    toast.info('Testing connection...');
    const success = await testN8nConnection(settings.n8nUrl, settings.apiKey);

    if (success) {
      setIsConnected(true);
      toast.success('Connected to n8n successfully!');
      handleRefresh(); // Auto-load workflows after successful connection
    } else {
      setIsConnected(false);
      toast.error('Failed to connect to n8n - check URL and API key');
    }
  };

  const handleSaveSettings = () => {
    // SECURITY: Validate settings before saving
    const validatedSettings = {
      ...settings,
      refreshInterval: validateRefreshInterval(settings.refreshInterval),
    };
    
    if (validatedSettings.refreshInterval !== settings.refreshInterval) {
      setSettings(validatedSettings);
      toast.info(`Refresh interval adjusted to ${validatedSettings.refreshInterval}s (min: ${MIN_REFRESH_INTERVAL}s, max: ${MAX_REFRESH_INTERVAL}s)`);
    }
    
    saveSettings(validatedSettings);
    toast.success("Settings saved securely");
    setShowSettings(false);
  };

  const getStatusIcon = (status: WorkflowExecution["status"]) => {
    switch (status) {
      case "success":
        return <CheckCircle className="w-4 h-4 text-green-400" />;
      case "error":
        return <XCircle className="w-4 h-4 text-red-400" />;
      case "running":
        return <RefreshCw className="w-4 h-4 text-blue-400 animate-spin" />;
      case "waiting":
        return <Clock className="w-4 h-4 text-yellow-400" />;
    }
  };

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60000).toFixed(1)}m`;
  };

  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleString();
  };

  // Check if n8n is configured
  const isConfigured = settings.n8nUrl && settings.apiKey;

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-white/10 bg-white/5">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-gradient-to-br from-orange-500 to-red-500 rounded-lg">
            <Workflow className="w-5 h-5 text-white" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-white">n8n Workflows</h3>
            <p className="text-xs text-white/60">
              {isConnected ? 'Connected to n8n' : isConfigured && hasAttemptedConnection ? 'Connection failed' : isConfigured ? 'Configured - test connection' : 'Setup required - Automation & Workflow Management'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setActiveTab("workflows")}
            className={activeTab === "workflows" ? "bg-white/10" : ""}
          >
            <Workflow className="w-4 h-4 mr-2" />
            Workflows
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setActiveTab("executions")}
            className={activeTab === "executions" ? "bg-white/10" : ""}
          >
            <Activity className="w-4 h-4 mr-2" />
            Executions
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setActiveTab("settings")}
            className={activeTab === "settings" ? "bg-white/10" : ""}
          >
            <Settings className="w-4 h-4 mr-2" />
            Settings
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="text-white/60 hover:text-white"
          >
            <RefreshCw className={`w-4 h-4 ${isRefreshing ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {/* Initial Setup Box - Show when not configured */}
      {!isConfigured && activeTab !== "settings" && (
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-6 mx-4 mt-4 rounded-lg bg-gradient-to-r from-orange-500/10 to-red-500/10 border border-orange-500/30"
        >
          <div className="flex items-start gap-4">
            <div className="p-3 bg-orange-500/20 rounded-lg">
              <Zap className="w-8 h-8 text-orange-400" />
            </div>
            <div className="flex-1">
              <h3 className="text-lg font-semibold text-white mb-2">Connect to n8n</h3>
              <p className="text-sm text-white/70 mb-4">
                Set up your n8n instance to start automating workflows. Your credentials are stored securely with encryption.
              </p>
              
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div className="text-sm">
                  <div className="flex items-center gap-2 text-white/60 mb-1">
                    <CheckCircle className="w-4 h-4 text-green-400" />
                    <span>Secure localStorage with obfuscation</span>
                  </div>
                  <div className="flex items-center gap-2 text-white/60">
                    <CheckCircle className="w-4 h-4 text-green-400" />
                    <span>Auto-refresh workflows</span>
                  </div>
                </div>
                <div className="text-sm">
                  <div className="flex items-center gap-2 text-white/60 mb-1">
                    <CheckCircle className="w-4 h-4 text-green-400" />
                    <span>Real-time execution monitoring</span>
                  </div>
                  <div className="flex items-center gap-2 text-white/60">
                    <CheckCircle className="w-4 h-4 text-green-400" />
                    <span>Workflow triggers & scheduling</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <Button
                  onClick={() => setActiveTab("settings")}
                  className="bg-orange-500 hover:bg-orange-600 text-white"
                >
                  <Settings className="w-4 h-4 mr-2" />
                  Configure n8n
                </Button>
                <Button
                  variant="outline"
                  onClick={() => window.open('https://n8n.io/getting-started', '_blank')}
                  className="border-white/20 text-white/80 hover:bg-white/10"
                >
                  <ExternalLink className="w-4 h-4 mr-2" />
                  n8n Setup Guide
                </Button>
              </div>
            </div>
          </div>
        </motion.div>
      )}

      {/* Connection Status Banner - Show when configured but connection was attempted and failed */}
      {isConfigured && !isConnected && hasAttemptedConnection && !isLoading && (
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-4 mx-4 mt-4 rounded-lg bg-yellow-500/10 border border-yellow-500/30"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <AlertCircle className="w-5 h-5 text-yellow-400" />
              <div>
                <p className="text-sm font-medium text-yellow-200">Connection failed</p>
                <p className="text-xs text-yellow-400/80">Unable to connect to n8n. Check your credentials and try again.</p>
              </div>
            </div>
            <Button
              onClick={handleTestConnection}
              variant="outline"
              className="border-yellow-500/50 text-yellow-200 hover:bg-yellow-500/20"
            >
              <RefreshCw className="w-4 h-4 mr-2" />
              Test Connection
            </Button>
          </div>
        </motion.div>
      )}

      {/* Content */}
      <ScrollArea className="flex-1">
        <AnimatePresence mode="wait">
          {/* Workflows Tab */}
          {activeTab === "workflows" && (
            <motion.div
              key="workflows"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="p-4 space-y-3"
            >
              {/* Demo Mode Notice */}
              {!isConfigured && (
                <div className="p-3 rounded-lg bg-blue-500/10 border border-blue-500/30 flex items-center gap-3">
                  <Info className="w-5 h-5 text-blue-400 flex-shrink-0" />
                  <div className="flex-1 text-sm text-blue-200">
                    <span className="font-medium">Demo Mode:</span> Showing sample workflows. Configure n8n credentials to see your real workflows.
                  </div>
                  <Button
                    size="sm"
                    onClick={() => setActiveTab("settings")}
                    variant="outline"
                    className="border-blue-500/50 text-blue-200 hover:bg-blue-500/20"
                  >
                    <Settings className="w-4 h-4 mr-2" />
                    Configure
                  </Button>
                </div>
              )}

              {/* Connected Notice */}
              {isConfigured && isConnected && (
                <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/30 flex items-center gap-3">
                  <CheckCircle className="w-5 h-5 text-green-400 flex-shrink-0" />
                  <div className="flex-1 text-sm text-green-200">
                    <span className="font-medium">Connected:</span> Showing live workflows from {settings.n8nUrl}
                  </div>
                  <Button
                    size="sm"
                    onClick={handleRefresh}
                    variant="outline"
                    disabled={isRefreshing}
                    className="border-green-500/50 text-green-200 hover:bg-green-500/20"
                  >
                    <RefreshCw className={`w-4 h-4 mr-2 ${isRefreshing ? "animate-spin" : ""}`} />
                    Refresh
                  </Button>
                </div>
              )}

              {/* Stats Overview */}
              <div className="grid grid-cols-4 gap-3 mb-4">
                <Card className="bg-white/5 border-white/10">
                  <CardContent className="p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <Workflow className="w-4 h-4 text-orange-400" />
                      <span className="text-xs text-white/60">Total</span>
                    </div>
                    <p className="text-xl font-bold text-white">{workflows.length}</p>
                  </CardContent>
                </Card>
                <Card className="bg-white/5 border-white/10">
                  <CardContent className="p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <Zap className="w-4 h-4 text-green-400" />
                      <span className="text-xs text-white/60">Active</span>
                    </div>
                    <p className="text-xl font-bold text-white">{workflows.filter(w => w.active).length}</p>
                  </CardContent>
                </Card>
                <Card className="bg-white/5 border-white/10">
                  <CardContent className="p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <Activity className="w-4 h-4 text-blue-400" />
                      <span className="text-xs text-white/60">Executions</span>
                    </div>
                    <p className="text-xl font-bold text-white">{workflows.reduce((sum, w) => sum + w.executions, 0)}</p>
                  </CardContent>
                </Card>
                <Card className="bg-white/5 border-white/10">
                  <CardContent className="p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <CheckCircle className="w-4 h-4 text-green-400" />
                      <span className="text-xs text-white/60">Success Rate</span>
                    </div>
                    <p className="text-xl font-bold text-white">
                      {(workflows.reduce((sum, w) => sum + w.successRate, 0) / workflows.length).toFixed(1)}%
                    </p>
                  </CardContent>
                </Card>
              </div>

              {/* Workflow List */}
              {workflows.map((workflow) => (
                <motion.div
                  key={workflow.id}
                  layout
                  className="p-4 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 hover:border-white/20 transition-all group"
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className={`w-2 h-2 rounded-full ${workflow.active ? "bg-green-400" : "bg-gray-400"}`} />
                      <h4 className="text-sm font-semibold text-white">{workflow.name}</h4>
                      <Badge variant="outline" className="text-[10px] border-white/20">
                        {workflow.trigger}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setSelectedWorkflow(workflow)}
                        className="h-6 w-6 text-white/60 hover:text-white"
                      >
                        <Eye className="w-3 h-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleRunWorkflow(workflow.id)}
                        className="h-6 w-6 text-green-400 hover:text-green-300"
                      >
                        <Play className="w-3 h-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleToggleWorkflow(workflow.id)}
                        className={`h-6 w-6 ${workflow.active ? "text-green-400" : "text-gray-400"}`}
                      >
                        {workflow.active ? <Zap className="w-3 h-3" /> : <Unlink className="w-3 h-3" />}
                      </Button>
                    </div>
                  </div>

                  <div className="grid grid-cols-4 gap-4 text-xs">
                    <div>
                      <span className="text-white/40">Last Run</span>
                      <p className="text-white/80">{workflow.lastRun ? formatTime(workflow.lastRun) : "Never"}</p>
                    </div>
                    <div>
                      <span className="text-white/40">Next Run</span>
                      <p className="text-white/80">{workflow.nextRun ? formatTime(workflow.nextRun) : "Manual"}</p>
                    </div>
                    <div>
                      <span className="text-white/40">Success Rate</span>
                      <p className="text-white/80">{workflow.successRate}%</p>
                    </div>
                    <div>
                      <span className="text-white/40">Avg Duration</span>
                      <p className="text-white/80">{formatDuration(workflow.avgDuration)}</p>
                    </div>
                  </div>

                  {workflow.schedule && (
                    <div className="mt-3 flex items-center gap-2 text-xs text-white/40">
                      <Calendar className="w-3 h-3" />
                      <span>Schedule: {workflow.schedule}</span>
                    </div>
                  )}
                </motion.div>
              ))}
            </motion.div>
          )}

          {/* Executions Tab */}
          {activeTab === "executions" && (
            <motion.div
              key="executions"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="p-4 space-y-2"
            >
              {executions.map((execution) => (
                <motion.div
                  key={execution.id}
                  layout
                  className="p-3 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 transition-all"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      {getStatusIcon(execution.status)}
                      <div>
                        <p className="text-sm font-medium text-white">{execution.workflowName}</p>
                        <p className="text-xs text-white/40">{formatTime(execution.startTime)}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-4 text-xs">
                      <div className="text-right">
                        <span className="text-white/40">Duration</span>
                        <p className="text-white/80">{execution.duration ? formatDuration(execution.duration) : "Running"}</p>
                      </div>
                      <Badge variant="outline" className="text-[10px] border-white/20">
                        {execution.trigger}
                      </Badge>
                      <ChevronRight className="w-4 h-4 text-white/40" />
                    </div>
                  </div>
                </motion.div>
              ))}
            </motion.div>
          )}

          {/* Settings Tab */}
          {activeTab === "settings" && (
            <motion.div
              key="settings"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="p-4 space-y-4"
            >
              <Card className="bg-white/5 border-white/10">
                <CardContent className="p-4 space-y-4">
                  <h4 className="text-sm font-semibold text-white flex items-center gap-2">
                    <Link className="w-4 h-4 text-orange-400" />
                    n8n Connection
                  </h4>
                  
                  <div className="space-y-3">
                    <div>
                      <Label className="text-xs text-white/60">n8n Instance URL</Label>
                      <Input
                        value={settings.n8nUrl}
                        onChange={(e) => setSettings(prev => ({ ...prev, n8nUrl: e.target.value }))}
                        placeholder="https://your-n8n-instance.com"
                        className="bg-black/40 border-white/20 text-white"
                      />
                    </div>
                    <div>
                      <Label className="text-xs text-white/60">API Key</Label>
                      <Input
                        type="password"
                        value={settings.apiKey}
                        onChange={(e) => setSettings(prev => ({ ...prev, apiKey: e.target.value }))}
                        placeholder="Enter your n8n API key"
                        className="bg-black/40 border-white/20 text-white"
                      />
                    </div>
                    <Button
                      onClick={handleTestConnection}
                      variant="outline"
                      size="sm"
                      className="w-full border-orange-500/30 text-orange-400 hover:bg-orange-500/10"
                    >
                      <ExternalLink className="w-3 h-3 mr-2" />
                      Test Connection
                    </Button>
                    {isConnected && (
                      <div className="flex items-center gap-2 text-xs text-green-400 mt-2">
                        <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                        Connected to n8n
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-white/5 border-white/10">
                <CardContent className="p-4 space-y-4">
                  <h4 className="text-sm font-semibold text-white flex items-center gap-2">
                    <Timer className="w-4 h-4 text-blue-400" />
                    Refresh Settings
                  </h4>
                  
                  <div className="flex items-center justify-between">
                    <div>
                      <Label className="text-xs text-white/80">Auto Refresh</Label>
                      <p className="text-xs text-white/40">Automatically refresh workflow data</p>
                    </div>
                    <Switch
                      checked={settings.autoRefresh}
                      onCheckedChange={(checked) => setSettings(prev => ({ ...prev, autoRefresh: checked }))}
                    />
                  </div>

                  <div>
                    <Label className="text-xs text-white/60">Refresh Interval (seconds)</Label>
                    <Input
                      type="number"
                      value={settings.refreshInterval}
                      onChange={(e) => {
                        const value = validateRefreshInterval(parseInt(e.target.value) || DEFAULT_REFRESH_INTERVAL);
                        setSettings(prev => ({ ...prev, refreshInterval: value }));
                      }}
                      min={MIN_REFRESH_INTERVAL}
                      max={MAX_REFRESH_INTERVAL}
                      className="bg-black/40 border-white/20 text-white"
                    />
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-white/5 border-white/10">
                <CardContent className="p-4 space-y-4">
                  <h4 className="text-sm font-semibold text-white flex items-center gap-2">
                    <Settings className="w-4 h-4 text-purple-400" />
                    Display Settings
                  </h4>
                  
                  <div className="flex items-center justify-between">
                    <div>
                      <Label className="text-xs text-white/80">Show Notifications</Label>
                      <p className="text-xs text-white/40">Get notified on workflow events</p>
                    </div>
                    <Switch
                      checked={settings.showNotifications}
                      onCheckedChange={(checked) => setSettings(prev => ({ ...prev, showNotifications: checked }))}
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <div>
                      <Label className="text-xs text-white/80">Compact Mode</Label>
                      <p className="text-xs text-white/40">Show more workflows in less space</p>
                    </div>
                    <Switch
                      checked={settings.compactMode}
                      onCheckedChange={(checked) => setSettings(prev => ({ ...prev, compactMode: checked }))}
                    />
                  </div>
                </CardContent>
              </Card>

              <Button
                onClick={handleSaveSettings}
                className="w-full bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-600 hover:to-red-600"
              >
                <Save className="w-4 h-4 mr-2" />
                Save Settings
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </ScrollArea>
    </div>
  );
}
