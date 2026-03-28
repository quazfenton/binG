import type { ParsedToolCall, ParserContext } from './types';

export class GrammarToolCallParser {
  parse(context: ParserContext): ParsedToolCall[] {
    const content = String(context.content || '');
    if (!content.trim()) return [];

    const calls: ParsedToolCall[] = [];

    // NEW: Parse bash heredoc format: cat > file << 'EOF' ... EOF
    const bashHeredocRegex = /cat\s*(>>?)\s*([^\s<>&|]+)\s*<<\s*['"]?(\w+)['"]?\s*\n([\s\S]*?)\n?\3(?:\s|$)/gi;
    let bashMatch: RegExpExecArray | null;
    
    while ((bashMatch = bashHeredocRegex.exec(content)) !== null) {
      const [, mode, filename, , fileContent] = bashMatch;
      if (filename && fileContent) {
        calls.push({
          name: 'filesystem.write_file',
          arguments: {
            path: filename.trim(),
            content: fileContent.trimEnd(),
            append: mode === '>>',
          },
          source: 'grammar',
        });
      }
    }

    // Also parse mkdir commands (supports multiple paths: mkdir -p path1 path2)
    // FIX: Don't capture across newlines to avoid parsing subsequent commands as paths
    const mkdirRegex = /mkdir\s+(-p\s+)?([^\n&|;<>]+)/gi;
    let mkdirMatch: RegExpExecArray | null;
    
    while ((mkdirMatch = mkdirRegex.exec(content)) !== null) {
      const pathsStr = mkdirMatch[2]?.trim();
      if (!pathsStr) continue;
      
      const dirpaths = pathsStr.split(/\s+/).filter(p => p && !p.startsWith('-'));
      for (const dirpath of dirpaths) {
        calls.push({
          name: 'filesystem.create_directory',
          arguments: {
            path: dirpath.trim(),
          },
          source: 'grammar',
        });
      }
    }

    // Also parse rm commands
    const rmRegex = /rm\s+(-[rf]+\s+)?([^\s&|;<>]+)/gi;
    let rmMatch: RegExpExecArray | null;
    
    while ((rmMatch = rmRegex.exec(content)) !== null) {
      const [, , filepath] = rmMatch;
      if (filepath && !filepath.startsWith('-')) {
        calls.push({
          name: 'filesystem.delete_file',
          arguments: {
            path: filepath.trim(),
          },
          source: 'grammar',
        });
      }
    }

    // Fallback: Try to parse WRITE commands in format: "WRITE filename <<<\ncontent\n>>>"
    // (deprecated but kept for backward compatibility)
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


