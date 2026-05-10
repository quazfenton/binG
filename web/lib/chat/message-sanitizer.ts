export interface SanitizeOptions { maxContentLength?: number }

export function sanitizeMessages(messages: any[], options: SanitizeOptions = {}) {
  if (!Array.isArray(messages)) throw new Error('messages must be an array');
  const maxLen = options.maxContentLength ?? 200000;
  const allowedRoles = new Set(['system', 'user', 'assistant', 'tool']);

  return messages.map((m: any, idx: number) => {
    const role = (m && typeof m.role === 'string' && allowedRoles.has(m.role)) ? m.role : 'user';
    let content = '';
    if (m && typeof m.content === 'string') {
      content = m.content;
    } else if (m && (typeof m.content === 'object' || Array.isArray(m.content))) {
      try {
        content = JSON.stringify(m.content);
      } catch {
        content = String(m.content);
      }
    } else if (m && (m.content === undefined || m.content === null)) {
      content = '';
    } else {
      // Coerce other types (number, boolean) to string
      content = String(m.content);
    }

    // Truncate very long contents to avoid provider schema/size issues
    if (content.length > maxLen) {
      content = content.slice(0, maxLen) + '...[TRUNCATED]';
    }

    return { role, content } as { role: string; content: string };
  });
}
