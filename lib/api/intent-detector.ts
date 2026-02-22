// Canonical intent detection is in lib/utils/request-type-detector.ts
// This file re-exports for backwards compatibility
export { detectRequestType as detectIntent } from '../utils/request-type-detector';

import type { LLMMessage } from './llm-providers';
import { detectRequestType } from '../utils/request-type-detector';

export type RequestIntent = 'tool' | 'sandbox' | 'chat';

export function isToolIntent(messages: LLMMessage[]): boolean {
  return detectRequestType(messages) === 'tool';
}

export function isSandboxIntent(messages: LLMMessage[]): boolean {
  return detectRequestType(messages) === 'sandbox';
}
