"""Data Analysis Example

An agent that analyzes tabular data files (CSV, Excel) and generates
HTML reports with insights, statistics, and visualizations.

Usage:
    python scripts/examples/data_analysis/main.py
    python scripts/examples/data_analysis/main.py --file data.csv
    python scripts/examples/data_analysis/main.py --interactive
"""

import asyncio
import argparse
import os
import sys
import re
from pathlib import Path

# Add project root
project_root = str(Path(__file__).parent.parent.parent.parent)
if project_root not in sys.path:
    sys.path.insert(0, project_root)

INSTRUCTIONS = """\
You are an expert data analyst specialized in tabular data analysis and report generation.

## Capabilities
- Analyze CSV, Excel, and other tabular data files
- Perform statistical analysis (mean, median, distributions, correlations)
- Identify patterns, trends, and anomalies
- Generate clear, actionable insights
- Create HTML reports with embedded visualizations

## Workflow
1. **Data Inspection**: Read the file, understand schema, identify data types
2. **Exploratory Analysis**: Compute summary statistics, identify missing values
3. **Pattern Discovery**: Find correlations, trends, outliers, groupings
4. **Insight Generation**: Extract meaningful findings from the data
5. **Report Generation**: Create a clean, professional HTML report

## Output Requirements
- HTML reports must be complete, valid HTML5
- Include inline CSS for styling (no external dependencies)
- Use tables, lists, and clear section headers
- Highlight key findings at the top
- Include data summary and statistical results
- If generating visualizations, use simple HTML/CSS/JS (no external libs needed)

## Communication Style
- Be concise and data-driven
- Lead with key findings
- Support claims with specific numbers
- Explain what the data shows, not just what you did
- Flag data quality issues or limitations
"""


def analyze_file(file_path: str, output_dir: str = None):
    """Analyze a data file and generate report."""
    from web.lib.orchestra.unified_agent_service import (
        processUnifiedAgentRequest,
        UnifiedAgentConfig,
    )

    abs_path = os.path.abspath(file_path)
    if not os.path.exists(abs_path):
        print(f"File not found: {abs_path}")
        return

    query = f"分析位于 `{abs_path}` 的数据文件，提取有价值的信息，生成一份 HTML 分析报告。"

    config = UnifiedAgentConfig(
        userMessage=query,
        systemPrompt=INSTRUCTIONS,
        maxSteps=50,
        mode="v1-api",
    )

    result = asyncio.get_event_loop().run_until_complete(
        processUnifiedAgentRequest(config)
    )

    if result.success:
        # Extract HTML from response
        match = re.search(r"```html(.*?)```", result.response, re.DOTALL)
        html_content = match.group(1).strip() if match else result.response

        # Save report
        output_dir = output_dir or str(Path(abs_path).parent)
        os.makedirs(output_dir, exist_ok=True)
        report_path = os.path.join(output_dir, "analysis_report.html")

        with open(report_path, "w", encoding="utf-8") as f:
            f.write(html_content)

        print(f"\n✓ Analysis complete")
        print(f"Report saved to: {report_path}")
        print(f"\nKey findings:")
        # Print first 500 chars of response as summary
        print(result.response[:500] + "...")
    else:
        print(f"\n✗ Analysis failed: {result.error}")


def create_sample_data():
    """Create a sample CSV for testing."""
    import csv

    output = "/tmp/sample_data.csv"
    with open(output, "w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["name", "age", "department", "salary", "years_experience", "performance_score"])
        data = [
            ["Alice", 28, "Engineering", 95000, 5, 4.2],
            ["Bob", 35, "Marketing", 78000, 12, 3.8],
            ["Charlie", 42, "Engineering", 125000, 18, 4.5],
            ["Diana", 31, "Sales", 85000, 8, 4.0],
            ["Eve", 26, "Engineering", 88000, 3, 3.9],
            ["Frank", 39, "Marketing", 92000, 14, 4.1],
            ["Grace", 33, "Sales", 96000, 9, 4.3],
            ["Henry", 45, "Engineering", 135000, 22, 4.7],
            ["Ivy", 29, "Marketing", 72000, 6, 3.5],
            ["Jack", 37, "Sales", 89000, 11, 3.9],
            ["Kate", 24, "Engineering", 82000, 2, 4.0],
            ["Leo", 41, "Marketing", 98000, 16, 4.4],
            ["Mia", 30, "Sales", 91000, 7, 4.2],
            ["Nick", 36, "Engineering", 108000, 13, 4.1],
            ["Olivia", 32, "Marketing", 86000, 9, 3.7],
        ]
        writer.writerows(data)

    print(f"Created sample data at: {output}")
    return output


def main():
    parser = argparse.ArgumentParser(description="Data Analysis Example")
    parser.add_argument("--file", help="Path to data file (CSV, Excel)")
    parser.add_argument("--output", help="Output directory for report")
    parser.add_argument("--sample", action="store_true",
                        help="Create sample data for testing")
    parser.add_argument("--interactive", action="store_true",
                        help="Run in interactive mode")
    args = parser.parse_args()

    if args.sample:
        args.file = create_sample_data()

    if args.interactive:
        print("Data Analysis Agent - Interactive Mode")
        print("Enter file path or 'sample' to use sample data")
        print("Type 'exit' to quit\n")
        while True:
            query = input("> ").strip()
            if query.lower() in ("exit", "quit", "q"):
                break
            if not query:
                continue
            if query.lower() == "sample":
                query = create_sample_data()
            analyze_file(query, args.output)
        return

    if args.file:
        analyze_file(args.file, args.output)
    else:
        print("Specify a file with --file or create sample data with --sample")


if __name__ == "__main__":
    main()
