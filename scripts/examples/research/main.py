"""Deep Research Example

A multi-agent research system with:
- Planner: determines what searches to perform
- Searcher: executes web searches and summarizes results
- Writer: synthesizes findings into a comprehensive report

Usage:
    python scripts/examples/research/main.py
    python scripts/examples/research/main.py --query "Latest advances in quantum computing"
    python scripts/examples/research/main.py --interactive
"""

import asyncio
import argparse
import json
import sys
from pathlib import Path
from dataclasses import dataclass, field
from typing import Optional

# Add project root
project_root = str(Path(__file__).parent.parent.parent.parent)
if project_root not in sys.path:
    sys.path.insert(0, project_root)


# ─── Prompts ─────────────────────────────────────────────────────────────────

PLANNER_PROMPT = """\
You are a helpful research assistant. Given a query, come up with a set of web \
searches to perform to best answer the query. Output between 5 and 15 search terms.

For each search term, explain why it's important to the query.

Format your response as JSON:
{
    "searches": [
        {"query": "search term 1", "reason": "why this matters"},
        {"query": "search term 2", "reason": "why this matters"},
        ...
    ]
}
"""

SEARCH_PROMPT = """\
You are a research assistant. Given a search term, you browse the available \
information and produce a concise summary of the results.

The summary must be 2-3 paragraphs and less than 300 words.
Capture the main points. Write succinctly — no need for complete sentences.
This will be consumed by someone synthesizing a report, so capture the essence \
and ignore any fluff. Do not include additional commentary.
"""

WRITER_PROMPT = """\
You are a senior researcher tasked with writing a cohesive report.
You will be provided with the original query and initial research findings.

First, come up with an outline for the report that describes the structure \
and flow. Then generate the report and return it as your final output.

The final output should be in markdown format, lengthy and detailed.
Aim for 5-10 pages of content, at least 1000 words.
"""


# ─── Research Manager ────────────────────────────────────────────────────────

@dataclass
class SearchItem:
    query: str
    reason: str


@dataclass
class ReportData:
    short_summary: str = ""
    markdown_report: str = ""
    follow_up_questions: list[str] = field(default_factory=list)


