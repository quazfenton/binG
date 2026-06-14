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
<<<<<<< Updated upstream

      // Drop ASSISTANT messages that have NO content AND NO tool_calls.
      // Vercel AI SDK provider adapters reject `{role:'assistant', content:''}`
      // with "Invalid prompt: The messages do not match the ModelMessage[]
      // schema". An assistant turn must carry either text or tool calls.
      if (role === 'assistant') {
        const content = m?.content;
        const hasToolCalls = Array.isArray(m?.toolCalls) && m.toolCalls.length > 0
          || Array.isArray(m?.tool_calls) && m.tool_calls.length > 0;
        const hasText =
          (typeof content === 'string' && content.trim().length > 0) ||
          (Array.isArray(content) && content.length > 0);
        if (!hasText && !hasToolCalls) return false;
      }

=======
>>>>>>> Stashed changes
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
<<<<<<< Updated upstream
      // ModelMessage[] schema" errors. The SDK requires each part to be a
      // `tool-result` (or `tool-approval-response`), NOT a generic `text`
      // part — the union discriminator for tool messages accepts only
      // tool-result / tool-error / tool-approval-request / tool-approval-
      // response parts. Convert the string into a `tool-result` part with
      // the standard output shape. tool_call_id / toolName are preserved
      // from the source message when present.
      if (role === 'tool' && typeof content === 'string') {
        const toolCallId = typeof m?.tool_call_id === 'string' ? m.tool_call_id : '';
        const toolName = typeof m?.name === 'string' ? m.name : '';
        content = [{
          type: 'tool-result' as const,
          toolCallId,
          toolName,
          input: {},
          output: { type: 'text', value: content },
        } as any];
      }

      const result: any = { role, content };

      // Fold any tool calls into the assistant content array as AI SDK v6
      // `tool-call` parts. v6 does NOT accept a top-level `toolCalls` property
      // on assistant ModelMessages — tool calls must be expressed as content
      // parts of the form `{ type: 'tool-call', toolCallId, toolName, input }`.
      // Emitting the legacy v4 top-level `toolCalls` shape (or using `args`
      // instead of `input`) triggers "messages do not match the ModelMessage[]
      // schema" errors with strict provider adapters.
      if (role === 'assistant') {
        const tc = m?.tool_calls || m?.toolCalls;
        if (Array.isArray(tc) && tc.length > 0) {
          const toolCallParts = tc
            .filter(Boolean)
            .map((call: any) => {
              // Convert from OpenAI {id, type:'function', function:{name, arguments}}
              // or already-normalized CoreToolCall ({toolCallId, toolName, args/input}).
              let input: any = {};
              if (typeof call.function?.arguments === 'string') {
                try { input = JSON.parse(call.function.arguments); } catch { input = {}; }
              } else {
                input = call.input ?? call.args ?? call.function?.arguments ?? {};
              }
              return {
                type: 'tool-call' as const,
                toolCallId: call.toolCallId || call.id || '',
                toolName: call.toolName || call.function?.name || call.name || '',
                input,
              };
            });

          const existingParts: any[] = Array.isArray(result.content)
            ? result.content
            : (typeof result.content === 'string' && result.content.length > 0
                ? [{ type: 'text' as const, text: result.content }]
                : []);
          result.content = [...existingParts, ...toolCallParts];
        }
      }

      // Normalize tool-role array content to the v6 ToolResultPart shape.
      // ToolResultPart requires `output` to be a typed ToolResultOutput
      // (`{ type: 'json'|'text', value }`); a bare `result`/`value` field on a
      // `tool-result` part fails schema validation.
      if (role === 'tool' && Array.isArray(result.content)) {
        result.content = result.content.map((part: any) => {
          if (part && part.type === 'tool-result' && part.output === undefined) {
            const { result: rawResult, value: rawValue, ...rest } = part;
            const raw = rawResult ?? rawValue ?? null;
            return { ...rest, output: { type: 'json' as const, value: raw } };
          }
          return part;
        });
      }

      // Preserve toolCallId on tool messages
      if (role === 'tool' && m?.tool_call_id) {
        result.toolCallId = m.tool_call_id;
      }

      return result;
=======
      // ModelMessage[] schema" errors.
      if (role === 'tool' && typeof content === 'string') {
        content = [{ type: 'text' as const, text: content }];
      }

      return { role, content };
>>>>>>> Stashed changes
    });
}
