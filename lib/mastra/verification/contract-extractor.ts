/**
 * Contract Inference Engine
 *
 * Extracts API contracts from TypeScript code and detects breaking changes.
 * Uses TypeScript Compiler API for AST analysis.
 *
 * @see https://mastra.ai/docs/verification/contract-inference
 */

import { Project, SourceFile, FunctionDeclaration, InterfaceDeclaration, TypeAliasDeclaration } from 'ts-morph';
import * as path from 'path';

/**
 * Contract node representing an exported API
 */
export interface ContractNode {
  id: string;
  signature: string;
  dependencies: string[];
  filePath: string;
  line: number;
  type: 'function' | 'interface' | 'type' | 'class';
  exported: boolean;
}

/**
 * Breaking change detection result
 */
export interface BreakingChange {
  type: 'removed' | 'signature_changed' | 'parameter_removed' | 'return_type_changed';
  contract: ContractNode;
  oldSignature: string;
  newSignature?: string;
  severity: 'major' | 'minor' | 'patch';
  message: string;
}

/**
 * Extract contracts from a TypeScript project
 */
export function extractContracts(rootPath: string): ContractNode[] {
  const project = new Project({
    tsConfigFilePath: path.join(rootPath, 'tsconfig.json'),
    skipAddingFilesFromTsConfig: false,
  });

  const contracts: ContractNode[] = [];

  for (const sourceFile of project.getSourceFiles()) {
    const fileContracts = extractFromFile(sourceFile);
    contracts.push(...fileContracts);
  }

  return contracts;
}

/**
 * Extract contracts from a single source file
 */
function extractFromFile(sourceFile: SourceFile): ContractNode[] {
  const contracts: ContractNode[] = [];
  const filePath = sourceFile.getFilePath();

  // Extract exported functions
  for (const fn of sourceFile.getFunctions()) {
    if (fn.isExported()) {
      contracts.push(createFunctionContract(fn, filePath));
    }
  }

  // Extract exported interfaces
  for (const iface of sourceFile.getInterfaces()) {
    if (iface.isExported()) {
      contracts.push(createInterfaceContract(iface, filePath));
    }
  }

  // Extract exported type aliases
  for (const typeAlias of sourceFile.getTypeAliases()) {
    if (typeAlias.isExported()) {
      contracts.push(createTypeAliasContract(typeAlias, filePath));
    }
  }

  // Extract exported classes
  for (const cls of sourceFile.getClasses()) {
    if (cls.isExported()) {
      contracts.push({
        id: `${filePath}:${cls.getName()}`,
        signature: cls.getType().getText(),
        dependencies: extractDependencies(cls),
        filePath,
        line: cls.getStartLineNumber(),
        type: 'class',
        exported: true,
      });
    }
  }

  return contracts;
}

/**
 * Create contract node from function declaration
 */
function createFunctionContract(fn: FunctionDeclaration, filePath: string): ContractNode {
  const name = fn.getName() || 'anonymous';
  const returnType = fn.getReturnType()?.getText() || 'void';
  const params = fn.getParameters().map(p => ({
    name: p.getName(),
    type: p.getType()?.getText() || 'any',
    optional: p.hasQuestionToken(),
  }));

  return {
    id: `${filePath}:${name}`,
    signature: JSON.stringify({ name, params, returnType }),
    dependencies: extractDependencies(fn),
    filePath,
    line: fn.getStartLineNumber(),
    type: 'function',
    exported: true,
  };
}

/**
 * Create contract node from interface declaration
 */
function createInterfaceContract(iface: InterfaceDeclaration, filePath: string): ContractNode {
  const name = iface.getName();
  const properties = iface.getProperties().map(p => ({
    name: p.getName(),
    type: p.getType()?.getText() || 'any',
    optional: p.hasQuestionToken(),
  }));

  return {
    id: `${filePath}:${name}`,
    signature: JSON.stringify({ name, properties }),
    dependencies: extractDependencies(iface),
    filePath,
    line: iface.getStartLineNumber(),
    type: 'interface',
    exported: true,
  };
}

/**
 * Create contract node from type alias
 */
function createTypeAliasContract(typeAlias: TypeAliasDeclaration, filePath: string): ContractNode {
  const name = typeAlias.getName();
  const type = typeAlias.getType()?.getText() || 'unknown';

  return {
    id: `${filePath}:${name}`,
    signature: JSON.stringify({ name, type }),
    dependencies: extractDependencies(typeAlias),
    filePath,
    line: typeAlias.getStartLineNumber(),
    type: 'type',
    exported: true,
  };
}

/**
 * Extract dependencies from a node
 */
function extractDependencies(node: any): string[] {
  const dependencies = new Set<string>();

  // Get all identifier references
  const identifiers = node.getDescendantsOfKind(40 /* SyntaxKind.Identifier */);
  for (const id of identifiers) {
    const text = id.getText();
    // Skip common keywords and local variables
    if (!['if', 'else', 'for', 'while', 'return', 'const', 'let', 'var'].includes(text)) {
      dependencies.add(text);
    }
  }

  return Array.from(dependencies);
}

/**
 * Detect breaking changes between old and new contracts
 */
export function detectBreakingChanges(
  oldContracts: ContractNode[],
  newContracts: ContractNode[]
): BreakingChange[] {
  const breakingChanges: BreakingChange[] = [];
  const oldMap = new Map(oldContracts.map(c => [c.id, c]));
  const newMap = new Map(newContracts.map(c => [c.id, c]));

  // Check for removed contracts
  for (const [id, oldContract] of oldMap) {
    if (!newMap.has(id)) {
      breakingChanges.push({
        type: 'removed',
        contract: oldContract,
        oldSignature: oldContract.signature,
        severity: 'major',
        message: `Contract "${id}" was removed`,
      });
    }
  }

  // Check for signature changes
  for (const [id, newContract] of newMap) {
    const oldContract = oldMap.get(id);
    if (oldContract && oldContract.signature !== newContract.signature) {
      breakingChanges.push({
        type: 'signature_changed',
        contract: newContract,
        oldSignature: oldContract.signature,
        newSignature: newContract.signature,
        severity: 'major',
        message: `Contract "${id}" signature changed`,
      });
    }
  }

  return breakingChanges;
}

/**
 * Get contract by ID
 */
export function getContractById(contracts: ContractNode[], id: string): ContractNode | undefined {
  return contracts.find(c => c.id === id);
}

/**
 * Get contracts by file path
 */
export function getContractsByFile(contracts: ContractNode[], filePath: string): ContractNode[] {
  return contracts.filter(c => c.filePath === filePath);
}

/**
 * Get exported contracts only
 */
export function getExportedContracts(contracts: ContractNode[]): ContractNode[] {
  return contracts.filter(c => c.exported);
}

/**
 * Generate contract documentation
 */
export function generateContractDocs(contracts: ContractNode[]): string {
  let docs = '# API Contracts\n\n';

  for (const contract of contracts) {
    docs += `## ${contract.id}\n\n`;
    docs += `- **Type**: ${contract.type}\n`;
    docs += `- **Line**: ${contract.line}\n`;
    docs += `- **Dependencies**: ${contract.dependencies.join(', ')}\n`;
    docs += `- **Signature**: \`${contract.signature}\`\n\n`;
  }

  return docs;
}
