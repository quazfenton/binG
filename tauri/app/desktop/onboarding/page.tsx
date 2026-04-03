'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  FolderOpen,
  Terminal,
  Key,
  CheckCircle,
  ChevronRight,
  ChevronLeft,
  Rocket,
  Sparkles,
  Settings,
  Database,
  Cpu,
  Loader2,
  AlertTriangle,
  Info,
} from 'lucide-react';
import { isDesktopMode, getDesktopWorkspaceDir } from '@/lib/utils/desktop-env';
import { tauriInvoke } from '@/lib/tauri/invoke-bridge';
import { createLogger } from '@/lib/utils/logger';

const log = createLogger('DesktopOnboarding');

interface OnboardingData {
  workspaceRoot: string;
  shell: string;
  llmProvider: string;
  apiKey: string;
  useLocalLLM: boolean;
  localLLMUrl: string;
  autoApprove: boolean;
  enableTelemetry: boolean;
}

const STEPS = [
  { id: 'welcome', title: 'Welcome', description: 'Get started with binG Desktop' },
  { id: 'workspace', title: 'Workspace', description: 'Choose your workspace directory' },
  { id: 'shell', title: 'Shell', description: 'Configure your preferred shell' },
  { id: 'api', title: 'API Keys', description: 'Set up your LLM provider' },
  { id: 'complete', title: 'Complete', description: 'Ready to go!' },
];

const SHELL_OPTIONS = [
  { value: 'bash', label: 'Bash', description: 'Default on Linux/macOS' },
  { value: 'zsh', label: 'Zsh', description: 'Enhanced shell for macOS' },
  { value: 'powershell', label: 'PowerShell', description: 'Modern Windows shell' },
  { value: 'cmd', label: 'Command Prompt', description: 'Traditional Windows CLI' },
];

const LLM_PROVIDERS = [
  { value: 'openai', label: 'OpenAI', description: 'GPT-4, GPT-4o' },
  { value: 'anthropic', label: 'Anthropic', description: 'Claude 3.5, Claude 3' },
  { value: 'google', label: 'Google', description: 'Gemini Pro' },
  { value: 'ollama', label: 'Ollama (Local)', description: 'Run LLMs locally' },
];

const DEFAULT_DATA: OnboardingData = {
  workspaceRoot: '',
  shell: 'bash',
  llmProvider: '',
  apiKey: '',
  useLocalLLM: false,
  localLLMUrl: 'http://localhost:11434',
  autoApprove: true,
  enableTelemetry: true,
};

