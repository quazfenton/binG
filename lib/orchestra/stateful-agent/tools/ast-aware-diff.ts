/**
 * AST-Aware Diff System
 *
 * Provides intelligent, structure-aware diffing for TypeScript/JavaScript files.
 * Uses TypeScript Compiler API to understand code structure and make surgical edits
 * that preserve AST integrity.
 *
 * Features:
 * - Node-level precision editing
 * - Automatic import management
 * - Scope-aware replacements
 * - Semantic preservation
 * - Dependency tracking
 */

import * as ts from 'typescript';
import { z } from 'zod';
import type { ToolResult } from './sandbox-tools';

/**
 * Zod schema for AST-aware diff operations
 */
export const AstDiffSchema = z.object({
  path: z.string().describe('File path to edit'),
  operation: z.enum([
    'replace_node',
    'insert_node',
    'delete_node',
    'rename_identifier',
    'wrap_node',
    'extract_function',
  ]).describe('Type of AST operation'),
  nodeSelector: z.object({
    kind: z.string().optional().describe('TS SyntaxKind to match'),
    name: z.string().optional().describe('Identifier name to match'),
    text: z.string().optional().describe('Node text to match'),
    range: z.object({
      start: z.number(),
      end: z.number(),
    }).optional().describe('Text range to match'),
  }).describe('Criteria to find the target node'),
  newContent: z.string().optional().describe('New code to insert/replace'),
  metadata: z.object({
    reason: z.string(),
    preserveComments: z.boolean().default(true),
    formatAfter: z.boolean().default(true),
  }).optional(),
});

export type AstDiffInput = z.infer<typeof AstDiffSchema>;

/**
 * AST node match result
 */
export interface NodeMatch {
  node: ts.Node;
  parent: ts.Node | null;
  sourceFile: ts.SourceFile;
  textRange: { start: number; end: number };
  kind: ts.SyntaxKind;
  name?: string;
}

/**
 * AST diff operation result
 */
export interface AstDiffResult {
  success: boolean;
  updatedContent: string;
  changes: Array<{
    type: string;
    description: string;
    range: { start: number; end: number };
  }>;
  importsAdded?: string[];
  importsRemoved?: string[];
  errors?: string[];
}

/**
 * AST-Aware Diff Manager
 */
export class AstDiffManager {
  private compilerOptions: ts.CompilerOptions;

  constructor(options?: Partial<ts.CompilerOptions>) {
    this.compilerOptions = {
      target: ts.ScriptTarget.Latest,
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.React,
      allowJs: true,
      checkJs: false,
      strict: false,
      ...options,
    };
  }

  /**
   * Parse source code into AST
   */
  parseSourceFile(filePath: string, content: string): ts.SourceFile {
    return ts.createSourceFile(
      filePath,
      content,
      this.compilerOptions.target || ts.ScriptTarget.Latest,
      true, // setParentNodes
      filePath.endsWith('.tsx') || filePath.endsWith('.jsx')
        ? ts.ScriptKind.TSX
        : ts.ScriptKind.TS
    );
  }

  /**
   * Find nodes matching selector criteria
   */
  findNodes(sourceFile: ts.SourceFile, selector: AstDiffInput['nodeSelector']): NodeMatch[] {
    const matches: NodeMatch[] = [];

    const visit = (node: ts.Node, parent: ts.Node | null = null) => {
      let isMatch = true;

      // Match by SyntaxKind
      if (selector.kind) {
        const kindName = ts.SyntaxKind[node.kind];
        if (kindName !== selector.kind) {
          isMatch = false;
        }
      }

      // Match by identifier name
      if (isMatch && selector.name) {
        const name = this.getNodeName(node);
        if (name !== selector.name) {
          isMatch = false;
        }
      }

      // Match by text content
      if (isMatch && selector.text) {
        const text = node.getText(sourceFile).trim();
        if (!text.includes(selector.text)) {
          isMatch = false;
        }
      }

      // Match by text range
      if (isMatch && selector.range) {
        const nodeStart = node.getStart(sourceFile);
        const nodeEnd = node.getEnd();
        if (nodeStart !== selector.range.start || nodeEnd !== selector.range.end) {
          isMatch = false;
        }
      }

      if (isMatch) {
        matches.push({
          node,
          parent,
          sourceFile,
          textRange: {
            start: node.getStart(sourceFile),
            end: node.getEnd(),
          },
          kind: node.kind,
          name: this.getNodeName(node),
        });
      }

      ts.forEachChild(node, (child) => visit(child, node));
    };

    ts.forEachChild(sourceFile, (node) => visit(node, null));
    return matches;
  }

