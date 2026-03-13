import type { ParserContext, ParserToolDefinition, ParsedToolCall, ToolCallingMode } from './types';
import { NativeToolCallParser } from './native-parser';
import { GrammarToolCallParser } from './grammar-parser';
import { XMLToolCallParser } from './xml-parser';
import { SelfHealingToolValidator } from './self-healing';

export interface DispatcherResult {
  calls: ParsedToolCall[];
  rejected: Array<{ call: ParsedToolCall; reason: string }>;
  mode: ToolCallingMode;
}

/**
 * @compatibility-boundary
 *
 * Content-based tool-call detection (grammar and XML parsers) is a legacy
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
  private readonly grammarParser = new GrammarToolCallParser();
  private readonly xmlParser = new XMLToolCallParser();
  private readonly validator = new SelfHealingToolValidator();

  async dispatch(context: ParserContext, tools: ParserToolDefinition[]): Promise<DispatcherResult> {
    const mode = this.resolveMode();

    const allowContentParsing = process.env.TOOL_CALLING_ALLOW_CONTENT_PARSING === 'true';
    const candidateModes = mode === 'auto'
      ? ['native', ...(allowContentParsing ? ['grammar', 'xml'] : [])]
      : [mode];

    let parsedCalls: ParsedToolCall[] = [];

    for (const candidate of candidateModes) {
      if (candidate === 'native') {
        parsedCalls = this.nativeParser.parse(context);
      } else if (candidate === 'grammar') {
        parsedCalls = this.grammarParser.parse(context);
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
      return configured;
    }
    return 'auto';
  }
}

export const advancedToolCallDispatcher = new AdvancedToolCallDispatcher();
