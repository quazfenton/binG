#!/usr/bin/env node
import fs from "fs-extra";
import path from "path";

const DOCS_ROOT = process.argv[2] || "docs";
const OUT = path.join(DOCS_ROOT, "symbol-index.json");

type SymbolEntry = {
  name: string;
  type: "function" | "class" | "interface" | "type" | "const" | "variable";
  file: string;
  exported: boolean;
};

const symbolIndex: Record<string, SymbolEntry[]> = {};

const exportPatterns = [
  { regex: /^export\s+(?:default\s+)?(?:async\s+)?function\s+(\w+)/g, type: "function" as const },
  { regex: /^export\s+(?:default\s+)?class\s+(\w+)/g, type: "class" as const },
  { regex: /^export\s+(?:default\s+)?interface\s+(\w+)/g, type: "interface" as const },
  { regex: /^export\s+(?:default\s+)?type\s+(\w+)/g, type: "type" as const },
  { regex: /^export\s+(?:default\s+)?const\s+(\w+)/g, type: "const" as const },
];

function extractSymbolsFromCode(code: string, filePath: string): SymbolEntry[] {
  const symbols: SymbolEntry[] = [];
  
  for (const { regex, type } of exportPatterns) {
    regex.lastIndex = 0;
    let match;
    while ((match = regex.exec(code)) !== null) {
      if (!match[1].includes(",")) {
        symbols.push({
          name: match[1],
          type,
          file: filePath,
          exported: true
        });
      }
    }
  }

  const fnPattern = /^(?:async\s+)?function\s+(\w+)/g;
  fnPattern.lastIndex = 0;
  let fnMatch;
  while ((fnMatch = fnPattern.exec(code)) !== null) {
    if (!symbols.some(s => s.name === fnMatch[1] && s.exported)) {
      symbols.push({
        name: fnMatch[1],
        type: "function",
        file: filePath,
        exported: false
      });
    }
  }

  return symbols;
}

async function walkDir(dir: string, extensions: string[], callback: (file: string) => void) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!entry.name.startsWith(".") && entry.name !== "node_modules") {
        await walkDir(fullPath, extensions, callback);
      }
    } else if (extensions.some(ext => entry.name.endsWith(ext))) {
      callback(fullPath);
    }
  }
}

async function buildSymbolIndex() {
  const codeExts = [".ts", ".tsx", ".js", ".jsx"];
  
  await walkDir(DOCS_ROOT, codeExts, async (fullPath) => {
    const relPath = path.relative(DOCS_ROOT, fullPath);
    const code = await fs.readFile(fullPath, "utf8");
    const symbols = extractSymbolsFromCode(code, relPath);
    
    if (symbols.length > 0) {
      symbolIndex[relPath] = symbols;
    }
  });

  await fs.writeJSON(OUT, symbolIndex, { spaces: 2 });
  console.log("Wrote symbol index:", OUT);
  console.log("Total files indexed:", Object.keys(symbolIndex).length);
}

buildSymbolIndex().catch(err => {
  console.error(err);
  process.exit(1);
});