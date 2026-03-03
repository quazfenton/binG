"use client";

/**
 * pages/visual-editor.tsx
 *
 * Entry point for the Visual Editor page.
 * - Reads project data from localStorage ("visualEditorProject") injected by CodePreviewPanel
 * - On save, writes changed files back via the VFS bridge (postMessage → opener or BroadcastChannel)
 * - On "Return to project", closes tab and signals the opener to reload its VFS state
 */

import React, { useEffect, useState, useCallback } from "react";
import Head from "next/head";
import { VisualEditorMain } from "../../components/visual_editor";

// ── Types ────────────────────────────────────────────────────────────────────

export interface ProjectFile {
  content: string;
  language?: string;
}

export interface VFSProject {
  name: string;
  filesystemScopePath: string; // e.g. "project/sessions/draft-chat_xyz"
  framework: string;
  files: Record<string, string>; // relative path → content
  dependencies?: string[];
  devDependencies?: string[];
  scripts?: Record<string, string>;
  bundler?: string;
  packageManager?: string;
}

// ── BroadcastChannel key used by CodePreviewPanel to listen for saves ────────
const VFS_SAVE_CHANNEL = "visual_editor_vfs_save";

// ── Page ─────────────────────────────────────────────────────────────────────

export default function VisualEditorPage() {
  const [project, setProject] = useState<VFSProject | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saved" | "error">("idle");

  // ── Load project from localStorage on mount ──────────────────────────────
  useEffect(() => {
    try {
      const raw = localStorage.getItem("visualEditorProject");
      if (!raw) {
        setLoadError("No project data found. Please open this editor from the Code Preview panel.");
        return;
      }
      const parsed = JSON.parse(raw) as VFSProject;
      // Normalise: files values must be plain strings
      const normalisedFiles: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed.files ?? {})) {
        normalisedFiles[k] = typeof v === "string" ? v : (v as any)?.content ?? "";
      }
      setProject({ ...parsed, files: normalisedFiles });
    } catch (err) {
      setLoadError(`Failed to parse project: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, []);

  // ── Save handler: write changes back via BroadcastChannel + opener ────────
  const handleSave = useCallback(
    async (updatedFiles: Record<string, string>) => {
      if (!project) return;

      setIsSaving(true);
      setSaveStatus("idle");

      try {
        const payload = {
          type: "VFS_SAVE",
          filesystemScopePath: project.filesystemScopePath ?? "project",
          files: updatedFiles,
          timestamp: Date.now(),
        };

        // 1. BroadcastChannel — lets any same-origin tab pick this up
        try {
          const bc = new BroadcastChannel(VFS_SAVE_CHANNEL);
          bc.postMessage(payload);
          bc.close();
        } catch (_) {
          // BroadcastChannel not available in all envs — fall through
        }

        // 2. window.opener.postMessage — direct bridge if opened as popup/tab
        try {
          if (window.opener && !window.opener.closed) {
            window.opener.postMessage(payload, window.location.origin);
          }
        } catch (_) {}

        // 3. Persist updated project in localStorage so next open is fresh
        const updatedProject: VFSProject = { ...project, files: updatedFiles };
        localStorage.setItem("visualEditorProject", JSON.stringify(updatedProject));

        setProject(updatedProject);
        setSaveStatus("saved");

        // Reset status badge after 3s
        setTimeout(() => setSaveStatus("idle"), 3000);
      } catch (err) {
        console.error("Save failed", err);
        setSaveStatus("error");
      } finally {
        setIsSaving(false);
      }
    },
    [project]
  );

  // ── Return to project ─────────────────────────────────────────────────────
  const handleReturn = useCallback(() => {
    // Signal opener to refresh
    try {
      if (window.opener && !window.opener.closed) {
        window.opener.postMessage(
          { type: "VFS_EDITOR_CLOSED", timestamp: Date.now() },
          window.location.origin
        );
      }
    } catch (_) {}

    // Try close; fallback to history.back
    if (window.opener) {
      window.close();
    } else {
      window.history.back();
    }
  }, []);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      <Head>
        <title>
          {project ? `Visual Editor — ${project.name ?? "Untitled"}` : "Visual Editor"}
        </title>
        <meta name="robots" content="noindex" />
        <link
          href="https://fonts.googleapis.com/css2?family=DM+Mono:ital,wght@0,300;0,400;0,500;1,300&family=Syne:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
      </Head>

      {loadError ? (
        <div className="h-screen w-screen bg-[#070b0f] flex items-center justify-center">
          <div className="max-w-md text-center space-y-4 px-8">
            <div className="w-16 h-16 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto">
              <svg className="w-8 h-8 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
              </svg>
            </div>
            <h1 className="text-xl font-semibold text-white" style={{ fontFamily: "Syne, sans-serif" }}>
              Cannot load project
            </h1>
            <p className="text-sm text-[#8b949e]">{loadError}</p>
            <button
              onClick={() => window.close()}
              className="px-4 py-2 bg-[#21262d] hover:bg-[#30363d] text-white text-sm rounded-lg transition-colors border border-[#30363d]"
            >
              Close tab
            </button>
          </div>
        </div>
      ) : !project ? (
        <div className="h-screen w-screen bg-[#070b0f] flex items-center justify-center">
          <div className="flex flex-col items-center gap-4">
            <div className="w-8 h-8 border-2 border-[#3b82f6] border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-[#8b949e]">Loading project…</p>
          </div>
        </div>
      ) : (
        <VisualEditorMain
          project={project}
          onSave={handleSave}
          onReturn={handleReturn}
          isSaving={isSaving}
          saveStatus={saveStatus}
        />
      )}
    </>
  );
}
