import type { LLMMessage } from '@/lib/api/llm-providers';
import { createHash } from 'crypto';

// LOW PRIORITY FIX: Cache for request type detection to avoid repeated analysis
const detectionCache = new Map<string, 'tool' | 'sandbox' | 'chat'>();
const CACHE_MAX_SIZE = 1000;

/**
 * Create cache key from messages
 */
function createCacheKey(messages: LLMMessage[]): string {
  const content = messages.map(m => `${m.role}:${JSON.stringify(m.content)}`).join('|');
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}

/**
 * Cleanup cache if too large
 */
function cleanupCache(): void {
  if (detectionCache.size > CACHE_MAX_SIZE) {
    // Remove oldest entries (first 10%)
    const toRemove = Math.floor(CACHE_MAX_SIZE * 0.1);
    const keys = Array.from(detectionCache.keys()).slice(0, toRemove);
    for (const key of keys) {
      detectionCache.delete(key);
    }
  }
}

/**
 * Detect the type of request based on the messages
 * @param messages The conversation messages
 * @returns The detected request type: 'tool', 'sandbox', or 'chat'
 */
export function detectRequestType(messages: LLMMessage[]): 'tool' | 'sandbox' | 'chat' {
  // Check cache first
  const cacheKey = createCacheKey(messages);
  const cached = detectionCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }
  
  const userMessages = messages.filter(m => m.role === 'user');
  const lastUserContent = userMessages[userMessages.length - 1]?.content;

  // Extract text from content (handle both string and multimodal array formats)
  const extractText = (value: any): string => {
    if (!value) return '';
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) {
      return value
        .map((part: any) => {
          if (typeof part === 'string') return part;
          if (part?.type === 'text') return part?.text || '';
          if (typeof part?.text === 'string') return part.text;
          if (typeof part?.content === 'string') return part.content;
          return '';
        })
        .join(' ');
    }
    if (typeof value?.text === 'string') return value.text;
    if (typeof value?.content === 'string') return value.content;
    if (Array.isArray(value?.parts)) return extractText(value.parts);
    return '';
  };

  const text = extractText(lastUserContent).trim();
  if (!text) return 'chat';

  const lowerText = text.toLowerCase();

  // IMPROVED: Use weighted scoring instead of simple pattern matching
  // This prevents adversarial bypasses and provides more accurate intent detection
  const scores = {
    tool: 0,
    sandbox: 0,
    chat: 0,
  };

  // Knowledge/advice requests should remain plain chat
  const KNOWLEDGE_PATTERNS = [
    /^\s*(how|what|why|when|where|can|could|would|should|is|are|do|does)\b/i,
    /\b(explain|guide|tutorial|docs|documentation|example|examples|best practice|overview)\b/i,
    /\b(how to use|how do i use|how can i use|how does)\b/i,
  ];
  
  // Action patterns that indicate tool/sandbox intent
  const ACTION_PATTERNS = [
    /\b(send|draft|compose|create|post|upload|deploy|open|start|launch|execute|run)\b/i,
    /\bfor me\b/i,
    /\bnow\b/i,
  ];
  
  const looksLikeKnowledgeRequest = KNOWLEDGE_PATTERNS.some((p) => p.test(lowerText));
  const explicitlyActionable = ACTION_PATTERNS.some((p) => p.test(lowerText));
  
  // Knowledge requests without explicit action are chat
  if (looksLikeKnowledgeRequest && !explicitlyActionable) {
    scores.chat += 3;
  }

  // Tool intent patterns (third-party service actions) - weighted scoring
  const TOOL_PATTERNS = [
    { pattern: /\b(use|using)\s+(a\s+)?tools?\b/i, weight: 3 },
    { pattern: /\b(tool|function)\s*(call|use|execution)?\b/i, weight: 2 },
    { pattern: /\b(send|draft|compose)\s+(an?\s+)?email\b/i, weight: 3 },
    { pattern: /\bgmail\b/i, weight: 2 },
    { pattern: /\bemail\s+to\b/i, weight: 3 },
    { pattern: /\bcalendar\b/i, weight: 2 },
    { pattern: /\bgithub\b/i, weight: 2 },
    { pattern: /\bslack\b/i, weight: 2 },
    { pattern: /send\s+(an?\s+)?email/i, weight: 3 },
    { pattern: /read\s+(my\s+)?emails?/i, weight: 2 },
    { pattern: /create\s+(a\s+)?calendar\s+event/i, weight: 3 },
    { pattern: /add\s+to\s+(my\s+)?calendar/i, weight: 3 },
    { pattern: /post\s+(to|on)\s+(twitter|x|reddit|slack|discord)/i, weight: 3 },
    { pattern: /send\s+(a\s+)?(text|sms|message)/i, weight: 3 },
    { pattern: /make\s+a\s+call/i, weight: 3 },
    { pattern: /create\s+(a\s+)?(github|git)\s+(issue|pr|pull)/i, weight: 3 },
    { pattern: /search\s+(with\s+)?exa/i, weight: 2 },
    { pattern: /play\s+(on\s+)?spotify/i, weight: 2 },
    { pattern: /upload\s+to\s+(drive|dropbox)/i, weight: 3 },
    { pattern: /create\s+(a\s+)?notion/i, weight: 2 },
    { pattern: /deploy\s+(to|on)\s+(vercel|railway)/i, weight: 3 },
    { pattern: /create\s+(a\s+)?google\s+(doc|sheet|slide)/i, weight: 3 },
  ];

  // Sandbox intent patterns (code execution, file operations) - weighted scoring
  const SANDBOX_PATTERNS = [
    { pattern: /\b(run|execute|compile)\s+(this|the|my)?\s*(code|script|program)/i, weight: 3 },
    { pattern: /\b(build|create|write)\s+(a\s+)?(server|api|app|script|program)\s+(and|then)\s+(run|execute|start)/i, weight: 3 },
    { pattern: /\bnpm\s+(install|init|run|start)/i, weight: 2 },
    { pattern: /\bpip\s+install/i, weight: 2 },
    { pattern: /\b(install|setup)\s+(packages?|dependencies)/i, weight: 2 },
    { pattern: /\brun\s+.*\.(py|js|ts|sh|rb)/i, weight: 3 },
    { pattern: /\b(open|start|launch)\s+(a\s+)?(terminal|shell|sandbox)/i, weight: 2 },
    { pattern: /\b(write|create|edit)\s+(a\s+)?file\s+.*\.(py|js|ts|html|css|json)/i, weight: 2 },
  ];

  // Apply weighted scoring for tool patterns
  for (const { pattern, weight } of TOOL_PATTERNS) {
    if (pattern.test(lowerText)) {
      scores.tool += weight;
    }
  }

  // Apply weighted scoring for sandbox patterns
  for (const { pattern, weight } of SANDBOX_PATTERNS) {
    if (pattern.test(lowerText)) {
      scores.sandbox += weight;
    }
  }

  // "for me" strongly indicates action (boost tool score)
  if (/\bfor me\b/i.test(lowerText)) {
    scores.tool += 3;
  }

  // Code execution strongly indicates sandbox
  if (/\bcode\s+(execution|run|execute)\b/i.test(lowerText)) {
    scores.sandbox += 3;
  }

  // Determine result based on highest score with confidence threshold
  const maxScore = Math.max(scores.tool, scores.sandbox, scores.chat);
  const totalScore = scores.tool + scores.sandbox + scores.chat;
  const confidence = totalScore > 0 ? maxScore / totalScore : 0;

  // If confidence is too low, default to chat
  let result: 'tool' | 'sandbox' | 'chat';
  if (confidence < 0.3 || maxScore === 0) {
    result = 'chat';
  } else if (scores.tool === maxScore) {
    result = 'tool';
  } else if (scores.sandbox === maxScore) {
    result = 'sandbox';
  } else {
    result = 'chat';
  }
  
  // Cache the result
  detectionCache.set(cacheKey, result);
  cleanupCache();
  
  return result;
}
