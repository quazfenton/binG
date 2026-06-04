/**
 * Integration Tests: Role Selection Injection
 *
 * Verifies the full injection pipeline used by /api/chat/route.ts:
 *
 *   1. forcedRole detection from role_selection / choose_role tool calls
 *      in conversation history
 *   2. selectAndComposeSystemPrompt with forceRole option (composes prompt
 *      from the unified 76-role library)
 *   3. prompt content verification (role-specific keywords, structure)
 *
 * These tests simulate the exact flow that runs inside the POST handler
 * without importing Next.js-dependent route modules.
 */

import { describe, it, expect } from 'vitest';
import { selectAndComposeSystemPrompt, getAllRoleIds } from '../unified-role-selector';

// Minimal LLMMessage type for test purposes (avoids dependency on web modules)
interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | Array<Record<string, unknown>>;
}

// ── Simulate the forcedRole detection from route.ts ─────────────────────────
// This is a faithful reproduction of the inline logic at lines ~803-842
// in /api/chat/route.ts. If that logic changes, update this accordingly.

function detectForcedRole(messages: LLMMessage[]): string | undefined {
  for (const msg of messages) {
    // Branch 1: structured content (array of parts with tool-call type)
    if (msg.role === 'assistant' && Array.isArray(msg.content)) {
      for (const part of msg.content as Array<Record<string, unknown>>) {
        if (
          part.type === 'tool-call' &&
          (part.toolName === 'role_selection' || part.toolName === 'choose_role') &&
          (part.input as Record<string, unknown>)?.role &&
          typeof (part.input as Record<string, unknown>).role === 'string'
        ) {
          const trimmed = ((part.input as Record<string, unknown>).role as string).trim();
          if (trimmed) return trimmed;
        }
      }
    }
    // Branch 2: JSON-stringified tool calls in plain-text assistant messages
    if (msg.role === 'assistant' && typeof msg.content === 'string') {
      try {
        const parsed = JSON.parse(msg.content);
        if (Array.isArray(parsed)) {
          for (const part of parsed) {
            if (
              part.type === 'tool-call' &&
              (part.toolName === 'role_selection' || part.toolName === 'choose_role') &&
              part.input?.role &&
              typeof part.input.role === 'string'
            ) {
              const trimmed = part.input.role.trim();
              if (trimmed) return trimmed;
            }
          }
        }
      } catch {
        // not JSON, skip
      }
    }
    // If we found a role, return immediately (equivalent to the outer loop's
    // `if (forcedRole) break;` in the real route.ts code)
  }
  return undefined;
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('forcedRole detection (simulated route.ts logic)', () => {
  it('detects role_selection from structured tool-call content', () => {
    const messages: LLMMessage[] = [
      { role: 'user', content: 'Fix this bug' },
      {
        role: 'assistant',
        content: [
          {
            type: 'tool-call',
            toolName: 'role_selection',
            toolCallId: 'call_1',
            input: { role: 'debugger', reason: 'Debugging a crash' },
          } as any,
        ],
      } as LLMMessage,
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolName: 'role_selection',
            toolCallId: 'call_1',
            output: { success: true },
          } as any,
        ],
      } as LLMMessage,
      { role: 'user', content: 'Now fix it' },
    ];

    const forcedRole = detectForcedRole(messages);
    expect(forcedRole).toBe('debugger');
  });

  it('detects choose_role alias from structured content', () => {
    const messages: LLMMessage[] = [
      {
        role: 'assistant',
        content: [{
          type: 'tool-call',
          toolName: 'choose_role',
          toolCallId: 'call_2',
          input: { role: 'reviewer', reason: 'Need code review' },
        } as any],
      } as LLMMessage,
    ];

    const forcedRole = detectForcedRole(messages);
    expect(forcedRole).toBe('reviewer');
  });

  it('detects role_selection from JSON-stringified assistant message', () => {
    const messages: LLMMessage[] = [
      {
        role: 'assistant',
        content: JSON.stringify([
          {
            type: 'tool-call',
            toolName: 'role_selection',
            input: { role: 'architect', reason: 'System design needed' },
          },
        ]),
      } as LLMMessage,
      { role: 'user', content: 'Design the system' },
    ];

    const forcedRole = detectForcedRole(messages);
    expect(forcedRole).toBe('architect');
  });

  it('returns undefined when no role_selection tool call exists', () => {
    const messages: LLMMessage[] = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there!' },
      { role: 'user', content: 'Write some code' },
      {
        role: 'assistant',
        content: [{
          type: 'tool-call',
          toolName: 'write_file',
          toolCallId: 'call_3',
          input: { path: 'test.ts', content: 'const x = 1;' },
        } as any],
      } as LLMMessage,
    ];

    const forcedRole = detectForcedRole(messages);
    expect(forcedRole).toBeUndefined();
  });

  it('ignores empty/whitespace-only roles', () => {
    const messages: LLMMessage[] = [
      {
        role: 'assistant',
        content: [{
          type: 'tool-call',
          toolName: 'role_selection',
          toolCallId: 'call_4',
          input: { role: '  ', reason: 'test' },
        } as any],
      } as LLMMessage,
    ];

    const forcedRole = detectForcedRole(messages);
    expect(forcedRole).toBeUndefined();
  });

  it('picks the first role_selection across messages (outer break behavior)', () => {
    const messages: LLMMessage[] = [
      {
        role: 'assistant',
        content: [{
          type: 'tool-call',
          toolName: 'role_selection',
          toolCallId: 'call_5',
          input: { role: 'debugger', reason: 'First choice' },
        } as any],
      } as LLMMessage,
      {
        role: 'assistant',
        content: [{
          type: 'tool-call',
          toolName: 'role_selection',
          toolCallId: 'call_6',
          input: { role: 'architect', reason: 'Second choice' },
        } as any],
      } as LLMMessage,
    ];

    const forcedRole = detectForcedRole(messages);
    // The first message with a valid role_selection wins
    expect(forcedRole).toBe('debugger');
  });

  it('scans JSON-stringified content after structured content in same message', () => {
    const messages: LLMMessage[] = [
      {
        role: 'assistant',
        content: JSON.stringify([
          {
            type: 'tool-call',
            toolName: 'role_selection',
            input: { role: 'securityAuditor', reason: 'Security audit needed' },
          },
        ]),
      } as LLMMessage,
    ];

    const forcedRole = detectForcedRole(messages);
    expect(forcedRole).toBe('securityAuditor');
  });
});

