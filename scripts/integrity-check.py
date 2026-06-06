#!/usr/bin/env python3

import subprocess
import sys
import json
import os
import argparse

def get_commit_range(commit_range):
    if '..' in commit_range:
        return commit_range.split('..')
    else:
        # Single commit (new branch)
        return [f"{commit_range}^", commit_range]

def check_shrinkage(commit_range):
    start, end = get_commit_range(commit_range)
    
    # Get files changed in this range
    files = subprocess.check_output(
        ["git", "diff", "--name-only", commit_range]
    ).decode().splitlines()

    for f in files:
        if not f.strip(): continue
        try:
            # Get old content from start of range
            old = subprocess.check_output(
                ["git", "show", f"{start}:{f}"], stderr=subprocess.DEVNULL
            ).decode(errors="ignore")

            # Get new content from end of range
            new = subprocess.check_output(
                ["git", "show", f"{end}:{f}"], stderr=subprocess.DEVNULL
            ).decode(errors="ignore")

            if len(old) > 1000:
                ratio = len(new) / len(old)
                if ratio < 0.5:
                    print(f"ERROR: {f} shrank to {ratio:.1%} of original size.")
                    sys.exit(1)
        except subprocess.CalledProcessError:
            pass # File might be new or deleted

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument('--mode', choices=['check-shrinkage', 'check-structure'])
    parser.add_argument('--range', required=True)
    parser.add_argument('--baseline', default='/opt/bing/scripts/integrity-baseline.json')
    args = parser.parse_args()

    if args.mode == 'check-shrinkage':
        check_shrinkage(args.range)
