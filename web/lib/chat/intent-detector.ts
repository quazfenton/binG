// Canonical intent detection is in lib/utils/request-type-detector.ts
// This file re-exports for backwards compatibility
import { detectRequestType } from '../utils/request-type-detector';
export { detectRequestType as detectIntent };

import type { LLMMessage } from './llm-providers';

export type RequestIntent = 'tool' | 'sandbox' | 'chat';

export async function isToolIntent(messages: LLMMessage[]): Promise<boolean> {
  return (await detectRequestType(messages)).type === 'tool';
}

export async function isSandboxIntent(messages: LLMMessage[]): Promise<boolean> {
  return (await detectRequestType(messages)).type === 'sandbox';
}
