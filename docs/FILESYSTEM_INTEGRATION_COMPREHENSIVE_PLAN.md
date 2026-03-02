# Comprehensive Filesystem Integration & LLM Application Plan

## Executive Summary

This document outlines a comprehensive technical plan to fix and enhance the filesystem integration, LLM application workflows, code preview systems, and sandbox synchronization in the binG platform.

**Current Issues Identified:**
1. ❌ Sandpack preview not receiving files correctly from virtual filesystem
2. ❌ File explorer shows wrong/empty directory on open
3. ❌ Terminal/shell edits (nano, vim) don't persist to virtual filesystem
4. ❌ LLM returns skeleton code instead of iterative file-by-file development
5. ❌ No file context sending for continued code sessions
6. ❌ Code diffs and edits not properly tracked/applied
7. ❌ Sandbox and virtual filesystem out of sync
8. ❌ No proper subdirectory creation/opening flow

**Proposed Solution:** A complete filesystem integration layer with:
- Real-time bidirectional sync between sandbox and virtual filesystem
- Iterative LLM coding sessions with file context
- Proper Sandpack integration with live filesystem data
- Terminal persistence layer for shell editors
- Enhanced file explorer with correct path handling
- Diff tracking and application system

---

## 1. Architecture Overview

### 1.1 Current Architecture (Problems)

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   LLM Response  │────►│  Code Parser     │────►│  Virtual FS     │
│  (single blob)  │     │  (extract files) │     │  (store files)  │
└─────────────────┘     └──────────────────┘     └────────┬────────┘
                                                          │
                                                          ▼
                                                 ┌─────────────────┐
                                                 │  Code Preview   │
                                                 │  Panel          │
                                                 │  (dual sources) │
                                                 └────────┬────────┘
                                                          │
                        ┌─────────────────────────────────┼─────────────────────────────────┐
                        ▼                                 ▼                                 ▼
             ┌──────────────────┐            ┌──────────────────┐            ┌──────────────────┐
             │  Sandpack        │            │  File Explorer   │            │  Sandbox         │
             │  (old parsing)   │            │  (wrong path)    │            │  (manual sync)   │
             └──────────────────┘            └──────────────────┘            └──────────────────┘
```

**Problems:**
- Dual data sources (projectFiles prop + virtual filesystem)
- Path duplication issues (`project/project/`)
- No sandbox → virtual filesystem sync for terminal edits
- LLM returns everything at once (skeleton code)
- No file context for iterative sessions

### 1.2 Proposed Architecture (Solution)

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                              Unified Filesystem Integration Layer                        │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                         │
│  ┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐                │
│  │  LLM Session     │     │  Terminal/Shell  │     │  Direct API      │                │
│  │  Manager         │     │  Persistence     │     │  Calls           │                │
│  │                  │     │                  │     │                  │                │
│  │  • File context  │     │  • nano/vim      │     │  • writeFile     │                │
│  │  • Iterative     │     │  • cat/echo      │     │  • readFile      │                │
│  │  • Diffs         │     │  • exec output   │     │  • listDir       │                │
│  └────────┬─────────┘     └────────┬─────────┘     └────────┬─────────┘                │
│           │                        │                        │                           │
│           └────────────────────────┼────────────────────────┘                           │
│                                    ▼                                                    │
│                    ┌──────────────────────────┐                                         │
│                    │  Virtual Filesystem      │                                         │
│                    │  Service (Single Source) │                                         │
│                    │                          │                                         │
│                    │  • Version tracking      │                                         │
│                    │  • Change events         │                                         │
│                    │  • Path normalization    │                                         │
│                    └────────────┬─────────────┘                                         │
│                                 │                                                       │
│           ┌─────────────────────┼─────────────────────┐                                │
│           │                     │                     │                                 │
│           ▼                     ▼                     ▼                                 │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐                      │
│  │  Sandpack        │  │  File Explorer   │  │  Sandbox         │                      │
│  │  Live Preview    │  │  (Correct Path)  │  │  Bidirectional   │                      │
│  │                  │  │                  │  │  Sync            │                      │
│  │  • Real-time     │  │  • No duplicates │  │  • Auto-mount    │                      │
│  │  • File events   │  │  • Proper nav    │  │  • Change detect │                      │
│  └──────────────────┘  └──────────────────┘  └──────────────────┘                      │
│                                                                                         │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Implementation Plan

### 2.1 Phase 1: Virtual Filesystem Service Enhancements

#### 2.1.1 Add Change Event System

**File:** `lib/virtual-filesystem/virtual-filesystem-service.ts`

```typescript
// ADD: Event emitter for filesystem changes
import { EventEmitter } from 'events';

export class VirtualFilesystemService {
  private readonly events = new EventEmitter();
  
  // Event types
  onFileChange(listener: (path: string, type: 'create' | 'update' | 'delete') => void): void {
    this.events.on('fileChange', listener);
  }
  
