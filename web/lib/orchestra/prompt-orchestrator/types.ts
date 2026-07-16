/**
 * prompt-orchestrator/types.ts
 *
 * TypeScript types for the prompt-orchestrator foundation (brainstorm step 1).
 *
 * Three shapes are defined:
 *   - `PromptScript` + `PromptStep`: the disk-format of a "prompt script" (JSON
 *     file on disk that operators hand-edit).
 *   - `InjectedMarker`: the result of scanning a target string for existing
 *     `[PO-INJECT ...]...[/PO-INJECT]` markers.
 *   - `InjectionSegment`: a single segment produced by the injection planner.
 *
 * The `sha` field on a marker is a SHA-256 of the payload. It is the
 * idempotency key (alongside `promptId` + `step`) — if the same tuple already
 * appears in the target, the injection is skipped.
 *
 * The `ts` field is generated at injection time and is for auditing only;
 * it is NOT part of the idempotency key.
 */

/**
 * Insertion mode for a prompt step. The foundation only implements `append`;
 * the other modes are reserved for future planner extensions and will
 * throw if requested (fail-loud > silent fallback).
 */
export type InsertMode = 'append' | 'after-divider' | 'replace-block';

/** A single ordered step within a prompt script. */
export interface PromptStep {
  /** Stable step identifier (e.g. "1", "1.2", "init", "warmup"). */
  step: string;
  /** Insertion mode (see InsertMode). Only `append` is currently implemented. */
  mode: InsertMode;
  /** The literal payload to inject. */
  payload: string;
}

/** A prompt script loaded from disk. */
export interface PromptScript {
  /** Stable script identifier. Used as the `promptId` in injected markers. */
  promptId: string;
  /** Ordered list of steps. Order is preserved when injecting. */
  steps: PromptStep[];
}

/** A marker parsed out of a target string by `scanMarkers`. */
export interface InjectedMarker {
  promptId: string;
  step: string;
  /** SHA-256 of the payload (hex-encoded). */
  sha: string;
  /** UNIX-ms timestamp generated at injection time (audit only). */
  ts: string;
  mode: string;
  /** The raw payload content (between opening and closing tags). */
  content: string;
  /** Byte offset of the opening `[PO-INJECT ...]` tag. */
  startIndex: number;
  /** Byte offset immediately after the closing `[/PO-INJECT]` tag. */
  endIndex: number;
}

/** A single segment produced by the injection planner. */
export interface InjectionSegment {
  mode: string;
  content: string;
}
