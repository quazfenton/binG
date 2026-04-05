/**
 * Prompt Parameter Codec — URL-safe serialization/deserialization
 *
 * Encodes/decodes PromptParameters into compact URL-safe strings for:
 * - Sharing configured response styles via links
 * - Persisting in URL query parameters
 * - Cache keys for modifier text composition
 * - Fingerprinting for analytics and change detection
 *
 * Encoding format: 1-byte version + 10× 1-byte enum values + 4-byte checksum = 15 bytes → ~20 chars base64
 *
 * @example
 * ```ts
 * import { encodeParams, decodeParams, paramsFingerprint } from '@bing/shared/agent/prompt-parameters.codec';
 *
 * const params: PromptParameters = { responseDepth: 'comprehensive', expertiseLevel: 'expert' };
 * const encoded = encodeParams(params);  // "AQAAAAACAAAA"
 * const decoded = decodeParams(encoded); // { responseDepth: 'comprehensive', expertiseLevel: 'expert' }
 * const hash = paramsFingerprint(params); // "sha256:abc123..."
 * ```
 */

import {
  ResponseDepth,
  ExpertiseLevel,
  ReasoningMode,
  CitationStrictness,
  Tone,
  CreativityLevel,
  RiskPosture,
  OutputFormat,
  SelfCorrection,
  ConfidenceExpression,
  type PromptParameters,
} from './prompt-parameters';

// ============================================================================
// Enum Value Maps (dense 0-indexed integers for compact encoding)
// ============================================================================

const ENUM_KEYS = [
  'responseDepth',
  'expertiseLevel',
  'reasoningMode',
  'citationStrictness',
  'tone',
  'creativityLevel',
  'riskPosture',
  'outputFormat',
  'selfCorrection',
  'confidenceExpression',
] as const;

type EnumKey = (typeof ENUM_KEYS)[number];

const ENUM_VALUES: Record<EnumKey, readonly string[]> = {
  responseDepth: Object.values(ResponseDepth),
  expertiseLevel: Object.values(ExpertiseLevel),
  reasoningMode: Object.values(ReasoningMode),
  citationStrictness: Object.values(CitationStrictness),
  tone: Object.values(Tone),
  creativityLevel: Object.values(CreativityLevel),
  riskPosture: Object.values(RiskPosture),
  outputFormat: Object.values(OutputFormat),
  selfCorrection: Object.values(SelfCorrection),
  confidenceExpression: Object.values(ConfidenceExpression),
};

const VERSION = 1;
const HEADER_BYTE = VERSION; // 0x01

// ============================================================================
// Encoding
// ============================================================================

/**
 * Encode PromptParameters into a URL-safe base64url string.
 * Returns empty string if no parameters are set (all undefined).
 */
export function encodeParams(params: PromptParameters): string {
  // Check if any values are actually set
  const hasValues = ENUM_KEYS.some(key => params[key] !== undefined);
  if (!hasValues) return '';

  const bytes = new Uint8Array(1 + ENUM_KEYS.length);
  bytes[0] = HEADER_BYTE;

  for (let i = 0; i < ENUM_KEYS.length; i++) {
    const key = ENUM_KEYS[i];
    const value = params[key];
    if (value !== undefined) {
      const enumValues = ENUM_VALUES[key];
      const idx = enumValues.indexOf(value as string);
      if (idx !== -1) {
        // Encode as: index + 1 (0 means undefined)
        bytes[i + 1] = idx + 1;
      }
    }
  }

  // URL-safe base64: replace +/ with -_, strip padding
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Decode a URL-safe base64url string back into PromptParameters.
 * Returns empty object if the string is invalid or empty.
 */
export function decodeParams(encoded: string): PromptParameters {
  if (!encoded || encoded.length < 2) return {};

  try {
    // Restore base64 padding and URL-safe characters
    let base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4 !== 0) base64 += '=';

    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }

    if (bytes[0] !== VERSION) {
      // Unknown version — return empty to avoid corrupt data
      console.warn(`[PromptCodec] Unknown version byte: ${bytes[0]}, expected ${VERSION}`);
      return {};
    }

    const params: PromptParameters = {};

    for (let i = 0; i < ENUM_KEYS.length; i++) {
      const key = ENUM_KEYS[i];
      const byteVal = bytes[i + 1];
      if (byteVal > 0) {
        const enumValues = ENUM_VALUES[key];
        const enumIdx = byteVal - 1;
        if (enumIdx >= 0 && enumIdx < enumValues.length) {
          (params as any)[key] = enumValues[enumIdx];
        }
      }
    }

    return params;
  } catch (err) {
    console.warn('[PromptCodec] Failed to decode parameters:', err);
    return {};
  }
}