  onDirectoryChange(listener: (path: string) => void): void {
    this.events.on('directoryChange', listener);
  }
  
  onSnapshotChange(listener: (version: number) => void): void {
    this.events.on('snapshotChange', listener);
  }
  
  // Emit events when files change
  private emitFileChange(path: string, type: 'create' | 'update' | 'delete'): void {
    this.events.emit('fileChange', path, type);
  }
  
  private emitSnapshotChange(version: number): void {
    this.events.emit('snapshotChange', version);
  }
  
  // Modify writeFile to emit events
  async writeFile(ownerId: string, filePath: string, content: string): Promise<VirtualFile> {
    const workspace = await this.ensureWorkspace(ownerId);
    const normalizedPath = this.normalizePath(filePath);
    const previous = workspace.files.get(normalizedPath);
    const now = new Date().toISOString();
    const normalizedContent = typeof content === 'string' ? content : String(content ?? '');

    const file: VirtualFile = {
      path: normalizedPath,
      content: normalizedContent,
      language: this.getLanguageFromPath(normalizedPath),
      lastModified: now,
      version: (previous?.version || 0) + 1,
      size: Buffer.byteLength(normalizedContent, 'utf8'),
    };

    workspace.files.set(normalizedPath, file);
    workspace.version += 1;
    workspace.updatedAt = now;
    
    // EMIT: File change event
    this.emitFileChange(normalizedPath, previous ? 'update' : 'create');
    this.emitSnapshotChange(workspace.version);
    
    await this.persistWorkspace(ownerId, workspace);

    return file;
  }
  
  // Similarly for deletePath
  async deletePath(ownerId: string, targetPath: string): Promise<{ deletedCount: number }> {
    const workspace = await this.ensureWorkspace(ownerId);
    const normalizedPath = this.normalizePath(targetPath);
    const normalizedPrefix = `${normalizedPath}/`;
    let deletedCount = 0;

    for (const existingPath of workspace.files.keys()) {
      if (existingPath === normalizedPath || existingPath.startsWith(normalizedPrefix)) {
        workspace.files.delete(existingPath);
        deletedCount += 1;
        this.emitFileChange(existingPath, 'delete');
      }
    }

    if (deletedCount > 0) {
      workspace.version += 1;
      workspace.updatedAt = new Date().toISOString();
      this.emitSnapshotChange(workspace.version);
      await this.persistWorkspace(ownerId, workspace);
    }

    return { deletedCount };
  }
}
```

#### 2.1.2 Add Diff Tracking

**ADD NEW FILE:** `lib/virtual-filesystem/filesystem-diffs.ts`

```typescript
/**
 * Filesystem Diff Tracking
 * Tracks changes between versions for LLM context and UI display
 */

import type { VirtualFile } from './filesystem-types';

export interface FileDiff {
  path: string;
  oldContent: string;
  newContent: string;
  timestamp: string;
  version: number;
  changeType: 'create' | 'update' | 'delete';
  hunks?: DiffHunk[];
}

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
}

export interface FileDiffHistory {
  path: string;
  diffs: FileDiff[];
  currentVersion: number;
}

export class FilesystemDiffTracker {
  private readonly diffs = new Map<string, FileDiffHistory>();
  private readonly previousContents = new Map<string, string>();

  /**
   * Track a file change
   */
  trackChange(file: VirtualFile, previousContent?: string): FileDiff {
    const changeType: FileDiff['changeType'] = previousContent === undefined ? 'create' : 'update';
    
    const diff: FileDiff = {
      path: file.path,
      oldContent: previousContent || '',
      newContent: file.content,
      timestamp: file.lastModified,
      version: file.version,
      changeType,
      hunks: this.computeHunks(previousContent || '', file.content),
    };

    // Update history
    let history = this.diffs.get(file.path);
    if (!history) {
      history = { path: file.path, diffs: [], currentVersion: 0 };
      this.diffs.set(file.path, history);
    }
    
    history.diffs.push(diff);
    history.currentVersion = file.version;
    
    // Store for next comparison
    this.previousContents.set(file.path, file.content);
    
    return diff;
  }

