// Shared SSE chunk protocol surface for route.ts + selector emitters.
// Cross-kind factory dispatching on SseChunkKind with TypeScript narrowing at the
// consumer side. Replaces the previous single-purpose makeSsePromptChunk with a
// single makeSseChunk(kind, ...) overload that returns the structurally-matched
// chunk variant, so the SSE chunk protocol (prompt | continuation | error |
// token-yield) shares one factory surface.

import type { PromptSource } from '@/lib/orchestra/unified-agent-service';

// === Stage 3 unionization: SseChunkKind + SsePromptChunk + SseContinuationChunk + SseErrorChunk + SseChunk ===

export type SseChunkKind = 'prompt' | 'continuation' | 'error' | 'token-yield';

export interface SsePromptChunk {
  type: 'prompt';
  source: PromptSource;
  content: string | null;
}

export interface SseContinuationChunk {
  type: 'continuation';
  continue: boolean;
  reason?: string;
  iteration: number;
}

export interface SseErrorChunk {
  type: 'error';
  message: string;
  recoverable: boolean;
}

export interface SseTokenYieldChunk {
  type: 'token-yield';
  content: string;
  tokenIndex: number;
}

// Discriminated union of all chunk variants. Consumers narrow via `chunk.type`.
export type SseChunk =
  | SsePromptChunk
  | SseContinuationChunk
  | SseErrorChunk
  | SseTokenYieldChunk;

// === TypeScript-narrowed overloads for the unified makeSseChunk factory ===
//
// Each overload maps a `kind` literal to its specific chunk shape; TS selects
// the matching overload at the call site, narrowing return type accordingly.
//
// rule: when caller switches on `return.type`, the union narrows cleanly.

export function makeSseChunk(
  kind: 'prompt',
  source: PromptSource,
  content: string | null,
): SsePromptChunk;
export function makeSseChunk(
  kind: 'continuation',
  continue: boolean,
  reason: string | undefined,
  iteration: number,
): SseContinuationChunk;
export function makeSseChunk(
  kind: 'error',
  message: string,
  recoverable: boolean,
): SseErrorChunk;
export function makeSseChunk(
  kind: 'token-yield',
  content: string,
  tokenIndex: number,
): SseTokenYieldChunk;
export function makeSseChunk(kind: SseChunkKind, ...args: unknown[]): SseChunk {
  switch (kind) {
    case 'prompt': {
      const [source, content] = args as [PromptSource, string | null];
      return { type: 'prompt', source, content };
    }
    case 'continuation': {
      const [continue_yes, reason, iteration] = args as [
        boolean,
        string | undefined,
        number,
      ];
      return { type: 'continuation', continue: continue_yes, reason, iteration };
    }
    case 'error': {
      const [message, recoverable] = args as [string, boolean];
      return { type: 'error', message, recoverable };
    }
    case 'token-yield': {
      const [content, tokenIndex] = args as [string, number];
      return { type: 'token-yield', content, tokenIndex };
    }
  }
}

// === Backward-compat re-export of the original single-purpose helper ===
//
// `makeSsePromptChunk(source, content)` was the original factory. Re-exported
// from makeSseChunk so existing imports keep resolving without churn.
// We attach `as` to the overload-set pick to satisfy the deprecated surface.
export function makeSsePromptChunk(
  source: PromptSource,
  content: string | null,
): SsePromptChunk {
  return makeSseChunk('prompt', source, content);
}
