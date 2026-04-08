/**
 * symbolExtractor.ts — AST-based symbol extraction using web-tree-sitter
 * Install: npm install web-tree-sitter
 *
 * You need to copy the WASM files to /public:
 *   node_modules/web-tree-sitter/tree-sitter.wasm → public/
 *   Get grammar WASMs from: https://github.com/nickel-lang/tree-sitter-nickel
 *   or build from https://github.com/tree-sitter/tree-sitter-typescript
 */

import Parser from "web-tree-sitter";
import type { VectorEntry, EdgeEntry } from "../memory/vectorStore";
import { buildSymbolEmbedInput } from "../memory/embeddings";
import { v4 as uuidv4 } from "uuid";

// ─── Types ────────────────────────────────────────────────────────────────────

export type SymbolKind = "function" | "class" | "component" | "method" | "chunk";
export type Language = "ts" | "py" | "rs" | "other";

export interface ExtractedSymbol {
  name: string;
  kind: SymbolKind;
  content: string;
  startLine: number;
  endLine: number;
  imports: string[];
}

// ─── Parser singleton ─────────────────────────────────────────────────────────

let _parserReady = false;
let _parser: Parser | null = null;

export async function initParser(): Promise<void> {
  if (_parserReady) return;

  await Parser.init({
    locateFile: () => "/tree-sitter.wasm",
  });

  _parser = new Parser();
  _parserReady = true;
}

async function getParser(lang: Language): Promise<Parser> {
  if (!_parserReady || !_parser) await initParser();

  const wasmPaths: Partial<Record<Language, string>> = {
    ts: "/tree-sitter-typescript.wasm",
    py: "/tree-sitter-python.wasm",
    rs: "/tree-sitter-rust.wasm",
  };

  const wasmPath = wasmPaths[lang];
  if (!wasmPath) throw new Error(`Unsupported language: ${lang}`);

  const language = await Parser.Language.load(wasmPath);
  _parser!.setLanguage(language);

  return _parser!;
}

// ─── Language Detection ───────────────────────────────────────────────────────

export function detectLanguage(filePath: string): Language {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, Language> = {
    ts: "ts", tsx: "ts", js: "ts", jsx: "ts",
    py: "py",
    rs: "rs",
  };
  return map[ext] ?? "other";
}

// ─── Symbol Extraction ────────────────────────────────────────────────────────

/**
 * Extract functions, classes, and React components from source code.
 * Falls back to line-based chunking for unsupported languages.
 */
export async function extractSymbols(
  source: string,
  filePath: string
): Promise<ExtractedSymbol[]> {
  const lang = detectLanguage(filePath);

  if (lang === "other") {
    return fallbackChunkSymbols(source);
  }

  try {
    const parser = await getParser(lang);
    const tree = parser.parse(source);
    return extractFromTree(tree.rootNode, source, lang);
  } catch {
    // If parser fails, fall back to chunk-based
    return fallbackChunkSymbols(source);
  }
}

function extractFromTree(
  root: Parser.SyntaxNode,
  source: string,
  lang: Language
): ExtractedSymbol[] {
  const symbols: ExtractedSymbol[] = [];
  const imports = extractImports(root, source);

  function visit(node: Parser.SyntaxNode) {
    const kind = classifyNode(node, lang);
    if (kind) {
      const name = getSymbolName(node, source);
      if (name && name.length > 0) {
        const startLine = node.startPosition.row;
        const endLine = node.endPosition.row;
        const content = source.slice(node.startIndex, node.endIndex);

        // Detect React components (PascalCase function returning JSX)
        const effectiveKind: SymbolKind =
          kind === "function" && /^[A-Z]/.test(name) ? "component" : kind;

        symbols.push({
          name,
          kind: effectiveKind,
          content,
          startLine,
          endLine,
          imports,
        });
      }
    }

    for (const child of node.children) {
      visit(child);
    }
  }

  visit(root);
  return symbols;
}

function classifyNode(node: Parser.SyntaxNode, _lang: Language): SymbolKind | null {
  switch (node.type) {
    case "function_declaration":
    case "function":
    case "arrow_function":
      return "function";
    case "class_declaration":
    case "class":
      return "class";
    case "method_definition":
      return "method";
    default:
      return null;
  }
}

function getSymbolName(node: Parser.SyntaxNode, source: string): string {
  const nameNode = node.childForFieldName?.("name");
  if (nameNode) {
    return source.slice(nameNode.startIndex, nameNode.endIndex);
  }
  // For arrow functions assigned to variables, look up to parent
  if (node.parent?.type === "variable_declarator") {
    const id = node.parent.childForFieldName?.("name");
    if (id) return source.slice(id.startIndex, id.endIndex);
  }
  return "";
}

function extractImports(root: Parser.SyntaxNode, source: string): string[] {
  const imports: string[] = [];

  function visit(node: Parser.SyntaxNode) {
    if (node.type === "import_statement" || node.type === "import_from_statement") {
      imports.push(source.slice(node.startIndex, node.endIndex).split("\n")[0]);
    }
    for (const child of node.children) {
      visit(child);
    }
  }

  visit(root);
  return imports.slice(0, 10); // cap at 10 imports for embedding input
}

/** Extract call expressions as raw strings for edge detection */
export function extractCallNames(root: Parser.SyntaxNode, source: string): string[] {
  const calls: string[] = [];

  function visit(node: Parser.SyntaxNode) {
    if (node.type === "call_expression") {
      const fn = node.childForFieldName?.("function");
      if (fn) calls.push(source.slice(fn.startIndex, fn.endIndex));
    }
    for (const child of node.children) {
      visit(child);
    }
  }

  visit(root);
  return [...new Set(calls)];
}

// ─── Fallback: chunk-based for unsupported langs ──────────────────────────────

function fallbackChunkSymbols(source: string): ExtractedSymbol[] {
  const lines = source.split("\n");
  const chunkSize = 30;
  const chunks: ExtractedSymbol[] = [];

  for (let i = 0; i < lines.length; i += chunkSize) {
    const slice = lines.slice(i, i + chunkSize);
    chunks.push({
      name: `chunk_L${i + 1}`,
      kind: "chunk",
      content: slice.join("\n"),
      startLine: i,
      endLine: i + slice.length,
      imports: [],
    });
  }

  return chunks;
}

// ─── Build VectorEntry from ExtractedSymbol ───────────────────────────────────

export function buildVectorEntry(
  symbol: ExtractedSymbol,
  opts: {
    projectId: string;
    filePath: string;
    fileHash: string;
    embedding: number[];
    language: Language;
  }
): VectorEntry {
  return {
    id: uuidv4(),
    projectId: opts.projectId,
    filePath: opts.filePath,
    name: symbol.name,
    kind: symbol.kind,
    content: symbol.content,
    embedding: opts.embedding,
    fileHash: opts.fileHash,
    startLine: symbol.startLine,
    endLine: symbol.endLine,
    importance: 0.5, // overwritten by PageRank
    language: opts.language,
    updatedAt: Date.now(),
  };
}

/** Build the text input for embedding this symbol */
export function symbolEmbedInput(symbol: ExtractedSymbol, filePath: string): string {
  return buildSymbolEmbedInput({
    name: symbol.name,
    filePath,
    content: symbol.content,
    imports: symbol.imports,
    kind: symbol.kind,
  });
}