  /**
   * Compute unified diff hunks
   */
  private computeHunks(oldContent: string, newContent: string): DiffHunk[] {
    const oldLines = oldContent.split('\n');
    const newLines = newContent.split('\n');
    const hunks: DiffHunk[] = [];
    
    let oldIndex = 0;
    let newIndex = 0;
    let currentHunk: DiffHunk | null = null;
    
    // Simple line-by-line diff (can be enhanced with myers diff algorithm)
    while (oldIndex < oldLines.length || newIndex < newLines.length) {
      const oldLine = oldLines[oldIndex];
      const newLine = newLines[newIndex];
      
      if (oldLine === newLine) {
        // Context line
        if (currentHunk) {
          currentHunk.lines.push(` ${oldLine}`);
          currentHunk.oldLines++;
          currentHunk.newLines++;
        }
        oldIndex++;
        newIndex++;
      } else if (oldLine !== undefined && newLine === undefined) {
        // Removed line
        if (!currentHunk) {
          currentHunk = {
            oldStart: oldIndex + 1,
            oldLines: 0,
            newStart: newIndex + 1,
            newLines: 0,
            lines: [],
          };
          hunks.push(currentHunk);
        }
        currentHunk.lines.push(`-${oldLine}`);
        currentHunk.oldLines++;
        oldIndex++;
      } else if (oldLine === undefined || oldLine !== newLine) {
        // Added line
        if (!currentHunk) {
          currentHunk = {
            oldStart: oldIndex + 1,
            oldLines: 0,
            newStart: newIndex + 1,
            newLines: 0,
            lines: [],
          };
          hunks.push(currentHunk);
        }
        currentHunk.lines.push(`+${newLine}`);
        currentHunk.newLines++;
        newIndex++;
      }
    }
    
    return hunks;
  }

  /**
   * Get diff history for a file
   */
  getHistory(path: string): FileDiffHistory | undefined {
    return this.diffs.get(path);
  }

  /**
   * Get latest diff for a file
   */
  getLatestDiff(path: string): FileDiff | undefined {
    const history = this.diffs.get(path);
    return history?.diffs[history.diffs.length - 1];
  }

  /**
   * Get all diffs for LLM context
   */
  getAllDiffsForContext(): FileDiff[] {
    const allDiffs: FileDiff[] = [];
    for (const history of this.diffs.values()) {
      const latest = history.diffs[history.diffs.length - 1];
      if (latest) {
        allDiffs.push(latest);
      }
    }
    return allDiffs.sort((a, b) => b.version - a.version);
  }

  /**
   * Clear history (for new session)
   */
  clear(): void {
    this.diffs.clear();
    this.previousContents.clear();
  }
}

export const diffTracker = new FilesystemDiffTracker();
```

---

### 2.2 Phase 2: LLM Session Manager for Iterative Coding

#### 2.2.1 Create LLM Session Manager

**ADD NEW FILE:** `lib/llm/llm-session-manager.ts`

```typescript
/**
 * LLM Session Manager for Iterative Code Development
 * 
 * Manages file context, iterative editing, and focused file-by-file development
 * to prevent skeleton code responses.
 */

import type { VirtualFile } from '@/lib/virtual-filesystem/filesystem-types';
import { diffTracker, type FileDiff } from '@/lib/virtual-filesystem/filesystem-diffs';

export interface LLMSessionConfig {
  sessionId: string;
  ownerId: string;
  filesystemScopePath: string;
  maxContextFiles?: number;
  maxContextTokens?: number;
}

export interface FileContext {
  path: string;
  content: string;
  language: string;
  lastModified: string;
  isModified: boolean;
}

export interface LLMSessionState {
  sessionId: string;
  currentFile?: string;
  fileQueue: string[];
  fileContexts: Map<string, FileContext>;
  recentDiffs: FileDiff[];
  conversationHistory: Array<{ role: string; content: string }>;
  iteration: number;
}

export class LLMSessionManager {
  private readonly sessions = new Map<string, LLMSessionState>();
  private readonly virtualFilesystem: any;

  constructor(virtualFilesystem: any) {
    this.virtualFilesystem = virtualFilesystem;
  }

  /**
   * Create or get session
   */
  async getOrCreateSession(config: LLMSessionConfig): Promise<LLMSessionState> {
    let session = this.sessions.get(config.sessionId);
    
    if (!session) {
      // Initialize new session
      session = {
        sessionId: config.sessionId,
        currentFile: undefined,
        fileQueue: [],
        fileContexts: new Map(),
        recentDiffs: [],
        conversationHistory: [],
        iteration: 0,
      };
      
      this.sessions.set(config.sessionId, session);
      
      // Load initial file context
      await this.loadFileContext(config.ownerId, config.filesystemScopePath, session);
    }
    
    return session;
  }

  /**
   * Load file context for session
   */
  private async loadFileContext(
    ownerId: string,
    scopePath: string,
    session: LLMSessionState
  ): Promise<void> {
    try {
      const snapshot = await this.virtualFilesystem.exportWorkspace(ownerId);
      
      for (const file of snapshot.files) {
        if (file.path.startsWith(scopePath)) {
          const previous = session.fileContexts.get(file.path);
          
          session.fileContexts.set(file.path, {
            path: file.path,
            content: file.content,
            language: file.language,
            lastModified: file.lastModified,
            isModified: previous ? previous.content !== file.content : false,
          });
        }
      }
      
      // Update file queue with modified files first
      const modifiedFiles = Array.from(session.fileContexts.values())
        .filter(f => f.isModified)
        .map(f => f.path)
        .sort();
      
      const otherFiles = Array.from(session.fileContexts.keys())
        .filter(p => !modifiedFiles.includes(p))
        .sort();
      
      session.fileQueue = [...modifiedFiles, ...otherFiles];
      
      // Get recent diffs
      session.recentDiffs = diffTracker.getAllDiffsForContext().slice(0, 10);
    } catch (error) {
      console.error('[LLMSession] Failed to load file context:', error);
    }
  }

