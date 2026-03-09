/**
 * Observable Notebook Embed Plugin
 * 
 * Embed Observable notebooks for interactive data visualization and exploration
 * @see https://observablehq.com/
 */

"use client";

import type React from "react";
import { useState, useCallback } from "react";
import { Card, CardContent, CardHeader } from "../ui/card";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { ExternalLink, RefreshCw, BarChart2, Monitor } from "lucide-react";

export interface ObservableEmbedPluginProps {
  onOpenWindow?: (notebookId: string, title: string) => void;
}

export interface ObservableNotebook {
  id: string;
  name: string;
  author: string;
  embedUrl: string;
  viewUrl: string;
}

const ObservableEmbedPlugin: React.FC<ObservableEmbedPluginProps> = ({ onOpenWindow }) => {
  const [notebookUrl, setNotebookUrl] = useState("");
  const [currentNotebook, setCurrentNotebook] = useState<ObservableNotebook | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Extract notebook info from Observable URL
  const extractNotebookInfo = (url: string): { author: string; notebook: string } | null => {
    try {
      const urlObj = new URL(url);
      if (!urlObj.hostname.includes('observablehq.com')) {
        return null;
      }
      
      // For observablehq.com/@author/notebook format
      const pathParts = urlObj.pathname.split('/').filter(Boolean);
      if (pathParts.length >= 2 && pathParts[0].startsWith('@')) {
        return {
          author: pathParts[0].substring(1),
          notebook: pathParts[1],
        };
      }
      return null;
    } catch {
      return null;
    }
  };

  // Load Observable notebook
  const loadNotebook = useCallback(async () => {
    if (!notebookUrl.trim()) {
      setError("Please enter an Observable notebook URL");
      return;
    }

    setIsLoading(true);
    setError(null);

    const info = extractNotebookInfo(notebookUrl.trim());
    
    if (!info) {
      setError("Invalid Observable URL. Please use a URL like https://observablehq.com/@author/notebook");
      setIsLoading(false);
      return;
    }

    try {
      const notebook: ObservableNotebook = {
        id: `${info.author}/${info.notebook}`,
        name: info.notebook,
        author: info.author,
        embedUrl: `https://observablehq.com/embed/@${info.author}/${info.notebook}`,
        viewUrl: `https://observablehq.com/@${info.author}/${info.notebook}`,
      };

      setCurrentNotebook(notebook);
      setIsLoading(false);
    } catch (err) {
      setError("Failed to load Observable notebook. Please check the URL.");
      setIsLoading(false);
    }
  }, [notebookUrl]);

  // Open notebook in new window
  const openInNewWindow = useCallback(() => {
    if (!currentNotebook) return;
    
    const width = 1200;
    const height = 800;
    const left = window.screenX + (window.outerWidth - width) / 2;
    const top = window.screenY + (window.outerHeight - height) / 2;
    
    const newWindow = window.open(
      currentNotebook.viewUrl,
      `observable-${currentNotebook.id}`,
      `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`
    );

    if (newWindow) {
      newWindow.focus();
    }
  }, [currentNotebook]);

  return (
    <Card className="w-full">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BarChart2 className="h-5 w-5 text-blue-600" />
            <h3 className="text-lg font-semibold">Observable Notebook Embed</h3>
          </div>
          <div className="flex items-center gap-2">
            {currentNotebook && (
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
                  onClick={() => setCurrentNotebook(null)}
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
        {!currentNotebook ? (
          <div className="space-y-4">
            <div className="grid gap-2">
              <Label htmlFor="observable-url">Observable Notebook URL</Label>
              <div className="flex gap-2">
                <Input
                  id="observable-url"
                  placeholder="https://observablehq.com/@author/notebook"
                  value={notebookUrl}
                  onChange={(e) => setNotebookUrl(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && loadNotebook()}
                />
                <Button onClick={loadNotebook} disabled={isLoading}>
                  {isLoading ? (
                    <RefreshCw className="h-4 w-4 animate-spin" />
                  ) : (
                    <BarChart3 className="h-4 w-4" />
                  )}
                </Button>
              </div>
              <p className="text-sm text-muted-foreground">
                Embed interactive notebooks with live data visualizations
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
                <li>https://observablehq.com/@d3/learn-d3</li>
                <li>https://observablehq.com/@observablehq/plot-introduction</li>
                <li>https://observablehq.com/@mbostock/shape-chaos</li>
              </ul>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <BarChart2 className="h-4 w-4 text-blue-600" />
                <div>
                  <span className="font-medium">{currentNotebook.name}</span>
                  <span className="text-muted-foreground text-sm ml-2">
                    by @{currentNotebook.author}
                  </span>
                </div>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setCurrentNotebook(null)}>
                Close Notebook
              </Button>
            </div>
            
            {/* Embed iframe */}
            <div className="border rounded-lg overflow-hidden" style={{ height: "700px" }}>
              <iframe
                src={currentNotebook.embedUrl}
                className="w-full h-full"
                title={`Observable Notebook: ${currentNotebook.name}`}
                allow="accelerometer; ambient-light-sensor; camera; encrypted-media; geolocation; gyroscope; microphone; midi; usb; vr; xr-spatial-tracking"
                sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads"
              />
            </div>
            
            <div className="flex gap-2">
              <Button variant="outline" size="sm" asChild>
                <a href={currentNotebook.viewUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="h-4 w-4 mr-2" />
                  Open on Observable
                </a>
              </Button>
              <Button variant="outline" size="sm" asChild>
                <a href={`https://observablehq.com/@${currentNotebook.author}`} target="_blank" rel="noopener noreferrer">
                  View Author Profile
                </a>
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default ObservableEmbedPlugin;
