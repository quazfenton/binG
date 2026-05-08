import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createValidationStack } from '../lib/lsp/validation-stack';
import { diagnosticBus } from '../lib/lsp/diagnostic-bus';
import { getLSPGateway } from '../lib/lsp/lsp-gateway';
import path from 'path';
import fs from 'fs-extra';

describe('LSP Integration Smoke Test', () => {
  const workspaceRoot = path.resolve('./temp-test-workspace');
  const validationStack = createValidationStack(workspaceRoot);

  beforeAll(async () => {
    await fs.ensureDir(workspaceRoot);
    // Create a dummy tsconfig to make tsserver happy
    await fs.writeJson(path.join(workspaceRoot, 'tsconfig.json'), {
      compilerOptions: { target: 'esnext', module: 'commonjs', strict: true }
    });
  });

  afterAll(async () => {
    await getLSPGateway(workspaceRoot).shutdown();
    await fs.remove(workspaceRoot);
  });

  it('should detect a syntax error in a TypeScript file', async () => {
    const filePath = 'error-file.ts';
    const content = 'const x: number = "not a number";'; // Type error
    
    // Validate file
    const result = await validationStack.validateFile(filePath, content, 1);

    expect(result.success).toBe(false);
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.diagnostics[0].message).toContain('Type');
    expect(result.diagnostics[0].source).toBe('tsserver');
  }, 15000); // Higher timeout for LSP startup

  it('should report success for valid code', async () => {
    const filePath = 'valid-file.ts';
    const content = 'export const greeting = "hello";';
    
    const result = await validationStack.validateFile(filePath, content, 1);

    expect(result.success).toBe(true);
    expect(result.diagnostics.length).toBe(0);
  }, 10000);
});
