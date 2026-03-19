import type { ParsedToolCall, ParserContext } from './types';

export class GrammarToolCallParser {
  parse(context: ParserContext): ParsedToolCall[] {
    const content = String(context.content || '');
    if (!content.trim()) return [];

    const calls: ParsedToolCall[] = [];

    // First, try to parse WRITE commands in format: "WRITE filename <<<\ncontent\n>>>"
    const writeCommandRegex = /WRITE\s+([^\s<]+)\s*<<<\s*([\s\S]*?)\s*>>>/gi;
    let writeMatch: RegExpExecArray | null;
    
    while ((writeMatch = writeCommandRegex.exec(content)) !== null) {
      const [, filename, fileContent] = writeMatch;
      if (filename && fileContent) {
        calls.push({
          name: 'filesystem.write_file',
          arguments: {
            path: filename.trim(),
            content: fileContent.trim(),
          },
          source: 'grammar',
        });
      }
    }

    // Also support READ command format: "READ filename"
    const readCommandRegex = /READ\s+([^\n\r]+)/gi;
    let readMatch: RegExpExecArray | null;
    
    while ((readMatch = readCommandRegex.exec(content)) !== null) {
      const [, filename] = readMatch;
      if (filename) {
        calls.push({
          name: 'filesystem.read_file',
          arguments: {
            path: filename.trim(),
          },
          source: 'grammar',
        });
      }
    }

    // Try to parse JSON blocks (original behavior)
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


