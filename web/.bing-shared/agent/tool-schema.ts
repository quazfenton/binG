/**
 * AI SDK v6 tool schema normalization helpers.
 *
 * In AI SDK v6, the `Tool` type's schema field is `inputSchema` (FlexibleSchema).
 * The v3/v4 `parameters` field is ignored by `prepareToolsAndToolChoice`, which
 * reads `tool2.inputSchema`. When `inputSchema` is undefined, `asSchema(undefined)`
 * returns `{ properties: {}, additionalProperties: false }` with NO `type` field.
 *
 * Azure OpenAI and other strict providers reject this with errors like
 * "schema must be a JSON Schema of 'type: \"object\"', got 'type: \"None\"'".
 *
 * The `normalizeSchemaForAI` helper below accepts whatever upstream tool
 * definitions pass us (Zod schemas, raw JSON Schema objects, null/undefined)
 * and returns a JSON Schema object guaranteed to have `type: "object"`, so
 * provider-side strict validation never trips on a missing `type` field.
 *
 * Zod handling: we use `zod-to-json-schema` to flatten Zod schemas into
 * plain JSON Schema. Some converters (notably zod-to-json-schema) wrap inner
 * schemas under `$defs.inner`; we unwrap that to keep the tool schema flat
 * and provider-friendly.
 */

import { zodToJsonSchema } from 'zod-to-json-schema';

const PROVIDER_OBJECT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {},
};

/**
 * Convert any upstream schema representation into a JSON Schema object that
 * AI SDK v6 / Azure / strict providers will accept.
 *
 * Accepts:
 *  - A Zod schema (any object with a `_def` field)
 *  - A plain JSON Schema object (preserved as-is, or with `type: "object"` injected)
 *  - `null` / `undefined` / non-object (returns a minimal valid object schema)
 */
export function normalizeSchemaForAI(rawSchema: unknown): Record<string, unknown> {
  if (!rawSchema || typeof rawSchema !== 'object') {
    return { ...PROVIDER_OBJECT_SCHEMA };
  }

  const schema = rawSchema as Record<string, unknown>;

  // Zod schema: detect via _def (Zod objects always carry this internal field).
  if ('_def' in schema) {
    const converted = zodToJsonSchema(rawSchema as Parameters<typeof zodToJsonSchema>[0], {
      target: 'openApi3',
    }) as Record<string, unknown>;

    // zod-to-json-schema sometimes wraps inner schemas under $defs.inner.
    // Unwrap to keep the tool schema flat and provider-friendly.
    const defs = converted.$defs as Record<string, unknown> | undefined;
    const inner = (defs && (defs.inner as Record<string, unknown>)) || converted;
    if (!inner.type) {
      inner.type = 'object';
    }
    return inner;
  }

  // Plain JSON Schema object: ensure it has `type: "object"` so strict providers
  // (Azure OpenAI, pollinations, etc.) don't reject it as `type: "None"`.
  if (!schema.type) {
    return { type: 'object', ...schema };
  }

  return schema;
}
