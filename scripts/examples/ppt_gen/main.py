"""PPT Generation Example

An agent that generates PowerPoint presentations from content.
Uses structured JSON schema for slide definitions.

Usage:
    python scripts/examples/ppt_gen/main.py
    python scripts/examples/ppt_gen/main.py --url "https://example.com/article"
    python scripts/examples/ppt_gen/main.py --file report.pdf
    python scripts/examples/ppt_gen/main.py --interactive
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

INSTRUCTIONS = """\
You are an expert in PowerPoint presentation generation.

## Workflow
1. Analyze the content and structure of the provided material
2. Arrange content in a logical, coherent flow
3. Generate a structured presentation slide by slide

## Presentation Structure
Each presentation should follow this pattern:
1. **Title Slide**: Main title, subtitle
2. **Introduction**: Overview of the topic
3. **Content Slides**: Key points with bullet lists, tables, or images
4. **Section Dividers**: Between major topics
5. **Conclusion**: Summary and key takeaways
6. **Acknowledgement**: References, Q&A

## Guidelines
- Extract key points only — don't dive too deep
- Keep text concise (max 6 bullets per slide, max 15 words per bullet)
- Use tables for structured data
- Include image URLs if available in source material
- Aim for 8-15 slides total
- Each slide should be self-contained

## Output Format
Generate a JSON schema describing the presentation:
```json
{
  "slides": [
    {"type": "title", "title": "...", "subtitle": "..."},
    {"type": "content", "title": "...", "bullets": ["...", "..."]},
    {"type": "section_title", "title": "..."},
    {"type": "content_with_table", "title": "...", "table": {"headers": [], "rows": []}},
    {"type": "content_with_image", "title": "...", "bullets": [], "image_url": "...", "image_caption": "..."},
    {"type": "acknowledgement", "text": "..."}
  ]
}
```

After generating the JSON, also generate the actual Python code to create the PPTX file using python-pptx.
"""


def generate_ppt(source: str, source_type: str = "text", output_dir: str = "/tmp/ppt_outputs"):
    """Generate a PowerPoint presentation from source content."""
    from web.lib.orchestra.unified_agent_service import (
        processUnifiedAgentRequest,
        UnifiedAgentConfig,
    )

    query = f"Generate a PowerPoint presentation from the following {source_type}:\n\n{source}"

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
        print(f"\n✓ Presentation structure generated")
        print(f"\n{result.response[:1000]}...")

        # Try to extract and save the PPTX if python-pptx code was generated
        # For now, save the full response as a reference
        os.makedirs(output_dir, exist_ok=True)
        safe_name = f"presentation_{len(os.listdir(output_dir))}.md"
        output_path = os.path.join(output_dir, safe_name)

        with open(output_path, "w", encoding="utf-8") as f:
            f.write(result.response)

        print(f"\nSaved to: {output_path}")
    else:
        print(f"\n✗ Generation failed: {result.error}")


def generate_from_file(file_path: str, output_dir: str = "/tmp/ppt_outputs"):
    """Generate PPT from a local file."""
    abs_path = os.path.abspath(file_path)
    if not os.path.exists(abs_path):
        print(f"File not found: {abs_path}")
        return

    print(f"Reading file: {abs_path}")
    try:
        with open(abs_path, "r", encoding="utf-8") as f:
            content = f.read()
        generate_ppt(content, source_type=f"file ({os.path.basename(abs_path)})", output_dir=output_dir)
    except Exception as e:
        print(f"Error reading file: {e}")


def main():
    parser = argparse.ArgumentParser(description="PPT Generation Example")
    parser.add_argument("--query", help="Text content to convert")
    parser.add_argument("--file", help="Path to source file")
    parser.add_argument("--url", help="URL of source content")
    parser.add_argument("--output", default="/tmp/ppt_outputs",
                        help="Output directory")
    parser.add_argument("--interactive", action="store_true",
                        help="Run in interactive mode")
    args = parser.parse_args()

    if args.interactive:
        print("PPT Generator - Interactive Mode")
        print("Enter text, file path, or URL to convert to presentation")
        print("Type 'exit' to quit\n")
        while True:
            query = input("> ").strip()
            if query.lower() in ("exit", "quit", "q"):
                break
            if not query:
                continue
            if os.path.isfile(query):
                generate_from_file(query, args.output)
            elif query.startswith("http"):
                generate_ppt(f"Content from URL: {query}", source_type="URL", output_dir=args.output)
            else:
                generate_ppt(query, output_dir=args.output)
        return

    if args.file:
        generate_from_file(args.file, args.output)
    elif args.url:
        generate_ppt(f"Content from URL: {args.url}", source_type="URL", output_dir=args.output)
    elif args.query:
        generate_ppt(args.query, output_dir=args.output)
    else:
        # Default demo
        sample_topic = """\
The History and Impact of Open Source Software

Open source software has transformed the technology landscape.
Key points:
- Linux: Created by Linus Torvalds in 1991, now powers 90%+ of cloud infrastructure
- Apache: The web server that started in 1995, still runs ~30% of websites
- Git: Distributed version control by Linus Torvalds, 2005
- Python: Created by Guido van Rossum in 1991, now #1 language for AI/ML
- React: Facebook's UI library, revolutionized frontend development
- Kubernetes: Google's container orchestration, became industry standard
- VS Code: Most popular code editor, built on open source Electron
"""
        print("Default: Generating presentation on Open Source Software history...")
        generate_ppt(sample_topic, output_dir=args.output)


if __name__ == "__main__":
    main()
