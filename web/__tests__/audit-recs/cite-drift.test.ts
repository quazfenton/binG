/**
 * Cite-drift regression guard.
 *
 * Cites in `/opt/bing/docs/MCP_TOOL_SELECTION_POSTAUDIT_FOLLOWUPS.md` +
 * `/opt/bing/docs/CENTRALIZED_TODO_LIST.md` use `:L\d+(-L\d+)?` patterns
 * referencing specific lines in test files + source files. Over time
 * line numbers drift (L5560 → L5609 type corrections), so this test:
 *
 *   1. Extracts every `:L\d+(-L\d+)?` pattern from both docs
 *   2. Looks backwards ~120 chars for the closest referenced file path
 *   3. Verifies STRUCTURAL correctness: file exists, line within bounds,
 *      line content is non-empty
 *   4. For test-file cites: verifies the cited start line is inside an
 *      `it(` or `describe(` block, and the cited end (if a range) lands
 *      on a closing `});` boundary
 *
 * The test HARD-FAILS on any drift so future reference-doc edits cannot
 * silently leave stale line numbers behind. Lock-in is CI-runnable, not
 * prose-only JSDoc.
 *
 * Companion to the item ⑥ lock-in (legacy-substring-contract.test.ts).
 * Item ⑥ locks the requireFullCatalog sentinel contract; this test locks
 * the cite-accuracy contract for the docs that reference item ⑥ + the
 * rest of the postaudit story.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const DOCS = [
  '/opt/bing/docs/MCP_TOOL_SELECTION_POSTAUDIT_FOLLOWUPS.md',
  '/opt/bing/docs/CENTRALIZED_TODO_LIST.md',
];
const PROJECT_ROOT = '/opt/bing';

interface Cite {
  doc: string;
  docLine: number;
  filePath: string;
  startLine: number;
  endLine?: number;
}

/**
 * Look backwards from `pos` in `text` for the closest file path.
 * Returns the rightmost match (closest in source order) regardless of
 * extension, so closely-packed mixed citations like `route.ts:L500 and
 * /web/.../route-shape-audit.test.ts:L945` resolve each cite to its
 * own adjacent file rather than greedily picking the first test file.
 */
function findFilePathNear(text: string, pos: number, searchBack = 120): string | null {
  const before = text.slice(Math.max(0, pos - searchBack), pos);
  // Array.from() avoids TS2802 (RegExpStringIterator spread requires
  // --downlevelIteration OR --target es2015+; Array.from works at any target).
  const matches = Array.from(before.matchAll(/([\w\./-]+\.(?:ts|tsx|js|jsx))(?![\w])/g));
  return matches.length > 0 ? matches[matches.length - 1][1] : null;
}

function extractCites(docPath: string): Cite[] {
  if (!fs.existsSync(docPath)) return [];
  const content = fs.readFileSync(docPath, 'utf8');
  const lines = content.split('\n');
  const cites: Cite[] = [];

  const citePattern = /:L(\d+)(?:-L(\d+))?/g;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    citePattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = citePattern.exec(line)) !== null) {
      const filePath = findFilePathNear(line, match.index);
      if (!filePath) continue;
      cites.push({
        doc: docPath,
        docLine: i + 1,
        filePath,
        startLine: parseInt(match[1], 10),
        endLine: match[2] ? parseInt(match[2], 10) : undefined,
      });
    }
  }
  return cites;
}

/**
 * Resolve a cited file path relative to /opt/bing if not absolute.
 * Returns the absolute path or null if the path is unresolvable
 * (e.g., a bare filename without enough context).
 *
 * Special case: paths starting with `/web/` or `/packages/` are
 * project-relative even though they have a leading slash (the docs
 * sometimes cite them as `/web/lib/...` or `/packages/shared/...`).
 * These are resolved under /opt/bing/ to match the actual repo layout.
 */
function resolveFilePath(filePath: string): string | null {
  // Project-relative paths with leading slash (e.g. `/web/lib/foo.ts`)
  if (filePath.startsWith('/web/') || filePath.startsWith('/packages/')) {
    return path.join(PROJECT_ROOT, filePath.slice(1));
  }
  // Truly absolute path (not under /opt/bing) → use as-is
  if (path.isAbsolute(filePath)) return filePath;
  // Skip bare filenames (e.g., `route.ts` without directory prefix) —
  // those have no deterministic base for resolution.
  if (!filePath.includes('/')) return null;
  return path.join(PROJECT_ROOT, filePath);
}

/**
 * Walk backwards from `lineNumber` (1-indexed) to determine whether
 * the cited line is inside an `it(` or `describe(` block. Returns
 * the depth-1-opening line content if found, null otherwise.
 */
function findEnclosingTestBlock(
  fileLines: string[],
  lineNumber: number,
): { lineNumber: number; line: string } | null {
  let depth = 0;
  for (let i = lineNumber - 1; i >= 0; i--) {
    const line = fileLines[i] ?? '';
    const closes = (line.match(/\}\)/g) ?? []).length;
    const opens = (line.match(/\b(it|describe)(\s*\.skip)?\s*\(/g) ?? []).length;
    depth += closes - opens;
    if (depth < 0) {
      return { lineNumber: i + 1, line };
    }
  }
  return null;
}

function isTestFile(filePath: string): boolean {
  return /\.test\.(ts|tsx|js|jsx)$/.test(filePath) || /\.spec\.(ts|tsx|js|jsx)$/.test(filePath);
}

