
    Overlap Map


    ┌─────────────────────┬───────────────────────────────────────────────────────────┬──────────────────────────────────────────────────────┬────────────┐
    │ Area                │ Existing Code                                             │ New Module                                           │ Overlap    │
    ├─────────────────────┼───────────────────────────────────────────────────────────┼──────────────────────────────────────────────────────┼────────────┤
    │ Context ranking     │ smart-context.ts (keyword + import graph scoring)         │ search.ts + similarity.ts (cosine + PageRank + 7-... │ HIGH       │
    │ **File → symbol ex... │ Regex-based extractRawImports in smart-context.ts         │ AST-based symbolExtractor.ts via web-tree-sitter     │ HIGH       │
    │ Vector store        │ context-pack-service.ts via getProjectServices (projec... │ vectorStore.ts (Dexie/IndexedDB)                     │ MEDIUM     │
    │ Embeddings          │ Via project-context retrieval.embedder                    │ embeddings.ts + app/api/embed/route.ts               │ MEDIUM     │
    │ Agent edit loop     │ VFS MCP tools + file-edit-parser.ts                       │ agentLoop.ts (self-correcting diff loop)             │ MEDIUM     │
    │ **Platform abstrac... │ @bing/platform/*, VFS bridges                             │ platform.ts (Web/Tauri)                              │ LOW        │
    │ Metrics             │ chatLogger                                                │ metrics.ts (trace + counters)                        │ LOW        │
    │ Chunking            │ None (file-level only)                                    │ chunk.ts (char/line/section chunking)                │ NEW        │
    │ Plugins             │ VFS MCP tools                                             │ plugins.ts (Git/ESLint/tsc)                          │ **COMPLEM... │
    └─────────────────────┴───────────────────────────────────────────────────────────┴──────────────────────────────────────────────────────┴────────────┘


    Integration Strategy — Layered

    Layer 1 (drop-in, no breaking changes):
     - Copy memory/ into web/lib/memory/ as-is
     - Wire the Orchestrator as a parallel retrieval path alongside existing smart-context
     - Use contextBuilder.ts to enhance existing prompt construction
     - Add embeddings.ts + route.ts as the shared embedding pipeline

    Layer 2 (replace existing scoring):
     - Replace smart-context.ts scoring with similarity.ts ranking formula
     - Replace regex import detection with symbolExtractor.ts AST extraction
     - Keep existing VFS tool-calling path (it works with function-calling models)
     - Wire agentLoop.ts as fallback when tool-calling fails or model lacks function calling

    Layer 3 (polish):
     - Wire metrics.ts to existing logging
     - Add plugins.ts for Git/ESLint/tsc validation
     - Use platform.ts for desktop/Tauri file watching

    Key Benefits
     1. Symbol-level retrieval — Instead of dumping entire files, inject only the relevant functions/classes
     2. Self-correcting edits — Agent loop retries failed diffs with error feedback
     3. Graph-aware ranking — Import relationships boost related symbols
     4. PageRank importance — Frequently-imported symbols rank higher
     5. Tab memory — Open files and recently accessed symbols get boosted





---

## Architecture

```
UI / React
     ↓
Orchestrator (lib/agent/orchestrator.ts)
     ↓
┌────────────────────────────────────────────┐
│  Search Pipeline                           │
│  embed query → HNSW candidates            │
│  → keyword grep → graph expand → rerank   │
└────────────────────────────────────────────┘
     ↓
Context Builder (token-aware, structured)
     ↓
LLM (streaming + tools)
     ↓
Agent Loop (diff → validate → retry)
     ↓
Platform Layer (fs / IndexedDB / Tauri IPC)
```

---

## Module Map

```
lib/
├── index.ts                    ← Public API barrel (import from here)
├── example-usage.ts            ← Full wiring example
│
├── memory/
│   ├── chunk.ts                ← Text chunking (char / line / section)
│   ├── embeddings.ts           ← Embed text, batch embed, cache
│   ├── vectorStore.ts          ← IndexedDB via Dexie (swap for SQLite on desktop)
│   └── indexer.ts              ← File indexer: hash → extract → embed → store → PageRank
│
├── retrieval/
│   ├── symbolExtractor.ts      ← AST symbol extraction via web-tree-sitter
│   ├── similarity.ts           ← Cosine, ranking, PageRank, graph expansion
│   └── search.ts               ← Full hybrid pipeline + tab memory
│
├── context/
│   └── contextBuilder.ts       ← Token-aware context window builder
│
├── agent/
│   ├── orchestrator.ts         ← Central command brain
│   ├── agentLoop.ts            ← Self-correcting edit loop
│   ├── plugins.ts              ← Plugin system (git, lint, tsc)
│   └── metrics.ts              ← Performance tracing
│
└── platform/
    └── platform.ts             ← Web/Tauri abstraction (fs, grep, watcher)

app/
└── api/
    └── embed/
        └── route.ts            ← Next.js embedding API route (OpenAI proxy)
```

---

## Installation

```bash
npm install dexie web-tree-sitter uuid
npm install -D @types/uuid
```

For desktop (Tauri), also add to `src-tauri/Cargo.toml`:
```toml
rusqlite = "0.30"
notify = "6"
walkdir = "2"
sha2 = "0.10"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
uuid = "1"
```

Copy WASM files to `/public`:
- `node_modules/web-tree-sitter/tree-sitter.wasm`
- `tree-sitter-typescript.wasm` (from tree-sitter-typescript releases)

---

## Quick Start

```ts
import { Orchestrator } from "@/lib";

const orch = await Orchestrator.fromPath("/path/to/project", {
  llm: async (userPrompt, systemPrompt) => {
    // call your LLM here
  },
});

// Index files
await orch.indexFiles(files);

// Ask a question
const answer = await orch.ask("How does auth work?");

// Edit a file with self-correction
const result = await orch.editFile({
  path: "src/users.ts",
  content: originalContent,
  task: "Add Zod validation to all parameters",
});
```

---

## Ranking Formula

```
score = 0.35 × semantic
      + 0.20 × keyword
      + 0.15 × graph_proximity
      + 0.10 × pagerank_importance
      + 0.10 × edit_boost
      + 0.05 × recency
      + 0.05 × open_file_boost
```

---

## Build Order

Implement in this order to avoid blocked dependencies:

1. ✅ `embeddings.ts` + `/api/embed/route.ts` — embed pipeline
2. ✅ `vectorStore.ts` — storage
3. ✅ `chunk.ts` + `symbolExtractor.ts` — extraction
4. ✅ `indexer.ts` — file indexing
5. ✅ `similarity.ts` + `search.ts` — retrieval
6. ✅ `contextBuilder.ts` — prompting
7. ✅ `agentLoop.ts` — self-correction
8. ✅ `orchestrator.ts` — wires everything
9. `platform.ts` — once you add Tauri
10. `plugins.ts` + `metrics.ts` — polish