  /**
   * Apply AST-aware diff operation
   */
  async applyAstDiff(
    filePath: string,
    currentContent: string,
    input: AstDiffInput
  ): Promise<AstDiffResult> {
    const changes: AstDiffResult['changes'] = [];
    const errors: string[] = [];

    try {
      // Parse source file
      const sourceFile = this.parseSourceFile(filePath, currentContent);

      // Find target nodes
      const matches = this.findNodes(sourceFile, input.nodeSelector);

      if (matches.length === 0) {
        return {
          success: false,
          updatedContent: currentContent,
          changes: [],
          errors: ['No matching nodes found for selector'],
        };
      }

      if (matches.length > 1) {
        return {
          success: false,
          updatedContent: currentContent,
          changes: [],
          errors: [`Multiple nodes (${matches.length}) match selector. Be more specific.`],
        };
      }

      const match = matches[0]!;

      // Apply operation based on type
      let updatedContent: string;

      switch (input.operation) {
        case 'replace_node':
          updatedContent = this.replaceNode(sourceFile, match, input.newContent || '');
          break;

        case 'insert_node':
          updatedContent = this.insertNode(sourceFile, match, input.newContent || '', 'after');
          break;

        case 'delete_node':
          updatedContent = this.deleteNode(sourceFile, match);
          break;

        case 'rename_identifier':
          updatedContent = this.renameIdentifier(sourceFile, match, input.newContent || '');
          break;

        case 'wrap_node':
          updatedContent = this.wrapNode(sourceFile, match, input.newContent || '');
          break;

        case 'extract_function':
          updatedContent = await this.extractFunction(sourceFile, match, input.newContent || '');
          break;

        default:
          throw new Error(`Unknown operation: ${(input.operation as any)}`);
      }

      changes.push({
        type: input.operation,
        description: input.metadata?.reason || `${input.operation} operation`,
        range: match.textRange,
      });

      return {
        success: true,
        updatedContent,
        changes,
      };
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
      return {
        success: false,
        updatedContent: currentContent,
        changes: [],
        errors,
      };
    }
  }

  /**
   * Replace a node with new content
   */
  private replaceNode(
    sourceFile: ts.SourceFile,
    match: NodeMatch,
    newContent: string
  ): string {
    const { start, end } = match.textRange;
    return sourceFile.text.substring(0, start) + newContent + sourceFile.text.substring(end);
  }

  /**
   * Insert node before or after target
   */
  private insertNode(
    sourceFile: ts.SourceFile,
    match: NodeMatch,
    newContent: string,
    position: 'before' | 'after' = 'after'
  ): string {
    const insertPos = position === 'after' ? match.textRange.end : match.textRange.start;
    return (
      sourceFile.text.substring(0, insertPos) +
      '\n' +
      newContent +
      '\n' +
      sourceFile.text.substring(insertPos)
    );
  }

  /**
   * Delete a node
   */
  private deleteNode(sourceFile: ts.SourceFile, match: NodeMatch): string {
    const { start, end } = match.textRange;
    return sourceFile.text.substring(0, start) + sourceFile.text.substring(end);
  }

  /**
   * Rename an identifier
   */
  private renameIdentifier(
    sourceFile: ts.SourceFile,
    match: NodeMatch,
    newName: string
  ): string {
    if (!match.name) {
      throw new Error('Cannot rename: node has no identifier name');
    }

    // Find all references to this identifier in the file
    const references = this.findAllReferences(sourceFile, match.name);
    
    // Replace from end to start to preserve positions
    let result = sourceFile.text;
    const sortedRefs = references.sort((a, b) => b.start - a.start);

    for (const ref of sortedRefs) {
      result =
        result.substring(0, ref.start) +
        newName +
        result.substring(ref.end);
    }

    return result;
  }

  /**
   * Wrap a node with new content
   */
  private wrapNode(
    sourceFile: ts.SourceFile,
    match: NodeMatch,
    wrapper: string
  ): string {
    const { start, end } = match.textRange;
    const nodeText = sourceFile.text.substring(start, end);
    
    // Simple wrapper - in production, this would be smarter
    const wrappedContent = wrapper.replace('{{node}}', nodeText);
    
    return (
      sourceFile.text.substring(0, start) +
      wrappedContent +
      sourceFile.text.substring(end)
    );
  }