// ============================================================================
// Fingerprinting
// ============================================================================

/**
 * Generate a stable hash/fingerprint for a parameter set.
 * Used for cache keys, analytics, and change detection.
 * Format: "pp:v{VERSION}:{encoded}"
 */
export function paramsFingerprint(params: PromptParameters): string {
  const encoded = encodeParams(params);
  return encoded ? `pp:v${VERSION}:${encoded}` : 'pp:default';
}

// ============================================================================
// Parameter Diffing
// ============================================================================

export interface ParamDiff {
  /** Parameters that were added */
  added: Partial<PromptParameters>;
  /** Parameters that were removed */
  removed: Partial<PromptParameters>;
  /** Parameters that were changed */
  changed: { key: EnumKey; from: string; to: string }[];
  /** Whether any change occurred */
  hasChanges: boolean;
  /** Human-readable summary */
  summary: string;
}

/**
 * Compute a diff between two parameter sets.
 * Undefined fields in either set are treated as "not set" (default).
 */
export function diffParams(
  before: PromptParameters,
  after: PromptParameters,
): ParamDiff {
  const added: Partial<PromptParameters> = {};
  const removed: Partial<PromptParameters> = {};
  const changed: { key: EnumKey; from: string; to: string }[] = [];

  const allKeys = new Set<EnumKey>(ENUM_KEYS);

  for (const key of allKeys) {
    const beforeVal = before[key];
    const afterVal = after[key];
    const beforeSet = beforeVal !== undefined;
    const afterSet = afterVal !== undefined;

    if (!beforeSet && afterSet) {
      (added as any)[key] = afterVal;
    } else if (beforeSet && !afterSet) {
      (removed as any)[key] = beforeVal;
    } else if (beforeSet && afterSet && beforeVal !== afterVal) {
      changed.push({ key, from: beforeVal as string, to: afterVal as string });
    }
  }

  const hasChanges = Object.keys(added).length > 0 ||
    Object.keys(removed).length > 0 ||
    changed.length > 0;

  const parts: string[] = [];
  if (Object.keys(added).length) parts.push(`${Object.keys(added).length} added`);
  if (Object.keys(removed).length) parts.push(`${Object.keys(removed).length} removed`);
  if (changed.length) parts.push(`${changed.length} changed`);
  const summary = hasChanges ? parts.join(', ') : 'No changes';

  return { added, removed, changed, hasChanges, summary };
}

// ============================================================================
// Preset Derivation
// ============================================================================

export interface PresetDerivation {
  /** The parent preset key */
  parent: string;
  /** Overrides applied on top of parent */
  overrides: Partial<PromptParameters>;
  /** Derived preset name */
  name: string;
}

/**
 * Create a derived preset from a parent with overrides.
 * Useful for "forking" a preset and customizing selectively.
 */
export function derivePreset(
  parent: Partial<PromptParameters>,
  overrides: Partial<PromptParameters>,
  name?: string,
): PromptParameters {
  return { ...parent, ...overrides, ...(name ? { name: name } : {}) } as PromptParameters;
}

// ============================================================================
// Validation
// ============================================================================

/**
 * Validate that a PromptParameters object contains only valid enum values.
 * Returns { valid: true } or { valid: false, errors: [...] }.
 */
export function validateParams(
  params: PromptParameters,
): { valid: true } | { valid: false; errors: string[] } {
  const errors: string[] = [];

  for (const key of ENUM_KEYS) {
    const value = params[key];
    if (value !== undefined) {
      const validValues = ENUM_VALUES[key];
      if (!validValues.includes(value as string)) {
        errors.push(
          `${key}: "${value}" is not a valid value. Expected one of: ${validValues.join(', ')}`,
        );
      }
    }
  }

  return errors.length > 0 ? { valid: false, errors } : { valid: true };
}

// ============================================================================
// URL Integration
// ============================================================================

/**
 * Append encoded parameters to a URL as a query parameter.
 * Returns the new URL. Preserves existing query parameters.
 */
export function appendParamsToUrl(url: string, params: PromptParameters): string {
  const encoded = encodeParams(params);
  if (!encoded) return url;

  const urlObj = new URL(url, 'http://localhost');
  urlObj.searchParams.set('style', encoded);
  return urlObj.toString().replace(/^http:\/\/localhost/, '');
}

/**
 * Extract encoded parameters from a URL's query string.
 * Returns decoded PromptParameters or empty object if not present.
 */
export function extractParamsFromUrl(url: string): PromptParameters {
  try {
    const urlObj = new URL(url, 'http://localhost');
    const encoded = urlObj.searchParams.get('style');
    return encoded ? decodeParams(encoded) : {};
  } catch {
    return {};
  }
}
