import { NextRequest, NextResponse } from 'next/server';


import { z } from 'zod';

// ---------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------

interface ZineNotificationPayload {
  id?: string;
  source: 'discord' | 'whatsapp' | 'email' | 'webhook' | 'api' | 'cron' | 'telegram' | 'slack';
  type?: 'message' | 'alert' | 'announcement' | 'update' | 'notification';
  content: string;
  author?: string;
  avatar?: string;
  metadata?: Record<string, unknown>;
  timestamp?: string;
  url?: string;
  priority?: 'low' | 'normal' | 'high' | 'urgent';
  channel?: string;
  attachments?: Array<{
    type: string;
    url?: string;
    name?: string;
  }>;
}

// ---------------------------------------------------------------------
// Format Parsers - detect and extract content from different platforms
// ---------------------------------------------------------------------

function parseDiscordPayload(body: Record<string, unknown>): ZineNotificationPayload | null {
  // Discord webhook format
  const content = typeof body.content === 'string' ? body.content : '';
  const author = typeof body.username === 'string' ? body.username : 'Discord User';
  const avatar = typeof body.avatar_url === 'string' ? body.avatar_url : undefined;
  const attachments = Array.isArray(body.attachments) 
    ? body.attachments.map((a: any) => ({ type: 'file', url: a.url, name: a.filename }))
    : [];

  if (!content && attachments.length === 0) return null;

  return {
    source: 'discord',
    type: 'message',
    content: content || `[Attachment: ${attachments.map(a => a.name).join(', ')}]`,
    author,
    avatar,
    metadata: { 
     embeds: body.embeds,
      attachments: attachments.length,
    },
    attachments,
  };
}

function parseWhatsAppPayload(body: Record<string, unknown>): ZineNotificationPayload | null {
  // Twilio/WhatsApp Business API format
  const messages = body.messages as any[] | undefined;
  if (!Array.isArray(messages) || messages.length === 0) return null;

  const msg = messages[0];
  const content = typeof msg.text?.body === 'string' ? msg.text.body : '';
  const author = typeof msg.from === 'string' ? msg.from : 'Unknown';
  
  if (!content) return null;

  return {
    source: 'whatsapp',
    type: 'message',
    content,
    author: `WhatsApp: ${author.slice(-4)}`,
    metadata: {
      messageId: msg.id,
      timestamp: msg.timestamp,
    },
  };
}

function parseEmailPayload(body: Record<string, unknown>): ZineNotificationPayload | null {
  // SendGrid, Mailgun, or generic email webhook format
  const subject = typeof body.subject === 'string' ? body.subject : '';
  const from = typeof body.from === 'string' ? body.from : 'Unknown';
  const text = typeof body.text === 'string' ? body.text : '';
  const html = typeof body.html === 'string' ? body.html : '';

  if (!subject && !text) return null;

  // Extract sender name if available
  const senderMatch = from.match(/^"?([^"]+)"?\s*</);
  const senderName = senderMatch ? senderMatch[1] : from.split('@')[0];

  return {
    source: 'email',
    type: 'notification',
    content: subject && text ? `${subject}\n\n${text.slice(0, 500)}` : (subject || text),
    author: senderName,
    metadata: { html: html.slice(0, 200), from },
    priority: (body.priority as string)?.toLowerCase() === 'high' ? 'high' : 'normal',
  };
}

function parseTelegramPayload(body: Record<string, unknown>): ZineNotificationPayload | null {
  // Telegram Bot API format
  const message = body.message as any;
  if (!message) return null;

  const content = message.text || message.caption || '';
  const chat = message.chat as any;
  const from = message.from as any;

  if (!content) return null;

  return {
    source: 'telegram',
    type: 'message',
    content,
    author: from?.first_name || from?.username || 'Telegram User',
    metadata: {
      chatId: chat?.id,
      messageId: message.message_id,
    },
  };
}

function parseSlackPayload(body: Record<string, unknown>): ZineNotificationPayload | null {
  // Slack webhook format
  const text = typeof body.text === 'string' ? body.text : '';
  const user = typeof body.user_name === 'string' ? body.user_name : 'Slack User';
  const channel = typeof body.channel_name === 'string' ? body.channel_name : undefined;

  if (!text) return null;

  return {
    source: 'slack',
    type: 'message',
    content: text,
    author: user,
    metadata: { channel },
  };
}

function parseGenericWebhook(body: Record<string, unknown>): ZineNotificationPayload {
  // Generic webhook - try to extract content from common fields
  const content = body.content || body.message || body.text || body.body || 
                  body.title || body.notification || JSON.stringify(body);
  
  const author = body.author || body.user || body.sender || body.from || 
                 body.username || body.name || 'Webhook';

  const url = body.url || body.link || body.href;

  return {
    source: 'webhook',
    type: (body.type as ZineNotificationPayload['type']) || 'notification',
    content: typeof content === 'string' ? content : JSON.stringify(content),
    author: typeof author === 'string' ? author : undefined,
    url: typeof url === 'string' ? url : undefined,
    metadata: body,
    priority: (body.priority as ZineNotificationPayload['priority']) || 'normal',
  };
}

// ---------------------------------------------------------------------
// Content Type Detection - auto-style based on content analysis
// ---------------------------------------------------------------------