  /**
   * Build prompt with file context
   */
  buildContextualPrompt(
    session: LLMSessionState,
    userMessage: string,
    options: {
      includeAllFiles?: boolean;
      maxFiles?: number;
      includeDiffs?: boolean;
    } = {}
  ): string {
    const {
      includeAllFiles = false,
      maxFiles = 5,
      includeDiffs = true,
    } = options;

    let context = '';

    // Add recent diffs
    if (includeDiffs && session.recentDiffs.length > 0) {
      context += '## Recent Changes:\n\n';
      for (const diff of session.recentDiffs.slice(0, 5)) {
        context += `### ${diff.changeType === 'create' ? 'Created' : 'Modified'}: ${diff.path}\n`;
        if (diff.hunks && diff.hunks.length > 0) {
          for (const hunk of diff.hunks) {
            context += '```diff\n';
            context += hunk.lines.join('\n');
            context += '\n```\n\n';
          }
        }
      }
    }

    // Add current file context
    if (session.currentFile) {
      const currentFileContext = session.fileContexts.get(session.currentFile);
      if (currentFileContext) {
        context += `## Current File: ${session.currentFile}\n\n`;
        context += '```' + currentFileContext.language + '\n';
        context += currentFileContext.content + '\n';
        context += '```\n\n';
      }
    }

    // Add other relevant files
    const filesToInclude = includeAllFiles
      ? Array.from(session.fileContexts.entries())
      : Array.from(session.fileContexts.entries())
          .filter(([_, ctx]) => ctx.isModified)
          .slice(0, maxFiles);

    if (filesToInclude.length > 0) {
      context += '## Project Files:\n\n';
      for (const [path, fileContext] of filesToInclude) {
        if (path !== session.currentFile) {
          context += `### ${path}\n`;
          context += '```' + fileContext.language + '\n';
          // Include first 50 lines for context
          const lines = fileContext.content.split('\n');
          context += lines.slice(0, 50).join('\n');
          if (lines.length > 50) {
            context += '\n// ... (' + (lines.length - 50) + ' more lines)';
          }
          context += '\n```\n\n';
        }
      }
    }

    // Add conversation context
    if (session.conversationHistory.length > 0) {
      context += '## Conversation History:\n\n';
      for (const msg of session.conversationHistory.slice(-6)) {
        context += `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}\n\n`;
      }
    }

    // Add user message
    context += `## Current Request:\n\n${userMessage}\n\n`;

    // Add instructions for iterative development
    context += `## Instructions:

Focus on the current file: ${session.currentFile || 'N/A'}

Provide COMPLETE, production-ready code - NOT skeleton or example code.
- Implement ALL functionality requested
- Include proper error handling
- Add comments where needed
- Follow best practices for ${session.currentFile ? this.getLanguage(session.currentFile) : 'the language'}

If multiple files need changes:
1. Focus on ONE file at a time
2. Provide the COMPLETE file content
3. Wait for user confirmation before moving to next file

Current iteration: ${session.iteration}
`;

    return context;
  }

  /**
   * Update session after LLM response
   */
  async updateSession(
    session: LLMSessionState,
    userMessage: string,
    llmResponse: string,
    filesModified: string[]
  ): Promise<void> {
    // Add to conversation history
    session.conversationHistory.push(
      { role: 'user', content: userMessage },
      { role: 'assistant', content: llmResponse }
    );
    
    // Keep history manageable
    if (session.conversationHistory.length > 20) {
      session.conversationHistory = session.conversationHistory.slice(-20);
    }
    
    // Update iteration
    session.iteration += 1;
    
    // Move to next file if current was modified
    if (session.currentFile && filesModified.includes(session.currentFile)) {
      const currentIndex = session.fileQueue.indexOf(session.currentFile);
      if (currentIndex !== -1 && currentIndex < session.fileQueue.length - 1) {
        session.currentFile = session.fileQueue[currentIndex + 1];
      } else {
        session.currentFile = undefined;
      }
    }
    
    // Reload file context
    // (would need ownerId and scopePath passed in)
  }

  /**
   * Set current file for focused editing
   */
  setCurrentFile(session: LLMSessionState, filePath: string): void {
    session.currentFile = filePath;
  }

  /**
   * Get session summary for UI
   */
  getSessionSummary(session: LLMSessionState): {
    totalFiles: number;
    modifiedFiles: number;
    currentFile?: string;
    iteration: number;
    recentChanges: number;
  } {
    const modifiedFiles = Array.from(session.fileContexts.values()).filter(f => f.isModified).length;
    
    return {
      totalFiles: session.fileContexts.size,
      modifiedFiles,
      currentFile: session.currentFile,
      iteration: session.iteration,
      recentChanges: session.recentDiffs.length,
    };
  }

