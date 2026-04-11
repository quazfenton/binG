import { NativeToolCallParser } from './native-parser';
import { XMLToolCallParser } from './xml-parser';
import { SelfHealingToolValidator } from './self-healing';
import type { ParserContext, ParserToolDefinition, ParsedToolCall, ToolCallingMode } from './types';

export interface DispatcherResult {
  calls: ParsedToolCall[];
  rejected: Array<{ call: ParsedToolCall; reason: string }>;
  mode: ToolCallingMode;
}

/**
 * @compatibility-boundary
 *
 * Content-based tool-call detection (extractFileEdits and XML parsers) is a legacy
 * fallback. Canonical tool invocations are now emitted directly by agent
 * producers. This dispatcher is only invoked when:
 *  1. `TOOL_CALLING_ALLOW_CONTENT_PARSING=true`, AND
 *  2. The native parser found no structured tool calls.
 *
 * New integrations should emit canonical ToolInvocation records instead of
 * embedding tool calls as text patterns in assistant content.
 */
export class AdvancedToolCallDispatcher {
  private readonly nativeParser = new NativeToolCallParser();
  private readonly xmlParser = new XMLToolCallParser();
  private readonly validator = new SelfHealingToolValidator();

  async dispatch(context: ParserContext, tools: ParserToolDefinition[]): Promise<DispatcherResult> {
    const mode = this.resolveMode();

    const allowContentParsing = process.env.TOOL_CALLING_ALLOW_CONTENT_PARSING === 'true';
    const candidateModes = mode === 'auto'
      ? ['native', ...(allowContentParsing ? ['content', 'xml'] : [])]
      : [mode];

    let parsedCalls: ParsedToolCall[] = [];

    for (const candidate of candidateModes) {
      if (candidate === 'native') {
        parsedCalls = this.nativeParser.parse(context);
      } else if (candidate === 'content') {
        // Use extractFileEdits as the single source of truth for all text-based formats:
        // bash heredocs, function-calls, flat JSON, tool tags, XML, fenced blocks, etc.
        const { extractFileEdits } = await import('@/lib/chat/file-edit-parser');
        const edits = extractFileEdits(String(context.content || ''));
        parsedCalls = editsToToolCalls(edits);
      } else if (candidate === 'xml') {
        parsedCalls = this.xmlParser.parse(context);
      }

      if (parsedCalls.length > 0) {
        const validated = await this.validator.validate(parsedCalls, tools);
        return {
          calls: validated.accepted,
          rejected: validated.rejected,
          mode: candidate as ToolCallingMode,
        };
      }
    }

    return {
      calls: [],
      rejected: [],
      mode,
    };
  }

  private resolveMode(): ToolCallingMode {
    const configured = (process.env.TOOL_CALLING_MODE || 'auto').trim().toLowerCase();
    if (configured === 'native' || configured === 'grammar' || configured === 'xml' || configured === 'auto') {
      return configured as ToolCallingMode;
    }
    return 'auto';
  }
}

/**
 * Convert FileEdit[] to ParsedToolCall[] for dispatcher compatibility.
 */
function editsToToolCalls(edits: Array<{ path: string; content?: string; action?: string; diff?: string }>): ParsedToolCall[] {
  const toolMap: Record<string, string> = {
    write: 'filesystem.write_file',
    patch: 'filesystem.apply_diff',
    delete: 'filesystem.delete_file',
    mkdir: 'filesystem.create_directory',
  };

  return edits.map(edit => ({
    name: toolMap[edit.action || 'write'] || 'filesystem.write_file',
    arguments: {
      path: edit.path,
      ...(edit.content ? { content: edit.content } : {}),
      ...(edit.diff ? { diff: edit.diff } : {}),
    },
    source: 'grammar' as const,
  }));
}

export const advancedToolCallDispatcher = new AdvancedToolCallDispatcher();
