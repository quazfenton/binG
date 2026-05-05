/**
 * Image Generation Provider System
 * Abstract interfaces for modular, multi-provider image generation with fallback support
 */

/**
 * Common image generation parameters (ComfyUI-inspired)
 */
export interface ImageGenerationParams {
  /** Model to use for generation */
  model?: string;
  /** Primary text prompt describing the desired image */
  prompt: string;
  /** Negative prompt - what to avoid in the image */
  negativePrompt?: string;
  /** Image width in pixels */
  width?: number;
  /** Image height in pixels */
  height?: number;
  /** Number of inference steps (higher = more detail, slower) */
  steps?: number;
  /** CFG/guidance scale - how closely to follow the prompt */
  guidance?: number;
  /** Random seed for reproducibility */
  seed?: number | 'random';
  /** Sampler method (provider-dependent) */
  sampler?: string;
  /** Number of images to generate */
  numImages?: number;
  /** Aspect ratio preset (overrides width/height) */
  aspectRatio?: AspectRatio;
  /** Quality preset */
  quality?: 'low' | 'medium' | 'high' | 'ultra';
  /** Style preset */
  style?: string;
  /** Initial image for img2img */
  initImage?: string;
  /** Strength for img2img (0-1) */
  imageStrength?: number;
  /** Additional provider-specific parameters */
  extra?: Record<string, any>;
}

/**
 * Common aspect ratio presets
 */
export type AspectRatio =
  | '1:1'      // Square
  | '16:9'     // Landscape
  | '9:16'     // Portrait
  | '4:3'      // Standard
  | '3:2'      // Photo
  | '2:3'      // Portrait photo
  | '21:9';    // Ultrawide

/**
 * Aspect ratio to pixel dimensions mapping
 */
export const ASPECT_RATIO_DIMENSIONS: Record<AspectRatio, { width: number; height: number }> = {
  '1:1': { width: 1024, height: 1024 },
  '16:9': { width: 1280, height: 720 },
  '9:16': { width: 720, height: 1280 },
  '4:3': { width: 1152, height: 864 },
  '3:2': { width: 1152, height: 768 },
  '2:3': { width: 768, height: 1152 },
  '21:9': { width: 1344, height: 576 },
};

/**
 * Generated image result
 */
export interface GeneratedImage {
  /** Image URL (can be base64 data URL or remote URL) */
  url: string;
  /** Image width */
  width: number;
  /** Image height */
  height: number;
  /** Seed used for generation */
  seed?: number;
  /** Generation metadata */
  metadata?: {
    model?: string;
    provider?: string;
    prompt?: string;
    negativePrompt?: string;
    steps?: number;
    guidance?: number;
    sampler?: string;
    generationTime?: number;
    [key: string]: any;
  };
}

/**
 * Image generation response
 */
export interface ImageGenerationResponse {
  /** Whether the generation was successful */
  success: boolean;
  /** Generated images */
  images?: GeneratedImage[];
  /** Error message if failed */
  error?: string;
  /** Provider that was used */
  provider: string;
  /** Model that was used */
  model?: string;
  /** Usage/cost information */
  usage?: {
    credits?: number;
    tokens?: number;
  };
  /** Fallback chain information */
  fallbackChain?: string[];
}

/**
 * Provider capabilities
 */
export interface ProviderCapabilities {
  /** Supported aspect ratios */
  aspectRatios: AspectRatio[];
  /** Supported resolutions */
  resolutions: { width: number; height: number }[];
  /** Supports negative prompts */
  supportsNegativePrompt: boolean;
  /** Supports image-to-image */
  supportsImg2Img: boolean;
  /** Supports seed control */
  supportsSeed: boolean;
  /** Supports multiple images per request */
  supportsBatchGeneration: boolean;
  /** Supports custom samplers */
  supportsSamplers: boolean;
  /** Maximum batch size */
  maxBatchSize: number;
  /** Available style presets */
  stylePresets?: string[];
  /** Available quality presets */
  qualityPresets?: ('low' | 'medium' | 'high' | 'ultra')[];
}

/**
 * Provider configuration
 */