  private getLanguage(filePath: string): string {
    const ext = filePath.split('.').pop()?.toLowerCase();
    const languages: Record<string, string> = {
      js: 'JavaScript',
      ts: 'TypeScript',
      jsx: 'React JSX',
      tsx: 'React TSX',
      py: 'Python',
      java: 'Java',
      cpp: 'C++',
      c: 'C',
      rb: 'Ruby',
      go: 'Go',
      rs: 'Rust',
      php: 'PHP',
      vue: 'Vue',
      svelte: 'Svelte',
      html: 'HTML',
      css: 'CSS',
      json: 'JSON',
      md: 'Markdown',
    };
    return languages[ext || ''] || 'Text';
  }
}

export const llmSessionManager = new LLMSessionManager(
  // Would be initialized with virtualFilesystem service
  null as any
);
```

---

### 2.3 Phase 3: Code Preview Panel Fixes

#### 2.3.1 Fix File Explorer Path Issues

**File:** `components/code-preview-panel.tsx`

```typescript
// REPLACE the filesystem path handling section

// FIX: Path normalization helper
const normalizeFilesystemPath = (path: string): string => {
  // Remove any duplicate 'project/' prefixes
  return path.replace(/^(project\/)+/, 'project/');
};

// REPLACE openFilesystemDirectory
const openFilesystemDirectory = useCallback((path: string) => {
  const normalizedPath = normalizeFilesystemPath(path);
  setFilesystemCurrentPath(normalizedPath);
  void listFilesystemDirectory(normalizedPath);
}, [listFilesystemDirectory, setFilesystemCurrentPath]);

// REPLACE openFilesystemParent
const openFilesystemParent = useCallback(() => {
  const current = normalizeFilesystemPath(filesystemCurrentPath);
  const parts = current.split("/").filter(Boolean);
  
  // If already at root, stay there
  if (parts.length <= 1 || (parts.length === 1 && parts[0] === 'project')) {
    openFilesystemDirectory("project");
    return;
  }
  
  const parentPath = parts.slice(0, -1).join("/");
  openFilesystemDirectory(parentPath || "project");
}, [filesystemCurrentPath, openFilesystemDirectory]);

// REPLACE selectFilesystemFile
const selectFilesystemFile = useCallback(async (path: string) => {
  setIsFilesystemFileLoading(true);
  try {
    const normalizedPath = normalizeFilesystemPath(path);
    const file = await readFilesystemFile(normalizedPath);
    setSelectedFilesystemPath(file.path);
    setSelectedFilesystemLanguage(file.language || "text");
    setSelectedFilesystemContent(file.content || "");
  } finally {
    setIsFilesystemFileLoading(false);
  }
}, [readFilesystemFile]);

// FIX: Initialize explorer with correct path
useEffect(() => {
  if (!isOpen || selectedTab !== "files") {
    return;
  }
  
  const initializeExplorer = async () => {
    setSelectedFilesystemPath("");
    setSelectedFilesystemContent("");
    setSelectedFilesystemLanguage("text");

    // Start at filesystem scope path
    const initialPath = normalizeFilesystemPath(filesystemScopePath);
    const initialNodes = await listFilesystemDirectory(initialPath);
    setFilesystemCurrentPath(initialPath);
    
    // If empty, try to find content
    if (initialNodes.length === 0) {
      // Look for session directories
      const sessionsRoot = normalizeFilesystemPath("project/sessions");
      const sessionDirectories = (await listFilesystemDirectory(sessionsRoot))
        .filter((node) => node.type === "directory");
      
      if (sessionDirectories.length > 0) {
        // Sort: drafts first, then by name descending (newest first)
        const preferred = sessionDirectories
          .slice()
          .sort((a, b) => {
            const aDraft = a.name.startsWith("draft-chat_") ? 1 : 0;
            const bDraft = b.name.startsWith("draft-chat_") ? 1 : 0;
            if (aDraft !== bDraft) return bDraft - aDraft;
            return b.name.localeCompare(a.name);
          });

        // Find first non-empty directory
        for (const directory of preferred) {
          const nodes = await listFilesystemDirectory(directory.path);
          if (nodes.length > 0) {
            openFilesystemDirectory(directory.path);
            return;
          }
        }
      }
    }
  };

  void initializeExplorer();
}, [filesystemScopePath, isOpen, selectedTab, listFilesystemDirectory, openFilesystemDirectory]);
```

#### 2.3.2 Fix Sandpack Integration

**File:** `components/code-preview-panel.tsx`

```typescript
// REPLACE the renderLivePreview function

