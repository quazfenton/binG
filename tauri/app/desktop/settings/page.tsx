'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { FolderOpen, Terminal, Shield, Database, Save, RefreshCw, CheckCircle, AlertTriangle, AlertCircle } from 'lucide-react';
import { isDesktopMode, getDesktopConfig, getDesktopWorkspaceDir } from '@/lib/utils/desktop-env';
import { tauriInvoke } from '@/lib/tauri/invoke-bridge';
import { createLogger } from '@/lib/utils/logger';

const log = createLogger('DesktopSettings');

interface DesktopSettings {
  workspaceRoot: string;
  shell: string;
  autoApprove: boolean;
  maxExecutionTime: number;
  maxMemoryMB: number;
  auditEnabled: boolean;
}

const DEFAULT_SETTINGS: DesktopSettings = {
  workspaceRoot: '',
  shell: 'bash',
  autoApprove: true,
  maxExecutionTime: 120,
  maxMemoryMB: 4096,
  auditEnabled: true,
};

export default function DesktopSettingsPage() {
  const [isDesktop, setIsDesktop] = useState(false);
  const [settings, setSettings] = useState<DesktopSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [systemInfo, setSystemInfo] = useState<any>(null);

  useEffect(() => {
    const desktop = isDesktopMode();
    setIsDesktop(desktop);

    if (desktop) {
      loadSettings();
      loadSystemInfo();
    } else {
      setLoading(false);
    }
  }, []);

  const loadSettings = async () => {
    try {
      // Load from localStorage or Tauri store
      const savedSettings = localStorage.getItem('desktop_settings');
      if (savedSettings) {
        try {
          const parsed = JSON.parse(savedSettings);
          // Validate parsed object structure
          if (typeof parsed !== 'object' || parsed === null) {
            throw new Error('Invalid settings format');
          }
          setSettings({ ...DEFAULT_SETTINGS, ...parsed });
        } catch (parseErr: any) {
          log.error('Malformed settings in localStorage', parseErr);
          setError('Failed to load settings: invalid format');
          setSettings(DEFAULT_SETTINGS);
        }
      } else {
        // Use default workspace
        const workspace = getDesktopWorkspaceDir();
        setSettings((prev) => ({ ...prev, workspaceRoot: workspace }));
      }
    } catch (err: any) {
      log.error('Failed to load settings', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const loadSystemInfo = async () => {
    try {
      const info = await tauriInvoke.getSystemInfo();
      setSystemInfo(info ?? {});
    } catch (err: any) {
      log.error('Failed to load system info', err);
    }
  };

  const saveSettings = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);

    try {
      // Save to localStorage
      localStorage.setItem('desktop_settings', JSON.stringify(settings));

      // Also save to Tauri store if available
      try {
        const tauriResult = await tauriInvoke.saveSettings(settings);
        if (!tauriResult.success) {
          log.warn('Tauri store save failed', tauriResult.error);
          setWarning('Settings saved locally, but failed to sync with desktop store.');
        }
      } catch (tauriErr: any) {
        // Tauri store failed, warn user about partial save
        log.warn('Tauri store save failed', tauriErr);
        setWarning('Settings saved locally, but failed to sync with desktop store.');
      }

      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err: any) {
      log.error('Failed to save settings', err);
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const selectWorkspace = async () => {
    try {
      const result = await tauriInvoke.openDirectoryDialog({
        title: 'Select Workspace Directory',
        defaultPath: settings.workspaceRoot || getDesktopWorkspaceDir(),
      });

      if (result && result.path) {
        setSettings((prev) => ({ ...prev, workspaceRoot: result.path }));
      }
    } catch (err: any) {
      log.error('Failed to select workspace', err);
      setError(err.message);
    }
  };

  if (loading) {
    return (
      <div className="container mx-auto py-8 max-w-4xl">
        <div className="flex items-center justify-center h-64">
          <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  if (!isDesktop) {
    return (
      <div className="container mx-auto py-8 max-w-4xl">
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Desktop Mode Only</AlertTitle>
          <AlertDescription>
            This settings page is only available in desktop mode. Please run the app using Tauri.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8 max-w-4xl">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold">Desktop Settings</h1>
          <p className="text-muted-foreground mt-1">
            Configure your local execution environment
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
            <CheckCircle className="h-3 w-3 mr-1" />
            Desktop Mode
          </Badge>
        </div>
      </div>

      {error && (
        <Alert variant="destructive" className="mb-6">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {warning && (
        <Alert className="mb-6 bg-yellow-50 border-yellow-200 text-yellow-800">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Warning</AlertTitle>
          <AlertDescription>{warning}</AlertDescription>
        </Alert>
      )}

      {saved && (
        <Alert className="mb-6 bg-green-50 border-green-200">
          <CheckCircle className="h-4 w-4" />
          <AlertTitle>Settings Saved</AlertTitle>
          <AlertDescription>Your settings have been saved successfully.</AlertDescription>
        </Alert>
      )}

      <Tabs defaultValue="general" className="w-full">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="execution">Execution</TabsTrigger>
          <TabsTrigger value="security">Security</TabsTrigger>
          <TabsTrigger value="system">System</TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="space-y-6 mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FolderOpen className="h-5 w-5" />
                Workspace
              </CardTitle>
              <CardDescription>
                Configure the default workspace directory for agent operations
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-4">
                <div className="flex-1">
                  <Label htmlFor="workspace">Workspace Directory</Label>
                  <Input
                    id="workspace"
                    value={settings.workspaceRoot}
                    onChange={(e) => setSettings((prev) => ({ ...prev, workspaceRoot: e.target.value }))}
                    placeholder="Select or enter workspace path"
                    className="mt-2"
                  />
                </div>
                <div className="flex items-end">
                  <Button variant="outline" onClick={selectWorkspace} className="mt-2">
                    <FolderOpen className="h-4 w-4 mr-2" />
                    Browse
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Terminal className="h-5 w-5" />
                Shell
              </CardTitle>
              <CardDescription>
                Choose the default shell for command execution
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Select
                value={settings.shell}
                onValueChange={(value) => setSettings((prev) => ({ ...prev, shell: value }))}
              >
                <SelectTrigger className="w-[200px]">
                  <SelectValue placeholder="Select shell" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="bash">Bash</SelectItem>
                  <SelectItem value="zsh">Zsh</SelectItem>
                  <SelectItem value="powershell">PowerShell</SelectItem>
                  <SelectItem value="cmd">Command Prompt</SelectItem>
                </SelectContent>
              </Select>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="execution" className="space-y-6 mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Execution Limits</CardTitle>
              <CardDescription>
                Configure resource limits for agent command execution
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div>
                <Label>Max Execution Time: {settings.maxExecutionTime}s</Label>
                <Slider
                  value={[settings.maxExecutionTime]}
                  onValueChange={([value]) => setSettings((prev) => ({ ...prev, maxExecutionTime: value }))}
                  min={30}
                  max={300}
                  step={10}
                  className="mt-3"
                />
                <div className="flex justify-between text-xs text-muted-foreground mt-1">
                  <span>30s</span>
                  <span>5min</span>
                </div>
              </div>

              <Separator />

              <div>
                <Label>Max Memory: {settings.maxMemoryMB}MB</Label>
                <Slider
                  value={[settings.maxMemoryMB]}
                  onValueChange={([value]) => setSettings((prev) => ({ ...prev, maxMemoryMB: value }))}
                  min={1024}
                  max={16384}
                  step={512}
                  className="mt-3"
                />
                <div className="flex justify-between text-xs text-muted-foreground mt-1">
                  <span>1GB</span>
                  <span>16GB</span>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Approval Workflow</CardTitle>
              <CardDescription>
                Configure how agent commands are approved for execution
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div>
                  <Label>Auto-Approve Commands</Label>
                  <p className="text-sm text-muted-foreground">
                    Automatically approve safe commands without user confirmation
                  </p>
                </div>
                <Switch
                  checked={settings.autoApprove}
                  onCheckedChange={(checked) => setSettings((prev) => ({ ...prev, autoApprove: checked }))}
                />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="security" className="space-y-6 mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="h-5 w-5" />
                Security Policy
              </CardTitle>
              <CardDescription>
                Configure security restrictions for desktop execution
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <Label>Command Audit Logging</Label>
                  <p className="text-sm text-muted-foreground">
                    Log all executed commands for security review
                  </p>
                </div>
                <Switch
                  checked={settings.auditEnabled}
                  onCheckedChange={(checked) => setSettings((prev) => ({ ...prev, auditEnabled: checked }))}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Blocked Commands</CardTitle>
              <CardDescription>
                Commands that are always blocked in desktop mode
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {['rm -rf /', 'mkfs', ':(){:|:&};:', 'dd if=/dev/zero of=/dev/sda'].map((cmd) => (
                  <div key={cmd} className="flex items-center gap-2 p-2 bg-muted rounded text-sm font-mono">
                    <AlertTriangle className="h-4 w-4 text-red-500" />
                    {cmd}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="system" className="space-y-6 mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Database className="h-5 w-5" />
                System Information
              </CardTitle>
              <CardDescription>
                Current system configuration and resources
              </CardDescription>
            </CardHeader>
            <CardContent>
              {systemInfo ? (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-muted-foreground">Platform</Label>
                    <p className="font-medium">{systemInfo.platform}</p>
                  </div>
                  <div>
                    <Label className="text-muted-foreground">Architecture</Label>
                    <p className="font-medium">{systemInfo.arch}</p>
                  </div>
                  <div>
                    <Label className="text-muted-foreground">CPU Count</Label>
                    <p className="font-medium">{systemInfo.cpuCount}</p>
                  </div>
                  <div>
                    <Label className="text-muted-foreground">Total Memory</Label>
                    <p className="font-medium">
                      {typeof systemInfo.totalMemory === 'number'
                        ? `${Math.round(systemInfo.totalMemory / 1024 / 1024 / 1024)}GB`
                        : 'Unknown'}
                    </p>
                  </div>
                  <div>
                    <Label className="text-muted-foreground">Home Directory</Label>
                    <p className="font-medium text-sm truncate">{systemInfo.homeDir}</p>
                  </div>
                  <div>
                    <Label className="text-muted-foreground">Temp Directory</Label>
                    <p className="font-medium text-sm truncate">{systemInfo.tempDir}</p>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  Loading system information...
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <div className="flex justify-end gap-4 mt-8">
        <Button variant="outline" onClick={loadSettings}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Reset
        </Button>
        <Button onClick={saveSettings} disabled={saving}>
          {saving ? (
            <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Save className="h-4 w-4 mr-2" />
          )}
          Save Settings
        </Button>
      </div>
    </div>
  );
}