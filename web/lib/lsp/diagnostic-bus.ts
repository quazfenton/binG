export type DiagnosticSeverity = 'error' | 'warning' | 'info' | 'hint';

export interface UnifiedDiagnostic {
  file: string;
  message: string;
  source: string;
  severity: DiagnosticSeverity;
  line?: number;
  column?: number;
  code?: string | number;
  context?: string;
  id: string;
  timestamp: number;
}

class DiagnosticBus {
  private diagnostics: Map<string, UnifiedDiagnostic> = new Map();
  private listeners: Set<(diagnostics: UnifiedDiagnostic[], updatedFiles: string[]) => void> = new Set();
  private readonly MAX_DIAGNOSTICS = 1000;

  public upsert(source: string, items: Omit<UnifiedDiagnostic, 'id' | 'timestamp' | 'source'>[], affectedFiles?: string[]): void {
    const timestamp = Date.now();
    const involvedFiles = new Set(affectedFiles || items.map(i => i.file));
    for (const [id, diag] of this.diagnostics.entries()) {
      if (diag.source === source && involvedFiles.has(diag.file)) {
        this.diagnostics.delete(id);
      }
    }
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

  public getForFile(file: string): UnifiedDiagnostic[] {
    return Array.from(this.diagnostics.values()).filter(d => d.file === file);
  }

  public getCompacted(file: string, limit: number = 5): UnifiedDiagnostic[] {
    const diags = this.getForFile(file);
    const uniqueMessages = new Set();
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

  public subscribe(callback: (diagnostics: UnifiedDiagnostic[], updatedFiles: string[]) => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  private notify(updatedFiles: string[]): void {
    const all = Array.from(this.diagnostics.values());
    this.listeners.forEach(l => l(all, updatedFiles));
  }

  public clear(source: string): void {
    const clearedFiles: string[] = [];
    for (const [id, diag] of this.diagnostics.entries()) {
      if (diag.source === source) {
        if (!clearedFiles.includes(diag.file)) clearedFiles.push(diag.file);
        this.diagnostics.delete(id);
      }
    }
    this.notify(clearedFiles);
  }
}

export const diagnosticBus = new DiagnosticBus();