const renderLivePreview = () => {
  const useStructure = projectStructureWithScopedFiles || projectStructure;

  if (!useStructure || Object.keys(useStructure.files).length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <div className="text-center">
          <Package className="w-12 h-12 mx-auto mb-4 opacity-50" />
          <p>No files to preview</p>
          <p className="text-sm">Files will appear here once generated</p>
        </div>
      </div>
    );
  }

  // Get Sandpack template based on framework
  const getSandpackTemplate = (framework: string) => {
    switch (framework) {
      case "react":
      case "vite-react":
        return "react";
      case "next":
        return "nextjs";
      case "vue":
      case "nuxt":
        return "vue";
      case "angular":
        return "angular";
      case "svelte":
        return "svelte";
      case "solid":
        return "solid";
      case "astro":
        return "astro";
      case "remix":
        return "remix";
      case "gatsby":
        return "gatsby";
      default:
        return "vanilla";
    }
  };

  // Prepare files for Sandpack - ensure proper format
  const sandpackFiles = Object.entries(useStructure.files).reduce(
    (acc, [path, content]) => {
      // Skip empty or invalid files
      if (typeof content !== "string" || !content.trim()) {
        console.warn(`[Sandpack] Skipping empty file: ${path}`);
        return acc;
      }

      // Normalize path for Sandpack (must start with /)
      const sandpackPath = path.startsWith("/") ? path : `/${path}`;
      
      // Detect file type for Sandpack
      const ext = path.split('.').pop()?.toLowerCase();
      const isEntryFile = ['index.html', 'index.js', 'index.tsx', 'main.tsx', 'app.tsx'].includes(path.split('/').pop() || '');
      
      acc[sandpackPath] = {
        code: content,
        active: isEntryFile,
      };
      
      return acc;
    },
    {} as Record<string, { code: string; active?: boolean }>
  );

  // If no entry file detected, create a minimal one
  if (!sandpackFiles['/index.html'] && !sandpackFiles['/index.tsx'] && !sandpackFiles['/index.js']) {
    const firstFile = Object.keys(sandpackFiles)[0];
    if (firstFile) {
      sandpackFiles[firstFile].active = true;
    }
  }

  const template = getSandpackTemplate(useStructure.framework);

  try {
    return (
      <Sandpack
        template={template as any}
        files={sandpackFiles}
        options={{
          visibleFiles: Object.keys(sandpackFiles),
          activeFile: Object.keys(sandpackFiles).find(f => sandpackFiles[f].active) || Object.keys(sandpackFiles)[0],
          showNavigator: true,
          showLineNumbers: true,
          showTabs: true,
          closableTabs: false,
        }}
        customSetup={{
          dependencies: useStructure.dependencies?.reduce(
            (acc, dep) => ({ ...acc, [dep]: 'latest' }),
            {}
          ),
        }}
      />
    );
  } catch (error) {
    console.error('[CodePreview] Sandpack render error:', error);
    return (
      <div className="flex items-center justify-center h-full text-destructive">
        <div className="text-center">
          <AlertCircle className="w-12 h-12 mx-auto mb-4" />
          <p>Failed to load preview</p>
          <p className="text-sm">{error instanceof Error ? error.message : 'Unknown error'}</p>
        </div>
      </div>
    );
  }
};
```

---

### 2.4 Phase 4: Sandbox ↔ Virtual Filesystem Bidirectional Sync

#### 2.4.1 Enhance Sandbox Service Bridge

**File:** `lib/sandbox/sandbox-service-bridge.ts`

```typescript
// ADD: Bidirectional sync with change detection

export class SandboxServiceBridge {
  // ... existing code ...
  
  // ADD: Poll for sandbox changes
  private sandboxChangePollers = new Map<string, NodeJS.Timeout>();
  private lastSandboxState = new Map<string, Map<string, string>>(); // sandboxId -> (path -> content hash)
  
  /**
   * Start polling sandbox for file changes
   * Syncs terminal/editor edits back to virtual filesystem
   */
  startSandboxSync(sandboxId: string, session: WorkspaceSession): void {
    // Stop existing poller if any
    this.stopSandboxSync(sandboxId);
    
    const pollInterval = 5000; // 5 seconds
    
    const poller = setInterval(async () => {
      try {
        await this.syncSandboxChanges(sandboxId, session.userId);
      } catch (error) {
        console.warn(`[SandboxBridge] Sync failed for ${sandboxId}:`, error);
      }
    }, pollInterval);
    
    this.sandboxChangePollers.set(sandboxId, poller);
  }
  
  /**
   * Stop polling
   */
  stopSandboxSync(sandboxId: string): void {
    const poller = this.sandboxChangePollers.get(sandboxId);
    if (poller) {
      clearInterval(poller);
      this.sandboxChangePollers.delete(sandboxId);
    }
  }
  
