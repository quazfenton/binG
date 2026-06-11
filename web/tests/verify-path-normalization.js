function normalizeSessionId(sessionId) {
  if (!sessionId || typeof sessionId !== 'string') return '';
  const trimmed = sessionId.trim();
  if (!trimmed) return '';
  
  // Composite IDs can use $ or : as a separator
  if (trimmed.includes('$') || trimmed.includes(':')) {
    const separatorIndex = Math.max(trimmed.lastIndexOf('$'), trimmed.lastIndexOf(':'));
    return trimmed.slice(separatorIndex + 1).trim();
  }
  return trimmed;
}

function normalizeFilesystemPath(path) {
  const sessionsMatch = path.match(/^workspace\/sessions\/([^/]+)/i);
  if (sessionsMatch) {
    const sessionSegment = sessionsMatch[1];
    if (sessionSegment.includes('$') || sessionSegment.includes(':')) {
      const normalizedSimpleId = normalizeSessionId(sessionSegment);
      return path.replace(`workspace/sessions/${sessionSegment}`, `workspace/sessions/${normalizedSimpleId}`);
    }
  }
  return path;
}

// Test cases
const tests = [
  { input: 'workspace/sessions/anon$006/src/file.ts', expected: 'workspace/sessions/006/src/file.ts' },
  { input: 'workspace/sessions/1$006/file.txt', expected: 'workspace/sessions/006/file.txt' },
  { input: 'workspace/sessions/user:006/config.json', expected: 'workspace/sessions/006/config.json' },
  { input: 'workspace/sessions/006/file.ts', expected: 'workspace/sessions/006/file.ts' },
  { input: 'src/file.ts', expected: 'src/file.ts' },
];

let failed = false;
tests.forEach(({ input, expected }) => {
  const result = normalizeFilesystemPath(input);
  if (result !== expected) {
    console.error(`FAILED: Input "${input}" -> Expected "${expected}", got "${result}"`);
    failed = true;
  } else {
    console.log(`PASSED: "${input}"`);
  }
});

if (failed) {
  process.exit(1);
} else {
  console.log('ALL TESTS PASSED');
  process.exit(0);
}