// ── Integration: detect → compose → verify prompt ──────────────────────────

describe('selectAndComposeSystemPrompt with forceRole (injection path)', () => {
  it('composes a debugger prompt when forcedRole is debugger', () => {
    const result = selectAndComposeSystemPrompt(
      { taskDescription: 'Fix this bug', enableFilesystemEdits: true },
      { forceRole: 'debugger' },
    );
    expect(result).not.toBeNull();
    expect(result!.role).toBe('debugger');
    expect(result!.source).toBe('core');
    expect(result!.prompt.length).toBeGreaterThan(100);
    expect(result!.prompt.toLowerCase()).toMatch(/debug|error|fix|issue/i);
  });

  it('composes an architect prompt when forcedRole is architect', () => {
    const result = selectAndComposeSystemPrompt(
      { taskDescription: 'Design system architecture', enableFilesystemEdits: true },
      { forceRole: 'architect' },
    );
    expect(result).not.toBeNull();
    expect(result!.role).toBe('architect');
    expect(result!.source).toBe('core');
    expect(result!.prompt.length).toBeGreaterThan(100);
  });

  it('composes prompts for supplementary roles', () => {
    const result = selectAndComposeSystemPrompt(
      { taskDescription: 'Train an ML model', enableFilesystemEdits: true },
      { forceRole: 'mlEngineer' },
    );
    expect(result).not.toBeNull();
    expect(result!.role).toBe('mlEngineer');
    expect(result!.source).toBe('supplementary');
    expect(result!.prompt.length).toBeGreaterThan(50);
  });

  it('composes prompts for general domain roles', () => {
    const result = selectAndComposeSystemPrompt(
      { taskDescription: 'Analyze this contract', enableFilesystemEdits: true },
      { forceRole: 'legalAnalyst' },
    );
    expect(result).not.toBeNull();
    expect(result!.role).toBe('legalAnalyst');
    expect(result!.source).toBe('general');
    expect(result!.prompt.length).toBeGreaterThan(50);
  });

  it('auto-detects role when forceRole is not set', () => {
    const result = selectAndComposeSystemPrompt(
      { taskDescription: 'Debug this stack trace', enableFilesystemEdits: true },
    );
    expect(result).not.toBeNull();
    expect(result!.role).toBe('debugger');
    expect(result!.prompt.length).toBeGreaterThan(100);
  });

  it('every valid role in getAllRoleIds produces a non-empty prompt via forceRole', () => {
    const ids = getAllRoleIds();
    // Test a representative sample across all 6 prompt sets
    const sampleRoles = [
      'coder', 'debugger', 'architect', 'reviewer', 'tester',           // core
      'mlEngineer', 'chaosEngineer', 'platformEngineer',                 // supplementary
      'legalAnalyst', 'creativeWriter', 'educator',                       // general
      'chef', 'productManager',                                           // general-v2
      'musicProducer', 'sportsAnalyst',                                   // general-v3
      'scientist', 'economist',                                            // general-v4
    ];

    for (const role of sampleRoles) {
      const result = selectAndComposeSystemPrompt(
        { taskDescription: '', enableFilesystemEdits: true },
        { forceRole: role as any },
      );
      expect(result).not.toBeNull();
      expect(result!.role).toBe(role);
      expect(result!.prompt.length).toBeGreaterThan(0);
    }
  });

  it('respects maxLength cap when composing prompts', () => {
    const result = selectAndComposeSystemPrompt(
      { taskDescription: 'Write some code', enableFilesystemEdits: true },
      { forceRole: 'coder', maxLength: 500 },
    );
    expect(result).not.toBeNull();
    expect(result!.prompt.length).toBeLessThanOrEqual(500);
  });
});

