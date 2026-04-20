# RAG Knowledge System

Retrieval-Augmented Generation for agent specialization. Retrieves relevant few-shot examples, practice experiences, rules, and task solutions at request time and injects them into the system prompt.

## Architecture

```
User Task: "Create a Flask app with app.py and requirements.txt"
  │
  ├─ Step 1: Query Preprocessing
  │   ├─ Normalize: lowercase, strip whitespace
  │   ├─ Detect taskType: 'vfs_batch'
  │   └─ Extract entities: ['flask', 'app.py', 'requirements.txt']
  │
  ├─ Step 2: Embed Query
  │   └─ Calls /api/embed (OpenAI text-embedding-3-small, 1536-dim)
  │
  ├─ Step 3: Coarse Vector Search (top-20)
  │   └─ Cosine similarity against all knowledge chunks
  │
  ├─ Step 4: Rerank
  │   Score = 0.6×vector + 0.15×keyword + 0.1×quality + 0.1×recency + 0.05×usage
  │
  ├─ Step 5: Filter & Dedup (top-3)
  │   └─ Remove duplicates by content hash, apply quality threshold
  │
  └─ Step 6: Format for Prompt
      "## Relevant Knowledge
       [1] (practice, quality: 0.85):
       batch_write is the most error-prone tool for smaller models...

       [2] (curated, quality: 1.0):
       Task: Create a Flask app with app.py and requirements.txt
       Expected output: batch_write(files=[{path:"app.py",content:...}])"
```

## Files

| File | Purpose |
|---|---|
| `web/lib/rag/knowledge-store.ts` | In-memory vector store (swap to SQLite + sqlite-vec later) |
| `web/lib/rag/retrieval.ts` | Full retrieval pipeline + ingestion helpers |
| `web/lib/rag/index.ts` | Barrel export |
| `scripts/rag/seed-knowledge.ts` | Curated examples to populate the store |

## Knowledge Types

| Type | Source | Purpose |
|---|---|---|
| `few_shot` | Curated | High-quality input→output examples for each tool |
| `experience` | Practice (GRPO) | Lessons learned from successful vs failed rollouts |
| `rule` | Curated | Tool schemas, constraints, workflow rules |
| `task_solution` | Production trajectories | Real successful agent executions |
| `anti_pattern` | Curated | Known failure patterns and their correct alternatives |

## Integration Points

### Automatic: System Prompt Injection

RAG retrieval runs automatically in `runV1ApiWithTools` (unified-agent-service.ts). Before sending the request to the LLM, the system:

1. Embeds the user's query
2. Searches the knowledge store for relevant chunks
3. Appends the top-3 results to the system prompt

This is transparent — no configuration needed. Failures are logged but don't block execution.

### Manual: Seed Curated Examples

```bash
# Populate the knowledge store with curated VFS examples
npx tsx scripts/rag/seed-knowledge.ts
```

This seeds 20+ knowledge chunks covering:
- 8 few-shot examples (write_file, batch_write, apply_diff)
- 7 anti-patterns (common mistakes and corrections)
- 4 rules (tool schemas and workflows)
- 3 experiences (simulated practice learnings)

### Manual: Ingest from Practice System

After running Training-Free GRPO practice, inject the extracted experiences:

```typescript
import { ingestExperience } from '@/lib/rag/retrieval';

await ingestExperience({
  experience: 'Always use write_file, not create_file',
  taskType: 'vfs_write',
  quality: 0.9,
});
```

### Manual: Ingest Production Trajectories

Successful agent runs are auto-logged, but you can also manually ingest:

```typescript
import { ingestTrajectory } from '@/lib/rag/retrieval';

await ingestTrajectory({
  task: 'Create a React component',
  toolCalls: 'write_file(path="src/App.tsx", content="...")',
  model: 'openai/gpt-4o',
  quality: 1.0,
});
```

## Configuration

RAG retrieval in `runV1ApiWithTools` uses these defaults:

```typescript
const ragResult = await runRetrievalPipeline(config.userMessage, {
  topK: 3,              // Return top-3 chunks
  coarseTopN: 10,       // Search top-10 before reranking
  minQuality: 0.3,      // Minimum quality threshold
  includeSource: false, // Don't include source tags in prompt
  maxTokens: 1500,      // Token budget for formatted output
});
```

## Scaling

The current implementation uses an in-memory store with brute-force cosine similarity. This works well for <10k chunks (~100MB RAM max). When scaling beyond that:

1. **SQLite + sqlite-vec**: Drop-in replacement for `InMemoryKnowledgeStore` with persistent storage and HNSW vector indexing.
2. **pgvector**: For multi-server deployments with PostgreSQL.
3. **Qdrant/Milvus**: For >1M chunks with distributed search.

The retrieval pipeline API (`runRetrievalPipeline`, `search`, `insert`) remains the same regardless of storage backend.

## Cost

- **Per retrieval**: 1 embedding call (~$0.0001) + in-memory search (free)
- **At 10k requests/day**: ~$1/month for embedding
- **Seeding**: 20 chunks × 1 embed each = 20 calls (~$0.002 one-time)