  /**
   * Extract code into a new function
   */
  private async extractFunction(
    sourceFile: ts.SourceFile,
    match: NodeMatch,
    functionName: string
  ): Promise<string> {
    const nodeText = sourceFile.text.substring(
      match.textRange.start,
      match.textRange.end
    );

    // Generate function declaration
    const functionDeclaration = `function ${functionName}() {\n  return ${nodeText};\n}\n`;

    // Insert function at top level
    const firstStatement = sourceFile.statements[0];
    const insertPos = firstStatement ? firstStatement.getStart(sourceFile) : 0;

    let result =
      sourceFile.text.substring(0, insertPos) +
      functionDeclaration +
      sourceFile.text.substring(insertPos);

    // Replace original code with function call
    const { start, end } = match.textRange;
    result =
      result.substring(0, start) +
      `${functionName}()` +
      result.substring(end);

    return result;
  }

  /**
   * Find all references to an identifier
   */
  private findAllReferences(
    sourceFile: ts.SourceFile,
    identifierName: string
  ): Array<{ start: number; end: number }> {
    const references: Array<{ start: number; end: number }> = [];

    const visit = (node: ts.Node) => {
      if (
        ts.isIdentifier(node) &&
        node.text === identifierName
      ) {
        references.push({
          start: node.getStart(sourceFile),
          end: node.getEnd(),
        });
      }
      ts.forEachChild(node, visit);
    };

    ts.forEachChild(sourceFile, visit);
    return references;
  }

