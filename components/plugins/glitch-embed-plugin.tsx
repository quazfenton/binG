/**
 * Glitch Embed Plugin
 *
 * Embed Glitch projects for live code editing and preview
 * @see https://glitch.com/
 */

"use client";

import type React from "react";
import { useState, useCallback } from "react";
import { Card, CardContent, CardHeader } from "../ui/card";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { ExternalLink, RefreshCw, Code, Monitor } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import useIframeLoader from '@/hooks/use-iframe-loader';
import { IframeUnavailableScreen } from '../ui/iframe-unavailable-screen';

export interface GlitchEmbedPluginProps {
  onOpenWindow?: (projectId: string, title: string) => void;
  onClose?: () => void;
  onResult?: (result: any) => void;
  initialData?: any;
}

export interface GlitchProject {
  id: string;
  name: string;
  description?: string;
  embedUrl: string;
  viewUrl: string;
}

const GlitchEmbedPlugin: React.FC<GlitchEmbedPluginProps> = ({ onOpenWindow }) => {
  const [projectUrl, setProjectUrl] = useState("");
  const [embedMode, setEmbedMode] = useState<"code" | "preview" | "both">("both");
  const [currentProject, setCurrentProject] = useState<GlitchProject | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Use iframe loader hook with fallback
  const {
    isLoading: hookIsLoading,
    isLoaded,
    isFailed,
    failureReason,
    errorMessage,
    retryCount,
    canRetry,
    isUsingFallback,
    fallbackUrl,
    handleLoad,
    handleRetry,
    handleReset,
    handleFallback,
  } = useIframeLoader({
    url: currentProject?.embedUrl || '',
    timeout: 30000,
    maxRetries: 3,
    retryDelay: 5000,
    enableAutoRetry: true,
    enableFallback: true,
    onLoaded: () => {
      setIsLoading(false);
      setError(null);
    },
    onFailed: (reason, error) => {
      setIsLoading(false);
      setError(error || 'Failed to load Glitch project');
    },
  });

  // Extract project name from Glitch URL
  const extractProjectName = (url: string): string | null => {
    try {
      const urlObj = new URL(url);
      if (!urlObj.hostname.endsWith('.glitch.me') && urlObj.hostname !== 'glitch.com') {
        return null;
      }
      // For glitch.com/edit/#!project:name format
      if (urlObj.hostname === 'glitch.com') {
        const hash = urlObj.hash;
        const match = hash.match(/project:([^&]+)/);
        return match ? match[1] : null;
      }
      // For project-name.glitch.me format
      const subdomain = urlObj.hostname.split('.')[0];
      return subdomain !== 'www' ? subdomain : null;
    } catch {
      return null;
    }
  };

  // Load Glitch project
  const loadProject = useCallback(async () => {
    if (!projectUrl.trim()) {
      setError("Please enter a Glitch project URL");
      return;
    }

    setIsLoading(true);
    setError(null);

    const projectName = extractProjectName(projectUrl.trim());
    
    if (!projectName) {
      setError("Invalid Glitch URL. Please use a URL like https://glitch.com/edit/#!project:name or https://name.glitch.me");
      setIsLoading(false);
      return;
    }

    try {
      const project: GlitchProject = {
        id: projectName,
        name: projectName,
        embedUrl: `https://glitch.com/embed/#!/edit/${projectName}`,
        viewUrl: `https://${projectName}.glitch.me`,
      };

      setCurrentProject(project);
      setIsLoading(false);
    } catch (err) {
      setError("Failed to load Glitch project. Please check the URL.");
      setIsLoading(false);
    }
  }, [projectUrl]);

  // Open project in new window
  const openInNewWindow = useCallback(() => {
    if (!currentProject) return;
    
    const width = 1200;
    const height = 800;
    const left = window.screenX + (window.outerWidth - width) / 2;
    const top = window.screenY + (window.outerHeight - height) / 2;
    
    const newWindow = window.open(
      currentProject.embedUrl,
      `glitch-${currentProject.id}`,
      `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`
    );

    if (newWindow) {
      newWindow.focus();
    }
  }, [currentProject]);

  // Get embed height based on mode
  const getEmbedHeight = () => {
    switch (embedMode) {
      case "code":
        return "600px";
      case "preview":
        return "400px";
      case "both":
        return "800px";
      default:
        return "600px";
    }
  };

  return (
    <Card className="w-full">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Code className="h-5 w-5 text-purple-600" />
            <h3 className="text-lg font-semibold">Glitch Project Embed</h3>
          </div>
          <div className="flex items-center gap-2">
            <Select value={embedMode} onValueChange={(v) => setEmbedMode(v as any)}>
              <SelectTrigger className="w-[120px]">
                <SelectValue placeholder="Mode" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="code">Code Only</SelectItem>
                <SelectItem value="preview">Preview Only</SelectItem>
                <SelectItem value="both">Code + Preview</SelectItem>
              </SelectContent>
            </Select>
            {currentProject && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={openInNewWindow}
                  title="Open in new window"
                >
                  <ExternalLink className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setCurrentProject(null)}
                  title="Close"
                >
                  <Monitor className="h-4 w-4" />
                </Button>
              </>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {!currentProject ? (
          <div className="space-y-4">
            <div className="grid gap-2">
              <Label htmlFor="glitch-url">Glitch Project URL</Label>
              <div className="flex gap-2">
                <Input
                  id="glitch-url"
                  placeholder="https://glitch.com/edit/#!project:my-project or https://my-project.glitch.me"
                  value={projectUrl}
                  onChange={(e) => setProjectUrl(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && loadProject()}
                />
                <Button onClick={loadProject} disabled={isLoading}>
                  {isLoading ? (
                    <RefreshCw className="h-4 w-4 animate-spin" />
                  ) : (
                    <Code className="h-4 w-4" />
                  )}
                </Button>
              </div>
              <p className="text-sm text-muted-foreground">
                Enter a Glitch project URL to embed the live editor and preview
              </p>
            </div>
            {error && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-md">
                <p className="text-sm text-red-600">{error}</p>
              </div>
            )}
            <div className="text-sm text-muted-foreground">
              <p className="font-medium mb-2">Examples:</p>
              <ul className="list-disc list-inside space-y-1">
                <li>https://glitch.com/edit/#!project:hello-webapp</li>
                <li>https://hello-webapp.glitch.me</li>
              </ul>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Code className="h-4 w-4 text-purple-600" />
                <span className="font-medium">{currentProject.name}</span>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setCurrentProject(null)}>
                Close Project
              </Button>
            </div>
            
            {/* Embed iframe */}
            <div className="border rounded-lg overflow-hidden" style={{ height: getEmbedHeight() }}>
              {embedMode !== "preview" && (
                isFailed ? (
                  <div className="w-full h-full" style={{ height: embedMode === "both" ? "50%" : "100%" }}>
                    <IframeUnavailableScreen
                      url={currentProject.embedUrl}
                      reason={failureReason || 'failed'}
                      errorMessage={errorMessage || undefined}
                      onRetry={handleRetry}onOpenExternal={() => window.open(currentProject.embedUrl, '_blank', 'noopener,noreferrer')}
                      onClose={() => { setCurrentProject(null); }}
                      autoRetryCount={retryCount}
                      maxRetries={3}
                    />
                  </div>
                ) : (
                  <iframe
                    src={isUsingFallback && fallbackUrl ? fallbackUrl : currentProject.embedUrl}
                    className="w-full h-full"
                    style={{ height: embedMode === "both" ? "50%" : "100%" }}
                    title={`Glitch Project: ${currentProject.name}`}
                    allow="camera; microphone; midi; geolocation; display-capture; encrypted-media; fullscreen"
                    sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
                  />
                )
              )}
              {embedMode === "both" && (
                <>
                  <div className="border-t" />
                  <iframe
                    src={currentProject.viewUrl}
                    className="w-full"
                    style={{ height: "50%" }}
                    title={`Preview: ${currentProject.name}`}
                    sandbox="allow-scripts allow-same-origin allow-forms"
                  />
                </>
              )}
              {embedMode === "preview" && (
                <iframe
                  src={currentProject.viewUrl}
                  className="w-full h-full"
                  title={`Preview: ${currentProject.name}`}
                  sandbox="allow-scripts allow-same-origin allow-forms"
                />
              )}
            </div>
            
            <div className="flex gap-2">
              <Button variant="outline" size="sm" asChild>
                <a href={currentProject.viewUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="h-4 w-4 mr-2" />
                  Open Preview
                </a>
              </Button>
              <Button variant="outline" size="sm" asChild>
                <a href={currentProject.embedUrl} target="_blank" rel="noopener noreferrer">
                  <Code className="h-4 w-4 mr-2" />
                  Open Editor
                </a>
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default GlitchEmbedPlugin;
