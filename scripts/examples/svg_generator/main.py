"""SVG Generator Example

An agent that researches a topic and creates an informative SVG visualization.

Usage:
    python scripts/examples/svg_generator/main.py
    python scripts/examples/svg_generator/main.py --query "Python performance tips"
    python scripts/examples/svg_generator/main.py --interactive
"""

import asyncio
import argparse
import os
import re
import sys
from pathlib import Path

# Add project root
project_root = str(Path(__file__).parent.parent.parent.parent)
if project_root not in sys.path:
    sys.path.insert(0, project_root)

INSTRUCTIONS = """\
You are an expert at creating informative SVG visualizations.

## Workflow
1. Research the given topic thoroughly
2. Synthesize key information
3. Create a visually appealing SVG that presents the findings

## SVG Requirements
- Valid SVG code only, wrapped in ```svg...```
- Include proper XML header: <?xml version="1.0" encoding="UTF-8"?>
- Use viewBox for responsiveness
- Include a clear title and structured sections
- Use readable fonts (system fonts, no external dependencies)
- Use a clean, modern color palette (3-4 colors max)
- Include icons/shapes for visual interest
- Text should be legible (min 12px font-size)

## Content Guidelines
- Lead with key findings
- Use bullet points or short paragraphs
- Include relevant statistics if available
- Organize into clear sections
- Make it self-contained (no external dependencies)

## Output
Only output the SVG code, nothing else. No explanations before or after.
"""


def generate_svg(query: str, output_dir: str = "/tmp/svg_outputs"):
    """Generate an SVG visualization for the given query."""
    from web.lib.orchestra.unified_agent_service import (
        processUnifiedAgentRequest,
        UnifiedAgentConfig,
    )

    config = UnifiedAgentConfig(
        userMessage=query,
        systemPrompt=INSTRUCTIONS,
        maxSteps=30,
        mode="v1-api",
    )

    result = asyncio.get_event_loop().run_until_complete(
        processUnifiedAgentRequest(config)
    )

    if result.success:
        # Extract SVG from response
        match = re.search(r"```svg(.*?)```", result.response, re.DOTALL)
        svg_content = match.group(1).strip() if match else result.response

        # Ensure it has XML header
        if not svg_content.startswith("<?xml"):
            svg_content = '<?xml version="1.0" encoding="UTF-8"?>\n' + svg_content

        # Save
        os.makedirs(output_dir, exist_ok=True)
        safe_name = re.sub(r'[^a-zA-Z0-9_\-]', '_', query)[:50]
        output_path = os.path.join(output_dir, f"{safe_name}.svg")

        with open(output_path, "w", encoding="utf-8") as f:
            f.write(svg_content)

        print(f"\n✓ SVG generated successfully")
        print(f"Saved to: {output_path}")
        print(f"Size: {len(svg_content)} bytes")

        # Show preview info
        title_match = re.search(r'<title>(.*?)</title>', svg_content)
        if title_match:
            print(f"Title: {title_match.group(1)}")
    else:
        print(f"\n✗ Generation failed: {result.error}")


def main():
    parser = argparse.ArgumentParser(description="SVG Generator Example")
    parser.add_argument("--query",
                        default="deepseek-v3.1有哪些亮点更新?",
                        help="Topic to research and visualize")
    parser.add_argument("--output", default="/tmp/svg_outputs",
                        help="Output directory")
    parser.add_argument("--interactive", action="store_true",
                        help="Run in interactive mode")
    args = parser.parse_args()

    if args.interactive:
        print("SVG Generator - Interactive Mode")
        print("Enter a topic to visualize as SVG")
        print("Type 'exit' to quit\n")
        while True:
            query = input("> ").strip()
            if query.lower() in ("exit", "quit", "q"):
                break
            if not query:
                continue
            generate_svg(query, args.output)
        return

    generate_svg(args.query, args.output)


if __name__ == "__main__":
    main()
