"use client";

import React, { createContext, useContext, useState, useCallback } from "react";

export type PanelTab = "explorer" | "chat" | "thinking";

interface PanelContextType {
  isOpen: boolean;
  activeTab: PanelTab;
  togglePanel: () => void;
  openPanel: (tab?: PanelTab) => void;
  closePanel: () => void;
  setTab: (tab: PanelTab) => void;
}

const PanelContext = createContext<PanelContextType | undefined>(undefined);

export function PanelProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<PanelTab>("explorer");

  const togglePanel = useCallback(() => {
    setIsOpen((prev) => !prev);
  }, []);

  const openPanel = useCallback((tab?: PanelTab) => {
    setIsOpen(true);
    if (tab) setActiveTab(tab);
  }, []);

  const closePanel = useCallback(() => {
    setIsOpen(false);
  }, []);

  const setTab = useCallback((tab: PanelTab) => {
    setActiveTab(tab);
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
