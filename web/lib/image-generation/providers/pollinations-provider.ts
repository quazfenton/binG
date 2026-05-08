/**
 * Pollinations AI Image Generation Provider
 * Documentation: https://github.com/pollinations/pollinations
 */

import type {
  ImageGenerationProvider,
  ImageGenerationParams,
  ImageGenerationResponse,
  ProviderConfig,
  ProviderCapabilities,
  ImageGenerationError,
  ImageGenerationErrorType,
} from '../types';
import { ImageGenerationErrorType as ErrorType } from '../types';

export class PollinationsImageProvider implements ImageGenerationProvider {
  readonly id = 'pollinations';
  readonly name = 'Pollinations AI';
  readonly defaultModel = 'flux';
  
  private apiKey?: string;
  private baseURL?: string;

  readonly models = [
    'flux',
    'kontext',
    'klein',
    'gptimage',
    'gptimage-large',
    'gpt-image-2',
    'grok-imagine',
    'grok-imagine-pro',
    'nanobanana',
    'nanobanana-2',
    'nanobanana-pro',
    'nova-canvas',
    'p-image',
    'p-image-edit',
    'qwen-image',
    'seedream',
    'seedream-pro',
    'seedream5',
    'wan-image',
    'wan-image-pro',
    'zimage'
  ];

  readonly capabilities: ProviderCapabilities = {
    aspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:2', '2:3'],
    resolutions: [
      { width: 512, height: 512 },
      { width: 1024, height: 1024 },
      { width: 1280, height: 720 },
      { width: 720, height: 1280 },
    ],
    supportsNegativePrompt: false,
    supportsImg2Img: false,
    supportsSeed: true,
    supportsBatchGeneration: false,
    supportsSamplers: false,
    maxBatchSize: 1,
    stylePresets: [],
    qualityPresets: [],
  };

  initialize(config: ProviderConfig): void {
    this.apiKey = config.apiKey;
    this.baseURL = config.baseURL || 'https://image.pollinations.ai/prompt';
  }

  async isAvailable(): Promise<boolean> {
    return true; // Pollinations API is free and doesn't explicitly strictly require a key
  }

  async generate(
    params: ImageGenerationParams,
    signal?: AbortSignal
  ): Promise<ImageGenerationResponse> {
    const startTime = Date.now();
    try {
      const model = params.model && this.models.includes(params.model) ? params.model : this.defaultModel;
      let prompt = params.prompt;
      
      const queryParams = new URLSearchParams();
      queryParams.append('model', model);
      if (params.width) queryParams.append('width', params.width.toString());
      if (params.height) queryParams.append('height', params.height.toString());
      if (params.seed) queryParams.append('seed', params.seed.toString());
      queryParams.append('nologo', 'true'); // Remove watermark

      const url = `${this.baseURL}/${encodeURIComponent(prompt)}?${queryParams.toString()}`;

      // We just return the image URL directly since pollinations serves images directly
      const duration = Date.now() - startTime;
      return {
        success: true,
        images: [{
          url,
          width: params.width || 1024,
          height: params.height || 1024,
          metadata: {
            model,
            provider: this.id,
          },
        }],
        provider: this.id,
        model,
        usage: {
          credits: 1,
        },
      };
    } catch (error: any) {
      throw this.createError(
        `Image generation failed: ${error.message}`,
        ErrorType.GENERATION_FAILED,
        error
      );
    }
  }

  getDefaultParams(): Partial<ImageGenerationParams> {
    return {
      width: 1024,
      height: 1024,
      numImages: 1,
    };
  }

  private createError(
    message: string,
    type: ImageGenerationErrorType,
    originalError?: Error
  ): ImageGenerationError {
    const error = new Error(message) as ImageGenerationError;
    error.name = 'ImageGenerationError';
    (error as any).type = type;
    (error as any).provider = this.id;
    (error as any).originalError = originalError;
    return error;
  }
}
