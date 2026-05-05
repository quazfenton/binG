/**
 * Code Snippets API
 * 
 * CRUD operations for code snippets used by Code Playground tab.
 * GET /api/code/snippets
 * POST /api/code/snippets
 */

import { NextRequest, NextResponse } from "next/server";

export const runtime = 'edge';

import { readFile, writeFile, mkdir, rename, unlink } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";
import { createHash, randomUUID } from "crypto";

const DATA_DIR = join(process.cwd(), "data");
const SNIPPETS_PATH = join(DATA_DIR, "code-snippets.json");

// Ensure data directory exists
async function ensureDataDir(): Promise<void> {
  if (!existsSync(DATA_DIR)) {
    await mkdir(DATA_DIR, { recursive: true });
  }
}

// Default code templates
const DEFAULT_TEMPLATES = [
  {
    id: "tmpl-1",
    name: "Hello World",
    language: "javascript",
    code: `console.log("Hello, World!");\n\n// Your code here`,
    description: "Basic Hello World example",
    category: "beginner",
  },
  {
    id: "tmpl-2",
    name: "Fetch API",
    language: "javascript",
    code: `async function fetchData() {\n  try {\n    const response = await fetch('https://api.example.com/data');\n    const data = await response.json();\n    console.log(data);\n  } catch (error) {\n    console.error('Error:', error);\n  }\n}\n\nfetchData();`,
    description: "API request example",
    category: "intermediate",
  },
  {
    id: "tmpl-3",
    name: "React Component",
    language: "typescript",
    code: `import React, { useState } from 'react';\n\ninterface Props {\n  title: string;\n}\n\nexport const Counter: React.FC<Props> = ({ title }) => {\n  const [count, setCount] = useState(0);\n\n  return (\n    <div>\n      <h1>{title}</h1>\n      <p>Count: {count}</p>\n      <button onClick={() => setCount(count + 1)}>\n        Increment\n      </button>\n    </div>\n  );\n};`,
    description: "React component with state",
    category: "intermediate",
  },
  {
    id: "tmpl-4",
    name: "Python Data Analysis",
    language: "python",
    code: `import pandas as pd\nimport numpy as np\n\n# Create sample data\ndata = {\n    'name': ['Alice', 'Bob', 'Charlie'],\n    'age': [25, 30, 35],\n    'score': [85, 90, 95]\n}\n\ndf = pd.DataFrame(data)\nprint(df)\nprint(f"\\nAverage age: {df['age'].mean()}")\nprint(f"Top scorer: {df.loc[df['score'].idxmax(), 'name']}")`,
    description: "Data analysis with pandas",
    category: "advanced",
  },
];

// Read snippets with safe fallback
async function readSnippets(): Promise<any[]> {
  try {
    await ensureDataDir();
    const data = await readFile(SNIPPETS_PATH, "utf-8");
    return JSON.parse(data);
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      await writeFile(SNIPPETS_PATH, JSON.stringify([], null, 2));
      return [];
    }
    console.error('[Snippets API] Failed to read snippets:', error.message);
    throw error;
  }
}

// Write snippets atomically with mutex
const writeQueue: Array<() => Promise<void>> = [];
let isWriting = false;

async function processWriteQueue(): Promise<void> {
  if (isWriting || writeQueue.length === 0) return;

  isWriting = true;
  const task = writeQueue.shift();

  try {
    await task?.();
  } finally {
    isWriting = false;
    await processWriteQueue();
  }
}

// Atomic update helper - read-modify-write inside the queue to prevent race conditions
async function updateSnippetsAtomically(mutate: (snippets: any[]) => any[]): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    writeQueue.push(async () => {
      try {
        const snippets = await readSnippets();
        const updated = mutate(snippets);
        await writeSnippets(updated);
        resolve();
      } catch (error) {
        reject(error);
      }
    });
    processWriteQueue();
  });
}

async function writeSnippets(snippets: any[]): Promise<void> {
  await ensureDataDir();

  // Write to temp file first, then rename for atomic operation
  const tempPath = `${SNIPPETS_PATH}.tmp.${Date.now()}-${createHash('md5').update(Math.random().toString()).digest('hex').slice(0, 8)}`;
  
  try {
    await writeFile(tempPath, JSON.stringify(snippets, null, 2), 'utf-8');
    await rename(tempPath, SNIPPETS_PATH);
  } catch (error) {
    // Clean up temp file on error
    try {
      await unlink(tempPath);
    } catch (cleanupError) {
      console.error('[Snippets API] Failed to remove temp file:', tempPath, cleanupError);
    }
    throw error;
  }
}

