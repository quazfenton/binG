/**
 * Smoke test for import resolution logic — validates the algorithm used in smart-context.ts
 */

function resolveImportPath(rawPath, sourceDir, allPathsLower, allPathsOrig) {
  const candidates = [];
  if (rawPath.startsWith('/')) {
    candidates.push(rawPath);
  } else if (rawPath.startsWith('./') || rawPath.startsWith('../')) {
    const baseParts = sourceDir === '/' ? [''] : sourceDir.split('/');
    const rawParts = rawPath.split('/');
    for (const part of rawParts) {
      if (part === '..') {
        if (baseParts.length > 1) baseParts.pop();
      } else if (part !== '.' && part !== '') {
        baseParts.push(part);
      }
    }
    const resolvedPath = baseParts.join('/').replace(/^\/+/, '/') || '/';
    candidates.push(resolvedPath);
  } else {
    return null;
  }

  const exts = ['', '.ts', '.tsx', '.js', '.jsx', '.py', '.rs', '.go', '.css', '.scss'];
  for (const candidate of candidates) {
    const cl = candidate.toLowerCase();
    if (allPathsLower.has(cl)) return allPathsOrig.get(cl);
    for (const ext of exts) {
      const withExt = candidate + ext;
      const wl = withExt.toLowerCase();
      if (allPathsLower.has(wl)) return allPathsOrig.get(wl);
    }
    const indexFiles = ['index.ts', 'index.tsx', 'index.js', 'index.py', '__init__.py', 'index.css', 'mod.rs'];
    for (const idx of indexFiles) {
      const ip = candidate + '/' + idx;
      const il = ip.toLowerCase();
      if (allPathsLower.has(il)) return allPathsOrig.get(il);
    }
  }
  return null;
}

// In real code: keys are lowercase, values preserve original case
const vfsFiles = new Map([
  ['/src/utils.ts', '/src/utils.ts'],
  ['/src/components/header.tsx', '/src/components/Header.tsx'],
  ['/src/components/index.tsx', '/src/components/index.tsx'],
  ['/src/styles/main.css', '/src/styles/main.css'],
  ['/lib/helpers/helper.ts', '/lib/helpers/helper.ts'],
]);
const vfsLower = new Set([...vfsFiles.keys()]); // Already lowercase

const tests = [
  // Relative imports
  ['./utils', '/src/app.ts', '/src/utils.ts'],
  ['./components', '/src/app.ts', '/src/components/index.tsx'],
  ['./components/Header', '/src/app.ts', '/src/components/Header.tsx'],
  ['./styles/main.css', '/src/app.ts', '/src/styles/main.css'],
  // Parent directory traversal
  ['../utils', '/src/components/app.ts', '/src/utils.ts'],
  ['../../../lib/helpers/helper', '/src/components/nested/deep.ts', '/lib/helpers/helper.ts'],
  // External packages (should return null)
  ['react', '/src/app.ts', null],
  ['lodash', '/src/app.ts', null],
  // Absolute VFS paths
  ['/src/utils', '/other/file.ts', '/src/utils.ts'],
  ['/src/components/Header', '/other/file.ts', '/src/components/Header.tsx'],
];

let passed = 0;
let failed = 0;

for (const [imp, src, expected] of tests) {
  const dir = src.substring(0, src.lastIndexOf('/'));
  const result = resolveImportPath(imp, dir, vfsLower, vfsFiles);
  if (result === expected) {
    passed++;
    console.log(`✓ ${imp.padEnd(40)} → ${result || '(null)'}`);
  } else {
    failed++;
    console.log(`✗ ${imp.padEnd(40)} → ${result || '(null)'} (expected: ${expected})`);
  }
}

console.log(`\n${passed}/${tests.length} passed`);
if (failed > 0) {
  console.log('\nDebugging failures...');
  // Re-run failed tests with verbose output
  for (const [imp, src, expected] of tests) {
    const dir = src.substring(0, src.lastIndexOf('/'));
    const result = resolveImportPath(imp, dir, vfsLower, vfsFiles);
    if (result !== expected) {
      console.log(`  Input: "${imp}" from "${src}" (dir: "${dir}")`);
      console.log(`  Expected: ${expected}, Got: ${result}`);
      console.log(`  VFS files: ${[...vfsFiles.keys()].join(', ')}`);
    }
  }
}

process.exit(failed > 0 ? 1 : 0);