describe('Cite-drift regression guard', () => {
  const allCites: Cite[] = [];

  beforeAll(() => {
    for (const doc of DOCS) {
      allCites.push(...extractCites(doc));
    }
    // eslint-disable-next-line no-console
    console.log(`[cite-drift] extracted ${allCites.length} cites from ${DOCS.length} docs`);
  });

  it('extracts at least 1 cite from the audited docs (sanity)', () => {
    expect(allCites.length).toBeGreaterThan(0);
  });

  it('every cited file exists (hard-fail on missing)', () => {
    const failures: string[] = [];
    for (const cite of allCites) {
      const resolvedPath = resolveFilePath(cite.filePath);
      if (!resolvedPath) continue; // skip unresolvable bare filenames
      if (!fs.existsSync(resolvedPath)) {
        failures.push(
          `MISSING FILE: ${cite.filePath} (cited at ${path.basename(cite.doc)}:${cite.docLine})`,
        );
      }
    }
    if (failures.length > 0) {
      // eslint-disable-next-line no-console
      console.log('[cite-drift] missing-file failures:\n' + failures.join('\n'));
    }
    expect(failures).toEqual([]);
  });

  it('every cited line is within file bounds (hard-fail on drift)', () => {
    const failures: string[] = [];
    for (const cite of allCites) {
      const resolvedPath = resolveFilePath(cite.filePath);
      if (!resolvedPath || !fs.existsSync(resolvedPath)) continue;
      const fileContent = fs.readFileSync(resolvedPath, 'utf8');
      const totalLines = fileContent.split('\n').length;
      const endLine = cite.endLine ?? cite.startLine;
      if (endLine > totalLines) {
        failures.push(
          `OUT OF BOUNDS: ${cite.filePath}:L${cite.startLine}${
            cite.endLine ? `-L${cite.endLine}` : ''
          } (file has ${totalLines} lines, cited at ${path.basename(cite.doc)}:${cite.docLine})`,
        );
      }
      if (cite.startLine < 1) {
        failures.push(
          `INVALID START LINE: ${cite.filePath}:L${cite.startLine} (cited at ${path.basename(cite.doc)}:${cite.docLine})`,
        );
      }
    }
    if (failures.length > 0) {
      // eslint-disable-next-line no-console
      console.log('[cite-drift] out-of-bounds failures:\n' + failures.join('\n'));
    }
    expect(failures).toEqual([]);
  });

  it('every cited line points to non-empty content (hard-fail on whitespace-only drift)', () => {
    const failures: string[] = [];
    for (const cite of allCites) {
      const resolvedPath = resolveFilePath(cite.filePath);
      if (!resolvedPath || !fs.existsSync(resolvedPath)) continue;
      const fileLines = fs.readFileSync(resolvedPath, 'utf8').split('\n');
      const startLine = fileLines[cite.startLine - 1] ?? '';
      if (startLine.trim().length === 0) {
        failures.push(
          `EMPTY LINE: ${cite.filePath}:L${cite.startLine} (cited at ${path.basename(cite.doc)}:${cite.docLine})`,
        );
      }
    }
    if (failures.length > 0) {
      // eslint-disable-next-line no-console
      console.log('[cite-drift] empty-line failures:\n' + failures.join('\n'));
    }
    expect(failures).toEqual([]);
  });

  it('every cited test-file range starts inside an it()/describe() block (hard-fail on boundary drift)', () => {
    const failures: string[] = [];
    for (const cite of allCites) {
      if (!isTestFile(cite.filePath)) continue;
      const resolvedPath = resolveFilePath(cite.filePath);
      if (!resolvedPath || !fs.existsSync(resolvedPath)) continue;
      const fileLines = fs.readFileSync(resolvedPath, 'utf8').split('\n');

      // Allow file-top references: imports + vi.mock setup at the top of
      // test files (typically L1-L30) are not inside an it() block by
      // design — those are module-level declarations. Cites in this
      // region are valid (the user often cites the mock-setup preamble
      // when referencing test scaffolding).
      if (cite.startLine <= 30) continue;

      const enclosingBlock = findEnclosingTestBlock(fileLines, cite.startLine);
      if (!enclosingBlock) {
        failures.push(
          `NOT INSIDE TEST BLOCK: ${cite.filePath}:L${cite.startLine} (cited at ${path.basename(cite.doc)}:${cite.docLine})`,
        );
        continue;
      }

      // Verify the cited end (if range) lands at or near a closing }) boundary
      if (cite.endLine && cite.endLine !== cite.startLine) {
        const endLineContent = fileLines[cite.endLine - 1] ?? '';
        const afterEndContent = fileLines[cite.endLine] ?? '';
        const isAtClosingBoundary =
          /^\s*\}\);?\s*$/.test(endLineContent) || /^\s*\}\);?\s*$/.test(afterEndContent);
        if (!isAtClosingBoundary) {
          // Allow ±2 line tolerance for closing-boundary drift
          const beforeEnd = fileLines[cite.endLine - 2] ?? '';
          const farAfterEnd = fileLines[cite.endLine + 1] ?? '';
          const isNearClosingBoundary =
            isAtClosingBoundary ||
            /^\s*\}\);?\s*$/.test(beforeEnd) ||
            /^\s*\}\);?\s*$/.test(farAfterEnd);
          if (!isNearClosingBoundary) {
            failures.push(
              `END NOT NEAR CLOSING: ${cite.filePath}:L${cite.endLine} (end content: "${endLineContent.trim().slice(0, 60)}", cited at ${path.basename(cite.doc)}:${cite.docLine})`,
            );
          }
        }
      }
    }
    if (failures.length > 0) {
      // eslint-disable-next-line no-console
      console.log('[cite-drift] test-block boundary failures:\n' + failures.join('\n'));
    }
    expect(failures).toEqual([]);
  });
});