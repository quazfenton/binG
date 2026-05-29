export interface SanitizeOptions { maxContentLength?: number }

/**
 * Sanitize messages for provider compatibility with the Vercel AI SDK.
 *
 * Fixes applied (see ROOT_CAUSE in plan-act-verify.ts:368):
 * 1. STRIPS system-role messages — the AI SDK ModelMessage[] schema rejects
 *    them; system prompts must go via the `system` parameter of
 *    generateText / streamText, not inside the messages array.
 * 2. CONVERTS tool-role plain-string content to array format — the AI SDK
 *    requires tool messages to have content: [{ type: 'tool-result', ... }]
 *    or [{ type: 'text', text: '...' }]; plain strings trigger
 *    "messages do not match ModelMessage[] schema" errors.
 */
export function sanitizeMessages(messages: any[], options: SanitizeOptions = {}) {
  if (!Array.isArray(messages)) throw new Error('messages must be an array');
  const maxLen = options.maxContentLength ?? 200000;
  const allowedRoles = new Set(['user', 'assistant', 'tool']);

  return messages
    .filter((m: any) => {
      // Only strip system-role messages — the AI SDK forbids them in the
      // messages array.  They must be passed via the `system` parameter
      // of generateText / streamText.
      const role = m && typeof m.role === 'string' ? m.role : null;
      if (role === 'system') return false;
      // Keep messages even with unknown roles — coerce to 'user' below
      // to avoid silently dropping context from non-standard message formats.
      return true;
    })
    .map((m: any) => {
      // Coerce unknown / missing roles to 'user' to preserve context
      // (only 'system' is stripped above).
      const rawRole = m && typeof m.role === 'string' ? m.role : null;
      const role = (rawRole && allowedRoles.has(rawRole)) ? rawRole : 'user';
      let content: string | any[] = '';

      if (m && typeof m.content === 'string') {
        content = m.content;
      } else if (m && Array.isArray(m.content)) {
        // Already in content-part array format — keep as-is
        content = m.content;
      } else if (m && typeof m.content === 'object' && m.content !== null) {
        try {
          content = JSON.stringify(m.content);
        } catch {
          content = String(m.content);
        }
      } else if (m && (m.content === undefined || m.content === null)) {
        content = '';
      } else {
        content = String(m.content);
      }

      // Truncate very long string contents to avoid provider schema/size issues
      if (typeof content === 'string' && content.length > maxLen) {
        content = content.slice(0, maxLen) + '...[TRUNCATED]';
      }

      // Tool role MUST have array content per AI SDK ModelMessage schema.
      // Plain-string tool content triggers "messages do not match
      // ModelMessage[] schema" errors.
      if (role === 'tool' && typeof content === 'string') {
        content = [{ type: 'text' as const, text: content }];
      }

      return { role, content };
    });
}
