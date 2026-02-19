import type { LLMMessage } from '@/lib/api/llm-providers';

/**
 * Detect the type of request based on the messages
 * @param messages The conversation messages
 * @returns The detected request type: 'tool', 'sandbox', or 'chat'
 */
export function detectRequestType(messages: LLMMessage[]): 'tool' | 'sandbox' | 'chat' {
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

  const text = extractText(lastUserContent);
  const recentUserContext = userMessages
    .slice(-3)
    .map((m) => extractText(m.content))
    .join(' ')
    .trim();
  const combinedText = `${recentUserContext} ${text}`.trim();
  
  if (!combinedText.trim()) return 'chat';
  
  const lowerText = combinedText.toLowerCase();

  // Tool intent patterns (third-party service actions)
  const TOOL_PATTERNS = [
    /\b(use|using)\s+(a\s+)?tools?\b/i,
    /\b(tool|function)\s*(call|use|execution)?\b/i,
    /\b(send|draft|compose)\s+(an?\s+)?email\b/i,
    /\bgmail\b/i,
    /\bemail\s+to\b/i,
    /\bcalendar\b/i,
    /\bgithub\b/i,
    /\bslack\b/i,
    /send\s+(an?\s+)?email/i, /read\s+(my\s+)?emails?/i,
    /create\s+(a\s+)?calendar\s+event/i, /add\s+to\s+(my\s+)?calendar/i,
    /post\s+(to|on)\s+(twitter|x|reddit|slack|discord)/i,
    /send\s+(a\s+)?(text|sms|message)/i, /make\s+a\s+call/i,
    /create\s+(a\s+)?(github|git)\s+(issue|pr|pull)/i,
    /search\s+(with\s+)?exa/i, /play\s+(on\s+)?spotify/i,
    /upload\s+to\s+(drive|dropbox)/i, /create\s+(a\s+)?notion/i,
    /deploy\s+(to|on)\s+(vercel|railway)/i,
    /create\s+(a\s+)?google\s+(doc|sheet|slide)/i,
  ];

  // Sandbox intent patterns (code execution, file operations)
  const SANDBOX_PATTERNS = [
    /\b(run|execute|compile)\s+(this|the|my)?\s*(code|script|program)/i,
    /\b(build|create|write)\s+(a\s+)?(server|api|app|script|program)\s+(and|then)\s+(run|execute|start)/i,
    /\bnpm\s+(install|init|run|start)/i, /\bpip\s+install/i,
    /\b(install|setup)\s+(packages?|dependencies)/i,
    /\brun\s+.*\.(py|js|ts|sh|rb)/i,
    /\b(open|start|launch)\s+(a\s+)?(terminal|shell|sandbox)/i,
    /\b(write|create|edit)\s+(a\s+)?file\s+.*\.(py|js|ts|html|css|json)/i,
  ];

  if (TOOL_PATTERNS.some(p => p.test(lowerText))) return 'tool';
  if (SANDBOX_PATTERNS.some(p => p.test(lowerText))) return 'sandbox';
  return 'chat';
}
