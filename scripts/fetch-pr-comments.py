#!/usr/bin/env python3
"""
fetch-pr-comments.py

Fetches GitHub PR review comments and appends new ones to local files.
Deduplicates by comment ID, tracks pagination state, and auto-resumes.

Usage:
  python scripts/fetch-pr-comments.py                          # auto-detect repo + latest PR
  python scripts/fetch-pr-comments.py --repo owner/repo       # specific repo
  python scripts/fetch-pr-comments.py --pr 61                 # specific PR number
  python scripts/fetch-pr-comments.py --repo owner/repo --pr 61 --per-page 40
  python scripts/fetch-pr-comments.py --out-dir ./pr-comments  # custom output dir
"""

import argparse
import json
import os
import re
import subprocess
import sys
import time
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Optional

import requests


@dataclass
class CommentRecord:
    id: int
    path: str
    start_line: Optional[int]
    original_start_line: Optional[int]
    line: Optional[int]
    original_line: Optional[int]
    original_position: Optional[int]
    position: Optional[int]
    diff_hunk: str
    body: str
    author_login: str
    created_at: str
    updated_at: str


@dataclass
class PaginationState:
    last_page_fetched: int = 0
    total_pages: int = 0
    per_page: int = 30


@dataclass
class FetchResult:
    new_comments: int = 0
    duplicate_comments: int = 0
    total_fetched: int = 0
    pages_fetched: int = 0
    stopped_early: bool = False
    has_more_comments: bool = False
    message: str = ""


