import { parentPort } from 'node:worker_threads';

/**
 * Worker for heavy parsing and extraction tasks.
 * Offloads CPU-intensive regex and string manipulation from the main thread.
 */
parentPort?.on('message', async (task: { type: string; data: any; id: string }) => {
  try {
    let result;
    switch (task.type) {
      case 'extractSymbols':
        result = extractSymbols(task.data.content, task.data.language);
        break;
      case 'extractKeywords':
        result = extractKeywords(task.data.content, task.data.symbols);
        break;
      case 'parseJSON':
        result = JSON.parse(task.data);
        break;
      case 'cosineSimilarityBatch':
        result = cosineSimilarityBatch(task.data.queryEmbedding, task.data.embeddings);
        break;
      default:
        throw new Error(`Unknown task type: ${task.type}`);
    }
    parentPort?.postMessage({ id: task.id, type: 'success', result });
  } catch (e: any) {
    parentPort?.postMessage({ id: task.id, type: 'error', error: e.message });
  }
});

function extractSymbols(content: string, language: string) {
  const symbols: any[] = [];
  const lines = content.split('\n');

  const patterns: Record<string, any[]> = {
    typescript: [
      { pattern: /export\s+(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)/g, type: 'function' },
      { pattern: /export\s+class\s+(\w+)/g, type: 'class' },
      { pattern: /export\s+interface\s+(\w+)/g, type: 'interface' },
      { pattern: /export\s+(?:const|let|var)\s+(\w+)/g, type: 'variable' },
      { pattern: /export\s+type\s+(\w+)/g, type: 'type' },
    ],
    python: [
      { pattern: /def\s+(\w+)\s*\(([^)]*)\)/g, type: 'function' },
      { pattern: /class\s+(\w+)/g, type: 'class' },
    ],
    rust: [
      { pattern: /fn\s+(\w+)\s*\(([^)]*)\)/g, type: 'function' },
      { pattern: /struct\s+(\w+)/g, type: 'class' },
      { pattern: /trait\s+(\w+)/g, type: 'interface' },
    ],
  };

  const langPatterns = patterns[language] || patterns.typescript;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const pattern of langPatterns) {
      const regex = pattern.pattern;
      let match;
      while ((match = regex.exec(line)) !== null) {
        symbols.push({
          name: match[1],
          type: pattern.type,
          line: i + 1,
          column: match.index + 1,
          signature: match[2] || undefined,
        });
      }
    }
  }
  return symbols;
}

function extractKeywords(content: string, symbols: any[]) {
  const keywords = new Set<string>();
  for (const symbol of symbols) {
    keywords.add(symbol.name.toLowerCase());
  }
  const commonKeywords = [
    'function', 'class', 'interface', 'type', 'const', 'let', 'var',
    'import', 'export', 'from', 'return', 'async', 'await',
    'if', 'else', 'for', 'while', 'switch', 'case', 'break', 'continue',
    'try', 'catch', 'finally', 'throw', 'error',
  ];
  const lowerContent = content.toLowerCase();
  for (const keyword of commonKeywords) {
    if (lowerContent.includes(keyword)) {
      keywords.add(keyword);
    }
  }
  return Array.from(keywords);
}

function cosineSimilarityBatch(query: number[], targets: number[][]) {
  return targets.map(target => {
    if (!target) return 0;
    let dotProduct = 0;
    let mA = 0;
    let mB = 0;
    for (let i = 0; i < query.length; i++) {
      dotProduct += query[i] * target[i];
      mA += query[i] * query[i];
      mB += target[i] * target[i];
    }
    mA = Math.sqrt(mA);
    mB = Math.sqrt(mB);
    const similarity = dotProduct / (mA * mB);
    return isNaN(similarity) ? 0 : similarity;
  });
}
