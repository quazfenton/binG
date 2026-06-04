/**
 * Standalone validation: getVFSToolDefinitions returns proper JSON Schema.
 * Separate file to avoid the pre-existing toolContextStore.exit() failure
 * in vfs-mcp-tools.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { getVFSToolDefinitions } from '../../lib/mcp/vfs-mcp-tools';

describe('getVFSToolDefinitions JSON Schema validation', () => {
  it('should return JSON Schema objects (not raw Zod types) as parameters', () => {
    const defs = getVFSToolDefinitions();
    expect(defs.length).toBeGreaterThan(0);

    for (const def of defs) {
      const params = def.function.parameters as Record<string, any>;

      // CRITICAL: Must NOT have Zod internals (would cause "schema must be a JSON Schema object" errors)
      expect((params as any)._def).toBeUndefined();
      expect((params as any)['~standard']).toBeUndefined();

      // Must be a plain object (serializable via JSON.stringify)
      expect(typeof params).toBe('object');
      expect(params).not.toBeNull();
      expect(Array.isArray(params)).toBe(false);

      // Must have valid JSON Schema structure
      expect(params.type).toBe('object');
      expect(params.properties).toBeDefined();
      expect(typeof params.properties).toBe('object');

      // JSON.stringify must produce valid JSON (not Zod internals)
      const serialized = JSON.stringify(params);
      expect(serialized).toContain('"type":"object"');
      expect(serialized).toContain('"properties"');
      // Ensure no Zod internal fields leak
      expect(serialized).not.toContain('"_def"');
      expect(serialized).not.toContain('"~standard"');
      expect(serialized).not.toContain('"ZodObject"');
      expect(serialized).not.toContain('"typeName"');

      // Required fields (if present) must be an array of strings
      if (params.required) {
        expect(Array.isArray(params.required)).toBe(true);
        for (const field of params.required) {
          expect(typeof field).toBe('string');
          expect(params.properties[field]).toBeDefined();
        }
      }
    }
  });

  it('each tool parameters should serialize to a valid OpenAI-compatible tool definition', () => {
    const defs = getVFSToolDefinitions();

    for (const def of defs) {
      // Simulate what gets sent to an OpenAI-compatible provider
      const providerPayload = {
        type: def.type,
        function: {
          name: def.function.name,
          description: def.function.description,
          parameters: def.function.parameters,
        },
      };

      // Must serialize without throwing
      const serialized = JSON.stringify(providerPayload);
      expect(serialized).toContain('"type":"function"');
      expect(serialized).toContain(`"name":"${def.function.name}"`);
      expect(serialized).toContain('"type":"object"');
      expect(serialized).toContain('"properties"');

      // Parse back and verify the structure survives round-trip
      const parsed = JSON.parse(serialized);
      expect(parsed.function.parameters.type).toBe('object');
      expect(parsed.function.parameters.properties).toBeDefined();
    }
  });
});
