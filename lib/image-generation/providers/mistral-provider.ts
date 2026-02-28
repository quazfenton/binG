/**
 * Mistral AI Image Generation Provider
 * Uses Mistral Agents API with built-in image_generation tool (powered by FLUX1.1 [pro] Ultra)
 * Documentation: https://docs.mistral.ai/agents/tools/built-in/image_generation
 */

import { Mistral } from '@mistralai/mistralai';
import type {
  ImageGenerationProvider,
  ImageGenerationParams,
  ImageGenerationResponse,
  GeneratedImage,
  ProviderConfig,
  ProviderCapabilities,
  ImageGenerationError,
  ImageGenerationErrorType,
} from '../types';
import { ASPECT_RATIO_DIMENSIONS, ImageGenerationErrorType as ErrorType } from '../types';

export class MistralImageProvider implements ImageGenerationProvider {
  readonly id = 'mistral';
  readonly name = 'Mistral AI';
  readonly defaultModel = 'mistral-large-2411';
  
  private client: Mistral | null = null;
  private apiKey?: string;
  private baseURL?: string;
  private cachedAgentId?: string;
  private agentIdCacheTime?: number;
  private static readonly AGENT_CACHE_TTL = 3600000; // 1 hour

  readonly models = [
    'mistral-large-2411',
    'mistral-medium-2505',
  ];

  readonly capabilities: ProviderCapabilities = {
    aspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:2', '2:3'],
    resolutions: [
      { width: 1024, height: 1024 },
      { width: 1280, height: 720 },
      { width: 720, height: 1280 },
      { width: 1152, height: 864 },
      { width: 1152, height: 768 },
      { width: 768, height: 1152 },
    ],
    supportsNegativePrompt: false,
    supportsImg2Img: false,
    supportsSeed: false,
    supportsBatchGeneration: false,
    supportsSamplers: false,
    maxBatchSize: 1,
    stylePresets: [],
    qualityPresets: ['medium', 'high', 'ultra'],
  };

  initialize(config: ProviderConfig): void {
    this.apiKey = config.apiKey;
    this.baseURL = config.baseURL;
    
    if (this.apiKey) {
      this.client = new Mistral({
        apiKey: this.apiKey,
        ...(this.baseURL && { baseURL: this.baseURL }),
      });
    }
  }

  async isAvailable(): Promise<boolean> {
    if (!this.client || !this.apiKey) {
      return false;
    }
    
    try {
      await this.client.models.list();
      return true;
    } catch {
      return false;
    }
  }

  async generate(
    params: ImageGenerationParams,
    signal?: AbortSignal
  ): Promise<ImageGenerationResponse> {
    if (!this.client) {
      throw this.createError(
        'Mistral provider not initialized. Please check your API key.',
        ErrorType.NOT_CONFIGURED
      );
    }

    const startTime = Date.now();
    const controller = new AbortController();
    
    if (signal) {
      signal.addEventListener('abort', () => controller.abort());
    }

    try {
      const agentId = await this.getOrCreateImageAgent();
      
      const response = await this.client.beta.conversations.start({
        agentId,
        inputs: this.buildPrompt(params),
      }, {
        signal: controller.signal,
      });

      const images = await this.extractImages(response);
      
      if (images.length === 0) {
        throw this.createError(
          'No images were generated. The model may have declined the request.',
          ErrorType.GENERATION_FAILED
        );
      }

      return {
        success: true,
        images,
        provider: this.id,
        model: this.defaultModel,
        usage: {
          credits: images.length,
        },
      };
    } catch (error) {
      if (error instanceof Error) {
        if (error.name === 'AbortError' || error.message.includes('aborted')) {
          throw this.createError(
            'Image generation timed out',
            ErrorType.TIMEOUT
          );
        }
        
        if (error.message.includes('429') || error.message.includes('rate limit')) {
          throw this.createError(
            'Rate limit exceeded. Please try again later.',
            ErrorType.RATE_LIMITED,
            error
          );
        }
        
        if (error.message.includes('401') || error.message.includes('403') || error.message.includes('unauthorized')) {
          throw this.createError(
            'Authentication failed. Please check your Mistral API key.',
            ErrorType.AUTH_FAILED,
            error
          );
        }
        
        throw this.createError(
          `Image generation failed: ${error.message}`,
          ErrorType.GENERATION_FAILED,
          error
        );
      }
      
      throw this.createError(
        'Unknown error during image generation',
        ErrorType.GENERATION_FAILED
      );
    }
  }

