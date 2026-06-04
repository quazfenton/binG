import os
import subprocess
import requests
import json

"""
AI Code Review Agent Script
---------------------------
Purpose:
This script performs automated code reviews using a local LLM (Ollama).
It is designed to run in a GitHub Actions environment.

Use Cases:
1. Pull Request Review: If a commit is part of an open PR, the AI's findings
   are posted as a comment directly on the PR thread (CodeRabbit-style).
2. Push Feedback: For commits pushed directly to branches without a PR,
   the findings are created as a new GitHub Issue for tracking.
3. Lightweight Analysis: Optimised for small models (Qwen2.5-Coder 1.5B)
   to run efficiently on standard GitHub-hosted runners.
"""

# Setup environment variables
GITHUB_TOKEN = os.getenv("GITHUB_TOKEN")
REPO = os.getenv("GITHUB_REPOSITORY")
CURRENT_SHA = os.getenv("GITHUB_SHA")
BEFORE_SHA = os.getenv("BEFORE_SHA")
HEADERS = {
    "Authorization": f"token {GITHUB_TOKEN}",
    "Accept": "application/vnd.github.v3+json"
}

def run_command(cmd):
    result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, shell=True)
    return result.stdout.strip()

def get_changed_files_and_diffs():
    """Gets files changed in this push and extracts individual diffs"""
    if BEFORE_SHA == "0000000000000000000000000000000000000000" or not BEFORE_SHA:
        base = f"{CURRENT_SHA}^"
    else:
        base = BEFORE_SHA

    try:
        files_output = run_command(f"git diff --name-only {base} {CURRENT_SHA}")
    except Exception:
        # Fallback if parent commit doesn't exist locally
        files_output = run_command(f"git diff --name-only HEAD~1 HEAD")

    files = [f for f in files_output.split("\n") if f.strip()]
    
    file_diffs = {}
    # Ignore common text, package lock, and image files to save context tokens
    ignore_extensions = ['.md', '.png', '.jpg', '.jpeg', '.lock', '.json', '.svg', '.yml', '.yaml']
    
    for file in files:
        if any(file.endswith(ext) for ext in ignore_extensions):
            continue
        
        diff = run_command(f"git diff {base} {CURRENT_SHA} -- \"{file}\"")
        if diff:
            file_diffs[file] = diff
    return file_diffs

def check_for_associated_pr():
    """Queries GitHub API to find if this commit belongs to an ongoing active Pull Request"""
    url = f"https://api.github.com/repos/{REPO}/commits/{CURRENT_SHA}/pulls"
    response = requests.get(url, headers=HEADERS)
    if response.status_code == 200 and response.json():
        open_prs = [pr for pr in response.json() if pr["state"] == "open"]
        if open_prs:
            return open_prs[0]["number"]
    return None

def query_ollama(file_name, diff_content):
    """Sends code diff directly to local Ollama instance utilizing Qwen2.5-Coder"""
    prompt = f"""
    You are an automated AI Senior Code Reviewer. Analyze this Git Diff for '{file_name}'.
    Look for critical bugs, logic flaws, or obvious clean-code improvements.
    
    Provide your output exactly in this Markdown format:
    ### 📄 File: `{file_name}`
    - **Summary of Changes**: A brief 1-sentence recap.
    - **Review Findings**:
      - 🚨 **[Bug/Style]**: Description of the problem.
      - 💡 **Suggestion**: Paste a code block snippet showing the refactored fix.
    
    If the changes are fine, reply exactly with: "No changes required."
    
    Git Diff:
    ```diff
    {diff_content}
    ```
    """
    
    url = "http://localhost:11434/api/generate"
    payload = {
        "model": "qwen2.5-coder:1.5b",
        "prompt": prompt,
        "stream": False,
        "options": {
            "temperature": 0.2 # Lower temperature forces more structured, predictable outputs
        }
    }
    
    try:
        response = requests.post(url, json=payload, timeout=120)
        return response.json().get("response", "").strip()
    except Exception as e:
        return f"Error analyzing {file_name}: {str(e)}"

def post_pr_comment(pr_number, review_body):
    """Comments directly on an active, ongoing PR thread"""
    url = f"https://api.github.com/repos/{REPO}/issues/{pr_number}/comments"
    payload = {"body": review_body}
    requests.post(url, json=payload, headers=HEADERS)
    print(f"Posted automated review comment on Pull Request #{pr_number}")

def create_github_issue(review_body):
    """Creates a new tracking Issue for standard standalone pushes outside of PR cycles"""
    url = f"https://api.github.com/repos/{REPO}/issues"
    payload = {
        "title": f"🤖 AI Code Review: Automated Push Feedback ({CURRENT_SHA[:7]})",
        "body": review_body,
        "labels": ["ai-review", "automated"]
    }
    requests.post(url, json=payload, headers=HEADERS)
    print("No open PR found. Created a fallback GitHub tracking Issue with findings.")

def main():
    print("Analyzing repository changes...")
    file_diffs = get_changed_files_and_diffs()
    
    if not file_diffs:
        print("No eligible code adjustments or diff lines found to review.")
        return

    full_review_report = "## 🤖 CodeRabbit-Style Automated AI Review\n\n"
    has_findings = False

    for file_name, diff in file_diffs.items():
        print(f"Reviewing: {file_name}")
        file_analysis = query_ollama(file_name, diff)
        
        if "No changes required." not in file_analysis and len(file_analysis) > 10:
            full_review_report += file_analysis + "\n\n---\n\n"
            has_findings = True

    if not has_findings:
        print("All adjustments parsed cleanly. No code feedback triggered.")
        return

    # Route output based on PR status
    pr_number = check_for_associated_pr()
    if pr_number:
        post_pr_comment(pr_number, full_review_report)
    else:
        create_github_issue(full_review_report)

if __name__ == "__main__":
    main()