class ResearchManager:
    """Multi-agent research orchestrator.

    Flow:
    1. Planner determines what searches to perform
    2. Searcher executes each search in parallel
    3. Writer synthesizes final report
    """

    def __init__(self, verbose: bool = False):
        self.verbose = verbose
        self.search_plan: list[SearchItem] = []
        self.search_results: list[str] = []
        self.report: Optional[ReportData] = None

    async def plan_searches(self, query: str) -> list[SearchItem]:
        """Use LLM to plan search queries."""
        from web.lib.orchestra.unified_agent_service import (
            processUnifiedAgentRequest,
            UnifiedAgentConfig,
        )

        if self.verbose:
            print("  [Planner] Planning searches...")

        config = UnifiedAgentConfig(
            userMessage=f"Query: {query}",
            systemPrompt=PLANNER_PROMPT,
            maxSteps=5,
            mode="v1-api",
        )

        result = await processUnifiedAgentRequest(config)

        if not result.success:
            print(f"  [Planner] Failed: {result.error}")
            return []

        # Parse search plan from response
        try:
            text = result.response
            # Try to extract JSON
            if "```json" in text:
                text = text.split("```json")[1].split("```")[0].strip()
            elif "{" in text:
                start = text.index("{")
                end = text.rindex("}") + 1
                text = text[start:end]

            data = json.loads(text)
            searches = data.get("searches", [])
            self.search_plan = [
                SearchItem(query=s["query"], reason=s["reason"])
                for s in searches
            ]
        except (json.JSONDecodeError, KeyError, IndexError) as e:
            print(f"  [Planner] Parse error: {e}")
            # Fallback: create a single search
            self.search_plan = [SearchItem(query=query, reason="Direct search")]

        if self.verbose:
            print(f"  [Planner] Will perform {len(self.search_plan)} searches")

        return self.search_plan

    async def perform_search(self, item: SearchItem) -> str:
        """Perform a single search and summarize results."""
        from web.lib.orchestra.unified_agent_service import (
            processUnifiedAgentRequest,
            UnifiedAgentConfig,
        )

        config = UnifiedAgentConfig(
            userMessage=f"Search term: {item.query}\nReason: {item.reason}",
            systemPrompt=SEARCH_PROMPT,
            maxSteps=5,
            mode="v1-api",
        )

        try:
            result = await processUnifiedAgentRequest(config)
            if result.success:
                return result.response
        except Exception as e:
            if self.verbose:
                print(f"  [Search] Error for '{item.query}': {e}")

        return None

    async def perform_searches(self, search_plan: list[SearchItem]) -> list[str]:
        """Perform all searches in parallel."""
        if self.verbose:
            print("  [Search] Searching...")

        # Run searches concurrently
        tasks = [self.perform_search(item) for item in search_plan]
        results = []
        completed = 0

        for coro in asyncio.as_completed(tasks):
            result = await coro
            if result:
                results.append(result)
            completed += 1
            if self.verbose:
                print(f"  [Search] {completed}/{len(tasks)} completed")

        self.search_results = results
        if self.verbose:
            print(f"  [Search] Done. {len(results)} results collected.")

        return results

    async def write_report(self, query: str, search_results: list[str]) -> ReportData:
        """Write a comprehensive report from search results."""
        from web.lib.orchestra.unified_agent_service import (
            processUnifiedAgentRequest,
            UnifiedAgentConfig,
        )

        if self.verbose:
            print("  [Writer] Writing report...")

        results_summary = "\n\n---\n\n".join(search_results)
        config = UnifiedAgentConfig(
            userMessage=f"Original query: {query}\n\nResearch findings:\n{results_summary}",
            systemPrompt=WRITER_PROMPT,
            maxSteps=10,
            mode="v1-api",
        )

        result = await processUnifiedAgentRequest(config)

        if result.success:
            self.report = ReportData(
                short_summary=result.response[:500] + "...",
                markdown_report=result.response,
                follow_up_questions=[],
            )
        else:
            self.report = ReportData(
                short_summary="Report generation failed",
                markdown_report=f"Error: {result.error}",
            )

        if self.verbose:
            print("  [Writer] Report complete")

        return self.report

    async def run(self, query: str) -> ReportData:
        """Run the full research pipeline."""
        print(f"\n{'='*60}")
        print(f"Research: {query}")
        print(f"{'='*60}\n")

        # Step 1: Plan searches
        search_plan = await self.plan_searches(query)
        if not search_plan:
            return ReportData(markdown_report="Failed to plan searches")

        # Step 2: Perform searches
        search_results = await self.perform_searches(search_plan)

        # Step 3: Write report
        report = await self.write_report(query, search_results)

        # Print results
        print(f"\n{'='*60}")
        print("REPORT SUMMARY")
        print(f"{'='*60}\n")
        print(report.short_summary)
        print(f"\n{'='*60}")
        print("FULL REPORT")
        print(f"{'='*60}\n")
        print(report.markdown_report)

        if report.follow_up_questions:
            print(f"\n{'='*60}")
            print("FOLLOW-UP QUESTIONS")
            print(f"{'='*60}\n")
            for i, q in enumerate(report.follow_up_questions, 1):
                print(f"  {i}. {q}")

        return report


def main():
    parser = argparse.ArgumentParser(description="Deep Research Example")
    parser.add_argument("--query", help="Research query")
    parser.add_argument("--interactive", action="store_true",
                        help="Run in interactive mode")
    parser.add_argument("--verbose", action="store_true",
                        help="Show detailed progress")
    parser.add_argument("--output", help="Save report to file")
    args = parser.parse_args()

    async def run_query(q: str):
        manager = ResearchManager(verbose=args.verbose)
        report = await manager.run(q)

        if args.output:
            with open(args.output, "w", encoding="utf-8") as f:
                f.write(report.markdown_report)
            print(f"\nReport saved to: {args.output}")

    if args.interactive:
        print("Deep Research Agent - Interactive Mode")
        print("Type 'exit' to quit\n")
        while True:
            query = input("> ").strip()
            if query.lower() in ("exit", "quit", "q"):
                break
            if not query:
                continue
            asyncio.run(run_query(query))
        return

    if args.query:
        asyncio.run(run_query(args.query))
    else:
        # Default query
        asyncio.run(run_query("What are the latest breakthroughs in AI and machine learning?"))


if __name__ == "__main__":
    main()