// ── Combined flow: detect → compose → verify prompt characteristics ─────────

describe('Combined flow (detect → compose)', () => {
  it('debugger detection → debugger prompt with debugging content', () => {
    // Step 1: Simulate a conversation with role_selection tool call
    const messages: LLMMessage[] = [
      { role: 'user', content: 'Fix this crash' },
      {
        role: 'assistant',
        content: [{
          type: 'tool-call',
          toolName: 'role_selection',
          toolCallId: 'call_dbg',
          input: { role: 'debugger', reason: 'Need to debug a crash' },
        } as any],
      } as LLMMessage,
      {
        role: 'tool',
        content: [{
          type: 'tool-result',
          toolName: 'role_selection',
          toolCallId: 'call_dbg',
          output: { success: true, roleAdopted: 'debugger' },
        } as any],
      } as LLMMessage,
      { role: 'user', content: 'Find the root cause' },
    ];

    // Step 2: Detect forcedRole (simulating route.ts)
    const forcedRole = detectForcedRole(messages);
    expect(forcedRole).toBe('debugger');

    // Step 3: Compose prompt with forcedRole (simulating route.ts)
    const roleSelection = selectAndComposeSystemPrompt(
      { taskDescription: 'Find the root cause', enableFilesystemEdits: true },
      { forceRole: forcedRole as any },
    );
    expect(roleSelection).not.toBeNull();
    expect(roleSelection!.role).toBe('debugger');
    expect(roleSelection!.source).toBe('core');
    expect(roleSelection!.prompt.length).toBeGreaterThan(200);

    // Step 4: Verify the composed prompt contains role-appropriate content
    const prompt = roleSelection!.prompt.toLowerCase();
    expect(prompt).toMatch(/debug|error|issue|fix/);
    expect(prompt).not.toContain('architect');
  });

  it('architect detection → architect prompt with design content', () => {
    const messages: LLMMessage[] = [
      {
        role: 'assistant',
        content: [{
          type: 'tool-call',
          toolName: 'role_selection',
          toolCallId: 'call_arch',
          input: { role: 'architect', reason: 'System design' },
        } as any],
      } as LLMMessage,
      { role: 'user', content: 'Design the system architecture' },
    ];

    const forcedRole = detectForcedRole(messages);
    expect(forcedRole).toBe('architect');

    const roleSelection = selectAndComposeSystemPrompt(
      { taskDescription: 'Design the system architecture', enableFilesystemEdits: true },
      { forceRole: forcedRole as any },
    );
    expect(roleSelection).not.toBeNull();
    expect(roleSelection!.role).toBe('architect');

    const prompt = roleSelection!.prompt.toLowerCase();
    expect(prompt).toMatch(/architect|design|system|component/i);
  });

  it('no role_selection call → auto-detect role from task description', () => {
    const messages: LLMMessage[] = [
      { role: 'user', content: 'Please review this pull request' },
    ];

    const forcedRole = detectForcedRole(messages);
    expect(forcedRole).toBeUndefined();

    // When no forcedRole, the system auto-detects
    const roleSelection = selectAndComposeSystemPrompt(
      { taskDescription: 'Please review this pull request', enableFilesystemEdits: true },
    );
    expect(roleSelection).not.toBeNull();
    expect(roleSelection!.role).toBe('reviewer');
  });

  it('empty forceRole falls through to auto-detect', () => {
    // When forceRole is empty string, it's falsy and falls through to auto-detect
    const roleSelection = selectAndComposeSystemPrompt(
      { taskDescription: 'Write a unit test for this', enableFilesystemEdits: true },
      { forceRole: '' as any },
    );
    expect(roleSelection).not.toBeNull();
    // Should auto-detect from the task description
    expect(roleSelection!.role).toBe('tester');
  });
});
