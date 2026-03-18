import type { ParsedToolCall, ParserContext } from './types';

export class XMLToolCallParser {
  parse(context: ParserContext): ParsedToolCall[] {
    const content = String(context.content || '');
    if (!content.includes('<call>')) return [];

    const calls: ParsedToolCall[] = [];
    const callRegex = /<call>([\s\S]*?)<\/call>/gi;
    let match: RegExpExecArray | null;

    while ((match = callRegex.exec(content)) !== null) {
      const callBody = match[1] || '';
      const toolMatch = callBody.match(/<tool_name>([\s\S]*?)<\/tool_name>/i);
      const argsMatch = callBody.match(/<arguments>([\s\S]*?)<\/arguments>/i);
      if (!toolMatch || !argsMatch) continue;

      const name = toolMatch[1].trim();
      if (!name) continue;

      try {
        const args = JSON.parse(argsMatch[1]);
        calls.push({
          name,
          arguments: args && typeof args === 'object' ? args : {},
          source: 'xml',
        });
      } catch {
        continue;
      }
    }

    return calls;
  }
}
