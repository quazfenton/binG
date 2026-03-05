// Canonical intent detection is in lib/utils/request-type-detector.ts
// This file re-exports for backwards compatibility
import { detectRequestType } from '../utils/request-type-detector';
export { detectRequestType as detectIntent };

import type { LLMMessage } from './llm-providers';

export type RequestIntent = 'tool' | 'sandbox' | 'chat';

export function isToolIntent(messages: LLMMessage[]): boolean {
  return detectRequestType(messages) === 'tool';
}

export function isSandboxIntent(messages: LLMMessage[]): boolean {
  return detectRequestType(messages) === 'sandbox';
}
