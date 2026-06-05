import os
import re
import shlex
import subprocess
import sys
import requests

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

if not (GITHUB_TOKEN and REPO and CURRENT_SHA):
    print(
        "Missing required env vars (GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_SHA); aborting.",
        file=sys.stderr,
    )
    sys.exit(1)

HEADERS = {
    "Authorization": f"token {GITHUB_TOKEN}",
    "Accept": "application/vnd.github.v3+json",
    "User-Agent": "binG-ai-review/1.0",
}

# Hard cap on a single diff to keep the prompt within the model's
# context window. Qwen2.5-Coder 1.5B has a 32K context, so we leave
# plenty of room for the system + output tokens.
MAX_DIFF_CHARS = 16_000
# Hard timeout for the Ollama request — the 1.5B model is small but
# can still hang on odd inputs.
OLLAMA_TIMEOUT_SECS = 120
# Per-file analysis also needs a network timeout.
GITHUB_TIMEOUT_SECS = 30
# Skip files whose name matches one of these regexes. We trust the
# list returned by `git diff --name-only`, but defence in depth: a
# malicious commit could try to feed us filenames like `; rm -rf /`.
SAFE_FILENAME_RE = re.compile(r"^[A-Za-z0-9 _./@+$\-]{1,512}$")
# Detect path traversal attempts in the per-file `git diff` arg.
PATH_TRAVERSAL_RE = re.compile(r"(^|/)\.\.($|/)")


def _run_git(args, check=True):
    """Run a git command with a list form (no shell, no injection)."""
    result = subprocess.run(
        ["git", *args],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    if check and result.returncode != 0:
        raise RuntimeError(
            f"git {' '.join(args)} failed (exit {result.returncode}): {result.stderr.strip()}"
        )
    return result.stdout


def get_changed_files_and_diffs():
    """Gets files changed in this push and extracts individual diffs."""
    # Choose a base ref. For the first push of a branch, BEFORE_SHA
    # is the sentinel `0000…000`; fall back to the current commit's
    # parent. If that's missing (single-commit repo), bail — there
    # is genuinely nothing to diff.
    if not BEFORE_SHA or BEFORE_SHA == "0000000000000000000000000000000000000000":
        base = f"{CURRENT_SHA}^"
    else:
        base = BEFORE_SHA

    try:
        files_output = _run_git(["diff", "--name-only", base, CURRENT_SHA])
    except RuntimeError:
        try:
            files_output = _run_git(["diff", "--name-only", "HEAD~1", "HEAD"])
        except RuntimeError:
            print(
                "No parent commit available; nothing to review on first-push of a brand new branch.",
                file=sys.stderr,
            )
            return {}

    files = [f for f in files_output.split("\n") if f.strip()]
    file_diffs = {}
    # Ignore common text, package lock, and image files to save context tokens.
    ignore_extensions = ['.md', '.png', '.jpg', '.jpeg', '.lock', '.json', '.svg', '.yml', '.yaml']

    for file in files:
        if any(file.endswith(ext) for ext in ignore_extensions):
            continue
        # Defence in depth: skip anything that looks like a malicious
        # filename or attempts path traversal.
        if not SAFE_FILENAME_RE.match(file) or PATH_TRAVERSAL_RE.search(file):
            print(f"Skipping suspicious filename: {file!r}", file=sys.stderr)
            continue

        try:
            diff = _run_git(["diff", base, CURRENT_SHA, "--", file])
        except RuntimeError as e:
            print(f"Failed to diff {file}: {e}", file=sys.stderr)
            continue
        if diff:
            if len(diff) > MAX_DIFF_CHARS:
                diff = diff[:MAX_DIFF_CHARS] + "\n... (diff truncated)\n"
            file_diffs[file] = diff
    return file_diffs


def check_for_associated_pr():
    """Queries GitHub API to find if this commit belongs to an ongoing active Pull Request."""
    url = f"https://api.github.com/repos/{REPO}/commits/{CURRENT_SHA}/pulls"
    try:
        response = requests.get(url, headers=HEADERS, timeout=GITHUB_TIMEOUT_SECS)
    except requests.RequestException as e:
        print(f"PR lookup failed: {e}", file=sys.stderr)
        return None
    if response.status_code != 200:
        print(
            f"PR lookup returned {response.status_code}: {response.text[:200]!r}",
            file=sys.stderr,
        )
        return None
    try:
        data = response.json()
    except ValueError:
        return None
    open_prs = [pr for pr in data if pr.get("state") == "open"]
    if open_prs:
        return open_prs[0]["number"]
    return None


def query_ollama(file_name, diff_content):
    """Sends code diff directly to local Ollama instance utilizing Qwen2.5-Coder."""
    prompt = f"""
    You are an automated AI Senior Code Reviewer. Analyze this Git Diff for '{file_name}'.
    Look for critical bugs, logic flaws, or obvious clean-code improvements.

    Provide your output exactly in this Markdown format:
    ### File: `{file_name}`
    - **Summary of Changes**: A brief 1-sentence recap.
    - **Review Findings**:
      - **[Bug/Style]**: Description of the problem.
      - **Suggestion**: Paste a code block snippet showing the refactored fix.

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
            "temperature": 0.2,  # Lower temperature forces more structured, predictable outputs
        },
    }

    try:
        response = requests.post(url, json=payload, timeout=OLLAMA_TIMEOUT_SECS)
    except requests.RequestException as e:
        return f"Error analyzing {file_name}: Ollama request failed: {e}"
    if response.status_code != 200:
        return f"Error analyzing {file_name}: Ollama returned HTTP {response.status_code}"
    try:
        return response.json().get("response", "").strip()
    except ValueError:
        return f"Error analyzing {file_name}: Ollama returned non-JSON body"


def _post_json(url, payload):
    """POST JSON to GitHub; return response object or raise."""
    response = requests.post(url, json=payload, headers=HEADERS, timeout=GITHUB_TIMEOUT_SECS)
    if response.status_code >= 300:
        raise RuntimeError(
            f"POST {url} returned {response.status_code}: {response.text[:500]}"
        )
    return response


def post_pr_comment(pr_number, review_body):
    """Comments directly on an active, ongoing PR thread."""
    url = f"https://api.github.com/repos/{REPO}/issues/{pr_number}/comments"
    _post_json(url, {"body": review_body})
    print(f"Posted automated review comment on Pull Request #{pr_number}")


def create_github_issue(review_body):
    """Creates a new tracking Issue for standard standalone pushes outside of PR cycles."""
    url = f"https://api.github.com/repos/{REPO}/issues"
    payload = {
        "title": f"AI Code Review: Automated Push Feedback ({CURRENT_SHA[:7]})",
        "body": review_body,
        "labels": ["ai-review", "automated"],
    }
    _post_json(url, payload)
    print("No open PR found. Created a fallback GitHub tracking Issue with findings.")


def main():
    print("Analyzing repository changes...")
    file_diffs = get_changed_files_and_diffs()

    if not file_diffs:
        print("No eligible code adjustments or diff lines found to review.")
        return

    full_review_report = "## CodeRabbit-Style Automated AI Review\n\n"
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