export interface ProviderConfig {
  /** API key */
  apiKey?: string;
  /** Base URL (optional) */
  baseURL?: string;
  /** Default model */
  defaultModel?: string;
  /** Timeout in milliseconds */
  timeout?: number;
  /** Additional provider-specific config */
  [key: string]: any;
}

/**
 * Abstract Image Generation Provider Interface
 * All providers must implement this interface
 */
export interface ImageGenerationProvider {
  /** Provider identifier */
  readonly id: string;
  /** Human-readable provider name */
  readonly name: string;
  /** Provider capabilities */
  readonly capabilities: ProviderCapabilities;
  /** Available models */
  readonly models: string[];
  /** Default model */
  readonly defaultModel: string;

  /**
   * Initialize the provider with configuration
   */
  initialize(config: ProviderConfig): void;

  /**
   * Check if provider is available and configured
   */
  isAvailable(): Promise<boolean>;

  /**
   * Generate image(s) based on parameters
   */
  generate(params: ImageGenerationParams, signal?: AbortSignal): Promise<ImageGenerationResponse>;

  /**
   * Get provider-specific default parameters
   */
  getDefaultParams(): Partial<ImageGenerationParams>;
}

/**
 * Provider registry entry
 */
export interface ProviderRegistryEntry {
  /** Provider instance */
  provider: ImageGenerationProvider;
  /** Priority (lower = higher priority) */
  priority: number;
  /** Whether provider is enabled */
  enabled: boolean;
  /** Whether provider is available (runtime check) */
  available: boolean;
}

/**
 * Fallback chain configuration
 */
export interface FallbackChainConfig {
  /** Ordered list of provider IDs to try */
  providers: string[];
  /** Whether to retry on specific errors */
  retryOnErrors?: string[];
  /** Maximum retries per provider */
  maxRetries?: number;
  /** Timeout per provider in milliseconds */
  timeout?: number;
}

/**
 * Error types for image generation
 */
export enum ImageGenerationErrorType {
  /** Invalid model specified */
  INVALID_MODEL = 'INVALID_MODEL',
  /** Provider not configured (missing API key) */
  NOT_CONFIGURED = 'NOT_CONFIGURED',
  /** Provider unavailable (rate limit, down, etc.) */
  UNAVAILABLE = 'UNAVAILABLE',
  /** Invalid parameters */
  INVALID_PARAMS = 'INVALID_PARAMS',
  /** Generation failed */
  GENERATION_FAILED = 'GENERATION_FAILED',
  /** Timeout */
  TIMEOUT = 'TIMEOUT',
  /** Rate limited */
  RATE_LIMITED = 'RATE_LIMITED',
  /** Quota exceeded */
  QUOTA_EXCEEDED = 'QUOTA_EXCEEDED',
  /** Authentication failed */
  AUTH_FAILED = 'AUTH_FAILED',
}

/**
 * Custom error for image generation
 */
export class ImageGenerationError extends Error {
  constructor(
    message: string,
    public readonly type: ImageGenerationErrorType,
    public readonly provider?: string,
    public readonly originalError?: Error,
  ) {
    super(message);
    this.name = 'ImageGenerationError';
  }
}

/**
 * Style presets commonly used in image generation
 */
export const STYLE_PRESETS = [
  'None',
  'Photorealistic',
  'Anime',
  'Digital Art',
  'Oil Painting',
  'Watercolor',
  'Sketch',
  '3D Render',
  'Pixel Art',
  'Concept Art',
  'Fantasy',
  'Sci-Fi',
  'Cinematic',
  'Minimalist',
  'Abstract',
  'Surreal',
] as const;

/**
 * Sampler options commonly used in image generation
 */
export const SAMPLER_OPTIONS = [
  'Euler',
  'Euler a',
  'DPM++ 2M Karras',
  'DPM++ SDE Karras',
  'DDIM',
  'PLMS',
  'UniPC',
  'Heun',
  'DPM2',
  'DPM2 a',
] as const;

/**
 * Quality presets mapping to steps/guidance
 */
export const QUALITY_PRESETS: Record<string, { steps: number; guidance: number }> = {
  low: { steps: 20, guidance: 5 },
  medium: { steps: 28, guidance: 5.5 },
  high: { steps: 40, guidance: 6 },
  ultra: { steps: 60, guidance: 7 },
};
