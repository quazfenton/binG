/**
 * vectorStore.ts — Web vector store using IndexedDB
 * Uses Dexie.js for clean IndexedDB access.
 * Install: pnpm add dexie
 *
 * For desktop (Tauri) you swap this with SQLite via invoke().
 * Keep the same interface — platform/storage.ts selects the right impl.
 */

import Dexie, { type Table } from "dexie";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface VectorEntry {
  id: string;
  projectId: string;
  filePath: string;
  name: string;
  kind: "function" | "class" | "component" | "method" | "chunk";
  content: string;
  embedding: number[];
  fileHash: string;
  startLine: number;
  endLine: number;
  importance: number; // PageRank score, 0–1
  language: "ts" | "py" | "rs" | "other";
  updatedAt: number;
}

export interface EdgeEntry {
  id: string;
  projectId: string;
  fromId: string;
  toId: string;
  type: "imports" | "calls" | "uses" | "inherits" | "http_call";
}

export interface ProjectMeta {
  id: string;
  name: string;
  path: string;
  lastIndexed: number;
  fileCount: number;
}

// ─── Database ────────────────────────────────────────────────────────────────

class VectorDB extends Dexie {
  symbols!: Table<VectorEntry>;
  edges!: Table<EdgeEntry>;
  projects!: Table<ProjectMeta>;

  constructor() {
    super("ai-coding-vector-db");
    this.version(1).stores({
      symbols: "id, projectId, filePath, name, kind, fileHash, updatedAt",
      edges: "id, projectId, fromId, toId, type",
      projects: "id, name",
    });
  }
}

let _db: VectorDB | null = null;

function getDB(): VectorDB {
  if (!_db) _db = new VectorDB();
  return _db;
}

// ─── Project Operations ──────────────────────────────────────────────────────

export async function upsertProject(meta: ProjectMeta): Promise<void> {
  await getDB().projects.put(meta);
}

export async function getProject(projectId: string): Promise<ProjectMeta | undefined> {
  return getDB().projects.get(projectId);
}

export async function listProjects(): Promise<ProjectMeta[]> {
  return getDB().projects.toArray();
}

export async function deleteProject(projectId: string): Promise<void> {
  const db = getDB();
  await db.symbols.where("projectId").equals(projectId).delete();
  await db.edges.where("projectId").equals(projectId).delete();
  await db.projects.delete(projectId);
}

// ─── Symbol Operations ───────────────────────────────────────────────────────

export async function upsertSymbol(entry: VectorEntry): Promise<void> {
  await getDB().symbols.put(entry);
}

export async function upsertSymbols(entries: VectorEntry[]): Promise<void> {
  await getDB().symbols.bulkPut(entries);
}

/** Get all symbols for a project (for in-memory ranking) */
export async function getProjectSymbols(projectId: string): Promise<VectorEntry[]> {
  return getDB().symbols.where("projectId").equals(projectId).toArray();
}

/** Get symbols for a specific file */
export async function getFileSymbols(
  projectId: string,
  filePath: string
): Promise<VectorEntry[]> {
  return getDB()
    .symbols.where("projectId")
    .equals(projectId)
    .and((s) => s.filePath === filePath)
    .toArray();
}

/** Delete all symbols for a file (before re-indexing it) */
export async function deleteFileSymbols(
  projectId: string,
  filePath: string
): Promise<void> {
  await getDB()
    .symbols.where("projectId")
    .equals(projectId)
    .and((s) => s.filePath === filePath)
    .delete();
}

/** Get the stored file hash to detect changes */
export async function getFileHash(
  projectId: string,
  filePath: string
): Promise<string | null> {
  const symbols = await getDB()
    .symbols.where("projectId")
    .equals(projectId)
    .and((s) => s.filePath === filePath)
    .limit(1)
    .toArray();

  return symbols[0]?.fileHash ?? null;
}

// ─── Edge Operations ─────────────────────────────────────────────────────────

export async function upsertEdges(edges: EdgeEntry[]): Promise<void> {
  await getDB().edges.bulkPut(edges);
}

export async function getEdgesFrom(
  projectId: string,
  fromIds: string[]
): Promise<EdgeEntry[]> {
  const db = getDB();
  const results: EdgeEntry[] = [];

  for (const id of fromIds) {
    const edges = await db.edges
      .where("fromId")
      .equals(id)
      .and((e) => e.projectId === projectId)
      .toArray();
    results.push(...edges);
  }

  return results;
}

export async function getProjectEdges(projectId: string): Promise<EdgeEntry[]> {
  return getDB().edges.where("projectId").equals(projectId).toArray();
}

export async function deleteFileEdges(
  projectId: string,
  filePath: string,
  symbolIds: string[]
): Promise<void> {
  if (symbolIds.length === 0) return;

  const db = getDB();
  for (const id of symbolIds) {
    await db.edges
      .where("fromId")
      .equals(id)
      .and((e) => e.projectId === projectId)
      .delete();
  }
}
