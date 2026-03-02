import type { ParsedToolCall, ParserContext } from './types';

export class GrammarToolCallParser {
  parse(context: ParserContext): ParsedToolCall[] {
    const content = String(context.content || '');
    if (!content.trim()) return [];

    const jsonBlocks: string[] = [];
    const fencedRegex = /```(?:json)?\s*([\s\S]*?)```/gi;
    let match: RegExpExecArray | null;

    while ((match = fencedRegex.exec(content)) !== null) {
      if (match[1]) jsonBlocks.push(match[1]);
    }

    const fallbackCurly = content.match(/\{[\s\S]*\}/);
    if (jsonBlocks.length === 0 && fallbackCurly) {
      jsonBlocks.push(fallbackCurly[0]);
    }

    const calls: ParsedToolCall[] = [];

    for (const block of jsonBlocks) {
      try {
        const parsed = JSON.parse(block);
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            this.pushCall(calls, item);
          }
        } else {
          this.pushCall(calls, parsed);
        }
      } catch {
        continue;
      }
    }

    return calls;
  }

  private pushCall(calls: ParsedToolCall[], candidate: any): void {
    if (!candidate || typeof candidate !== 'object') return;

    const name = candidate.tool || candidate.toolName || candidate.name || candidate.function?.name;
    if (!name) return;

    let args = candidate.args || candidate.arguments || candidate.input || candidate.function?.arguments || {};
    if (typeof args === 'string') {
      try {
        args = JSON.parse(args);
      } catch {
        args = {};
      }
    }

    calls.push({
      name: String(name),
      arguments: args && typeof args === 'object' ? args : {},
      source: 'grammar',
    });
  }
}
