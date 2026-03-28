import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/database/connection';
import { resolveRequestAuth } from '@/lib/auth/request-auth';
import { checkRateLimit } from '@/lib/middleware/rate-limit';

// Check if server-side chat storage is enabled
const SERVER_CHAT_STORAGE_ENABLED = process.env.ENABLE_SERVER_CHAT_STORAGE === 'true';

// Rate limiting configuration
const RATE_LIMIT_MAX_REQUESTS = 100; // requests per window
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour

/**
 * Validate and parse user ID to a safe integer
 * Database stores user_id as INTEGER, but auth returns string
 * Uses strict validation to prevent partial parsing (e.g., "123abc" → 123)
 */
function validateAndParseUserId(userId: string): number | null {
  // Must be all digits, no trailing characters
  if (!/^\d+$/.test(userId)) {
    return null;
  }
  
  const numericId = Number(userId);
  
  // Must be a safe integer (prevents precision loss)
  if (!Number.isSafeInteger(numericId)) {
    return null;
  }
  
  return numericId;
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
    // Use proper auth resolution instead of raw cookie
    const authResult = await resolveRequestAuth(request, { allowAnonymous: false });

    if (!authResult.success || !authResult.userId) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    // Validate and parse user ID to safe integer
    const numericUserId = validateAndParseUserId(authResult.userId);
    if (numericUserId === null) {
      return NextResponse.json(
        { error: 'Invalid user ID format' },
        { status: 400 }
      );
    }

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

    const dbOps = new DatabaseOperations();

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

    // Validate and parse user ID to safe integer
    const numericUserId = validateAndParseUserId(authResult.userId);
    if (numericUserId === null) {
      return NextResponse.json(
        { error: 'Invalid user ID format' },
        { status: 400 }
      );
    }

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

    // Save conversation and messages atomically in a single transaction
    // This prevents race conditions where concurrent saves create duplicate conversations
    // or leave orphan conversations if message insertion fails
    const db = getDatabase();
    
    // Database not initialized yet - return error
    if (!db) {
      console.error('[Chat History] Database not initialized');
      return NextResponse.json(
        { error: 'Database not ready. Please try again in a moment.' },
        { status: 503 }
      );
    }
    
    const saveConversationTransaction = db.transaction(() => {
      // Check if conversation exists and verify ownership
      const existingConversation = db.prepare(`
        SELECT * FROM conversations 
        WHERE id = ? AND is_archived = FALSE
      `).get(id) as any;

      if (existingConversation && existingConversation.user_id !== numericUserId) {
        // Conversation belongs to another user - this is a true access denied
        const error: any = new Error('Access denied: conversation belongs to another user');
        error.code = 'ACCESS_DENIED';
        throw error;
      }

      // Create conversation if it doesn't exist
      if (!existingConversation) {
        db.prepare(`
          INSERT INTO conversations (id, user_id, title)
          VALUES (?, ?, ?)
        `).run(id, numericUserId, title || 'Untitled Chat');
      }

      // Delete existing messages for this conversation
      db.prepare(`
        DELETE FROM messages
        WHERE conversation_id = ?
      `).run(id);

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
      saveConversationTransaction();
    } catch (transactionError: any) {
      // Re-throw access denied errors
      if (transactionError.code === 'ACCESS_DENIED') {
        throw transactionError;
      }
      
      // Handle constraint errors (concurrent saves)
      if (transactionError.code === 'SQLITE_CONSTRAINT_PRIMARYKEY') {
        const conflictError: any = new Error('Concurrent save conflict. Please retry.');
        conflictError.code = 'CONCURRENT_SAVE';
        throw conflictError;
      }
      
      // Re-throw other errors
      throw transactionError;
    }

    return NextResponse.json({ success: true, chatId: id });

  } catch (error: any) {
    console.error('Error saving chat history:', error);
    
    // Handle access denied (conversation belongs to another user)
    if (error.code === 'ACCESS_DENIED') {
      return NextResponse.json(
        { error: error.message },
        { status: 403 }
      );
    }
    
    // Handle concurrent save conflicts
    if (error.code === 'CONCURRENT_SAVE' || error.code === 'SQLITE_CONSTRAINT_PRIMARYKEY') {
      return NextResponse.json(
        { error: 'Concurrent save conflict. Please retry.' },
        { status: 409 }
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

    // Validate and parse user ID to safe integer
    const numericUserId = validateAndParseUserId(authResult.userId);
    if (numericUserId === null) {
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