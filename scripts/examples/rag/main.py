"""RAG (Retrieval-Augmented Generation) Example

An agent that answers questions using a local knowledge base.
Connects to a RAG service (RAGFlow, Qdrant, etc.) for document retrieval.

Usage:
    python scripts/examples/rag/main.py
    python scripts/examples/rag/main.py --query "What is our Q4 revenue?"
    python scripts/examples/rag/main.py --interactive
    python scripts/examples/rag/main.py --ingest ./docs/  # Ingest documents
"""

import asyncio
import argparse
import os
import sys
from pathlib import Path

# Add project root
project_root = str(Path(__file__).parent.parent.parent.parent)
if project_root not in sys.path:
    sys.path.insert(0, project_root)


def build_rag_context(query: str, top_k: int = 5) -> str:
    """Retrieve relevant documents from local knowledge base.

    This is a placeholder that you can adapt to your RAG backend.
    Supports: RAGFlow MCP, Qdrant, Chroma, or any vector store.
    """
    # ─── Option 1: RAGFlow MCP ──────────────────────────────────────
    # If you have RAGFlow running with an MCP server:
    #
    # from langchain_mcp_adapters.client import MultiServerMCPClient
    # async with MultiServerMCPClient({
    #     "ragflow": {
    #         "url": os.environ.get("MCP_RAGFLOW_URL", "http://localhost:9380/mcp"),
    #         "transport": "streamable_http",
    #     }
    # }) as client:
    #     tools = await client.get_tools()
    #     result = await tools[0].ainvoke({"query": query, "top_k": top_k})
    #     return result.content

    # ─── Option 2: Local file search (fallback) ─────────────────────
    # Search local documents for relevant content
    docs_dir = os.environ.get("RAG_DOCS_DIR", "./rag_docs")
    if not os.path.exists(docs_dir):
        return f"[RAG] No documents found at {docs_dir}. Set RAG_DOCS_DIR or create the directory."

    import glob
    from difflib import SequenceMatcher

    results = []
    query_lower = query.lower()
    query_words = set(query_lower.split())

    for filepath in glob.glob(f"{docs_dir}/**/*", recursive=True):
        if not os.path.isfile(filepath):
            continue
        if filepath.endswith(('.pdf', '.docx', '.xlsx')):
            # Skip binary files for now
            continue
        try:
            with open(filepath, "r", encoding="utf-8", errors="ignore") as f:
                content = f.read()
            content_lower = content.lower()

            # Simple relevance scoring
            word_matches = sum(1 for w in query_words if w in content_lower)
            score = word_matches / len(query_words) if query_words else 0

            if score > 0.1:
                rel_path = os.path.relpath(filepath, docs_dir)
                # Extract relevant snippet
                results.append({
                    "file": rel_path,
                    "score": score,
                    "snippet": content[:1000],
                })
        except Exception:
            continue

    # Sort by relevance
    results.sort(key=lambda x: x["score"], reverse=True)
    results = results[:top_k]

    if not results:
        return f"[RAG] No relevant documents found in {docs_dir}"

    context_parts = [f"[RAG Retrieved {len(results)} documents]"]
    for r in results:
        context_parts.append(
            f"\n--- {r['file']} (relevance: {r['score']:.2f}) ---\n{r['snippet']}"
        )

    return "\n".join(context_parts)


def ingest_documents(docs_dir: str):
    """Ingest documents into the knowledge base.

    This is a placeholder. Adapt to your RAG backend.
    For RAGFlow, use their API to create a knowledge base.
    For Qdrant/Chroma, use their ingest pipeline.
    """
    docs_path = Path(docs_dir)
    if not docs_path.exists():
        print(f"Creating docs directory: {docs_dir}")
        docs_path.mkdir(parents=True, exist_ok=True)
        print(f"Place your documents in {docs_dir} for the agent to use.")
        return

    files = list(docs_path.rglob("*"))
    files = [f for f in files if f.is_file()]
    print(f"Found {len(files)} files in {docs_dir}")
    print("Files are available for local file search RAG.")
    print("To use a vector store, configure your RAG backend separately.")


def rag_query(query: str, top_k: int = 5):
    """Query with RAG augmentation."""
    from web.lib.orchestra.unified_agent_service import (
        processUnifiedAgentRequest,
        UnifiedAgentConfig,
    )

    # Step 1: Retrieve relevant documents
    print("  Retrieving documents...")
    rag_context = build_rag_context(query, top_k=top_k)

    # Step 2: Query with retrieved context
    full_query = f"""Context from knowledge base:
{rag_context}

Question: {query}

Answer the question using ONLY the provided context. If the context doesn't contain enough information, say so explicitly and provide what partial answer you can.
"""

    config = UnifiedAgentConfig(
        userMessage=full_query,
        systemPrompt="You are a helpful assistant that answers questions based on the provided knowledge base context. Always cite which document you're referencing.",
        maxSteps=10,
        mode="v1-api",
    )

    result = asyncio.get_event_loop().run_until_complete(
        processUnifiedAgentRequest(config)
    )

    if result.success:
        print(f"\n{'='*60}")
        print("ANSWER")
        print(f"{'='*60}\n")
        print(result.response)
    else:
        print(f"\n✗ Query failed: {result.error}")


def main():
    parser = argparse.ArgumentParser(description="RAG Example")
    parser.add_argument("--query", help="Question to answer")
    parser.add_argument("--ingest", help="Directory of documents to ingest")
    parser.add_argument("--top-k", type=int, default=5, help="Number of documents to retrieve")
    parser.add_argument("--interactive", action="store_true",
                        help="Run in interactive mode")
    args = parser.parse_args()

    if args.ingest:
        ingest_documents(args.ingest)
        return

    if args.interactive:
        print("RAG Agent - Interactive Mode")
        print("Ask questions that will be answered from the knowledge base")
        print("Type 'exit' to quit\n")
        while True:
            query = input("> ").strip()
            if query.lower() in ("exit", "quit", "q"):
                break
            if not query:
                continue
            rag_query(query, top_k=args.top_k)
        return

    if args.query:
        rag_query(args.query, top_k=args.top_k)
    else:
        # Default demo
        rag_query("What are the key findings from our latest quarterly report?", top_k=args.top_k)


if __name__ == "__main__":
    main()