// Queue-based write for concurrent safety
async function queueWriteSnippets(snippets: any[]): Promise<void> {
  return new Promise((resolve, reject) => {
    writeQueue.push(async () => {
      try {
        await writeSnippets(snippets);
        resolve();
      } catch (error) {
        reject(error);
      }
    });
    processWriteQueue();
  });
}

// GET - List all snippets and templates
export async function GET(request: NextRequest) {
  try {
    const snippets = await readSnippets();
    const url = new URL(request.url);
    const type = url.searchParams.get('type') || 'all';
    const language = url.searchParams.get('language');

    let result;
    
    if (type === 'templates' || type === 'all') {
      result = { templates: DEFAULT_TEMPLATES };
    }
    
    if (type === 'snippets' || type === 'all') {
      let filteredSnippets = snippets;
      
      if (language) {
        filteredSnippets = snippets.filter(s => s.language === language);
      }
      
      result = { 
        ...result, 
        snippets: filteredSnippets,
        totalSnippets: snippets.length 
      };
    }

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (error: any) {
    console.error('[Snippets API] GET error:', error.message);
    return NextResponse.json({
      success: true,
      templates: DEFAULT_TEMPLATES,
      snippets: [],
      fallback: true,
    });
  }
}

// POST - Create/update snippets
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, snippet, snippets: newSnippets } = body;

    switch (action) {
      case 'save': {
        // Validate required fields
        if (!snippet?.code || typeof snippet.code !== 'string') {
          return NextResponse.json(
            { success: false, error: 'Code is required' },
            { status: 400 }
          );
        }
        if (!snippet?.name || typeof snippet.name !== 'string') {
          return NextResponse.json(
            { success: false, error: 'Snippet name is required' },
            { status: 400 }
          );
        }
        if (!snippet?.language || typeof snippet.language !== 'string') {
          return NextResponse.json(
            { success: false, error: 'Snippet language is required' },
            { status: 400 }
          );
        }

        const newSnippet = {
          id: `snippet-${randomUUID()}`,
          name: snippet.name,
          language: snippet.language,
          code: snippet.code,
          output: snippet.output || '',
          error: snippet.error || '',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          isPublic: false,
          likes: 0,
        };

        // Use atomic update to prevent race conditions
        await updateSnippetsAtomically((currentSnippets) => {
          currentSnippets.unshift(newSnippet);
          return currentSnippets;
        });

        return NextResponse.json({
          success: true,
          snippet: newSnippet,
        });
      }

      case 'delete': {
        if (!snippet?.id) {
          return NextResponse.json(
            { success: false, error: 'Snippet ID is required' },
            { status: 400 }
          );
        }

        // Use atomic update to prevent race conditions
        await updateSnippetsAtomically((currentSnippets) => {
          return currentSnippets.filter(s => s.id !== snippet.id);
        });

        return NextResponse.json({
          success: true,
          message: 'Snippet deleted',
        });
      }

      case 'replace': {
        if (!newSnippets || !Array.isArray(newSnippets)) {
          return NextResponse.json(
            { success: false, error: 'Valid snippets array required' },
            { status: 400 }
          );
        }

        // Validate each snippet in the array
        for (const s of newSnippets) {
          if (!s.name || typeof s.name !== 'string') {
            return NextResponse.json(
              { success: false, error: 'All snippets must have a valid name' },
              { status: 400 }
            );
          }
          if (!s.language || typeof s.language !== 'string') {
            return NextResponse.json(
              { success: false, error: 'All snippets must have a valid language' },
              { status: 400 }
            );
          }
          if (!s.code || typeof s.code !== 'string') {
            return NextResponse.json(
              { success: false, error: 'All snippets must have valid code' },
              { status: 400 }
            );
          }
        }

        // Use atomic write (no read needed for replace)
        await new Promise<void>((resolve, reject) => {
          writeQueue.push(async () => {
            try {
              await writeSnippets(newSnippets);
              resolve();
            } catch (error) {
              reject(error);
            }
          });
          processWriteQueue();
        });

        return NextResponse.json({
          success: true,
          snippets: newSnippets,
        });
      }

      default:
        return NextResponse.json(
          { success: false, error: `Unknown action: ${action}` },
          { status: 400 }
        );
    }
  } catch (error: any) {
    console.error('[Snippets API] POST error:', error.message);
    return NextResponse.json(
      { success: false, error: 'Failed to process request' },
      { status: 500 }
    );
  }
}
