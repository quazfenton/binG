import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/database/connection';
import { DatabaseOperations } from '@/lib/database/connection';
import { resolveRequestAuth } from '@/lib/auth/request-auth';
import { checkRateLimit } from '@/lib/middleware/rate-limit';

// Check if server-side chat storage is enabled
const SERVER_CHAT_STORAGE_ENABLED = process.env.ENABLE_SERVER_CHAT_STORAGE === 'true';

// Rate limiting configuration
const RATE_LIMIT_MAX_REQUESTS = 100; // requests per window
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour

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
    // Use proper auth resolution instead of raw cookie
    const authResult = await resolveRequestAuth(request, { allowAnonymous: false });

    if (!authResult.success || !authResult.userId) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    // Convert string userId to number for database operations
    // Database stores user_id as INTEGER, but auth returns string
    const numericUserId = parseInt(authResult.userId, 10);
    if (Number.isNaN(numericUserId)) {
      return NextResponse.json(
        { error: 'Invalid user ID format' },
        { status: 400 }
      );
    }

    const dbOps = new DatabaseOperations();

    // Check rate limit using shared rate limiting infrastructure
    const rateLimitResult = checkRateLimit(authResult.userId, RATE_LIMIT_MAX_REQUESTS, RATE_LIMIT_WINDOW_MS);
    
    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        { 
          error: 'Rate limit exceeded',
          message: 'Too many requests. Please try again later.',
          retryAfter: rateLimitResult.retryAfter,
        },
        { 
          status: 429,
          headers: {
            'X-RateLimit-Limit': String(RATE_LIMIT_MAX_REQUESTS),
            'X-RateLimit-Remaining': String(rateLimitResult.remaining),
            'X-RateLimit-Reset': String(rateLimitResult.resetAt),
            'Retry-After': String(rateLimitResult.retryAfter),
          },
        }
      );
    }

    // Get all conversations for user
    // Note: DatabaseOperations methods are synchronous (better-sqlite3)
    const conversations = dbOps.getUserConversations(numericUserId, 50);

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

    // Use proper auth resolution instead of raw cookie
    const authResult = await resolveRequestAuth(request, { allowAnonymous: false });

    if (!authResult.success || !authResult.userId) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    // Convert string userId to number for database operations
    const numericUserId = parseInt(authResult.userId, 10);
    if (Number.isNaN(numericUserId)) {
      return NextResponse.json(
        { error: 'Invalid user ID format' },
        { status: 400 }
      );
    }

    const dbOps = new DatabaseOperations();

    // Check rate limit using shared rate limiting infrastructure
    const rateLimitResult = checkRateLimit(authResult.userId, RATE_LIMIT_MAX_REQUESTS, RATE_LIMIT_WINDOW_MS);
    
    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        { 
          error: 'Rate limit exceeded',
          message: 'Too many requests. Please try again later.',
          retryAfter: rateLimitResult.retryAfter,
        },
        { 
          status: 429,
          headers: {
            'X-RateLimit-Limit': String(RATE_LIMIT_MAX_REQUESTS),
            'X-RateLimit-Remaining': String(rateLimitResult.remaining),
            'X-RateLimit-Reset': String(rateLimitResult.resetAt),
            'Retry-After': String(rateLimitResult.retryAfter),
          },
        }
      );
    }

    // Create or update conversation
    // SECURITY: Check if conversation exists at all before creating
    const anyConversation = dbOps.getConversation(id) as any;
    if (anyConversation && anyConversation.user_id !== numericUserId) {
      return NextResponse.json(
        { error: 'Access denied: conversation belongs to another user' },
        { status: 403 }
      );
    }

    const existingConversation = dbOps.getConversationById(id, numericUserId) as any;

    if (!existingConversation) {
      dbOps.createConversation(id, numericUserId, title || 'Untitled Chat');
    }

    // Save messages (clear old ones first to avoid duplicates)
    // SECURITY: Delete messages only if they belong to a conversation owned by this user
    // WRAPPED IN TRANSACTION: Ensures atomicity - either all operations succeed or none do
    const db = getDatabase();
    const transaction = db.transaction(() => {
      // Delete existing messages
      db.prepare(`
        DELETE FROM messages
        WHERE conversation_id = ?
        AND conversation_id IN (SELECT id FROM conversations WHERE user_id = ?)
      `).run(id, numericUserId);

      // Insert new messages
      const insertStmt = db.prepare(`
        INSERT INTO messages (id, conversation_id, role, content, provider, model)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      
      for (const message of messages) {
        insertStmt.run(
          message.id || `${id}-${Date.now()}-${Math.random()}`,
          id,
          message.role,
          message.content,
          message.provider,
          message.model
        );
      }
    });

    try {
      transaction();
    } catch (transactionError: any) {
      console.error('Transaction failed:', transactionError);
      throw transactionError;
    }

    return NextResponse.json({ success: true, chatId: id });

  } catch (error: any) {
    console.error('Error saving chat history:', error);
    if (error.code === 'SQLITE_CONSTRAINT_PRIMARYKEY') {
      return NextResponse.json(
        { error: 'Access denied: conversation belongs to another user' },
        { status: 403 }
      );
    }
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

    // Use proper auth resolution instead of raw cookie
    const authResult = await resolveRequestAuth(request, { allowAnonymous: false });

    if (!authResult.success || !authResult.userId) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    // Convert string userId to number for database operations
    const numericUserId = parseInt(authResult.userId, 10);
    if (Number.isNaN(numericUserId)) {
      return NextResponse.json(
        { error: 'Invalid user ID format' },
        { status: 400 }
      );
    }

    const dbOps = new DatabaseOperations();

    // Verify conversation exists and belongs to user before deleting
    const conversation = dbOps.getConversationById(chatId, numericUserId);
    if (!conversation) {
      return NextResponse.json(
        { error: 'Conversation not found or access denied' },
        { status: 404 }
      );
    }

    // Delete conversation (cascade will delete messages)
    // Already verified user ownership above
    const db = getDatabase();
    const result = db.prepare('DELETE FROM conversations WHERE id = ? AND user_id = ?').run(chatId, numericUserId);

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