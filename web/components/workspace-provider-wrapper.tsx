"use client";

/**
 * WorkspaceProviderWrapper - Standalone "use client" component that uses
 * dynamic() with ssr:false to load WorkspaceProvider and WorkspaceIndicator.
 *
 * This is a SEPARATE file from client-providers.tsx to keep ClientProviders'
 * module graph clean during Next.js SSG bundling. In Next.js 16's parallel
 * SSG worker model, keeping each ssr:false dynamic import in its own module
 * boundary prevents React context evaluation order issues that cause
 * "Cannot read properties of null (reading 'useContext')" errors.
 *
 * This component is used only in the (main) route group — it does NOT cascade
 * to desktop/onboarding or embed/* pages, so those pages can still be SSG'd
 * without hitting the context chain.
 */

import { WorkspaceProvider } from "@/contexts/workspace-context";
import { WorkspaceIndicator } from "./workspace-indicator";

export function WorkspaceProviderWrapper({ children }: { children: React.ReactNode }) {
  return (
    <WorkspaceProvider>
      {/* Title bar: drag handle + workspace indicator (desktop only) */}
      <div
        data-tauri-drag-region
        className="h-7 w-full flex-shrink-0 absolute top-0 left-0 z-[10000] pointer-events-auto flex items-center px-3 gap-2"
      >
        <div className="flex-1" />
        <div className="pointer-events-auto" data-tauri-drag-region={false}>
          <WorkspaceIndicator />
        </div>
      </div>
      {children}
    </WorkspaceProvider>
  );
}