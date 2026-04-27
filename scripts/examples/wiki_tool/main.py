"""Wikipedia Search Tool Example

Adapted from youtu-agent's wiki_tool.py — shows how to wrap an external
retrieval/search API as a structured agent tool.

Key patterns demonstrated:
- Wrapping an external API as a structured tool with clear schema
- Batched queries (multiple queries in one call for efficiency)
- Formatted output the LLM can reason about (titles + excerpts)
- Error handling for API failures

Usage:
    python scripts/examples/wiki_tool/main.py
    python scripts/examples/wiki_tool/main.py --query "History of the Roman Empire"
    python scripts/examples/wiki_tool/main.py --interactive
"""

import asyncio
import argparse
import re
import sys
from pathlib import Path
from typing import Optional

# Add project root
project_root = str(Path(__file__).parent.parent.parent.parent)
if project_root not in sys.path:
    sys.path.insert(0, project_root)


# ============================================================================
# Wikipedia Search Tool — wraps the Wikipedia REST API
# Pattern adapted from youtu-agent's WikiToolkit
# ============================================================================

class WikipediaSearchTool:
    """Searches Wikipedia and returns formatted results.

    Pattern from youtu-agent wiki_tool.py:
    - Accepts multiple queries in one call (batched for efficiency)
    - Returns formatted results with titles and excerpts
    - Handles errors gracefully
    """

    WIKIPEDIA_API = "https://en.wikipedia.org/w/api.php"

    def __init__(self, top_k: int = 3, max_chars: int = 500):
        self.top_k = top_k
        self.max_chars = max_chars

    async def search(self, queries: list[str]) -> str:
        """Search Wikipedia for multiple queries in one call.

        Args:
            queries: Array of query strings. Include multiple complementary
                     search queries in a single call for best results.

        Returns:
            Formatted search results with titles and excerpts.
        """
        import aiohttp

        results = []
        async with aiohttp.ClientSession() as session:
            for query in queries:
                try:
                    docs = await self._search_one(session, query)
                    if docs:
                        formatted = "\n".join(docs)
                        results.append(f'🔍 Results for "{query}":\n{formatted}')
                    else:
                        results.append(f'🔍 No results for "{query}"')
                except Exception as e:
                    results.append(f'⚠️ Error searching "{query}": {e}')

        return "\n\n" + "=" * 60 + "\n\n".join(results)

    async def _search_one(self, session, query: str) -> list[str]:
        """Search Wikipedia for a single query."""
        import aiohttp

        params = {
            "action": "query",
            "list": "search",
            "srsearch": query,
            "srlimit": self.top_k,
            "format": "json",
        }

        async with session.get(self.WIKIPEDIA_API, params=params, timeout=10) as resp:
            data = await resp.json()

        docs = []
        for i, item in enumerate(data.get("query", {}).get("search", []), 1):
            title = item.get("title", "Unknown")
            snippet = item.get("snippet", "")
            # Strip HTML tags
            snippet = re.sub(r'<[^>]+>', '', snippet)
            # Truncate
            if len(snippet) > self.max_chars:
                snippet = snippet[:self.max_chars] + "..."
            docs.append(f"  Doc {i} (Title: {title})\n  {snippet}")

        return docs


# ============================================================================
# Agent Integration — wire the tool into the unified agent
# ============================================================================

INSTRUCTIONS = """\
You are a research assistant with access to a Wikipedia search tool.

When the user asks a factual or historical question:
1. Use the wikipedia_search tool with 1-3 complementary search queries
2. Synthesize the results into a clear, well-organized answer
3. Cite the titles of the sources you used

If the tool returns no results, try rephrasing the query with different keywords.
Do NOT make up information — only use what the search returns.
"""


async def run_with_tool(query: str, verbose: bool = False):
    """Run a query with Wikipedia search tool integration."""
    from web.lib.orchestra.unified_agent_service import (
        processUnifiedAgentRequest,
        UnifiedAgentConfig,
    )

    # Create the tool instance
    wiki_tool = WikipediaSearchTool(top_k=3)

    # Define the tool executor — called by the agent loop
    async def execute_tool(name: str, args: dict) -> dict:
        if name != "wikipedia_search":
            return {"success": False, "error": f"Unknown tool: {name}"}

        queries = args.get("queries", [])
        if not queries:
            # Handle case where LLM sends single query as string
            single_query = args.get("query", "")
            if single_query:
                queries = [single_query]
            else:
                return {"success": False, "error": "No search queries provided"}

        if isinstance(queries, str):
            queries = [queries]

        if verbose:
            print(f"  🔍 Searching Wikipedia for: {queries}")

        try:
            result = await wiki_tool.search(queries)
            return {"success": True, "output": result}
        except Exception as e:
            return {"success": False, "error": str(e)}

    # Define tool definitions for the LLM (JSON Schema)
    tool_definitions = [
        {
            "name": "wikipedia_search",
            "description": "Search Wikipedia for information. Supply an array of 1-3 complementary search queries for best results.",
            "parameters": {
                "type": "object",
                "properties": {
                    "queries": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Array of search query strings. Include multiple complementary queries.",
                    },
                },
                "required": ["queries"],
            },
        },
    ]

    config = UnifiedAgentConfig(
        userMessage=query,
        systemPrompt=INSTRUCTIONS,
        tools=tool_definitions,
        executeTool=execute_tool,
        maxSteps=10,
        mode="v1-api",
    )

    result = await processUnifiedAgentRequest(config)

    if result.success:
        print(f"\n{'='*60}")
        print("ANSWER")
        print(f"{'='*60}\n")
        print(result.response)
        print(f"\nSteps taken: {result.totalSteps}")
    else:
        print(f"\n✗ Failed: {result.error}")


def main():
    parser = argparse.ArgumentParser(description="Wikipedia Search Tool Example")
    parser.add_argument("--query",
                        default="What are the key milestones in the history of artificial intelligence?",
                        help="Research question")
    parser.add_argument("--verbose", action="store_true",
                        help="Show search queries being executed")
    parser.add_argument("--interactive", action="store_true",
                        help="Run in interactive mode")
    args = parser.parse_args()

    if args.interactive:
        print("Wikipedia Research Assistant — Interactive Mode")
        print("Ask any question — I'll search Wikipedia and synthesize an answer")
        print("Type 'exit' to quit\n")
        while True:
            query = input("> ").strip()
            if query.lower() in ("exit", "quit", "q"):
                break
            if not query:
                continue
            asyncio.run(run_with_tool(query, verbose=args.verbose))
        return

    asyncio.run(run_with_tool(args.query, verbose=args.verbose))


if __name__ == "__main__":
    main()
