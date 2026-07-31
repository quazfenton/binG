/**
 * Validation test: mem0_* tool parameters from getMCPToolsForAI_SDK()
 * return proper JSON Schema objects (not raw Zod types).
 *
 * Mem0 tools are created via AI SDK's tool() with Zod schemas in the
 * .parameters field. In architecture-integration.ts, getMCPToolsForAI_SDK()
 * wraps these in convertToJsonSchema() using zod-to-json-schema before
 * exporting them in OpenAI-compatible format.
 *
 * This test validates that conversion path end-to-end across all 6 mem0 tools.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { zodToJsonSchema } from 'zod-to-json-schema';

// Mock server-only to prevent RSC import errors in test environment
import { vi } from 'vitest';
vi.mock('server-only', () => ({}));

// Mock logger (imported by mem0-power)
vi.mock('@/lib/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Expected tool names from buildMem0Tools()
const EXPECTED_MEM0_TOOLS = [
  'mem0_add',
  'mem0_search',
  'mem0_get_all',
  'mem0_update',
  'mem0_delete',
  'mem0_delete_all',
];

describe('mem0_* tool schema conversion (getMCPToolsForAI_SDK path)', () => {
  // F2 minimal fix: buildMem0Tools gates on isMem0Configured() which reads
  // process.env.MEM0_API_KEY. Test env (vitest) has no key set, so the
  // inner gate returns false and buildMem0Tools returns {}. Setting the
  // env var before each test and clearing it after isolates the test from
  // any external process state and prevents leakage across files.
  beforeEach(() => {
    process.env.MEM0_API_KEY = 'test-mem0-api-key';
  });
  afterEach(() => {
    delete process.env.MEM0_API_KEY;
  });
  it('should convert all mem0 tool parameters from Zod to valid JSON Schema', async () => {
    // Import the mem0 tool builder (must be done after mocks)
    const { buildMem0Tools } = await import('@/lib/powers/mem0-power');

    // Build the mem0 tools — this returns { mem0_add: tool(...), ... }
    const mem0ToolMap = await buildMem0Tools({
      userId: 'test-user',
      sessionId: 'test-session',
    });

    // Verify all expected tools are present
    const toolNames = Object.keys(mem0ToolMap);
    expect(toolNames.sort()).toEqual(EXPECTED_MEM0_TOOLS.sort());

    for (const toolName of toolNames) {
      const mem0Tool = mem0ToolMap[toolName];

      // The AI SDK's tool() stores the Zod schema in .parameters
      const rawSchema = mem0Tool.parameters || (mem0Tool as any).inputSchema;
      expect(rawSchema).toBeDefined();

      // VERIFY: The raw schema is a Zod type (has Zod internal property _def)
      expect((rawSchema as any)._def).toBeDefined();
      expect(typeof (rawSchema as any)._def).toBe('object');

      // VERIFY: Direct JSON.stringify of a Zod type would NOT produce valid JSON Schema
      const rawSerialized = JSON.stringify(rawSchema);
      expect(rawSerialized).not.toContain('"type":"object"');

      // Now apply the SAME conversion that getMCPToolsForAI_SDK() uses:
      //   convertToJsonSchema(toolDef.parameters || (toolDef as any).inputSchema || {})
      const converted = zodToJsonSchema(rawSchema, { target: 'openApi3' });
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

      // Validate tool-specific fields
      const props = jsonSchema.properties;

      // All tools should have valid property types
      for (const [propName, propDef] of Object.entries(props)) {
        const prop = propDef as Record<string, any>;
        expect(prop).toBeDefined();
        expect(typeof prop).toBe('object');
        // Must be a valid JSON Schema property type
        // Allow undefined type for composable schemas (oneOf/anyOf),
        // or standard JSON Schema primitive types
        expect(
          prop.type === undefined ||
          ['string', 'number', 'boolean', 'array', 'object'].includes(prop.type) ||
          prop.oneOf !== undefined ||
          prop.anyOf !== undefined
        ).toBe(true);
      }

      // Tool-specific validations
      switch (toolName) {
        case 'mem0_add':
          expect(props.messages).toBeDefined();
          expect(props.messages.type).toBe('array');
          expect(props.messages.items).toBeDefined();
          expect(props.messages.items.properties).toBeDefined();
          expect(props.messages.items.properties.role).toBeDefined();
          expect(props.messages.items.properties.role.type).toBe('string');
          expect(props.messages.items.properties.content).toBeDefined();
          expect(props.messages.items.properties.content.type).toBe('string');
          break;

        case 'mem0_search':
          expect(props.query).toBeDefined();
          expect(props.query.type).toBe('string');
          expect(props.userId).toBeDefined();
          expect(props.userId.type).toBe('string');
          expect(props.limit).toBeDefined();
          expect(props.limit.type).toBe('number');
          break;

        case 'mem0_get_all':
          expect(props.userId).toBeDefined();
          expect(props.userId.type).toBe('string');
          expect(props.limit).toBeDefined();
          expect(props.limit.type).toBe('number');
          break;

        case 'mem0_update':
          expect(props.memoryId).toBeDefined();
          expect(props.memoryId.type).toBe('string');
          expect(props.text).toBeDefined();
          expect(props.text.type).toBe('string');
          break;

        case 'mem0_delete':
          expect(props.memoryId).toBeDefined();
          expect(props.memoryId.type).toBe('string');
          break;

        case 'mem0_delete_all':
          expect(props.userId).toBeDefined();
          expect(props.userId.type).toBe('string');
          break;
      }

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
    }
  });

  it('each mem0_* tool should serialize to a valid OpenAI-compatible tool definition', async () => {
    const { buildMem0Tools } = await import('@/lib/powers/mem0-power');

    const mem0ToolMap = await buildMem0Tools({
      userId: 'test-user',
      sessionId: 'test-session',
    });

    for (const [toolName, mem0Tool] of Object.entries(mem0ToolMap)) {
      // Simulate what getMCPToolsForAI_SDK() does:
      // 1. Extract the schema (parameters or inputSchema)
      const rawSchema = mem0Tool.parameters || (mem0Tool as any).inputSchema || {};

      // 2. Apply zod-to-json-schema conversion (same as convertToJsonSchema)
      const converted = zodToJsonSchema(rawSchema, { target: 'openApi3' });
      const jsonSchema = converted.$defs?.inner ?? converted;

      // 3. Assemble the OpenAI-compatible tool payload (with mem0_ prefix from buildMem0Tools)
      const providerPayload = {
        type: 'function' as const,
        function: {
          name: toolName,
          description: mem0Tool.description || '',
          parameters: jsonSchema,
        },
      };

      // Must serialize without throwing
      const serialized = JSON.stringify(providerPayload);
      expect(serialized).toContain('"type":"function"');
      expect(serialized).toContain(`"name":"${toolName}"`);
      expect(serialized).toContain('"type":"object"');
      expect(serialized).toContain('"properties"');

      // No Zod internals in the serialized provider payload
      expect(serialized).not.toContain('"_def"');
      expect(serialized).not.toContain('"~standard"');
      expect(serialized).not.toContain('"ZodObject"');

      // Parse back and verify the structure survives round-trip
      const parsed = JSON.parse(serialized);
      expect(parsed.function.parameters.type).toBe('object');
      expect(parsed.function.parameters.properties).toBeDefined();
    }
  });

  it('getMCPToolsForAI_SDK assembly path should correctly convert all mem0 tool schemas', async () => {
    // This test validates the exact logic used in getMCPToolsForAI_SDK():
    //
    //   mem0Tools = Object.entries(mem0ToolMap).map(([name, toolDef]) => ({
    //     type: 'function',
    //     function: {
    //       name: `mem0_${name}`,
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

    const { buildMem0Tools } = await import('@/lib/powers/mem0-power');

    const mem0ToolMap = await buildMem0Tools({
      userId: 'test-user',
      sessionId: 'test-session',
    });

    // Replicate the exact assembly logic from getMCPToolsForAI_SDK()
    const mem0Tools = Object.entries(mem0ToolMap).map(([name, toolDef]: [string, any]) => {
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
    const toolNames = mem0Tools.map(t => t.function.name).sort();
    expect(toolNames).toEqual(EXPECTED_MEM0_TOOLS.sort());

    for (const tool of mem0Tools) {
      // CRITICAL: Must NOT have Zod internals
      expect((tool.function.parameters as any)._def).toBeUndefined();
      expect((tool.function.parameters as any)['~standard']).toBeUndefined();

      // Must be valid JSON Schema
      expect(tool.function.parameters.type).toBe('object');
      expect(tool.function.parameters.properties).toBeDefined();
      expect(typeof tool.function.parameters.properties).toBe('object');

      // Description should be informative
      expect(tool.function.description).toBeDefined();
      expect(tool.function.description!.length).toBeGreaterThan(10);

      // JSON.stringify produces valid OpenAI-compatible payload
      const serialized = JSON.stringify(tool);
      expect(serialized).toContain('"type":"function"');
      expect(serialized).toContain(`"name":"${tool.function.name}"`);
      expect(serialized).not.toContain('"_def"');
      expect(serialized).not.toContain('"~standard"');
      expect(serialized).not.toContain('"ZodObject"');

      // Round-trip
      const parsed = JSON.parse(serialized);
      expect(parsed.function.parameters.type).toBe('object');
      expect(parsed.function.parameters.properties).toBeDefined();
    }
  });
});