export default function DesktopOnboardingPage() {
  const router = useRouter();
  const [isDesktop, setIsDesktop] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [data, setData] = useState<OnboardingData>(DEFAULT_DATA);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkedExisting, setCheckedExisting] = useState(false);

  useEffect(() => {
    const desktop = isDesktopMode();
    setIsDesktop(desktop);

    if (desktop) {
      checkExistingSetup();
    } else {
      // FIX: Set checkedExisting in non-desktop branch to prevent stuck loading state
      setCheckedExisting(true);
      setLoading(false);
    }
  }, []);

  const checkExistingSetup = async () => {
    try {
      // Check if already configured
      const existingSettings = localStorage.getItem('desktop_settings');
      const hasCompletedOnboarding = localStorage.getItem('onboarding_completed');

      if (existingSettings && hasCompletedOnboarding) {
        // Already set up, redirect to main app
        router.push('/');
        return;
      }

      // Load default workspace
      const workspace = getDesktopWorkspaceDir();
      setData((prev) => ({ ...prev, workspaceRoot: workspace }));
    } catch (err: any) {
      log.error('Failed to check existing setup', err);
    } finally {
      setLoading(false);
      setCheckedExisting(true);
    }
  };

  const isStepValid = (step: number): boolean => {
    switch (step) {
      case 1: // Workspace
        return data.workspaceRoot.trim().length > 0;
      case 2: // Shell
        return data.shell.trim().length > 0;
      case 3: // API
        if (data.useLocalLLM) {
          return data.localLLMUrl.trim().length > 0;
        }
        return data.llmProvider.trim().length > 0 && data.apiKey.trim().length > 0;
      default:
        return true;
    }
  };

  const handleNext = () => {
    // Validate current step before proceeding
    if (!isStepValid(currentStep)) {
      setError('Please fill in all required fields before continuing');
      return;
    }

    if (currentStep < STEPS.length - 1) {
      setCurrentStep((prev) => prev + 1);
      setError(null);
    }
  };

  const handleBack = () => {
    if (currentStep > 0) {
      setCurrentStep((prev) => prev - 1);
    }
  };

  const selectWorkspace = async () => {
    try {
      const result = await tauriInvoke.openDirectoryDialog({
        title: 'Select Workspace Directory',
        defaultPath: data.workspaceRoot || getDesktopWorkspaceDir(),
      });

      if (result && result.path) {
        setData((prev) => ({ ...prev, workspaceRoot: result.path }));
      }
    } catch (err: any) {
      log.error('Failed to select workspace', err);
      setError(err.message);
    }
  };

  const saveAndComplete = async () => {
    setSaving(true);
    setError(null);

    try {
      // Save settings
      const settings = {
        workspaceRoot: data.workspaceRoot,
        shell: data.shell,
        autoApprove: data.autoApprove,
        maxExecutionTime: 120,
        maxMemoryMB: 4096,
        auditEnabled: true,
        llmProvider: data.llmProvider,
        // apiKey intentionally excluded from localStorage; stored via secure Tauri store
        useLocalLLM: data.useLocalLLM,
        localLLMUrl: data.localLLMUrl,
      };

      localStorage.setItem('desktop_settings', JSON.stringify(settings));
      localStorage.setItem('onboarding_completed', 'true');

      // Save API key to secure storage (Tauri store only - no insecure fallbacks)
      if (data.apiKey) {
        const envKey = `${data.llmProvider.toUpperCase()}_API_KEY`;
        try {
          await tauriInvoke.saveSecret(envKey, data.apiKey);
        } catch (err: any) {
          log.error('Failed to save API key to secure storage', err);
          setError('Failed to securely store API key. Please ensure Tauri desktop storage is available and try again.');
          setSaving(false);
          return;
        }
      }

      // Also save to Tauri store if available
      try {
        const { saveSettings } = await import('@/lib/tauri/invoke-bridge');
        const result = await saveSettings(settings);
        if (!result.success) {
          log.warn('Tauri store save failed', result.error);
        }
      } catch {
        // Tauri store not available
      }

      // Navigate to main app
      router.push('/');
    } catch (err: any) {
      log.error('Failed to save settings', err);
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const skipToComplete = () => {
    localStorage.setItem('onboarding_completed', 'true');
    router.push('/');
  };

  if (loading || !checkedExisting) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
        <div className="text-center">
          <Loader2 className="h-12 w-12 animate-spin text-white mx-auto mb-4" />
          <p className="text-slate-400">Loading...</p>
        </div>
      </div>
    );
  }

  if (!isDesktop) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
        <Card className="max-w-md">
          <CardContent className="pt-6">
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Desktop Mode Only</AlertTitle>
              <AlertDescription>
                This onboarding is only available in desktop mode. Please run the app using Tauri.
              </AlertDescription>
            </Alert>
          </CardContent>
        </Card>
      </div>
    );
  }

  const progress = ((currentStep + 1) / STEPS.length) * 100;
  const currentStepData = STEPS[currentStep];

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-4">
      <Card className="max-w-2xl w-full shadow-2xl border-slate-700">
        <CardHeader className="text-center pb-2">
          <div className="flex items-center justify-center gap-2 mb-4">
            <Badge variant="outline" className="bg-green-500/10 text-green-400 border-green-500/30">
              <Rocket className="h-3 w-3 mr-1" />
              Desktop Mode
            </Badge>
          </div>
          <CardTitle className="text-2xl">{currentStepData.title}</CardTitle>
          <CardDescription>{currentStepData.description}</CardDescription>
        </CardHeader>

        <CardContent>
          <Progress value={progress} className="mb-6" />

          {error && (
            <Alert variant="destructive" className="mb-4">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Error</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {/* Step Content */}
          <div className="min-h-[300px]">
            {currentStep === 0 && (
              <WelcomeStep />
            )}

            {currentStep === 1 && (
              <WorkspaceStep
                workspaceRoot={data.workspaceRoot}
                onChange={(value) => setData((prev) => ({ ...prev, workspaceRoot: value }))}
                onSelect={selectWorkspace}
              />
            )}

            {currentStep === 2 && (
              <ShellStep
                shell={data.shell}
                onChange={(value) => setData((prev) => ({ ...prev, shell: value }))}
              />
            )}

            {currentStep === 3 && (
              <APIKeyStep
                llmProvider={data.llmProvider}
                apiKey={data.apiKey}
                useLocalLLM={data.useLocalLLM}
                localLLMUrl={data.localLLMUrl}
                onProviderChange={(value) => setData((prev) => ({ ...prev, llmProvider: value }))}
                onApiKeyChange={(value) => setData((prev) => ({ ...prev, apiKey: value }))}
                onLocalLLMChange={(value) => setData((prev) => ({ ...prev, useLocalLLM: value }))}
                onLocalLLMUrlChange={(value) => setData((prev) => ({ ...prev, localLLMUrl: value }))}
              />
            )}

            {currentStep === 4 && (
              <CompleteStep
                settings={data}
                onComplete={saveAndComplete}
                onSkip={skipToComplete}
                saving={saving}
              />
            )}
          </div>
        </CardContent>

        <CardFooter className="flex justify-between">
          <Button
            variant="outline"
            onClick={handleBack}
            disabled={currentStep === 0}
          >
            <ChevronLeft className="h-4 w-4 mr-2" />
            Back
          </Button>

          {currentStep < STEPS.length - 1 && (
            <Button onClick={handleNext} disabled={!isStepValid(currentStep)}>
              Next
              <ChevronRight className="h-4 w-4 ml-2" />
            </Button>
          )}
        </CardFooter>
      </Card>
    </div>
  );
}

