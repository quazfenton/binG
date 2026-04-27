"""
Prepare VFS MCP tool usage dataset for practice.

Each sample tests a file-writing task where the agent must use VFS MCP tools
correctly (write_file, batch_write, apply_diff).

Usage:
    python scripts/practice/prepare_vfs_dataset.py
"""

import json
import os
import sys
from pathlib import Path

# Add project root
project_root = str(Path(__file__).parent.parent.parent.parent)
if project_root not in sys.path:
    sys.path.insert(0, project_root)

from packages.shared.agent.practice.db import DatasetSample
from packages.shared.agent.practice.utils import SQLModelUtils

# ─── VFS Tool Usage Tasks ─────────────────────────────────────────────────
# These tasks specifically test the agent's ability to use VFS MCP tools
# for file writing — the most common failure point for less capable models.

VFS_TASKS = [
    # ─── Basic: single file write ─────────────────────────────────────────
    {
        "question": "Create a file called hello.py that prints 'Hello, World!'",
        "answer": "write_file(path='hello.py', content=\"print('Hello, World!')\")",
    },
    {
        "question": "Write a Python function called greet(name) that returns a greeting string. Save it to utils/greet.py",
        "answer": "write_file(path='utils/greet.py', content='def greet(name):\\n    return f\"Hello, {name}!\"')",
    },
    # ─── Intermediate: multiple files ─────────────────────────────────────
    {
        "question": "Create a simple Flask app with three files: app.py (main), templates/index.html (basic HTML), and requirements.txt",
        "answer": "batch_write(files=[{path:'app.py', content:'from flask import Flask...'}, {path:'templates/index.html', content:'<!DOCTYPE html>...'}, {path:'requirements.txt', content:'flask'}])",
    },
    {
        "question": "Set up a basic React component structure: create src/App.jsx, src/App.css, and src/index.js",
        "answer": "batch_write(files=[{path:'src/App.jsx', content:'export default function App()...'}, {path:'src/App.css', content:'.app {...}'}, {path:'src/index.js', content:'import React...'}])",
    },
    # ─── Intermediate: diff application ───────────────────────────────────
    {
        "question": "Read the file config.py, add a new DATABASE_URL setting at the top, and save the changes",
        "answer": "First read_file(path='config.py'), then apply_diff with unified diff adding DATABASE_URL",
    },
    # ─── Advanced: directory creation + files ─────────────────────────────
    {
        "question": "Create a Python package structure: mypackage/__init__.py, mypackage/core.py, mypackage/utils.py, and tests/test_core.py",
        "answer": "create_directory(path='mypackage'), create_directory(path='tests'), batch_write(files=[...])",
    },
    # ─── Advanced: edit existing file ─────────────────────────────────────
    {
        "question": "Add error handling to the fetch_data() function in api.py — wrap it in try/except and log errors",
        "answer": "read_file(path='api.py'), then apply_diff or write_file with the updated content",
    },
    # ─── Complex: multi-file refactor ─────────────────────────────────────
    {
        "question": "Rename the function processData to transform_data across all files in the src/ directory. Update any imports that reference it.",
        "answer": "search_files(query='processData', path='src/'), read affected files, then batch_write with renamed function",
    },
    # ─── Edge case: special characters in content ─────────────────────────
    {
        "question": "Create a JSON config file config.json with database settings: host=localhost, port=5432, name=mydb, pool_size=10",
        "answer": "write_file(path='config.json', content='{\"database\":{\"host\":\"localhost\",\"port\":5432,...}}')",
    },
    # ─── Edge case: large file with structure ─────────────────────────────
    {
        "question": "Create a comprehensive README.md for a Python project called 'data-pipeline' with sections: Overview, Installation, Usage, Configuration, Contributing, License",
        "answer": "write_file(path='README.md', content='# data-pipeline\\n\\n## Overview\\n...')",
    },
    # ─── Edge case: nested paths ──────────────────────────────────────────
    {
        "question": "Create a file at src/components/auth/LoginForm.tsx with a basic React login form component with email and password fields",
        "answer": "write_file(path='src/components/auth/LoginForm.tsx', content='import React...')",
    },
    # ─── Realistic: full feature ──────────────────────────────────────────
    {
        "question": "Implement user authentication: create models/user.py with a User class, routes/auth.py with login/register endpoints, and middleware/auth.py with a token checker",
        "answer": "batch_write(files=[models/user.py, routes/auth.py, middleware/auth.py] with proper content)",
    },
]


def prepare_dataset():
    """Load VFS tool tasks into the database."""
    with SQLModelUtils.create_session() as session:
        # Check if already loaded
        existing = session.exec(
            __import__('sqlmodel').select(DatasetSample).where(
                DatasetSample.dataset == "VFS_Tool_Use",
                DatasetSample.source == "training_free_grpo",
            )
        ).first()

        if existing:
            print("Dataset 'VFS_Tool_Use' already exists. Skipping.")
            return

        for i, task in enumerate(VFS_TASKS):
            sample = DatasetSample(
                dataset="VFS_Tool_Use",
                source="training_free_grpo",
                question=task["question"],
                answer=task["answer"],
                index=i,
            )
            session.add(sample)

        session.commit()
        print(f"Loaded {len(VFS_TASKS)} VFS tool usage tasks into database.")
        print("Dataset name: VFS_Tool_Use")


if __name__ == "__main__":
    prepare_dataset()
