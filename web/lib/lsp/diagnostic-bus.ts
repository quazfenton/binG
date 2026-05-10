/**
 * diagnostic-bus.ts — Centralized diagnostic bus for all diagnostic sources
 *
 * Normalizes diagnostics from ALL sources into one stream:
 *   lsp | eslint | compiler | runtime | tests
 *
 * The app NEVER cares which source is underneath — it queries the bus.
 */

// ─── Types ──────────────────────────────────────────────────────────────────────

export type DiagnosticSeverity = 'error' | 'warning' | 'info' | 'hint';

/** LSP severity codes → DiagnosticSeverity. Shared across all adapters. */
export const SEVERITY_MAP: Record<number, DiagnosticSeverity> = {
  1: 'error',
  2: 'warning',
  3: 'info',
  4: 'hint',
};

/**
 * Diagnostic source categories.
 * All producers push into the bus under one of these (or a custom string).
 */
export type DiagnosticSource = 'lsp' | 'eslint' | 'compiler' | 'runtime' | 'tests' | (string & {});

export interface UnifiedDiagnostic {
  file: string;
  message: string;
  /** Category: 'lsp', 'eslint', 'compiler', 'runtime', 'tests', or custom */
  source: DiagnosticSource;
  severity: DiagnosticSeverity;
  line?: number;
  column?: number;
  code?: string | number;
  context?: string;
  /** Unique opaque id */
  id: string;
  timestamp: number;
}

// ─── Bus ────────────────────────────────────────────────────────────────────────

class DiagnosticBus {
  private diagnostics: Map<string, UnifiedDiagnostic> = new Map();
  private listeners: Set<(diagnostics: UnifiedDiagnostic[], updatedFiles: string[]) => void> = new Set();
  private readonly MAX_DIAGNOSTICS = 1000;

  // ── Write ──────────────────────────────────────────────────────────────────

  /**
   * Upsert diagnostics from a specific source.
   * Old diagnostics for the same source+files are removed before inserting new ones.
   */
  public upsert(
    source: DiagnosticSource,
    items: Omit<UnifiedDiagnostic, 'id' | 'timestamp' | 'source'>[],
    affectedFiles?: string[]
  ): void {
    const timestamp = Date.now();
    const involvedFiles = new Set(affectedFiles || items.map(i => i.file));

    // Remove old diagnostics for this source + these files
    for (const [id, diag] of this.diagnostics.entries()) {
      if (diag.source === source && involvedFiles.has(diag.file)) {
        this.diagnostics.delete(id);
      }
    }

    // Insert new diagnostics
    for (const item of items) {
      if (this.diagnostics.size >= this.MAX_DIAGNOSTICS) {
        const oldestKey = this.diagnostics.keys().next().value;
        if (oldestKey) this.diagnostics.delete(oldestKey);
      }
      const id = `${source}:${item.file}:${item.line || 0}:${item.column || 0}:${Buffer.from(item.message).toString('base64').slice(0, 16)}`;
      this.diagnostics.set(id, { ...item, id, timestamp, source });
    }

    this.notify(Array.from(involvedFiles));
  }

  // ── Query ──────────────────────────────────────────────────────────────────

  /** Get all diagnostics for a file across all sources */
  public getForFile(file: string, source?: DiagnosticSource): UnifiedDiagnostic[] {
    let diags = Array.from(this.diagnostics.values()).filter(d => d.file === file);
    if (source) diags = diags.filter(d => d.source === source);
    return diags;
  }

  /** Get deduplicated diagnostics for a file (one per unique message prefix) */
  public getCompacted(file: string, limit: number = 5, source?: DiagnosticSource): UnifiedDiagnostic[] {
    const diags = this.getForFile(file, source);
    const uniqueMessages = new Set<string>();
    const compacted: UnifiedDiagnostic[] = [];
    for (const d of diags) {
      const shortMsg = d.message.slice(0, 50);
      if (!uniqueMessages.has(shortMsg)) {
        compacted.push(d);
        uniqueMessages.add(shortMsg);
      }
      if (compacted.length >= limit) break;
    }
    return compacted;
  }

  /** Get all diagnostics from a specific source */
  public getBySource(source: DiagnosticSource): UnifiedDiagnostic[] {
    return Array.from(this.diagnostics.values()).filter(d => d.source === source);
  }

  /** Get all files that have diagnostics (optionally filtered by source) */
  public getAffectedFiles(source?: DiagnosticSource): string[] {
    const files = new Set<string>();
    for (const d of this.diagnostics.values()) {
      if (!source || d.source === source) files.add(d.file);
    }
    return Array.from(files);
  }

  /** List all active diagnostic sources */
  public getAllSources(): DiagnosticSource[] {
    const sources = new Set<DiagnosticSource>();
    for (const d of this.diagnostics.values()) sources.add(d.source);
    return Array.from(sources);
  }

  /** Total count across all sources */
  public get totalCount(): number {
    return this.diagnostics.size;
  }

  // ── Subscribe ──────────────────────────────────────────────────────────────

  /** Subscribe to diagnostic changes. Returns an unsubscribe function. */
  public subscribe(
    callback: (diagnostics: UnifiedDiagnostic[], updatedFiles: string[]) => void
  ): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  private notify(updatedFiles: string[]): void {
    const all = Array.from(this.diagnostics.values());
    this.listeners.forEach(l => l(all, updatedFiles));
  }

  // ── Clear ──────────────────────────────────────────────────────────────────

  /** Clear all diagnostics from a specific source */
  public clear(source: DiagnosticSource): void {
    const clearedFiles: string[] = [];
    for (const [id, diag] of this.diagnostics.entries()) {
      if (diag.source === source) {
        if (!clearedFiles.includes(diag.file)) clearedFiles.push(diag.file);
        this.diagnostics.delete(id);
      }
    }
    this.notify(clearedFiles);
  }

  /** Clear diagnostics for a specific file (optionally restricted to one source) */
  public clearForFile(file: string, source?: DiagnosticSource): void {
    for (const [id, diag] of this.diagnostics.entries()) {
      if (diag.file === file && (!source || diag.source === source)) {
        this.diagnostics.delete(id);
      }
    }
    this.notify([file]);
  }

  /** Clear ALL diagnostics from all sources */
  public clearAll(): void {
    this.diagnostics.clear();
    this.notify([]);
  }
}

// ─── Singleton ─────────────────────────────────────────────────────────────────

export const diagnosticBus = new DiagnosticBus();