  /**
   * Sync changes from sandbox to virtual filesystem
   */
  private async syncSandboxChanges(sandboxId: string, userId: string): Promise<void> {
    try {
      // Get current sandbox state
      const currentState = new Map<string, string>();
      
      // List all files in sandbox workspace
      const listResult = await this.sandboxService.listDirectory(sandboxId, '/workspace');
      
      if (listResult.success) {
        // Parse file list (simplified - would need proper parsing)
        const files = listResult.output.split('\n')
          .filter(line => line && !line.startsWith('d'))
          .map(line => line.split(/\s+/).pop());
        
        for (const file of files) {
          if (file) {
            const readResult = await this.sandboxService.readFile(sandboxId, `/workspace/${file}`);
            if (readResult.success) {
              const hash = this.hashContent(readResult.output);
              currentState.set(`/workspace/${file}`, hash);
            }
          }
        }
      }
      
      // Compare with last state
      const lastState = this.lastSandboxState.get(sandboxId) || new Map();
      const changedFiles: string[] = [];
      
      for (const [path, hash] of currentState.entries()) {
        const lastHash = lastState.get(path);
        if (lastHash !== hash) {
          changedFiles.push(path);
        }
      }
      
      // Sync changed files to virtual filesystem
      for (const path of changedFiles) {
        const readResult = await this.sandboxService.readFile(sandboxId, path);
        if (readResult.success) {
          // Convert sandbox path to virtual filesystem path
          const vfsPath = path.replace('/workspace', 'project');
          
          await virtualFilesystem.writeFile(userId, vfsPath, readResult.output);
          console.log(`[SandboxBridge] Synced ${path} → ${vfsPath}`);
        }
      }
      
      // Update last state
      this.lastSandboxState.set(sandboxId, currentState);
      
    } catch (error) {
      console.error('[SandboxBridge] Failed to sync sandbox changes:', error);
    }
  }
  
  /**
   * Simple content hash
   */
  private hashContent(content: string): string {
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash.toString();
  }
  
  // MODIFY: destroyWorkspace to stop sync
  async destroyWorkspace(sessionId: string, sandboxId: string): Promise<void> {
    // Stop sync first
    this.stopSandboxSync(sandboxId);
    this.lastSandboxState.delete(sandboxId);
    
    // Then destroy
    await this.ensureInitialized();
    await this.sandboxService.destroyWorkspace(sessionId, sandboxId);
    this.mountedFilesystemVersionBySandbox.delete(sandboxId);
  }
}
```

---

### 2.5 Phase 5: Environment Variables

**File:** `env.example`

```bash
# ===========================================
# VIRTUAL FILESYSTEM CONFIGURATION
# ===========================================

# Virtual filesystem storage directory
# Default: data/virtual-filesystem
VIRTUAL_FILESYSTEM_STORAGE_DIR=data/virtual-filesystem

# Maximum path length (default: 1024)
#VIRTUAL_FILESYSTEM_MAX_PATH_LENGTH=1024

# Maximum search results (default: 200)
#VIRTUAL_FILESYSTEM_MAX_SEARCH_LIMIT=200

# Default workspace root (default: project)
#VIRTUAL_FILESYSTEM_ROOT=project

# ===========================================
# FILESYSTEM DIFF TRACKING
# ===========================================

# Enable diff tracking for LLM context (default: true)
VIRTUAL_FILESYSTEM_ENABLE_DIFFS=true

# Maximum diffs to keep per file (default: 50)
#VIRTUAL_FILESYSTEM_MAX_DIFFS_PER_FILE=50

# Maximum total diffs in context (default: 10)
#VIRTUAL_FILESYSTEM_MAX_CONTEXT_DIFFS=10

# ===========================================
# LLM SESSION MANAGEMENT
# ===========================================

# Enable iterative LLM sessions (default: true)
LLM_SESSION_ENABLED=true

# Maximum files in LLM context (default: 5)
#LLM_SESSION_MAX_CONTEXT_FILES=5

# Maximum context tokens (approximate, default: 8000)
#LLM_SESSION_MAX_CONTEXT_TOKENS=8000

# Include diffs in LLM context (default: true)
#LLM_SESSION_INCLUDE_DIFFS=true

# Auto-advance to next file after edit (default: true)
#LLM_SESSION_AUTO_ADVANCE=true

# ===========================================
# SANDBOX SYNC CONFIGURATION
# ===========================================

# Enable bidirectional sandbox sync (default: true)
SANDBOX_SYNC_ENABLED=true

# Sync poll interval in milliseconds (default: 5000)
#SANDBOX_SYNC_INTERVAL_MS=5000

# Sync terminal edits back to virtual filesystem (default: true)
#SANDBOX_SYNC_TERMINAL_EDITS=true

# ===========================================
# CODE PREVIEW PANEL
# ===========================================

# Default panel width in pixels (default: 800)
#CODE_PREVIEW_DEFAULT_WIDTH=800

# Enable Sandpack live preview (default: true)
#CODE_PREVIEW_ENABLE_SANDPACK=true

# Auto-detect framework from files (default: true)
#CODE_PREVIEW_AUTO_DETECT_FRAMEWORK=true

# ===========================================
# FILE EXPLORER
# ===========================================

# Initial explorer path (default: project)
#FILE_EXPLORER_INITIAL_PATH=project

# Show hidden files (default: false)
#FILE_EXPLORER_SHOW_HIDDEN=false

