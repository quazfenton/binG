#!/usr/bin/env bash
set -e

# Read stdin to get the range of commits being pushed
# Format: <local ref> <local sha> <remote ref> <remote sha>
while read local_ref local_sha remote_ref remote_sha; do
    # Handle new branch push
    if [ "$remote_sha" = "0000000000000000000000000000000000000000" ]; then
        # For new branches, compare against the parent of the first commit or just the commit itself
        range="$local_sha"
    else
        range="$remote_sha..$local_sha"
    fi

    echo "🔍 Checking commits in range: $range"

    # Layer 1: Detect explicit truncation markers
    # We check files modified in this commit range
    git diff --name-only $range | xargs -r grep -E '\.\.\.\[TRUNCATED\]|TODO_RESTORE|CUT_HERE' 2>/dev/null
    if [ $? -eq 0 ]; then
      echo "❌ Truncation marker detected."
      exit 1
    fi
    
    # Layer 3: Integrity check for pushed commits
    /opt/bing/scripts/integrity-check.py --mode check-shrinkage --range "$range"
done

echo "✅ Pre-push integrity checks passed."