  getDefaultParams(): Partial<ImageGenerationParams> {
    return {
      width: 1024,
      height: 1024,
      numImages: 1,
      quality: 'high',
    };
  }

  private async getOrCreateImageAgent(): Promise<string> {
    const now = Date.now();
    if (this.cachedAgentId && this.agentIdCacheTime && (now - this.agentIdCacheTime) < MistralImageProvider.AGENT_CACHE_TTL) {
      return this.cachedAgentId;
    }

    try {
      const agentsResponse = await this.client!.beta.agents.list();
      const agents = (agentsResponse as any).data || [];
      const existingAgent = agents.find((a: any) => a.name === 'Image Generation Agent');
      
      if (existingAgent) {
        this.cachedAgentId = existingAgent.id;
        this.agentIdCacheTime = now;
        return existingAgent.id;
      }
    } catch (error) {
      console.warn('[MistralProvider] Failed to list agents, creating new one:', error);
    }

    const newAgent = await this.client!.beta.agents.create({
      model: this.defaultModel,
      name: 'Image Generation Agent',
      description: 'Agent specialized in generating high-quality images from text prompts',
      instructions: 
        'You are an image generation assistant. When the user provides a prompt, ' +
        'use the image_generation tool to create the requested image. ' +
        'Focus on creating detailed, high-quality images that match the user\'s description.',
      tools: [{ type: 'image_generation' as any }],
    });

    this.cachedAgentId = newAgent.id;
    this.agentIdCacheTime = now;
    return newAgent.id;
  }

  private buildPrompt(params: ImageGenerationParams): string {
    let prompt = params.prompt;

    if (params.quality) {
      const qualityModifiers: Record<string, string> = {
        low: '',
        medium: ', high quality',
        high: ', highly detailed, high quality, professional',
        ultra: ', ultra detailed, masterpiece, best quality, professional photography',
      };
      if (qualityModifiers[params.quality]) {
        prompt += qualityModifiers[params.quality];
      }
    }

    if (params.aspectRatio) {
      const ratioHints: Record<string, string> = {
        '1:1': '',
        '16:9': ', cinematic widescreen format',
        '9:16': ', vertical portrait format, perfect for mobile',
        '4:3': ', classic photo format',
        '3:2': ', landscape photography format',
        '2:3': ', portrait photography format',
        '21:9': ', ultrawide cinematic format',
      };
      if (ratioHints[params.aspectRatio]) {
        prompt += ratioHints[params.aspectRatio];
      }
    }

    if (params.style && params.style !== 'None') {
      prompt += `, ${params.style} style`;
    }

    return prompt;
  }

  private async extractImages(response: any): Promise<GeneratedImage[]> {
    const images: GeneratedImage[] = [];

    if (!response?.outputs || response.outputs.length === 0) {
      return images;
    }

    for (const output of response.outputs) {
      if (!output.content) continue;
      
      for (const chunk of output.content) {
        if (chunk.type === 'tool_file' && chunk.file_id) {
          try {
            const fileResponse = await this.client!.files.download({ 
              fileId: chunk.file_id 
            });
            
            let base64: string;
            let mimeType = 'image/png';
            
            if (typeof fileResponse === 'string') {
              base64 = fileResponse;
            } else if (fileResponse instanceof Uint8Array) {
              base64 = Buffer.from(fileResponse).toString('base64');
            } else if (fileResponse && 'data' in fileResponse) {
              const data = (fileResponse as any).data;
              if (data instanceof Uint8Array) {
                base64 = Buffer.from(data).toString('base64');
              } else {
                base64 = String(data);
              }
            } else {
              base64 = String(fileResponse || '');
            }

            if (chunk.file_type === 'jpeg' || chunk.file_type === 'jpg') {
              mimeType = 'image/jpeg';
            }

            const dataUrl = `data:${mimeType};base64,${base64}`;

            images.push({
              url: dataUrl,
              width: 1024,
              height: 1024,
              metadata: {
                model: this.defaultModel,
                provider: this.id,
                fileId: chunk.file_id,
                fileName: chunk.file_name,
              },
            });
          } catch (error) {
            console.error('Failed to download image from Mistral:', error);
          }
        }
      }
    }

    return images;
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
