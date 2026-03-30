/**
 * Prompt Library API
 *
 * CRUD operations for AI prompts
 * Supports categorization, search, and community sharing
 */

import { NextRequest, NextResponse } from 'next/server';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';

export interface Prompt {
  id: string;
  title: string;
  content: string;
  category: string;
  tags: string[];
  author?: string;
  upvotes: number;
  downloads: number;
  createdAt: number;
  updatedAt: number;
}

const DATA_DIR = join(process.cwd(), 'data');
const PROMPTS_FILE = join(DATA_DIR, 'prompts.json');

// Built-in prompt categories
const CATEGORIES = [
  'coding',
  'writing',
  'analysis',
  'creative',
  'business',
  'education',
  'research',
  'productivity',
];

// Default prompts to seed the library
const DEFAULT_PROMPTS: Prompt[] = [
  {
    id: 'prompt-1',
    title: 'Code Review Expert',
    content: 'You are an expert code reviewer. Review this code for:\n1. Best practices\n2. Performance optimizations\n3. Security vulnerabilities\n4. Maintainability\n5. Test coverage\n\nProvide specific, actionable suggestions with code examples.',
    category: 'coding',
    tags: ['code-review', 'best-practices', 'security'],
    upvotes: 42,
    downloads: 156,
    createdAt: Date.now() - 86400000 * 5,
    updatedAt: Date.now() - 86400000 * 2,
  },
  {
    id: 'prompt-2',
    title: 'Technical Writer',
    content: 'You are a professional technical writer. Help me write clear, concise documentation for this feature:\n\n- Target audience: [specify]\n- Key concepts to cover: [list]\n- Tone: professional yet approachable\n\nInclude code examples, diagrams (describe them), and troubleshooting sections.',
    category: 'writing',
    tags: ['documentation', 'technical-writing', 'api'],
    upvotes: 38,
    downloads: 124,
    createdAt: Date.now() - 86400000 * 7,
    updatedAt: Date.now() - 86400000 * 3,
  },
  {
    id: 'prompt-3',
    title: 'Data Analysis Assistant',
    content: 'You are a data analysis expert. Help me analyze this dataset:\n\n1. Identify patterns and trends\n2. Spot anomalies or outliers\n3. Suggest visualizations\n4. Provide statistical insights\n5. Recommend next steps\n\nFormat your response with clear sections and actionable insights.',
    category: 'analysis',
    tags: ['data', 'analytics', 'visualization'],
    upvotes: 56,
    downloads: 203,
    createdAt: Date.now() - 86400000 * 10,
    updatedAt: Date.now() - 86400000 * 1,
  },
  {
    id: 'prompt-4',
    title: 'Creative Story Generator',
    content: 'You are a creative writing assistant. Help me write a compelling story with:\n\n- Genre: [specify]\n- Main character: [describe]\n- Setting: [describe]\n- Conflict: [describe]\n\nInclude vivid descriptions, dialogue, and plot twists. Write in [specify tone] tone.',
    category: 'creative',
    tags: ['storytelling', 'creative-writing', 'fiction'],
    upvotes: 67,
    downloads: 289,
    createdAt: Date.now() - 86400000 * 14,
    updatedAt: Date.now() - 86400000 * 5,
  },
  {
    id: 'prompt-5',
    title: 'Business Plan Advisor',
    content: 'You are an experienced business consultant. Help me create a comprehensive business plan:\n\n1. Executive Summary\n2. Market Analysis\n3. Competitive Landscape\n4. Revenue Model\n5. Marketing Strategy\n6. Financial Projections\n7. Risk Assessment\n\nProvide specific, actionable advice for each section.',
    category: 'business',
    tags: ['business-plan', 'strategy', 'startup'],
    upvotes: 45,
    downloads: 178,
    createdAt: Date.now() - 86400000 * 20,
    updatedAt: Date.now() - 86400000 * 7,
  },
];

// Ensure data directory exists
async function ensureDataDir() {
  if (!existsSync(DATA_DIR)) {
    await mkdir(DATA_DIR, { recursive: true });
  }
}

// In-memory queue for prompt writes (prevents race conditions)
const writeQueue: Array<() => Promise<void>> = [];
let isWriting = false;

// Process write queue sequentially
async function processWriteQueue() {
  if (isWriting || writeQueue.length === 0) return;
  
  isWriting = true;
  while (writeQueue.length > 0) {
    const write = writeQueue.shift();
    if (write) {
      try {
        await write();
      } catch (error: any) {
        console.error('[Prompts API] Write queue error:', error);
      }
    }
  }
  isWriting = false;
}

// Load prompts from file
async function loadPrompts(): Promise<Prompt[]> {
  await ensureDataDir();

  try {
    const data = await readFile(PROMPTS_FILE, 'utf-8');
    const parsed: unknown = JSON.parse(data);
    if (!Array.isArray(parsed)) {
      throw new Error('Prompts file does not contain an array');
    }
    return parsed as Prompt[];
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      // Initialize with default prompts
      await savePrompts(DEFAULT_PROMPTS);
      return DEFAULT_PROMPTS;
    }
    throw error;
  }
}

// Save prompts to file (queued to prevent race conditions)
async function savePrompts(prompts: Prompt[]) {
  await ensureDataDir();
  
  return new Promise<void>((resolve, reject) => {
    writeQueue.push(async () => {
      try {
        await writeFile(PROMPTS_FILE, JSON.stringify(prompts, null, 2));
        resolve();
      } catch (error) {
        reject(error);
      }
    });
    processWriteQueue();
  });
}

