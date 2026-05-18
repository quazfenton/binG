import { parentPort } from 'node:worker_threads';

// Inverted Index: Map<word, Set<fileId>>
let index: Map<string, Set<string>> = new Map();
let workspaceFiles: Map<string, { path: string; content: string }> = new Map();

function tokenize(text: string): string[] {
  // Tokenize: lowercase, remove non-alphanumeric, filter short words
  return text.toLowerCase().match(/\b\w{3,}\b/g) || [];
}

parentPort?.on('message', async (task: { type: string; payload: any }) => {
  if (task.type === 'init') {
    const workspace = task.payload;
    index = new Map();
    workspaceFiles = new Map();

    for (const [id, file] of Object.entries(workspace.files)) {
      const fileObj = file as { path: string; content: string };
      workspaceFiles.set(id, fileObj);
      
      const words = tokenize(fileObj.content);
      for (const word of words) {
        if (!index.has(word)) index.set(word, new Set());
        index.get(word)!.add(id);
      }
    }
    parentPort?.postMessage({ type: 'initialized' });
  } else if (task.type === 'search') {
    const { query, maxResults, maxPerFile, contextLines, caseInsensitive, fixedString, wordRegexp, glob, path: searchPath } = task.payload;
    const lq = query.toLowerCase();
    
    // 1. Identify Candidate Files using the index
    // We try to find any part of the query in the index to narrow down the file list
    const queryTokens = tokenize(query);
    let candidateIds: Set<string>;

    if (queryTokens.length > 0) {
      // Intersection of files containing any of the tokens (as a starting point)
      candidateIds = new Set();
      for (const token of queryTokens) {
        const ids = index.get(token);
        if (ids) {
          for (const id of ids) candidateIds.add(id);
        }
      }
    } else {
      // Fallback: search all files if query is too short or has no tokens
      candidateIds = new Set(workspaceFiles.keys());
    }

    // 2. Prepare Regex
    let pattern = query;
    if (fixedString) pattern = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (wordRegexp) pattern = `\\b(?:${pattern})\\b`;
    const regex = new RegExp(pattern, caseInsensitive ? 'i' : '');

    // 3. Prepare Glob/Path filters
    const normalizedBasePath = (searchPath || 'workspace').replace(/\\/g, '/').trim();

    const matches = [];

    for (const id of candidateIds) {
      if (matches.length >= maxResults) break;
      const file = workspaceFiles.get(id);
      if (!file) continue;

      // Filter by path
      if (normalizedBasePath !== 'workspace' && !file.path.startsWith(normalizedBasePath + '/') && file.path !== normalizedBasePath) continue;

      // Filter by content (Fast Path)
      if (!regex.test(file.content)) continue;

      const lines = file.content.split('\n');
      let fileMatches = 0;
      for (let i = 0; i < lines.length; i++) {
        if (fileMatches >= maxPerFile || matches.length >= maxResults) break;
        if (regex.test(lines[i])) {
          matches.push({
            path: file.path,
            lineNumber: i + 1,
            content: lines[i],
            contextBefore: contextLines > 0 ? lines.slice(Math.max(0, i - contextLines), i) : [],
            contextAfter: contextLines > 0 ? lines.slice(i + 1, Math.min(lines.length, i + 1 + contextLines)) : [],
          });
          fileMatches++;
        }
      }
    }
    
    parentPort?.postMessage({ type: 'results', matches });
  }
});
