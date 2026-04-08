# Memory Module — Code Retrieval & Symbol Intelligence

Production-grade, Cursor-class intelligence layer for the Next.js coding app.

## Structure

```
lib/
├── memory/                    ← Storage & indexing
│   ├── chunk.ts               ← Text chunking (char/line/section)
│   ├── embeddings.ts          ← Embed text, batch embed, in-memory cache
│   ├── vectorStore.ts         ← IndexedDB (Dexie) — symbols, edges, projects
│   ├── indexer.ts             ← SHA-256 → extract → embed → store → PageRank
│   ├── platform.ts            ← Web/Tauri abstraction (fs, grep, watcher)
│   ├── index.ts               ← Barrel exports — import from here
│   └── example-usage.ts       ← Full wiring example
│
├── retrieval/                 ← Intelligence pipeline
│   ├── symbolExtractor.ts     ← AST extraction via web-tree-sitter
│   ├── similarity.ts          ← Cosine, ranking formula, PageRank, graph expansion
│   ├── search.ts              ← Full hybrid pipeline + tab memory
│   └── use-code-retrieval.ts  ← React hook for parallel retrieval
│
├── context/                   ← Prompt construction
│   └── contextBuilder.ts      ← Token-aware builder with diversity caps
│
└── agent/                     ← Self-correcting agent
    ├── orchestrator.ts        ← Central command (aliased as Retrieval)
    ├── agentLoop.ts           ← Diff → validate → retry loop
    ├── plugins.ts             ← Git, ESLint, tsc plugins
    └── metrics.ts             ← Async trace + counters + p95

app/api/embed/
└── route.ts                   ← OpenAI embedding proxy (rate-limited)
```

## Quick Start

```ts
import { Retrieval, trace } from "@/lib/memory";

const retrieval = await Retrieval.fromPath("/path/to/project", {
  llm: async (userPrompt, systemPrompt) => {
    // Call your LLM here
  },
});

// Index files
await retrieval.indexFiles(files, {
  onProgress: (done, total, file) => console.log(`${done}/${total}: ${file}`),
  recomputePageRank: true,
});

// Ask a question
const answer = await retrieval.ask("How does auth work?");

// Edit a file with self-correction
const result = await retrieval.editFile({
  path: "src/users.ts",
  content: originalContent,
  task: "Add Zod validation to all parameters",
});
```

## React Hook (Parallel to Smart-Context)

```tsx
import { useCodeRetrieval } from "@/lib/retrieval/use-code-retrieval";

function MyComponent() {
  const { search, ask, isInitializing, indexFiles } = useCodeRetrieval({
    projectId: "my-project",
    llm: async (userPrompt, systemPrompt) => {
      // Call your LLM
    },
  });

  // Index VFS files
  useEffect(() => {
    const files = vfsFiles.map(f => ({ path: f.path, content: f.content }));
    indexFiles(files);
  }, []);

  // Search
  const results = await search("authentication");
}
```

## Security

- **Rate limiting**: 60 requests/minute per IP on embedding endpoint
- **Input validation**: All inputs validated for type, length, and content
- **Command injection**: Plugin commands sanitize shell metacharacters
- **LLM timeout**: 60s default, configurable per call
- **No eval**: tree-sitter parses ASTs safely — no code execution

## Dependencies

```bash
pnpm add dexie web-tree-sitter uuid
pnpm add -D @types/uuid
```

Copy WASM files to `/public`:
- `node_modules/web-tree-sitter/tree-sitter.wasm`
- `tree-sitter-typescript.wasm`