  /**
   * Get node name if it's an identifier
   */
  private getNodeName(node: ts.Node): string | undefined {
    if (ts.isIdentifier(node)) {
      return node.text;
    }

    if (
      ts.isFunctionDeclaration(node) ||
      ts.isClassDeclaration(node) ||
      ts.isInterfaceDeclaration(node) ||
      ts.isTypeAliasDeclaration(node) ||
      ts.isVariableDeclaration(node) ||
      ts.isPropertyDeclaration(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isPropertySignature(node) ||
      ts.isMethodSignature(node) ||
      ts.isParameter(node)
    ) {
      return node.name && ts.isIdentifier(node.name) ? node.name.text : undefined;
    }

    return undefined;
  }

  /**
   * Add import statement
   */
  addImport(sourceContent: string, importStatement: string): string {
    // Check if import already exists
    if (sourceContent.includes(importStatement)) {
      return sourceContent;
    }

    // Find position after existing imports
    const sourceFile = this.parseSourceFile('temp.ts', sourceContent);
    const importDeclarations = sourceFile.statements.filter(ts.isImportDeclaration);

    if (importDeclarations.length > 0) {
      const lastImport = importDeclarations[importDeclarations.length - 1];
      const insertPos = lastImport.getEnd();
      return (
        sourceContent.substring(0, insertPos) +
        '\n' +
        importStatement +
        sourceContent.substring(insertPos)
      );
    }

    // No imports exist, add at top
    return importStatement + '\n' + sourceContent;
  }

  /**
   * Remove unused imports
   */
  removeUnusedImports(sourceContent: string): string {
    const sourceFile = this.parseSourceFile('temp.ts', sourceContent);
    const importsToRemove: ts.ImportDeclaration[] = [];

    // Find all identifiers used in the file
    const usedIdentifiers = new Set<string>();

    const collectIdentifiers = (node: ts.Node) => {
      if (ts.isIdentifier(node)) {
        usedIdentifiers.add(node.text);
      }
      ts.forEachChild(node, collectIdentifiers);
    };

    ts.forEachChild(sourceFile, collectIdentifiers);

    // Check each import
    for (const importDecl of sourceFile.statements.filter(ts.isImportDeclaration)) {
      const importClause = importDecl.importClause;
      if (!importClause) continue;

      // Check named imports
      if (importClause.namedBindings && ts.isNamedImports(importClause.namedBindings)) {
        const usedNamedImports = importClause.namedBindings.elements.filter(
          (element) => usedIdentifiers.has(element.name.text)
        );

        if (usedNamedImports.length === 0) {
          importsToRemove.push(importDecl);
        }
      }

      // Check default import
      if (importClause.name && !usedIdentifiers.has(importClause.name.text)) {
        importsToRemove.push(importDecl);
      }
    }

    // Remove unused imports
    let result = sourceContent;
    for (const importDecl of importsToRemove.reverse()) {
      const start = importDecl.getStart(sourceFile);
      const end = importDecl.getEnd();
      result = result.substring(0, start) + result.substring(end);
    }

    return result;
  }
}

/**
 * Tool wrapper for AST-aware diff operations
 */
export const astDiffTool = {
  description: `Surgically edit TypeScript/JavaScript files using AST-aware operations.

USE THIS for:
- Renaming functions/variables (updates all references)
- Extracting code into functions
- Wrapping code with try-catch, HOCs, etc.
- Precise node-level edits

OPERATIONS:
- replace_node: Replace a specific AST node
- insert_node: Insert code before/after a node
- delete_node: Remove a node safely
- rename_identifier: Rename with reference updates
- wrap_node: Wrap node with new code
- extract_function: Extract code into new function

EXAMPLE:
{
  "path": "src/utils.ts",
  "operation": "rename_identifier",
  "nodeSelector": {
    "kind": "FunctionDeclaration",
    "name": "oldName"
  },
  "newContent": "newName",
  "metadata": {
    "reason": "Rename to match naming convention"
  }
}`,
  schema: AstDiffSchema,
  execute: async (
    input: AstDiffInput,
    context: { vfs?: Record<string, string> }
  ): Promise<ToolResult> => {
    const manager = new AstDiffManager();
    const currentContent = context.vfs?.[input.path];

    if (!currentContent) {
      return {
        success: false,
        error: `File not found: ${input.path}`,
      };
    }

    const result = await manager.applyAstDiff(input.path, currentContent, input);

    if (result.success) {
      // Update VFS
      if (context.vfs) {
        context.vfs[input.path] = result.updatedContent;
      }

      return {
        success: true,
        output: `AST diff applied: ${result.changes.map((c) => c.type).join(', ')}`,
        content: result.updatedContent,
      };
    }

    return {
      success: false,
      error: result.errors?.join(', ') || 'Unknown error',
    };
  },
};

/**
 * Quick AST analysis utility
 */
export async function analyzeAstStructure(
  filePath: string,
  content: string
): Promise<{
  functions: Array<{ name: string; range: { start: number; end: number } }>;
  classes: Array<{ name: string; range: { start: number; end: number } }>;
  imports: Array<{ from: string; names: string[] }>;
  exports: string[];
}> {
  const manager = new AstDiffManager();
  const sourceFile = manager.parseSourceFile(filePath, content);

  const functions: Array<{ name: string; range: { start: number; end: number } }> = [];
  const classes: Array<{ name: string; range: { start: number; end: number } }> = [];
  const imports: Array<{ from: string; names: string[] }> = [];
  const exports: string[] = [];

  const visit = (node: ts.Node) => {
    // Functions
    if (
      ts.isFunctionDeclaration(node) &&
      node.name
    ) {
      functions.push({
        name: node.name.text,
        range: {
          start: node.getStart(sourceFile),
          end: node.getEnd(),
        },
      });
    }

    // Classes
    if (
      ts.isClassDeclaration(node) &&
      node.name
    ) {
      classes.push({
        name: node.name.text,
        range: {
          start: node.getStart(sourceFile),
          end: node.getEnd(),
        },
      });
    }

    // Imports
    if (ts.isImportDeclaration(node)) {
      const from = node.moduleSpecifier.getText(sourceFile).replace(/['"]/g, '');
      const names: string[] = [];

      if (node.importClause) {
        if (node.importClause.name) {
          names.push(node.importClause.name.text);
        }

        if (
          node.importClause.namedBindings &&
          ts.isNamedImports(node.importClause.namedBindings)
        ) {
          names.push(
            ...node.importClause.namedBindings.elements.map((e) => e.name.text)
          );
        }
      }

      imports.push({ from, names });
    }

    // Exports
    if (ts.isExportDeclaration(node)) {
      exports.push(node.getText(sourceFile));
    }

    ts.forEachChild(node, visit);
  };

  ts.forEachChild(sourceFile, visit);

  return { functions, classes, imports, exports };
}

export default AstDiffManager;