function detectContentType(content: string): string {
  const upper = content.toUpperCase();
  const trimmed = content.trim();

  // Urgency patterns
  if (/^(URGENT|CRITICAL|EMERGENCY|ALERT|WARNING!)/i.test(trimmed)) {
    return 'announcement';
  }
  
  // Headers with #
  if (trimmed.startsWith('#')) {
    return 'heading';
  }
  
  // Quotes
  if (trimmed.startsWith('>') || trimmed.startsWith('"')) {
    return 'quote';
  }
  
  // Whisper/faint content
  if (/^(ps.|footnote|aside|btw|by the way)/i.test(trimmed)) {
    return 'whisper';
  }
  
  // Data/code blocks
  if (trimmed.startsWith('```') || /^\{[\s\S]*\}$/.test(trimmed) || /^\[[\s\S]*\]$/.test(trimmed)) {
    return 'data';
  }
  
  // All caps short content
  if (upper === trimmed && trimmed.length > 3 && trimmed.length < 50) {
    return 'announcement';
  }
  
  // Timestamps and dates
  if (/\d{1,2}:\d{2}|\d{4}-\d{2}-\d{2}|ago|just now/i.test(trimmed)) {
    return 'notification';
  }
  
  // URLs only
  if (/^https?:\/\/\S+$/i.test(trimmed)) {
    return 'data';
  }
  
  return 'text';
}

// ---------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------

const webhookEventSchema = z.object({
  source: z.enum(['discord', 'whatsapp', 'email', 'webhook', 'api', 'cron', 'telegram', 'slack']).optional(),
  content: z.string().min(1),
  author: z.string().optional(),
  type: z.enum(['message', 'alert', 'announcement', 'update', 'notification']).optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
  url: z.string().url().optional(),
  metadata: z.record(z.unknown()).optional(),
  timestamp: z.string().optional(),
  channel: z.string().optional(),
});

// ---------------------------------------------------------------------
// POST handler - receive notifications
// ---------------------------------------------------------------------

export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get('content-type') || '';
    let payload: ZineNotificationPayload;
    
    // Parse based on content type
    if (contentType.includes('application/json')) {
      const body = await request.json();
      
      // Check for Discord signature (webhook verification)
      if (body.type === 'interaction' || body.type === 'message_component') {
        return NextResponse.json({ 
          success: true, 
          message: 'Discord interaction acknowledged',
          type: 'discord_interaction',
        });
      }
      
      // Auto-detect source and parse
      if (body.webhook_uuid || body.application_id) {
        payload = parseDiscordPayload(body) || parseGenericWebhook(body);
      } else if (body.messages) {
        payload = parseWhatsAppPayload(body) || parseGenericWebhook(body);
      } else if (body.from && (body.subject || body.text)) {
        payload = parseEmailPayload(body) || parseGenericWebhook(body);
      } else if (body.message) {
        payload = parseTelegramPayload(body) || parseGenericWebhook(body);
      } else if (body.token || body.channel_id) {
        payload = parseSlackPayload(body) || parseGenericWebhook(body);
      } else {
        // Generic/API format
        const validated = webhookEventSchema.parse(body);
        payload = {
          ...validated,
          source: validated.source || 'webhook',
          content: validated.content || '', // Ensure content is never undefined
        } as ZineNotificationPayload;
      }
    } else {
      // Plain text body
      const text = await request.text();
      if (!text.trim()) {
        return NextResponse.json(
          { success: false, error: 'Empty payload' },
          { status: 400 }
        );
      }
      
      payload = {
        source: 'webhook',
        type: 'notification',
        content: text.slice(0, 2000),
        timestamp: new Date().toISOString(),
      };
    }

    // Generate unique ID if not provided
    const id = payload.id || `notif-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    
    // Ensure content is always present (satisfy ZineNotificationPayload type)
    const typedPayload = {
      ...payload,
      content: payload.content || '',
    } as ZineNotificationPayload;

    // Detect content type for styling
    const contentType2 = detectContentType(payload.content);

    // Build response
    const response: { success: boolean; id: string; received: Record<string, unknown>; instructions: string } = {
      success: true,
      id,
      received: {
        source: typedPayload.source,
        type: typedPayload.type || 'notification',
        contentType: contentType2,
        content: typedPayload.content,
        author: typedPayload.author,
        priority: typedPayload.priority || 'normal',
        timestamp: typedPayload.timestamp || new Date().toISOString(),
      },
      instructions: 'Content will be styled based on detected type and displayed in Zine Display',
    };

    // Log for debugging
    console.log(`[Zine-Webhook] Received ${payload.source} notification:`, {
      id,
      contentPreview: payload.content.slice(0, 100),
      author: payload.author,
      type: contentType2,
    });

    return NextResponse.json(response);
  } catch (error) {
    console.error('[Zine-Webhook] Error:', error);
    
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { 
          success: false, 
          error: 'Invalid payload format',
          details: error.errors.map(e => `${e.path.join('.')}: ${e.message}`),
        },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { success: false, error: 'Failed to process notification' },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------
// GET handler - health check and info
// ---------------------------------------------------------------------

export async function GET(request: NextRequest) {
  return NextResponse.json({
    service: 'Zine Display Webhook',
    version: '1.0.0',
    status: 'active',
    endpoints: {
      POST: 'Receive notifications from Discord, WhatsApp, Email, Telegram, Slack, or generic webhooks',
    },
    supportedSources: [
      'discord - Discord webhooks',
      'whatsapp - Twilio WhatsApp API',
      'email - SendGrid/Mailgun webhooks',
      'telegram - Telegram Bot API',
      'slack - Slack webhooks',
      'webhook - Generic HTTP webhooks',
      'api - Direct API calls',
      'cron - Scheduled triggers',
    ],
    contentTypes: [
      'heading - # prefix or ALL CAPS short',
      'quote - > prefix or quoted text',
      'announcement - URGENT/ALERT prefixes',
      'whisper - ps. or footnote patterns',
      'data - JSON/code blocks, URLs',
      'notification - timestamps, alerts',
      'text - default fallback',
    ],
  });
}
