/**
 * Validation test: bash_execute tool parameters from getMCPToolsForAI_SDK()
 * return proper JSON Schema objects (not raw Zod types).
 *
 * The bash tool is created via AI SDK's tool() which stores a Zod schema
 * in the .parameters or .inputSchema field. In architecture-integration.ts,
 * getMCPToolsForAI_SDK() wraps these in convertToJsonSchema() using
 * zod-to-json-schema before exporting them in OpenAI-compatible format.
 *
 * This test validates that conversion path end-to-end.
 */

import { describe, it, expect } from 'vitest';
import { zodToJsonSchema } from 'zod-to-json-schema';

// Mock server-only to prevent RSC import errors in test environment
import { vi } from 'vitest';
vi.mock('server-only', () => ({}));

// Mock logger
vi.mock('@/lib/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock virtual-filesystem (imported by bash-tool)
vi.mock('@/lib/virtual-filesystem/index.server', () => ({
  virtualFilesystem: {
    writeFile: vi.fn().mockResolvedValue({ path: '/test/output.txt' }),
    readFile: vi.fn().mockResolvedValue({ content: 'test content' }),
    listDirectory: vi.fn().mockResolvedValue({ nodes: [] }),
  },
}));

vi.mock('@/lib/virtual-filesystem', () => ({
  virtualFilesystem: {
    writeFile: vi.fn().mockResolvedValue({ path: '/test/output.txt' }),
    readFile: vi.fn().mockResolvedValue({ content: 'test content' }),
    listDirectory: vi.fn().mockResolvedValue({ nodes: [] }),
  },
}));

// Mock child_process to prevent actual bash execution in tests
vi.mock('child_process', () => ({
  spawn: vi.fn(() => {
    const closeCallbacks: Array<(code: number | null) => void> = [];
    const stdoutDataCallbacks: Array<(data: Buffer) => void> = [];
    const stderrDataCallbacks: Array<(data: Buffer) => void> = [];

    const proc = {
      stdout: {
        on: vi.fn((event: string, cb: any) => {
          if (event === 'data') stdoutDataCallbacks.push(cb);
        }),
      },
      stderr: {
        on: vi.fn((event: string, cb: any) => {
          if (event === 'data') stderrDataCallbacks.push(cb);
        }),
      },
      on: vi.fn((event: string, cb: any) => {
        if (event === 'close') closeCallbacks.push(cb);
      }),
      stdin: { write: vi.fn(), end: vi.fn() },
      kill: vi.fn(),
    };

    queueMicrotask(() => {
      stdoutDataCallbacks.forEach(cb => cb(Buffer.from('')));
      closeCallbacks.forEach(cb => cb(0));
    });

    return proc;
  }),
}));

// Mock RTK integration (imported by bash-tool)
vi.mock('@/lib/context/rtk-integration', () => ({
  rewriteCommand: vi.fn((cmd: string) => cmd),
  filterOutput: vi.fn((output: string) => output),
  summarizeOutput: vi.fn((output: string) => output),
  trackSavings: vi.fn(),
  estimateTokens: vi.fn(() => 0),
  canRewrite: vi.fn(() => false),
  getCommandCategory: vi.fn(() => null),
}));

// Mock bash event schema (imported by bash-tool)
vi.mock('@/lib/bash/bash-event-schema', () => ({
  createBashExecutionEvent: vi.fn(() => ({ type: 'BASH_EXECUTION' })),
  createBashFailureContext: vi.fn(() => ({})),
}));

// Mock self-healing (imported by bash-tool)
vi.mock('@/lib/bash/self-healing', () => ({
  executeWithHealing: vi.fn(),
  isCommandSafe: vi.fn(() => true),
}));

// Mock fs/promises (imported via registerVFSSyncHook)
vi.mock('fs/promises', () => ({
  readFile: vi.fn().mockResolvedValue(''),
}));

describe('bash_execute tool schema conversion (getMCPToolsForAI_SDK path)', () => {
  it('should convert bash tool inputSchema from Zod to valid JSON Schema', async () => {
    // Import the bash tool module (must be done after mocks)
    const { createBashTool } = await import('@/lib/bash/bash-tool');

    // Create the bash tool — this returns { bash_execute: AI SDK tool(...) }
    const bashToolMap = createBashTool({
      workingDir: '/workspace',
      enableSelfHealing: false,
      persistToVFS: false,
    });

    const bashTool = bashToolMap['bash_execute'];
    expect(bashTool).toBeDefined();

    // The AI SDK's tool() stores the Zod schema in .inputSchema (not .parameters)
    // In getMCPToolsForAI_SDK(), the code accesses:
    //   toolDef.parameters || (toolDef as any).inputSchema || {}
    const rawSchema = bashTool.parameters || (bashTool as any).inputSchema;
    expect(rawSchema).toBeDefined();

    // VERIFY: The raw schema is a Zod type (has Zod internal property _def)
    // This confirms the bug exists without conversion
    expect((rawSchema as any)._def).toBeDefined();
    expect(typeof (rawSchema as any)._def).toBe('object');

    // VERIFY: Direct JSON.stringify of a Zod type would NOT produce valid JSON Schema
    // (it would contain Zod internal fields like "typeName", "ZodObject", "_def")
    const rawSerialized = JSON.stringify(rawSchema);
    expect(rawSerialized).not.toContain('"type":"object"');

    // Now apply the SAME conversion that getMCPToolsForAI_SDK() uses:
    //   convertToJsonSchema(toolDef.parameters || (toolDef as any).inputSchema || {})
    const converted = zodToJsonSchema(rawSchema, { target: 'openApi3' });
    // Extract inner schema from $defs container if present
    const jsonSchema = converted.$defs?.inner ?? converted;

    // VERIFY: The converted schema is a valid JSON Schema object
    expect(jsonSchema).toBeDefined();
    expect(typeof jsonSchema).toBe('object');
    expect(jsonSchema).not.toBeNull();
    expect(Array.isArray(jsonSchema)).toBe(false);

    // Must have valid JSON Schema structure
    expect(jsonSchema.type).toBe('object');
    expect(jsonSchema.properties).toBeDefined();
    expect(typeof jsonSchema.properties).toBe('object');

    // Must have expected bash_execute parameters
    const propKeys = Object.keys(jsonSchema.properties);
    expect(propKeys.length).toBeGreaterThanOrEqual(5);
    expect(propKeys).toContain('command');
    expect(propKeys).toContain('code');
    expect(propKeys).toContain('workingDir');
    expect(propKeys).toContain('timeout');

    // Field types should be correct
    expect(jsonSchema.properties.command.type).toBe('string');
    expect(jsonSchema.properties.code.type).toBe('string');
    expect(jsonSchema.properties.workingDir.type).toBe('string');
    expect(jsonSchema.properties.persist.type).toBe('boolean');
    expect(jsonSchema.properties.selfHeal.type).toBe('boolean');
    expect(jsonSchema.properties.timeout.type).toBe('number');

    // JSON.stringify must NOT contain Zod internals
    const serialized = JSON.stringify(jsonSchema);
    expect(serialized).toContain('"type":"object"');
    expect(serialized).toContain('"properties"');
    expect(serialized).not.toContain('"_def"');
    expect(serialized).not.toContain('"~standard"');
    expect(serialized).not.toContain('"ZodObject"');
    expect(serialized).not.toContain('"typeName"');

    // Must not have $defs or $schema (some providers reject these)
    expect(serialized).not.toContain('"$defs"');
    expect(serialized).not.toContain('"$schema"');
  });

  it('bash tool JSON Schema should serialize to a valid OpenAI-compatible tool definition', async () => {
    const { createBashTool } = await import('@/lib/bash/bash-tool');

    const bashToolMap = createBashTool({
      workingDir: '/workspace',
      enableSelfHealing: false,
      persistToVFS: false,
    });

    const bashTool = bashToolMap['bash_execute'];
    expect(bashTool).toBeDefined();

    // Simulate what getMCPToolsForAI_SDK() does:
    // 1. Extract the schema (parameters or inputSchema)
    const rawSchema = bashTool.parameters || (bashTool as any).inputSchema || {};

    // 2. Apply zod-to-json-schema conversion (same as convertToJsonSchema)
    const converted = zodToJsonSchema(rawSchema, { target: 'openApi3' });
    const jsonSchema = converted.$defs?.inner ?? converted;

    // 3. Assemble the OpenAI-compatible tool payload
    const providerPayload = {
      type: 'function' as const,
      function: {
        name: 'bash_execute',
        description: bashTool.description || '',
        parameters: jsonSchema,
      },
    };

    // Must serialize without throwing
    const serialized = JSON.stringify(providerPayload);
    expect(serialized).toContain('"type":"function"');
    expect(serialized).toContain('"name":"bash_execute"');
    expect(serialized).toContain('"type":"object"');
    expect(serialized).toContain('"properties"');
    expect(serialized).toContain('"command"');
    expect(serialized).toContain('"code"');
    expect(serialized).toContain('"workingDir"');
    expect(serialized).toContain('"timeout"');

    // No Zod internals in the serialized provider payload
    expect(serialized).not.toContain('"_def"');
    expect(serialized).not.toContain('"~standard"');
    expect(serialized).not.toContain('"ZodObject"');

    // Parse back and verify the structure survives round-trip
    const parsed = JSON.parse(serialized);
    expect(parsed.function.parameters.type).toBe('object');
    expect(parsed.function.parameters.properties).toBeDefined();
    expect(parsed.function.parameters.properties.command).toBeDefined();
    expect(parsed.function.parameters.properties.command.type).toBe('string');
    expect(parsed.function.parameters.properties.code).toBeDefined();
    expect(parsed.function.parameters.properties.code.type).toBe('string');
    expect(parsed.function.parameters.properties.workingDir).toBeDefined();
    expect(parsed.function.parameters.properties.workingDir.type).toBe('string');
    expect(parsed.function.parameters.properties.timeout).toBeDefined();
    expect(parsed.function.parameters.properties.timeout.type).toBe('number');
  });

  it('getMCPToolsForAI_SDK assembly path should correctly convert bash tool schemas', async () => {
    // This test validates the exact logic used in getMCPToolsForAI_SDK():
    //
    //   bashTools = Object.entries(bashToolMap).map(([name, toolDef]) => ({
    //     type: 'function',
    //     function: {
    //       name,
    //       description: toolDef.description,
    //       parameters: convertToJsonSchema(toolDef.parameters || (toolDef as any).inputSchema || {}),
    //     },
    //   }));
    //
    // Where convertToJsonSchema = (schema) => {
    //   if (schema && typeof schema === 'object' && '_def' in schema) {
    //     const converted = zodToJsonSchema(schema, { target: 'openApi3' });
    //     return converted.$defs?.inner ?? converted;
    //   }
    //   return schema;
    // };

    const { createBashTool } = await import('@/lib/bash/bash-tool');

    const bashToolMap = createBashTool({
      workingDir: '/workspace',
      enableSelfHealing: false,
      persistToVFS: false,
    });

    // Replicate the exact assembly logic from getMCPToolsForAI_SDK()
    const bashTools = Object.entries(bashToolMap).map(([name, toolDef]: [string, any]) => {
      const rawSchema = toolDef.parameters || toolDef.inputSchema || {};
      let parameters = rawSchema;

      // convertToJsonSchema logic
      if (rawSchema && typeof rawSchema === 'object' && '_def' in rawSchema) {
        const converted = zodToJsonSchema(rawSchema, { target: 'openApi3' });
        parameters = converted.$defs?.inner ?? converted;
      }

      return {
        type: 'function' as const,
        function: {
          name,
          description: toolDef.description || '',
          parameters,
        },
      };
    });

    // Verify the assembly produced the expected output
    expect(bashTools.length).toBe(1);
    expect(bashTools[0].function.name).toBe('bash_execute');
    expect(bashTools[0].function.description).toBeDefined();
    expect(bashTools[0].function.description!.length).toBeGreaterThan(10);

    const params = bashTools[0].function.parameters;

    // CRITICAL: Must NOT have Zod internals
    expect((params as any)._def).toBeUndefined();
    expect((params as any)['~standard']).toBeUndefined();

    // Must be valid JSON Schema
    expect(params.type).toBe('object');
    expect(params.properties).toBeDefined();
    expect(params.properties.command).toBeDefined();
    expect(params.properties.command.type).toBe('string');
    expect(params.properties.code).toBeDefined();
    expect(params.properties.code.type).toBe('string');
    expect(params.properties.workingDir).toBeDefined();
    expect(params.properties.workingDir.type).toBe('string');
    expect(params.properties.timeout).toBeDefined();
    expect(params.properties.timeout.type).toBe('number');

    // JSON.stringify produces valid OpenAI-compatible payload
    const serialized = JSON.stringify(bashTools[0]);
    expect(serialized).toContain('"type":"function"');
    expect(serialized).toContain('"name":"bash_execute"');
    expect(serialized).not.toContain('"_def"');
    expect(serialized).not.toContain('"~standard"');
    expect(serialized).not.toContain('"ZodObject"');

    // Round-trip
    const parsed = JSON.parse(serialized);
    expect(parsed.function.parameters.type).toBe('object');
    expect(parsed.function.parameters.properties.command.type).toBe('string');
  });
});
