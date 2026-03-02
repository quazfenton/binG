import type { ParsedToolCall, ParserContext } from './types';

export class NativeToolCallParser {
  parse(context: ParserContext): ParsedToolCall[] {
    const calls: ParsedToolCall[] = [];
    const rawCalls = context.metadata?.toolCalls;
    if (!Array.isArray(rawCalls)) return calls;

    for (const raw of rawCalls) {
      if (!raw) continue;

      if (raw.function?.name) {
        let args = raw.function.arguments;
        if (typeof args === 'string') {
          try {
            args = JSON.parse(args);
          } catch {
            args = {};
          }
        }

        calls.push({
          name: String(raw.function.name),
          arguments: args && typeof args === 'object' ? args : {},
          source: 'native',
        });
        continue;
      }

      if (raw.name) {
        calls.push({
          name: String(raw.name),
          arguments: raw.input && typeof raw.input === 'object'
            ? raw.input
            : (raw.arguments && typeof raw.arguments === 'object' ? raw.arguments : {}),
          source: 'native',
        });
      }
    }

    return calls;
  }
}
