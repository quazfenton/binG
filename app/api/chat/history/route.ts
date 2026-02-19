import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/database/connection';
import { DatabaseOperations } from '@/lib/database/connection';

// Check if server-side chat storage is enabled
const SERVER_CHAT_STORAGE_ENABLED = process.env.ENABLE_SERVER_CHAT_STORAGE === 'true';

// Simple in-memory rate limiting (per user)
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT = 100; // requests per hour
const RATE_WINDOW = 60 * 60 * 1000; // 1 hour

function checkRateLimit(userId: string): boolean {
  const now = Date.now();
  const userLimit = rateLimitMap.get(userId);
  
  if (!userLimit || now > userLimit.resetTime) {
    rateLimitMap.set(userId, { count: 1, resetTime: now + RATE_WINDOW });
    return true;
  }
  
  if (userLimit.count >= RATE_LIMIT) {
    return false;
  }
  
  userLimit.count++;
  return true;
}

/**
 * GET /api/chat/history
 * Retrieve chat history for authenticated user
 */
export async function GET(request: NextRequest) {
  // Check if server storage is enabled
  if (!SERVER_CHAT_STORAGE_ENABLED) {
    return NextResponse.json(
      { error: 'Server chat storage is disabled' },
      { status: 403 }
    );
  }

  try {
    // Get session from cookie
    const sessionId = request.cookies.get('session_id')?.value;
    
    if (!sessionId) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const dbOps = new DatabaseOperations();
    
    // Validate session and get user
    const session = dbOps.getSession(sessionId) as any;
    
    if (!session) {
      return NextResponse.json(
        { error: 'Invalid session' },
        { status: 401 }
      );
    }

    // Check rate limit
    if (!checkRateLimit(session.user_id.toString())) {
      return NextResponse.json(
        { error: 'Rate limit exceeded' },
        { status: 429 }
      );
    }

    // Get all conversations for user
    const conversations = dbOps.getUserConversations(session.user_id, 50);
    
    // Format for frontend
    const chatHistory = conversations.map((conv: any) => ({
      id: conv.id,
      title: conv.title || 'Untitled Chat',
      timestamp: new Date(conv.updated_at).getTime(),
      messages: [] // Messages loaded separately per conversation
    }));

    return NextResponse.json({ chats: chatHistory });
    
  } catch (error) {
    console.error('Error retrieving chat history:', error);
    return NextResponse.json(
      { error: 'Failed to retrieve chat history' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/chat/history
 * Save a chat conversation
 */
export async function POST(request: NextRequest) {
  // Check if server storage is enabled
  if (!SERVER_CHAT_STORAGE_ENABLED) {
    return NextResponse.json(
      { error: 'Server chat storage is disabled' },
      { status: 403 }
    );
  }

  try {
    const body = await request.json();
    const { id, title, messages } = body;

    if (!id || !messages || !Array.isArray(messages)) {
      return NextResponse.json(
        { error: 'Invalid request body' },
        { status: 400 }
      );
    }

    // Get session from cookie
    const sessionId = request.cookies.get('session_id')?.value;
    
    if (!sessionId) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const dbOps = new DatabaseOperations();
    
    // Validate session and get user
    const session = dbOps.getSession(sessionId) as any;
    
    if (!session) {
      return NextResponse.json(
        { error: 'Invalid session' },
        { status: 401 }
      );
    }

    // Check rate limit
    if (!checkRateLimit(session.user_id.toString())) {
      return NextResponse.json(
        { error: 'Rate limit exceeded' },
        { status: 429 }
      );
    }

    // Create or update conversation
    const existingConversation = dbOps.getConversation(id);
    
    if (!existingConversation) {
      // Create new conversation
      dbOps.createConversation(id, session.user_id, title || 'Untitled Chat');
    }

    // Save messages (clear old ones first to avoid duplicates)
    const db = getDatabase();
    db.prepare('DELETE FROM messages WHERE conversation_id = ?').run(id);
    
    for (const message of messages) {
      dbOps.saveMessage(
        message.id || `${id}-${Date.now()}-${Math.random()}`,
        id,
        message.role,
        message.content,
        message.provider,
        message.model
      );
    }

    return NextResponse.json({ success: true, chatId: id });
    
  } catch (error) {
    console.error('Error saving chat history:', error);
    return NextResponse.json(
      { error: 'Failed to save chat history' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/chat/history
 * Delete a specific chat conversation
 */
export async function DELETE(request: NextRequest) {
  // Check if server storage is enabled
  if (!SERVER_CHAT_STORAGE_ENABLED) {
    return NextResponse.json(
      { error: 'Server chat storage is disabled' },
      { status: 403 }
    );
  }

  try {
    const { searchParams } = new URL(request.url);
    const chatId = searchParams.get('id');

    if (!chatId) {
      return NextResponse.json(
        { error: 'Chat ID is required' },
        { status: 400 }
      );
    }

    // Get session from cookie
    const sessionId = request.cookies.get('session_id')?.value;
    
    if (!sessionId) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const dbOps = new DatabaseOperations();
    
    // Validate session and get user
    const session = dbOps.getSession(sessionId) as any;
    
    if (!session) {
      return NextResponse.json(
        { error: 'Invalid session' },
        { status: 401 }
      );
    }

    // Delete conversation (cascade will delete messages)
    const db = getDatabase();
    const result = db.prepare('DELETE FROM conversations WHERE id = ? AND user_id = ?').run(chatId, session.user_id);
    
    if (result.changes === 0) {
      return NextResponse.json(
        { error: 'Conversation not found or access denied' },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true });
    
  } catch (error) {
    console.error('Error deleting chat history:', error);
    return NextResponse.json(
      { error: 'Failed to delete chat history' },
      { status: 500 }
    );
  }
}