function WelcomeStep() {
  return (
    <div className="space-y-6 text-center py-8">
      <div className="w-20 h-20 mx-auto bg-gradient-to-br from-blue-500 to-purple-600 rounded-2xl flex items-center justify-center">
        <Sparkles className="h-10 w-10 text-white" />
      </div>

      <div>
        <h3 className="text-xl font-semibold mb-2">Welcome to binG Desktop!</h3>
        <p className="text-muted-foreground max-w-md mx-auto">
          Let&apos;s set up your local coding agent environment. This wizard will help you
          configure your workspace, shell, and LLM provider.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-4 max-w-lg mx-auto">
        <div className="p-4 rounded-lg bg-slate-800/50 text-center">
          <FolderOpen className="h-6 w-6 mx-auto mb-2 text-blue-400" />
          <p className="text-sm">Workspace</p>
        </div>
        <div className="p-4 rounded-lg bg-slate-800/50 text-center">
          <Terminal className="h-6 w-6 mx-auto mb-2 text-green-400" />
          <p className="text-sm">Shell</p>
        </div>
        <div className="p-4 rounded-lg bg-slate-800/50 text-center">
          <Key className="h-6 w-6 mx-auto mb-2 text-purple-400" />
          <p className="text-sm">API Keys</p>
        </div>
      </div>

      <Alert className="max-w-md mx-auto bg-blue-500/10 border-blue-500/30">
        <Info className="h-4 w-4" />
        <AlertDescription className="text-sm">
          You can always change these settings later in the Desktop Settings page.
        </AlertDescription>
      </Alert>
    </div>
  );
}

