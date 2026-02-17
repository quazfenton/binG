import type { LLMMessage } from '@/lib/api/llm-providers';

/**
 * Detect the type of request based on the messages
 * @param messages The conversation messages
 * @returns The detected request type: 'tool', 'sandbox', or 'chat'
 */
export function detectRequestType(messages: LLMMessage[]): 'tool' | 'sandbox' | 'chat' {
  const lastUserMsg = messages.filter(m => m.role === 'user').pop()?.content;
  if (!lastUserMsg || typeof lastUserMsg !== 'string') return 'chat';

  const text = lastUserMsg.toLowerCase();

  // Tool intent patterns (third-party service actions)
  const TOOL_PATTERNS = [
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

  if (TOOL_PATTERNS.some(p => p.test(text))) return 'tool';
  if (SANDBOX_PATTERNS.some(p => p.test(text))) return 'sandbox';
  return 'chat';
}