@dataclass
class RepositoryConfig:
    repo: str
    pr_number: int
    per_page: int = 30
    token: Optional[str] = None

    @property
    def api_url(self) -> str:
        return f"https://api.github.com/repos/{self.repo}/pulls/{self.pr_number}/comments"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Fetch GitHub PR review comments with deduplication and auto-resume.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  %(prog)s --repo quazfenton/bing --pr 61 --per-page 40
  %(prog)s --repo quazfenton/bing --pr 61 --token ghp_xxxxx
  %(prog)s  # auto-detects repo from git remote and latest PR
        """,
    )

    parser.add_argument("--repo", "-r", type=str,
                        help="Repository in 'owner/name' format (auto-detected from git if omitted)")
    parser.add_argument("--pr", "-p", type=int,
                        help="PR number (auto-detected to latest by default)")
    parser.add_argument("--per-page", type=int, default=30,
                        help="Comments per page (max 100, default: 30)")
    parser.add_argument("--start-page", type=int, default=None,
                        help="Page number to start fetching from (default: page 1, or resume from last)")
    parser.add_argument("--out-dir", "-o", type=str, default="./pr-comments",
                        help="Output directory (default: ./pr-comments)")
    parser.add_argument("--token", "-t", type=str,
                        help="GitHub token (also via GITHUB_TOKEN env var)")
    parser.add_argument("--overwrite", action="store_true",
                        help="Clear existing files and re-fetch from page 1")
    parser.add_argument("--quiet", "-q", action="store_true",
                        help="Suppress informational output")
    parser.add_argument("--dry-run", action="store_true",
                        help="Show what would be fetched without making API requests")

    return parser.parse_args()


def get_git_remote_repo() -> Optional[str]:
    """Extract 'owner/repo' from git remote URL."""
    try:
        result = subprocess.run(
            ["git", "remote", "get-url", "origin"],
            capture_output=True, text=True, timeout=5,
        )
        if result.returncode != 0:
            return None

        url = result.stdout.strip()
        # git@github.com:owner/repo.git or https://github.com/owner/repo.git
        if url.startswith("git@"):
            match = re.search(r'github\.com[/:]([^/]+)/([^/]+?)(?:\.git)?$', url)
        else:
            match = re.search(r'github\.com/([^/]+)/([^/]+?)(?:\.git)?$', url)

        if match:
            return f"{match.group(1)}/{match.group(2)}"
    except Exception:
        pass
    return None


def get_current_branch() -> Optional[str]:
    """Get the current git branch name."""
    try:
        result = subprocess.run(
            ["git", "rev-parse", "--abbrev-ref", "HEAD"],
            capture_output=True, text=True, timeout=5,
        )
        if result.returncode == 0:
            return result.stdout.strip()
    except Exception:
        pass
    return None


def get_latest_pr_number(repo: str, token: Optional[str]) -> Optional[int]:
    """
    Get the PR number for auto-detection.
    Priority:
      1. Open PR matching the current git branch (head branch).
      2. Most recently updated open PR authored by the repo owner (if token).
      3. Most recently updated open PR.
    """
    headers = {"Accept": "application/vnd.github+json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"

    # ── Priority 1: match current branch ─────────────────────────────────────
    branch = get_current_branch()
    if branch and branch != 'HEAD':
        owner = repo.split('/')[0]
        url = f"https://api.github.com/repos/{repo}/pulls"
        params = {"state": "open", "head": f"{owner}:{branch}", "per_page": 1}
        try:
            r = requests.get(url, headers=headers, params=params, timeout=10)
            if r.ok:
                prs = r.json()
                if prs:
                    return prs[0]["number"]
        except Exception:
            pass

    # ── Priority 2/3: fall back to latest open PR ────────────────────────────
    user = None
    if token:
        try:
            r = requests.get("https://api.github.com/user", headers=headers, timeout=10)
            if r.ok:
                user = r.json().get("login")
        except Exception:
            pass

    url = f"https://api.github.com/repos/{repo}/pulls"
    params = {"state": "open", "sort": "updated", "direction": "desc", "per_page": 30}
    try:
        r = requests.get(url, headers=headers, params=params, timeout=10)
        if not r.ok:
            return None
        prs = r.json()
        if not prs:
            return None
        if user:
            for pr in prs:
                if pr.get("user", {}).get("login") == user:
                    return pr["number"]
        return prs[0]["number"]
    except Exception:
        return None


def load_seen_ids(out_dir: Path) -> set[int]:
    """Load comment IDs already saved in the output directory."""
    seen: set[int] = set()
    for f in out_dir.glob("*.json"):
        try:
            with open(f) as fp:
                data = json.load(fp)
                cid = data.get("id")
                if isinstance(cid, int):
                    seen.add(cid)
        except Exception:
            pass
    return seen


def load_state(out_dir: Path) -> PaginationState:
    """Load pagination state from disk."""
    state_file = out_dir / ".fetch_state.json"
    if state_file.exists():
        try:
            with open(state_file) as fp:
                data = json.load(fp)
                return PaginationState(**data)
        except Exception:
            pass
    return PaginationState()


def save_state(out_dir: Path, state: PaginationState) -> None:
    """Persist pagination state to disk."""
    out_dir.mkdir(parents=True, exist_ok=True)
    state_file = out_dir / ".fetch_state.json"
    with open(state_file, "w") as fp:
        json.dump(asdict(state), fp, indent=2)


_comment_seq: int = 0

def save_comment(out_dir: Path, comment: CommentRecord) -> Path:
    """Save a single comment to a numbered file."""
    global _comment_seq
    _comment_seq += 1
    out_dir.mkdir(parents=True, exist_ok=True)
    filepath = out_dir / f"{_comment_seq:04d}_comment_{comment.id}.json"
    with open(filepath, "w") as fp:
        json.dump(asdict(comment), fp, indent=2)
    return filepath


def build_comment_record(data: dict) -> CommentRecord:
    """Build a CommentRecord from API response data."""
    return CommentRecord(
        id=data["id"],
        path=data.get("path", ""),
        start_line=data.get("start_line"),
        original_start_line=data.get("original_start_line"),
        line=data.get("line"),
        original_line=data.get("original_line"),
        original_position=data.get("original_position"),
        position=data.get("position"),
        diff_hunk=data.get("diff_hunk", ""),
        body=data.get("body", ""),
        author_login=data.get("user", {}).get("login", ""),
        created_at=data.get("created_at", ""),
        updated_at=data.get("updated_at", ""),
    )


def parse_total_pages_from_link(link_header: str) -> int:
    """Parse the 'last' rel page number from a Link header."""
    if not link_header:
        return 0
    for part in link_header.split(","):
        part = part.strip()
        if 'rel="last"' in part:
            m = re.search(r'[?&]page=(\d+)', part)
            if m:
                return int(m.group(1))
    return 0


def fetch_comments_page(
    config: RepositoryConfig,
    page: int,
) -> tuple[list[dict], int]:
    """
    Fetch one page of PR review comments.
    Returns (comments, total_pages_from_header).
    Raises RuntimeError on non-2xx or rate-limit.
    """
    headers = {
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    if config.token:
        headers["Authorization"] = f"Bearer {config.token}"

    params = {"per_page": config.per_page, "page": page}
    r = requests.get(config.api_url, headers=headers, params=params, timeout=15)

    if r.status_code == 403:
        remaining = r.headers.get("X-RateLimit-Remaining", "?")
        reset_epoch = r.headers.get("X-RateLimit-Reset", "0")
        reset_time = datetime.fromtimestamp(int(reset_epoch), tz=timezone.utc).strftime("%H:%M:%S UTC") if reset_epoch != "0" else "unknown"
        raise RuntimeError(
            f"GitHub API rate limit hit (remaining: {remaining}, resets at: {reset_time}). "
            "Use --token or set GITHUB_TOKEN env var."
        )
    if r.status_code != 200:
        raise RuntimeError(f"GitHub API error {r.status_code}: {r.text}")

    comments = r.json()
    total_pages = parse_total_pages_from_link(r.headers.get("Link", ""))

    return comments, total_pages


def run_fetch(config: RepositoryConfig, args: argparse.Namespace) -> FetchResult:
    """Main fetch loop. Returns a FetchResult."""
    global _comment_seq
    out_dir = Path(args.out_dir)

    if args.overwrite:
        if not args.quiet:
            print("  Overwrite mode: clearing existing files...")
        for f in out_dir.glob("*.json"):
            f.unlink()
        # Reset state file immediately so a crash doesn't leave stale state
        out_dir.mkdir(parents=True, exist_ok=True)
        save_state(out_dir, PaginationState(per_page=config.per_page))
        state = PaginationState(per_page=config.per_page)
        seen_ids: set[int] = set()
        _comment_seq = 0
    else:
        out_dir.mkdir(parents=True, exist_ok=True)
        state = load_state(out_dir)
        state.per_page = config.per_page
        seen_ids = load_seen_ids(out_dir)
        # Seed seq from highest existing file number
        _comment_seq = 0
        for f in sorted(out_dir.glob("*.json")):
            try:
                name = f.stem  # e.g. "0001_comment_12345" or "comment_12345"
                if name.startswith("comment_"):
                    continue  # old format, no seq number
                seq = int(name.split('_')[0])
                _comment_seq = max(_comment_seq, seq)
            except (ValueError, IndexError):
                pass

    result = FetchResult()

    # Determine start page: --start-page overrides everything
    if args.start_page is not None:
        start_page = args.start_page
    elif state.last_page_fetched > 0 and not args.overwrite:
        # Check if any new comments appeared on page 1 (which would shift pages)
        try:
            probe, _ = fetch_comments_page(config, 1)
            new_ids = [c["id"] for c in probe if c["id"] not in seen_ids]
            if not new_ids:
                start_page = state.last_page_fetched + 1
            else:
                if not args.quiet:
                    print(f"  {len(new_ids)} new comment(s) detected — re-fetching from page 1")
                start_page = 1
        except Exception:
            start_page = state.last_page_fetched + 1
    else:
        start_page = 1

    if args.dry_run:
        print(f"[DRY RUN] Would fetch PR #{config.pr_number} comments from {config.repo}")
        print(f"[DRY RUN]   API: {config.api_url}")
        print(f"[DRY RUN]   Starting from page {start_page}, per_page={config.per_page}")
        print(f"[DRY RUN]   Already saved: {len(seen_ids)} comment IDs")
        print(f"[DRY RUN]   Output dir: {out_dir}")
        return result

    total_pages_observed = 0

    for page in range(start_page, 10_000):
        if not args.quiet:
            print(f"  Fetching page {page}...", end="", flush=True)

        try:
            raw_comments, total_pages = fetch_comments_page(config, page)
        except Exception as e:
            print(f"\n  ERROR: {e}")
            result.message = str(e)
            break

        if total_pages > 0:
            total_pages_observed = max(total_pages_observed, total_pages)

        if not raw_comments:
            if not args.quiet:
                print(" no comments — done.")
            break

        if not args.quiet:
            print(f" {len(raw_comments)} comment(s)")

        new_on_page = 0
        for raw in raw_comments:
            record = build_comment_record(raw)
            if record.id not in seen_ids:
                save_comment(out_dir, record)
                seen_ids.add(record.id)
                result.new_comments += 1
                new_on_page += 1
            else:
                result.duplicate_comments += 1

        result.total_fetched += len(raw_comments)
        result.pages_fetched += 1
        state.last_page_fetched = page

        # Stop if this entire page was already seen and we've caught up.
        # Only apply this heuristic after fetching at least one page's worth
        # so the first page on a fresh run isn't incorrectly skipped.
        if new_on_page == 0 and page > start_page:
            if not args.quiet:
                print(f"  All {len(raw_comments)} comments already saved — caught up.")
            result.stopped_early = True
            break

        # Dynamic rate-limit backoff: check remaining quota
        time.sleep(0.5)

    # If we exited the loop normally (not a break), there may be more pages.
    result.has_more_comments = not result.stopped_early and result.pages_fetched > 0

    state.total_pages = total_pages_observed
    save_state(out_dir, state)

    return result


def main() -> int:
    args = parse_args()

    token = args.token or os.environ.get("GITHUB_TOKEN")

    # ── Resolve repo ──────────────────────────────────────────────────────────
    repo = args.repo
    if not repo:
        repo = get_git_remote_repo()
        if not repo:
            print("ERROR: Could not detect repo from git remote. Pass --repo owner/name", file=sys.stderr)
            return 1

    # ── Resolve PR number ────────────────────────────────────────────────────
    pr = args.pr
    if not pr:
        if not args.quiet:
            print(f"Auto-detecting latest PR for {repo}...")
        pr = get_latest_pr_number(repo, token)
        if not pr:
            print(f"ERROR: Could not find any open PRs in {repo}", file=sys.stderr)
            return 1
        if not args.quiet:
            print(f"  Found latest PR: #{pr}")

    # ── Build config and run ─────────────────────────────────────────────────
    config = RepositoryConfig(repo=repo, pr_number=pr, per_page=args.per_page, token=token)
    result = run_fetch(config, args)

    if not args.quiet:
        out_dir = Path(args.out_dir)
        print(f"\n{'─'*60}")
        print(f"  Repository:  {repo}")
        print(f"  PR:          #{pr}")
        print(f"  Output dir:  {out_dir.resolve()}")
        print(f"  New:         {result.new_comments}")
        print(f"  Already had: {result.duplicate_comments}")
        print(f"  Total:       {result.total_fetched}")
        print(f"  Pages:       {result.pages_fetched}")
        if result.stopped_early:
            print(f"  Status:      Caught up — paused early (no new comments on last page)")
        elif result.message:
            print(f"  Status:      {result.message}")
        else:
            print(f"  Status:      Complete")
        print(f"{'─'*60}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