interface WorkspaceStepProps {
  workspaceRoot: string;
  onChange: (value: string) => void;
  onSelect: () => void;
}

function WorkspaceStep({ workspaceRoot, onChange, onSelect }: WorkspaceStepProps) {
  return (
    <div className="space-y-6 py-4">
      <div className="text-center mb-6">
        <div className="w-16 h-16 mx-auto bg-blue-500/20 rounded-full flex items-center justify-center mb-4">
          <FolderOpen className="h-8 w-8 text-blue-400" />
        </div>
        <h3 className="text-lg font-semibold">Choose Your Workspace</h3>
        <p className="text-muted-foreground text-sm">
          This is where your agent will read and write files
        </p>
      </div>

      <div className="space-y-4">
        <div>
          <Label htmlFor="workspace">Workspace Directory</Label>
          <div className="flex gap-2 mt-2">
            <Input
              id="workspace"
              value={workspaceRoot}
              onChange={(e) => onChange(e.target.value)}
              placeholder="Select or enter workspace path"
              className="flex-1"
            />
            <Button variant="outline" onClick={onSelect}>
              Browse
            </Button>
          </div>
        </div>

        <div className="p-4 rounded-lg bg-slate-800/50 text-sm text-muted-foreground">
          <p className="font-medium mb-2 text-foreground">Recommended paths:</p>
          <ul className="list-disc list-inside space-y-1">
            <li>Windows: C:\Users\YourName\Documents\binG-workspaces</li>
            <li>macOS/Linux: ~/binG-workspaces</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

interface ShellStepProps {
  shell: string;
  onChange: (value: string) => void;
}

function ShellStep({ shell, onChange }: ShellStepProps) {
  return (
    <div className="space-y-6 py-4">
      <div className="text-center mb-6">
        <div className="w-16 h-16 mx-auto bg-green-500/20 rounded-full flex items-center justify-center mb-4">
          <Terminal className="h-8 w-8 text-green-400" />
        </div>
        <h3 className="text-lg font-semibold">Select Your Shell</h3>
        <p className="text-muted-foreground text-sm">
          The shell used to execute commands
        </p>
      </div>

      <RadioGroup
        value={shell}
        onValueChange={onChange}
        className="grid grid-cols-2 gap-4"
      >
        {SHELL_OPTIONS.map((option) => (
          <div key={option.value}>
            <RadioGroupItem
              value={option.value}
              id={option.value}
              className="peer sr-only"
            />
            <Label
              htmlFor={option.value}
              className="flex flex-col p-4 rounded-lg border-2 border-slate-700 hover:border-slate-600 cursor-pointer peer-data-[state=checked]:border-green-500 peer-data-[state=checked]:bg-green-500/10 transition-colors"
            >
              <span className="font-medium">{option.label}</span>
              <span className="text-sm text-muted-foreground">{option.description}</span>
            </Label>
          </div>
        ))}
      </RadioGroup>
    </div>
  );
}

interface APIKeyStepProps {
  llmProvider: string;
  apiKey: string;
  useLocalLLM: boolean;
  localLLMUrl: string;
  onProviderChange: (value: string) => void;
  onApiKeyChange: (value: string) => void;
  onLocalLLMChange: (value: boolean) => void;
  onLocalLLMUrlChange: (value: string) => void;
}

function APIKeyStep({
  llmProvider,
  apiKey,
  useLocalLLM,
  localLLMUrl,
  onProviderChange,
  onApiKeyChange,
  onLocalLLMChange,
  onLocalLLMUrlChange,
}: APIKeyStepProps) {
  return (
    <div className="space-y-6 py-4">
      <div className="text-center mb-6">
        <div className="w-16 h-16 mx-auto bg-purple-500/20 rounded-full flex items-center justify-center mb-4">
          <Key className="h-8 w-8 text-purple-400" />
        </div>
        <h3 className="text-lg font-semibold">Set Up LLM Provider</h3>
        <p className="text-muted-foreground text-sm">
          Choose how you want to power your AI agent
        </p>
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between p-4 rounded-lg border border-slate-700">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-orange-500/20 flex items-center justify-center">
              <Database className="h-5 w-5 text-orange-400" />
            </div>
            <div>
              <p className="font-medium">Use Local LLM (Ollama)</p>
              <p className="text-sm text-muted-foreground">Run models locally on your machine</p>
            </div>
          </div>
          <Switch
            checked={useLocalLLM}
            onCheckedChange={onLocalLLMChange}
          />
        </div>

        {useLocalLLM ? (
          <div className="space-y-4 pl-4 border-l-2 border-orange-500/30">
            <div>
              <Label htmlFor="ollama-url">Ollama URL</Label>
              <Input
                id="ollama-url"
                value={localLLMUrl}
                onChange={(e) => onLocalLLMUrlChange(e.target.value)}
                placeholder="http://localhost:11434"
                className="mt-2"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Make sure Ollama is running on your machine
              </p>
            </div>
          </div>
        ) : (
          <>
            <div>
              <Label htmlFor="provider">LLM Provider</Label>
              <Select value={llmProvider} onValueChange={onProviderChange}>
                <SelectTrigger className="mt-2">
                  <SelectValue placeholder="Select a provider" />
                </SelectTrigger>
                <SelectContent>
                  {LLM_PROVIDERS.map((provider) => (
                    <SelectItem key={provider.value} value={provider.value}>
                      <div>
                        <p className="font-medium">{provider.label}</p>
                        <p className="text-xs text-muted-foreground">{provider.description}</p>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {llmProvider && (
              <div>
                <Label htmlFor="api-key">API Key</Label>
                <Input
                  id="api-key"
                  type="password"
                  value={apiKey}
                  onChange={(e) => onApiKeyChange(e.target.value)}
                  placeholder="Enter your API key"
                  className="mt-2"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Your API key is stored locally and never sent to external servers
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

interface CompleteStepProps {
  settings: OnboardingData;
  onComplete: () => void;
  onSkip: () => void;
  saving: boolean;
}

function CompleteStep({ settings, onComplete, onSkip, saving }: CompleteStepProps) {
  return (
    <div className="space-y-6 py-4 text-center">
      <div className="w-20 h-20 mx-auto bg-green-500/20 rounded-full flex items-center justify-center mb-4">
        <CheckCircle className="h-10 w-10 text-green-400" />
      </div>

      <div>
        <h3 className="text-xl font-semibold mb-2">You&apos;re All Set!</h3>
        <p className="text-muted-foreground">
          Your desktop environment is configured and ready to use
        </p>
      </div>

      <div className="text-left bg-slate-800/50 rounded-lg p-4 max-w-md mx-auto">
        <p className="font-medium mb-3 text-foreground">Configuration Summary:</p>
        <ul className="space-y-2 text-sm">
          <li className="flex items-center gap-2">
            <CheckCircle className="h-4 w-4 text-green-400" />
            <span>Workspace: {settings.workspaceRoot || 'Default'}</span>
          </li>
          <li className="flex items-center gap-2">
            <CheckCircle className="h-4 w-4 text-green-400" />
            <span>Shell: {settings.shell}</span>
          </li>
          <li className="flex items-center gap-2">
            <CheckCircle className="h-4 w-4 text-green-400" />
            <span>
              LLM: {settings.useLocalLLM ? 'Ollama (Local)' : settings.llmProvider || 'Not configured'}
            </span>
          </li>
        </ul>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 justify-center">
        <Button size="lg" onClick={onComplete} disabled={saving}>
          {saving ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Saving...
            </>
          ) : (
            <>
              <Rocket className="h-4 w-4 mr-2" />
              Launch binG Desktop
            </>
          )}
        </Button>
        <Button variant="outline" size="lg" onClick={onSkip}>
          Skip for now
        </Button>
      </div>
    </div>
  );
}