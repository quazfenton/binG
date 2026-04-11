"use client";

import React, { createContext, useContext, useState, useCallback } from "react";

export type PanelTab = "explorer" | "chat" | "thinking" | "music" | "automations" | "youtube" | "forum" | "agent" | "compare" | "integrations" | "git" | "voice" | "remote" | "news" | "cronjobs" | "frontier-feed" | "command-deck" | "mcp-servers";

export type TopPanelTab =
  | "news"
  | "plugins"
  | "marketplace"
  | "workflows"
  | "orchestration"
  | "art-gallery"
  | "mind-map"
  | "prompt-lab"
  | "music"
  | "music-hub"
  | "immersive"
  | "flow"
  | "events"
  | "bookmarks"
  | "code-playground"
  | "monaco-editor"
  | "broadway-deal-hunter"
  | "model-comparison"
  | "zine-display"
  | "mcp"
  | "movies";

interface PanelContextType {
  isOpen: boolean;
  activeTab: PanelTab;
  togglePanel: () => void;
  openPanel: (tab?: PanelTab) => void;
  closePanel: () => void;
  setTab: (tab: PanelTab) => void;
  
  // Top panel state
  isTopPanelOpen: boolean;
  isTopPanelHovering: boolean;
  topPanelActiveTab: TopPanelTab;
  toggleTopPanel: () => void;
  openTopPanel: (tab?: TopPanelTab) => void;
  closeTopPanel: () => void;
  setTopPanelTab: (tab: TopPanelTab) => void;
  setTopPanelHovering: (hovering: boolean) => void;
  
  // Monaco editor state
  monacoFilePath: string | null;
  openMonacoEditor: (filePath: string) => void;
  closeMonacoEditor: () => void;
}

const PanelContext = createContext<PanelContextType | undefined>(undefined);

export function PanelProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<PanelTab>("explorer");
  
  // Top panel state
  const [isTopPanelOpen, setIsTopPanelOpen] = useState(false);
  const [isTopPanelHovering, setIsTopPanelHovering] = useState(false);
  const [topPanelActiveTab, setTopPanelActiveTab] = useState<TopPanelTab>("news");

  const togglePanel = useCallback(() => {
    // Close top panel when opening side panel (mutual exclusivity)
    if (!isOpen) {
      setIsTopPanelOpen(false);
    }
    setIsOpen((prev) => !prev);
  }, [isOpen]);

  const openPanel = useCallback((tab?: PanelTab) => {
    // Close top panel when opening side panel (mutual exclusivity)
    setIsTopPanelOpen(false);
    setIsOpen(true);
    if (tab) setActiveTab(tab);
  }, []);

  const closePanel = useCallback(() => {
    setIsOpen(false);
  }, []);

  const setTab = useCallback((tab: PanelTab) => {
    setActiveTab(tab);
  }, []);
  
  // Top panel functions
  const toggleTopPanel = useCallback(() => {
    // Close side panel when opening top panel (mutual exclusivity)
    if (!isTopPanelOpen) {
      setIsOpen(false);
    }
    setIsTopPanelOpen((prev) => !prev);
  }, [isTopPanelOpen]);

  const openTopPanel = useCallback((tab?: TopPanelTab) => {
    // Close side panel when opening top panel (mutual exclusivity)
    setIsOpen(false);
    setIsTopPanelOpen(true);
    if (tab) setTopPanelActiveTab(tab);
  }, []);

  const closeTopPanel = useCallback(() => {
    setIsTopPanelOpen(false);
  }, []);

  const setTopPanelTab = useCallback((tab: TopPanelTab) => {
    setTopPanelActiveTab(tab);
  }, []);

  const setTopPanelHovering = useCallback((hovering: boolean) => {
    setIsTopPanelHovering(hovering);
  }, []);

  // Monaco editor state
  const [monacoFilePath, setMonacoFilePath] = useState<string | null>(null);

  const openMonacoEditor = useCallback((filePath: string) => {
    setMonacoFilePath(filePath);
    // Open top panel and switch to monaco-editor tab
    setIsTopPanelOpen(true);
    setTopPanelActiveTab("monaco-editor");
  }, [setTopPanelActiveTab]);

  const closeMonacoEditor = useCallback(() => {
    setMonacoFilePath(null);
  }, []);

  return (
    <PanelContext.Provider
      value={{
        isOpen,
        activeTab,
        togglePanel,
        openPanel,
        closePanel,
        setTab,
        isTopPanelOpen,
        isTopPanelHovering,
        topPanelActiveTab,
        toggleTopPanel,
        openTopPanel,
        closeTopPanel,
        setTopPanelTab,
        setTopPanelHovering,
        monacoFilePath,
        openMonacoEditor,
        closeMonacoEditor,
      }}
    >
      {children}
    </PanelContext.Provider>
  );
}

export function usePanel() {
  const context = useContext(PanelContext);
  if (context === undefined) {
    throw new Error("usePanel must be used within a PanelProvider");
  }
  return context;
}