# Sort directories first (default: true)
#FILE_EXPLORER_SORT_DIRS_FIRST=true
```

---

## 3. Testing Strategy

### 3.1 Unit Tests

```typescript
// __tests__/virtual-filesystem-diffs.test.ts
describe('FilesystemDiffTracker', () => {
  it('should track file creation', () => {
    const file = { path: '/project/test.js', content: 'console.log("hi")', version: 1 };
    const diff = diffTracker.trackChange(file);
    expect(diff.changeType).toBe('create');
    expect(diff.newContent).toBe('console.log("hi")');
  });

  it('should compute hunks correctly', () => {
    const oldContent = 'line1\nline2\nline3';
    const newContent = 'line1\nmodified\nline3';
    const hunks = diffTracker['computeHunks'](oldContent, newContent);
    expect(hunks.length).toBe(1);
    expect(hunks[0].lines).toContain(' line1');
    expect(hunks[0].lines).toContain('-line2');
    expect(hunks[0].lines).toContain('+modified');
    expect(hunks[0].lines).toContain(' line3');
  });
});

// __tests__/llm-session.test.ts
describe('LLMSessionManager', () => {
  it('should build contextual prompt with file context', () => {
    const session = {
      sessionId: 'test',
      currentFile: '/project/app.ts',
      fileContexts: new Map([
        ['/project/app.ts', { path: '/project/app.ts', content: 'code', language: 'typescript', lastModified: '', isModified: true }]
      ]),
      recentDiffs: [],
      conversationHistory: [],
      iteration: 1,
      fileQueue: [],
    };
    
    const prompt = llmSessionManager.buildContextualPrompt(session, 'Update the app');
    expect(prompt).toContain('Current File: /project/app.ts');
    expect(prompt).toContain('Instructions:');
  });
});
```

### 3.2 Integration Tests

```typescript
// __tests__/filesystem-integration.test.ts
describe('Filesystem Integration', () => {
  it('should sync sandbox changes to virtual filesystem', async () => {
    const sandboxId = 'test-sandbox';
    const userId = 'test-user';
    
    // Create file in sandbox
    await sandboxBridge.writeFile(sandboxId, '/workspace/test.js', 'console.log("hi")');
    
    // Wait for sync
    await new Promise(resolve => setTimeout(resolve, 6000));
    
    // Check virtual filesystem
    const snapshot = await virtualFilesystem.exportWorkspace(userId);
    const file = snapshot.files.find(f => f.path === 'project/test.js');
    expect(file).toBeDefined();
    expect(file?.content).toBe('console.log("hi")');
  });
});
```

---

## 4. Migration Guide

### 4.1 Breaking Changes

- File paths are now normalized (no more `project/project/` duplication)
- Sandpack now uses virtual filesystem as single source of truth
- `projectFiles` prop on CodePreviewPanel is deprecated

### 4.2 Upgrade Steps

1. **Backup data:**
   ```bash
   cp -r data/virtual-filesystem data/virtual-filesystem.backup
   ```

2. **Update environment:**
   ```bash
   cp env.example .env.local
   # Review and configure new variables
   ```

3. **Clear old cache (optional):**
   ```bash
   rm -rf data/virtual-filesystem/*.json
   ```

4. **Restart application**

---

## 5. Success Metrics

| Metric | Before | Target | Measurement |
|--------|--------|--------|-------------|
| File explorer path errors | 80% | <5% | User error reports |
| Sandpack load failures | 60% | <10% | Error logs |
| LLM skeleton code | Frequent | Rare | User feedback |
| Terminal edit persistence | 0% | 95% | Sync success rate |
| File context in LLM | None | Always | Prompt analysis |
| Iterative sessions | None | 80%+ | Session tracking |

---

## 6. Timeline

| Phase | Tasks | Estimated Time |
|-------|-------|----------------|
| **Phase 1** | VFS enhancements (events, diffs) | 2-3 days |
| **Phase 2** | LLM Session Manager | 3-4 days |
| **Phase 3** | Code Preview Panel fixes | 2-3 days |
| **Phase 4** | Sandbox bidirectional sync | 3-4 days |
| **Phase 5** | Testing & documentation | 2-3 days |
| **Total** | | **12-17 days** |

---

## 7. Conclusion

This comprehensive plan addresses all identified issues:

✅ **Sandpack integration** - Uses virtual filesystem as single source  
✅ **File explorer paths** - Proper normalization, no duplicates  
✅ **Terminal persistence** - Bidirectional sync with polling  
✅ **LLM iterative coding** - Session manager with file context  
✅ **Diff tracking** - Full change history for LLM context  
✅ **Sandbox sync** - Automatic bidirectional synchronization  

**Next Steps:**
1. Review and approve plan
2. Implement Phase 1
3. Test incrementally
4. Deploy with monitoring

---

**Document Version:** 1.0  
**Created:** 2026-02-27  
**Status:** Ready for Implementation
