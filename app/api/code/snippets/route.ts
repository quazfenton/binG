/**
 * Code Snippets API
 * 
 * CRUD operations for code snippets used by Code Playground tab.
 * GET /api/code/snippets
 * POST /api/code/snippets
 */

import { NextRequest, NextResponse } from "next/server";
import { readFile, writeFile, mkdir, rename } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";
import { createHash } from "crypto";

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
      await writeFile(tempPath, '[]');
    } catch {}
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

    const currentSnippets = await readSnippets();

    switch (action) {
      case 'save': {
        if (!snippet?.code) {
          return NextResponse.json(
            { success: false, error: 'Code is required' },
            { status: 400 }
          );
        }

        const newSnippet = {
          id: `snippet-${Date.now()}`,
          name: snippet.name || `Snippet ${currentSnippets.length + 1}`,
          language: snippet.language || 'javascript',
          code: snippet.code,
          output: snippet.output,
          error: snippet.error,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          isPublic: false,
          likes: 0,
        };

        currentSnippets.unshift(newSnippet);
        await queueWriteSnippets(currentSnippets);

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

        const filtered = currentSnippets.filter(s => s.id !== snippet.id);
        await queueWriteSnippets(filtered);

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

        await queueWriteSnippets(newSnippets);

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