/**
 * GET /api/prompts - List all prompts
 * 
 * Query parameters:
 * - category: Filter by category
 * - search: Search in title/content
 * - tags: Filter by tags (comma-separated)
 * - sort: Sort by 'upvotes', 'downloads', 'recent' (default: recent)
 * - limit: Max results (default: 50)
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const category = searchParams.get('category');
    const search = searchParams.get('search');
    const tags = searchParams.get('tags');
    const sort = searchParams.get('sort') || 'recent';
    const limit = parseInt(searchParams.get('limit') || '50');

    let prompts = await loadPrompts();

    // Filter by category
    if (category) {
      prompts = prompts.filter(p => p.category === category);
    }

    // Filter by tags
    if (tags) {
      const tagList = tags.split(',');
      prompts = prompts.filter(p => 
        tagList.some(tag => p.tags.includes(tag))
      );
    }

    // Search in title and content
    if (search) {
      const searchLower = search.toLowerCase();
      prompts = prompts.filter(p =>
        p.title.toLowerCase().includes(searchLower) ||
        p.content.toLowerCase().includes(searchLower)
      );
    }

    // Sort
    prompts.sort((a, b) => {
      switch (sort) {
        case 'upvotes':
          return b.upvotes - a.upvotes;
        case 'downloads':
          return b.downloads - a.downloads;
        case 'recent':
        default:
          return b.createdAt - a.createdAt;
      }
    });

    // Apply limit
    prompts = prompts.slice(0, limit);

    return NextResponse.json({
      success: true,
      prompts,
      total: prompts.length,
      categories: CATEGORIES,
    });
  } catch (error: any) {
    console.error('[Prompts API] GET error:', error);
    return NextResponse.json(
      { error: 'Failed to load prompts' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/prompts - Create new prompt
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { title, content, category, tags } = body;

    // Validate required fields
    if (!title || !content || !category) {
      return NextResponse.json(
        { error: 'Title, content, and category are required' },
        { status: 400 }
      );
    }

    // Validate category
    if (!CATEGORIES.includes(category)) {
      return NextResponse.json(
        { error: `Invalid category. Must be one of: ${CATEGORIES.join(', ')}` },
        { status: 400 }
      );
    }

    const prompts = await loadPrompts();

    const newPrompt: Prompt = {
      id: `prompt-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      title,
      content,
      category,
      tags: tags || [],
      upvotes: 0,
      downloads: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    prompts.unshift(newPrompt);
    await savePrompts(prompts);

    return NextResponse.json({
      success: true,
      prompt: newPrompt,
    }, { status: 201 });
  } catch (error: any) {
    console.error('[Prompts API] POST error:', error);
    return NextResponse.json(
      { error: 'Failed to create prompt' },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/prompts - Update prompt (upvote, download, edit)
 */
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, action, apiKey } = body;

    if (!id || !action) {
      return NextResponse.json(
        { error: 'Prompt ID and action are required' },
        { status: 400 }
      );
    }

    // Require API key for edit operations (upvote/download are public)
    const expectedApiKey = process.env.PROMPTS_API_KEY;
    if (action === 'edit' && (!apiKey || apiKey !== expectedApiKey)) {
      return NextResponse.json(
        { error: 'Unauthorized. API key required for editing prompts' },
        { status: 401 }
      );
    }

    const prompts = await loadPrompts();
    const index = prompts.findIndex(p => p.id === id);

    if (index === -1) {
      return NextResponse.json(
        { error: 'Prompt not found' },
        { status: 404 }
      );
    }

    switch (action) {
      case 'upvote':
        prompts[index].upvotes++;
        prompts[index].updatedAt = Date.now();
        break;

      case 'download':
        prompts[index].downloads++;
        prompts[index].updatedAt = Date.now();
        break;

      case 'edit':
        const { title, content, category, tags } = body;
        if (title) prompts[index].title = title;
        if (content) prompts[index].content = content;
        if (category && CATEGORIES.includes(category)) {
          prompts[index].category = category;
        }
        if (tags) prompts[index].tags = tags;
        prompts[index].updatedAt = Date.now();
        break;

      default:
        return NextResponse.json(
          { error: 'Invalid action. Use: upvote, download, or edit' },
          { status: 400 }
        );
    }

    await savePrompts(prompts);

    return NextResponse.json({
      success: true,
      prompt: prompts[index],
    });
  } catch (error: any) {
    // Only log detailed errors in development
    if (process.env.NODE_ENV === 'development') {
      console.error('[Prompts API] PUT error:', error);
    } else {
      console.error('[Prompts API] PUT error: Failed to update prompt');
    }
    return NextResponse.json(
      { error: 'Failed to update prompt' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/prompts - Delete prompt
 */
export async function DELETE(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const id = searchParams.get('id');
    const apiKey = searchParams.get('apiKey');

    if (!id) {
      return NextResponse.json(
        { error: 'Prompt ID is required' },
        { status: 400 }
      );
    }

    // Require API key for delete operations
    const expectedApiKey = process.env.PROMPTS_API_KEY;
    if (!apiKey || apiKey !== expectedApiKey) {
      return NextResponse.json(
        { error: 'Unauthorized. API key required for deleting prompts' },
        { status: 401 }
      );
    }

    const prompts = await loadPrompts();
    const index = prompts.findIndex(p => p.id === id);

    if (index === -1) {
      return NextResponse.json(
        { error: 'Prompt not found' },
        { status: 404 }
      );
    }

    prompts.splice(index, 1);
    await savePrompts(prompts);

    return NextResponse.json({
      success: true,
      message: 'Prompt deleted',
    });
  } catch (error: any) {
    // Only log detailed errors in development
    if (process.env.NODE_ENV === 'development') {
      console.error('[Prompts API] DELETE error:', error);
    } else {
      console.error('[Prompts API] DELETE error: Failed to delete prompt');
    }
    return NextResponse.json(
      { error: 'Failed to delete prompt' },
      { status: 500 }
    );
  }
}
