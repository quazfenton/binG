/**
 * Regression tests for Bug #37: centralized toolNameAliases map in tools/router.ts.
 *
 * The map silently rewrites LLM-invented tool names (e.g. `list_directory`,
 * `bash_execute`, `read_file` vs `read_files`) to the canonical capability
 * ID and emits a [STEER] hint so the model learns the canonical name on retry.
 *
 * Without this map, an LLM that invents `list_directory` instead of using
 * `list_files` would loop 5× on `is not a function` errors before any operator
 * notices. With this map, the first call is silently rewritten to `file.list`
 * and a one-liner steer is logged.
 */

import { describe, it, expect } from 'vitest';
import { TOOL_NAME_ALIASES, resolveToolNameAlias } from '@/lib/tools/router';

describe('TOOL_NAME_ALIASES (Bug #37)', () => {
  it('contains list_directory as the most common misname (the headline fix)', () => {
    expect(TOOL_NAME_ALIASES['list_directory']).toBe('file.list');
  });

  it('maps the most common bash misnames to bash.execute', () => {
    expect(TOOL_NAME_ALIASES['bash']).toBe('bash.execute');
    expect(TOOL_NAME_ALIASES['bash_execute']).toBe('bash.execute');
    expect(TOOL_NAME_ALIASES['shell']).toBe('bash.execute');
    expect(TOOL_NAME_ALIASES['exec_shell']).toBe('bash.execute');
  });

  it('maps read_file and read_files to file.read (singular capability, plural alias)', () => {
    expect(TOOL_NAME_ALIASES['read_file']).toBe('file.read');
    expect(TOOL_NAME_ALIASES['read_files']).toBe('file.read');
  });

  it('maps search/grep/rg to repo.search', () => {
    expect(TOOL_NAME_ALIASES['search']).toBe('repo.search');
    expect(TOOL_NAME_ALIASES['grep']).toBe('repo.search');
    expect(TOOL_NAME_ALIASES['rg']).toBe('repo.search');
  });

  it('does not shadow canonical capability IDs', () => {
    // Sanity: canonical IDs like 'file.read' must not be entries in the
    // alias map (they would loop). Only alternate names belong here.
    expect(TOOL_NAME_ALIASES['file.read']).toBeUndefined();
    expect(TOOL_NAME_ALIASES['file.list']).toBeUndefined();
    expect(TOOL_NAME_ALIASES['bash.execute']).toBeUndefined();
  });

  it('every value is a canonical capability ID (dotted form)', () => {
    // Heuristic: every canonical value should look like 'category.action'.
    for (const [alias, canonical] of Object.entries(TOOL_NAME_ALIASES)) {
      expect(canonical).toMatch(/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/);
      // Aliases should not be dotted — they are LLM-invented misnames.
      expect(alias).not.toContain('.');
    }
  });
});

describe('resolveToolNameAlias (Bug #37)', () => {
  it('returns rewritten=true when the name is a known alias', () => {
    const result = resolveToolNameAlias('list_directory');
    expect(result.rewritten).toBe(true);
    expect(result.canonical).toBe('file.list');
  });

  it('returns rewritten=false for an already-canonical name (idempotent)', () => {
    const result = resolveToolNameAlias('file.list');
    expect(result.rewritten).toBe(false);
    expect(result.canonical).toBe('file.list');
  });

  it('is case-insensitive (LLMs often capitalize tool names)', () => {
    const result = resolveToolNameAlias('List_Directory');
    expect(result.rewritten).toBe(true);
    expect(result.canonical).toBe('file.list');
  });

  it('strips leading/trailing whitespace', () => {
    const result = resolveToolNameAlias('  bash_execute  ');
    expect(result.rewritten).toBe(true);
    expect(result.canonical).toBe('bash.execute');
  });

  it('returns rewritten=false and canonical=rawName for unknown names', () => {
    const result = resolveToolNameAlias('nonexistent_tool');
    expect(result.rewritten).toBe(false);
    expect(result.canonical).toBe('nonexistent_tool');
  });

  it('returns empty result for empty/null/undefined input (defensive)', () => {
    expect(resolveToolNameAlias('').rewritten).toBe(false);
    expect(resolveToolNameAlias('').canonical).toBe('');
    // @ts-expect-error - intentional bad input
    expect(resolveToolNameAlias(null).rewritten).toBe(false);
    // @ts-expect-error - intentional bad input
    expect(resolveToolNameAlias(undefined).rewritten).toBe(false);
  });

  it('rewrites the headline Bug #37 case (list_directory → file.list)', () => {
    // This is the exact case that caused the 5× is-not-a-function loop in run.log.
    const result = resolveToolNameAlias('list_directory');
    expect(result.canonical).toBe('file.list');
  });
});
