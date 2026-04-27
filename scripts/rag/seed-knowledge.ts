/**
 * Seed the RAG knowledge store with curated VFS tool examples,
 * common failure patterns, and best practices.
 *
 * Run once at server startup or manually:
 *   npx tsx scripts/rag/seed-knowledge.ts
 */

import {
  ingestFewShot,
  ingestAntiPattern,
  ingestRule,
  ingestExperience,
} from '../../web/lib/rag/retrieval';

async function seed() {
  console.log('Seeding RAG knowledge store...');
  let count = 0;

  // ─── Few-Shot Examples: write_file ──────────────────────────────────
  await ingestFewShot({
    taskType: 'vfs_write',
    input: 'Create a hello.py that prints Hello World',
    output: 'write_file(path="hello.py", content="print(\'Hello, World!\')")',
    quality: 1.0,
  });
  count++;

  await ingestFewShot({
    taskType: 'vfs_write',
    input: 'Create a React component src/App.tsx with a greeting',
    output: 'write_file(path="src/App.tsx", content="export default function App() { return <div>Hello</div>; }")',
    quality: 1.0,
  });
  count++;

  await ingestFewShot({
    taskType: 'vfs_write',
    input: 'Create a README.md for my project',
    output: 'write_file(path="README.md", content="# My Project\\n\\nDescription here.")',
    quality: 1.0,
  });
  count++;

  // ─── Few-Shot Examples: batch_write ──────────────────────────────────
  await ingestFewShot({
    taskType: 'vfs_batch',
    input: 'Create a Flask app with app.py and requirements.txt',
    output: 'batch_write(files=[{path:"app.py",content:"from flask import Flask\\napp = Flask(__name__)"},{path:"requirements.txt",content:"flask\\ngunicorn"}])',
    quality: 1.0,
  });
  count++;

  await ingestFewShot({
    taskType: 'vfs_batch',
    input: 'Create a React component with its CSS file',
    output: 'batch_write(files=[{path:"src/App.tsx",content:"export default function App() { return <div className=\\"app\\">Hello</div>; }"},{path:"src/App.css",content:".app { margin: 0 }"}])',
    quality: 1.0,
  });
  count++;

  await ingestFewShot({
    taskType: 'vfs_batch',
    input: 'Set up a Python package with tests',
    output: 'batch_write(files=[{path:"mypackage/__init__.py",content:""},{path:"mypackage/core.py",content:"def main(): pass"},{path:"tests/test_core.py",content:"def test_main(): pass"}])',
    quality: 1.0,
  });
  count++;

  // ─── Few-Shot Examples: apply_diff ──────────────────────────────────
  await ingestFewShot({
    taskType: 'vfs_diff',
    input: 'Rename the function greet to welcome in src/greet.py',
    output: 'apply_diff(path="src/greet.py", diff="--- a/src/greet.py\\n+++ b/src/greet.py\\n@@ -1,3 +1,3 @@\\n-def greet(name):\\n+def welcome(name):\\n     return f\'Hello, {name}!\'")',
    quality: 1.0,
  });
  count++;

  // ─── Anti-Patterns ──────────────────────────────────────────────────
  await ingestAntiPattern({
    antiPattern: 'Using write_file to modify an existing file by rewriting the entire content just to change a few lines.',
    correctApproach: 'Use apply_diff(path, diff) with a surgical unified diff patch for existing file modifications.',
    taskType: 'vfs_diff',
  });
  count++;

  await ingestAntiPattern({
    antiPattern: 'Using create_file or writeFile instead of write_file.',
    correctApproach: 'Always use the canonical tool name write_file (with underscore, not camelCase or create_file).',
    taskType: 'vfs_write',
  });
  count++;

  await ingestAntiPattern({
    antiPattern: 'Passing file content wrapped in markdown code fences like ```python\\ncontent\\n```.',
    correctApproach: 'Pass raw content strings without markdown code fence wrappers. The system automatically unwraps them, but it\'s more efficient to pass content directly.',
    taskType: 'vfs_write',
  });
  count++;

  await ingestAntiPattern({
    antiPattern: 'Stringifying the files array for batch_write: batch_write(files="[{...}]").',
    correctApproach: 'Pass files as a proper array: batch_write(files=[{path:"a.py",content:"..."},{path:"b.py",content:"..."}]).',
    taskType: 'vfs_batch',
  });
  count++;

  await ingestAntiPattern({
    antiPattern: 'Using batch_write with a single object instead of an array: batch_write(files={path:"a.py",content:"..."}).',
    correctApproach: 'batch_write requires files to be an array: files=[{path:"a.py",content:"..."}]. For a single file, use write_file instead.',
    taskType: 'vfs_batch',
  });
  count++;

  await ingestAntiPattern({
    antiPattern: 'Using apply_diff without --- and +++ headers in the diff.',
    correctApproach: 'Always include --- a/path and +++ b/path headers in the diff. If omitted, the system auto-generates them, but explicit headers are more reliable.',
    taskType: 'vfs_diff',
  });
  count++;

  await ingestAntiPattern({
    antiPattern: 'Using absolute paths like /src/app.tsx or URLs like https://example.com/src/app.tsx.',
    correctApproach: 'Use relative paths without leading slash: "src/app.tsx". The system handles scope resolution automatically.',
    taskType: 'vfs_write',
  });
  count++;

  // ─── Rules ──────────────────────────────────────────────────────────
  await ingestRule({
    rule: 'ALWAYS call read_file(path) before applying a diff to an existing file. The diff requires exact context line matching.',
    taskType: 'vfs_diff',
  });
  count++;

  await ingestRule({
    rule: 'For creating 2+ new files, use batch_write(files=[{path,content},...]). For a single new file, use write_file(path, content).',
    taskType: 'vfs_write',
  });
  count++;

  await ingestRule({
    rule: 'write_file requires exactly two arguments: path (string) and content (string). Missing either causes failure.',
    taskType: 'vfs_write',
  });
  count++;

  await ingestRule({
    rule: 'batch_write accepts an array of {path, content} objects via the files parameter. Maximum 50 files, 50MB total.',
    taskType: 'vfs_batch',
  });
  count++;

  // ─── Experiences (simulated from practice) ──────────────────────────
  await ingestExperience({
    experience: 'When using write_file, always provide both "path" and "content" as separate named arguments. Common failure: omitting content or using wrong field names like "file" or "code".',
    taskType: 'vfs_write',
    quality: 0.9,
  });
  count++;

  await ingestExperience({
    experience: 'batch_write is the most error-prone tool for smaller models. Key issues: (1) stringifying the files array, (2) passing a single object instead of array, (3) using wrong key names inside entries. Always use files=[{path:"...",content:"..."}].',
    taskType: 'vfs_batch',
    quality: 0.85,
  });
  count++;

  await ingestExperience({
    experience: 'apply_diff failures are usually caused by: (1) missing ---/+++ headers, (2) incorrect context lines, (3) wrong line numbers. Always read the file first, then generate the diff with exact matching context.',
    taskType: 'vfs_diff',
    quality: 0.8,
  });
  count++;

  console.log(`✓ Seeded ${count} knowledge chunks into RAG store`);
}

seed().catch(console.error);
