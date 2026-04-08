/**
 * indexer.ts — File indexing pipeline
 *
 * Orchestrates: hash check → extract symbols → embed → store → update graph → PageRank
 *
 * Usage:
 *   const indexer = new ProjectIndexer(projectId);
 *   await indexer.indexFile(filePath, fileContent);
 *   await indexer.recomputePageRank(); // run after bulk indexing
 */

import { embedBatch, buildSymbolEmbedInput } from "../memory/embeddings";
import {
  upsertSymbols,
  upsertEdges,
  deleteFileSymbols,
  deleteFileEdges,
  getFileHash,
  getFileSymbols,
  getProjectSymbols,
  getProjectEdges,
  upsertProject,
  type VectorEntry,
  type EdgeEntry,
} from "../memory/vectorStore";
import {
  extractSymbols,
  buildVectorEntry,
  symbolEmbedInput,
  detectLanguage,
} from "../retrieval/symbolExtractor";
import { computePageRank } from "../retrieval/similarity";
import { v4 as uuidv4 } from "uuid";

// ─── File Hashing ─────────────────────────────────────────────────────────────

async function hashContent(content: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ─── Indexer ──────────────────────────────────────────────────────────────────

export interface IndexResult {
  filePath: string;
  skipped: boolean;
  symbolsIndexed: number;
  edgesCreated: number;
  durationMs: number;
}

export class ProjectIndexer {
  private projectId: string;

  constructor(projectId: string) {
    this.projectId = projectId;
  }

  /**
   * Index a single file.
   * - Skips if file content hash hasn't changed.
   * - Deletes old symbols/edges for the file before re-inserting.
   */
  async indexFile(filePath: string, content: string): Promise<IndexResult> {
    const start = performance.now();

    // 1. Hash check — skip if unchanged
    const newHash = await hashContent(content);
    const existingHash = await getFileHash(this.projectId, filePath);

    if (existingHash === newHash) {
      return {
        filePath,
        skipped: true,
        symbolsIndexed: 0,
        edgesCreated: 0,
        durationMs: performance.now() - start,
      };
    }

    // 2. Delete old symbols (and their edges)
    const oldSymbols = await getFileSymbols(this.projectId, filePath);
    const oldIds = oldSymbols.map((s) => s.id);
    await deleteFileEdges(this.projectId, filePath, oldIds);
    await deleteFileSymbols(this.projectId, filePath);

    // 3. Extract symbols
    const extracted = await extractSymbols(content, filePath);

    if (extracted.length === 0) {
      return {
        filePath,
        skipped: false,
        symbolsIndexed: 0,
        edgesCreated: 0,
        durationMs: performance.now() - start,
      };
    }

    const language = detectLanguage(filePath);

    // 4. Build embed inputs (context-enriched)
    const embedInputs = extracted.map((sym) => symbolEmbedInput(sym, filePath));

    // 5. Batch embed
    const embeddings = await embedBatch(embedInputs, 5);

    // 6. Build VectorEntry objects
    const entries: VectorEntry[] = extracted.map((sym, i) =>
      buildVectorEntry(sym, {
        projectId: this.projectId,
        filePath,
        fileHash: newHash,
        embedding: embeddings[i],
        language,
      })
    );

    // 7. Store symbols
    await upsertSymbols(entries);

    // 8. Build edges from import statements
    const edges: EdgeEntry[] = [];

    for (let i = 0; i < extracted.length; i++) {
      const sym = extracted[i];
      const entry = entries[i];

      for (const importLine of sym.imports) {
        // Extract the imported path
        const match = importLine.match(/from\s+['"]([^'"]+)['"]/);
        if (!match) continue;

        const importPath = match[1];

        // Only link local imports (starts with . or /)
        if (!importPath.startsWith(".") && !importPath.startsWith("/")) continue;

        // Try to find matching symbol in our DB
        // We store a soft edge using a placeholder to_id (the file path)
        // This gets resolved during PageRank if you implement full resolution
        edges.push({
          id: uuidv4(),
          projectId: this.projectId,
          fromId: entry.id,
          toId: importPath, // resolved later — or store as-is for soft linking
          type: "imports",
        });
      }
    }

    if (edges.length > 0) {
      await upsertEdges(edges);
    }

    return {
      filePath,
      skipped: false,
      symbolsIndexed: entries.length,
      edgesCreated: edges.length,
      durationMs: performance.now() - start,
    };
  }

  /**
   * Index multiple files. Skips unchanged files automatically.
   * Returns per-file results.
   */
  async indexFiles(
    files: Array<{ path: string; content: string }>,
    onProgress?: (done: number, total: number, current: string) => void
  ): Promise<IndexResult[]> {
    const results: IndexResult[] = [];

    for (let i = 0; i < files.length; i++) {
      const { path, content } = files[i];
      onProgress?.(i, files.length, path);

      const result = await this.indexFile(path, content);
      results.push(result);
    }

    onProgress?.(files.length, files.length, "done");
    return results;
  }

  /**
   * Recompute PageRank importance scores for all symbols in this project.
   * Run after bulk indexing or significant changes.
   */
  async recomputePageRank(): Promise<void> {
    const symbols = await getProjectSymbols(this.projectId);
    const edges = await getProjectEdges(this.projectId);

    if (symbols.length === 0) return;

    const symbolIds = symbols.map((s) => s.id);
    const scores = computePageRank(symbolIds, edges, 20);

    // Update importance on each symbol
    const updated: VectorEntry[] = symbols.map((s) => ({
      ...s,
      importance: scores.get(s.id) ?? 0.5,
    }));

    await upsertSymbols(updated);
  }

  /**
   * Update project metadata after indexing.
   */
  async updateProjectMeta(name: string, path: string, fileCount: number): Promise<void> {
    await upsertProject({
      id: this.projectId,
      name,
      path,
      lastIndexed: Date.now(),
      fileCount,
    });
  }
}

// ─── Convenience: hash a project folder path to a stable ID ──────────────────

export async function projectIdFromPath(path: string): Promise<string> {
  const hash = await hashContent(path);
  return `proj_${hash.slice(0, 16)}`;
}
