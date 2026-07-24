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
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('MistralProvider');

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
  };

  constructor(config?: ProviderConfig) {
    if (config?.apiKey) {
      this.apiKey = config.apiKey;
    } else {
      this.apiKey = process.env.MISTRAL_API_KEY;
    }

    this.baseURL = config?.baseURL || process.env.MISTRAL_BASE_URL;

    if (this.apiKey) {
      this.client = new Mistral({
        apiKey: this.apiKey,
        ...(this.baseURL ? { serverURL: this.baseURL } : {}),
      });
    }
  }

  initialize(config: ProviderConfig): void {
    if (config.apiKey) {
      this.apiKey = config.apiKey;
    }
    if (config.baseURL) {
      this.baseURL = config.baseURL;
    }
    // Recreate the client whenever an API key is available so that a
    // `baseURL`/proxy configured via `initializeAll` (set AFTER the
    // constructor ran) actually takes effect. Previously the client was
    // built before `baseURL` was applied and never received `serverURL`,
    // so configured custom endpoints were silently ignored.
    if (this.apiKey) {
      this.client = new Mistral({
        apiKey: this.apiKey,
        ...(this.baseURL ? { serverURL: this.baseURL } : {}),
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
        'Mistral provider not initialized. Please check your MISTRAL_API_KEY environment variable.',
        ErrorType.NOT_CONFIGURED
      );
    }

    logger.info('Starting image generation with prompt:', params.prompt.substring(0, 100));

    const startTime = Date.now();
    const controller = new AbortController();

    if (signal) {
      signal.addEventListener('abort', () => controller.abort());
    }

    try {
      // Get or create the image generation agent
      const agentId = await this.getOrCreateImageAgent();
      logger.info('Using agent:', agentId);

      // Start conversation with the agent
      logger.info('Starting conversation with prompt:', this.buildPrompt(params));
      
      const response = await this.client.beta.conversations.start({
        agentId,
        inputs: this.buildPrompt(params),
      }, {
        signal: controller.signal,
      });

      logger.info('Got response:', JSON.stringify(response, null, 2).substring(0, 500));

      // Extract images from the response
      const images = await this.extractImages(response);

      if (images.length === 0) {
        logger.error('No images found in response. Response structure:', JSON.stringify(response, null, 2));
        throw this.createError(
          'No images were generated. The model may have declined the request or the image_generation tool is not properly configured.',
          ErrorType.GENERATION_FAILED
        );
      }

      const duration = Date.now() - startTime;
      logger.info(`Successfully generated ${images.length} image(s) in ${duration}ms`);

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
      const duration = Date.now() - startTime;
      logger.error(`Error after ${duration}ms:`, error);

      if (error instanceof Error) {
        if (error.name === 'AbortError' || error.message.includes('aborted')) {
          throw this.createError(
            'Image generation timed out after 3 minutes',
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
      logger.warn('Failed to list agents, creating new one:', error);
    }

    // Create agent with explicit image_generation tool configuration
    const newAgent = await this.client!.beta.agents.create({
      model: this.defaultModel,
      name: 'Image Generation Agent',
      description: 'Agent specialized in generating high-quality images from text prompts using FLUX1.1 [pro] Ultra',
      instructions:
        'You are an image generation assistant powered by FLUX1.1 [pro] Ultra. ' +
        'ALWAYS use the image_generation tool when the user requests an image. ' +
        'Do not describe the image - just generate it using the tool. ' +
        'Focus on creating detailed, high-quality images that match the user\'s description.',
      tools: [
        {
          type: 'image_generation' as any,
          // Explicitly configure the image_generation connector - cast to any to bypass type limitations
          ...( { config: {
            model: 'flux-pro-1.1-ultra',
          }} as any)
        }
      ],
    });

    this.cachedAgentId = newAgent.id;
    this.agentIdCacheTime = now;
    return newAgent.id;
  }

  private buildPrompt(params: ImageGenerationParams): string {
    let prompt = params.prompt;

    // Add quality modifiers
    if (params.quality) {
      const qualityModifiers: Record<string, string> = {
        low: '',
        medium: ', high quality',
        high: ', highly detailed, professional quality, sharp focus',
        ultra: ', ultra detailed, masterpiece, best quality, professional photography, 8k resolution',
      };
      if (qualityModifiers[params.quality]) {
        prompt += qualityModifiers[params.quality];
      }
    }

    // Add aspect ratio context
    if (params.aspectRatio) {
      const ratioHints: Record<string, string> = {
        '1:1': '',
        '16:9': ', cinematic widescreen composition',
        '9:16': ', vertical portrait composition, perfect for mobile',
        '4:3': ', classic photography composition',
        '3:2': ', landscape photography format',
        '2:3': ', portrait photography format',
        '21:9': ', ultrawide cinematic composition',
      };
      if (ratioHints[params.aspectRatio]) {
        prompt += ratioHints[params.aspectRatio];
      }
    }

    // Add style context
    if (params.style && params.style !== 'None') {
      prompt += `, ${params.style} artistic style`;
    }

    // Explicit instruction to generate image
    return `Generate an image with this description: ${prompt}. Use the image_generation tool now.`;
  }

  private async extractImages(response: any): Promise<GeneratedImage[]> {
    const images: GeneratedImage[] = [];

    logger.info('Extracting images from response with ' + (response.outputs?.length || 0) + ' outputs');

    if (!response?.outputs || response.outputs.length === 0) {
      return images;
    }

    // Look through all outputs for message.output entries
    for (const output of response.outputs) {
      logger.info('Processing output type:', output.type);
      
      if (output.type === 'message.output' && output.content) {
        logger.info('Found message.output with ' + output.content.length + ' content items');
        
        for (const chunk of output.content) {
          logger.info('Processing content type:', chunk.type);
          
          // ✅ FIX 1: Extract image URL directly from text content (Mistral returns CDN URL in text)
          if (chunk.type === 'text' && chunk.text) {
            const urlMatch = chunk.text.match(/https:\/\/[^\s\)]+\.jpg[^\s\)]*|https:\/\/[^\s\)]+\.png[^\s\)]*/i);
            if (urlMatch) {
              let imageUrl = urlMatch[0];
              logger.info('Extracted image URL from text:', imageUrl);

              // ✅ FIX: Decode URL-encoded characters (e.g., %3A -> :, %3F -> ?)
              // Blob storage URLs often have encoded SAS tokens that need decoding
              try {
                imageUrl = decodeURIComponent(imageUrl);
                logger.info('Decoded image URL:', imageUrl);
              } catch (e) {
                // If decoding fails, use original URL
                logger.warn('URL decoding failed, using original:', e);
              }

              images.push({
                url: imageUrl,
                width: 1024,
                height: 1024,
                metadata: {
                  model: this.defaultModel,
                  provider: this.id,
                  source: 'text_url',
                },
              });
            }
          }
          
          // ✅ FIX 2: Handle tool_file with proper file download
          if (chunk.type === 'tool_file' && chunk.fileId) {
            try {
              logger.info('Downloading file:', chunk.fileId);
              
              // Get file metadata first
              const fileInfo = await this.client!.files.retrieve({
                fileId: chunk.fileId
              });
              
              logger.info('File info:', fileInfo);
              
              // If file has a direct URL, use it
              if ((fileInfo as any).url) {
                let imageUrl = (fileInfo as any).url;
                logger.info('Using direct URL from file metadata');

                // Decode URL-encoded characters
                try {
                  imageUrl = decodeURIComponent(imageUrl);
                } catch (e) {
                  logger.warn('URL decoding failed:', e);
                }

                images.push({
                  url: imageUrl,
                  width: 1024,
                  height: 1024,
                  metadata: {
                    model: this.defaultModel,
                    provider: this.id,
                    fileId: chunk.fileId,
                    fileName: chunk.fileName,
                    source: 'file_url',
                  },
                });
                continue;
              }
              
              // Otherwise try to download the actual file content
              const fileResponse = await this.client!.files.download({
                fileId: chunk.fileId
              }) as unknown as string | Uint8Array | ArrayBuffer;

              let imageUrl: string;
              let mimeType = 'image/png';

              logger.info('File response type: ' + typeof fileResponse + ' ' + (fileResponse?.constructor?.name || 'unknown'));

              // Handle different response types
              if (typeof fileResponse === 'string') {
                if (fileResponse.startsWith('http://') || fileResponse.startsWith('https://')) {
                  imageUrl = fileResponse;
                  logger.info('Using direct URL from response');
                } else if (fileResponse.length > 100) {
                  // Likely base64
                  imageUrl = `data:${mimeType};base64,${fileResponse}`;
                } else {
                  logger.warn('Got short string response, skipping');
                  continue;
                }
              } else if (fileResponse instanceof Uint8Array || fileResponse instanceof ArrayBuffer) {
                const buffer = fileResponse instanceof ArrayBuffer ? new Uint8Array(fileResponse) : fileResponse;
                if (buffer.length > 1000) {
                  const base64 = Buffer.from(buffer).toString('base64');
                  imageUrl = `data:${mimeType};base64,${base64}`;
                  logger.info('Converted binary to base64, length:', base64.length);
                } else {
                  logger.warn('Got small binary response, skipping');
                  continue;
                }
              } else if (typeof fileResponse === 'object' && fileResponse !== null) {
                // Check if it's a ReadableStream (Node.js fetch) - actually consume it!
                const objWithBody = fileResponse as any;
                const fr = fileResponse as any;
                if (fr instanceof ReadableStream || objWithBody.body instanceof ReadableStream) {
                  logger.info('Got ReadableStream, consuming...');
                  try {
                    const stream = fr instanceof ReadableStream ? fr : objWithBody.body;
                    const reader = stream.getReader();
                    const chunks: Uint8Array[] = [];
                    
                    while (true) {
                      const { done, value } = await reader.read();
                      if (done) break;
                      chunks.push(value);
                    }
                    
                    // Combine chunks
                    const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
                    const buffer = new Uint8Array(totalLength);
                    let offset = 0;
                    for (const chunk of chunks) {
                      buffer.set(chunk, offset);
                      offset += chunk.length;
                    }
                    
                    if (buffer.length > 1000) {
                      const base64 = Buffer.from(buffer).toString('base64');
                      imageUrl = `data:${mimeType};base64,${base64}`;
                      logger.info('Consumed ReadableStream to base64, length:', base64.length);
                    } else {
                      logger.warn('ReadableStream produced small response, skipping');
                      continue;
                    }
                  } catch (error) {
                    logger.error('Failed to consume ReadableStream:', error);
                    continue;
                  }
                }
                // Check for URL in response object
                else if ((fileResponse as any).url) {
                  let url = (fileResponse as any).url;
                  logger.info('Using URL from response object');
                  
                  // Decode URL
                  try {
                    url = decodeURIComponent(url);
                  } catch (e) {
                    logger.warn('URL decoding failed:', e);
                  }
                  imageUrl = url;
                } else if ((fileResponse as any).data) {
                  const data = (fileResponse as any).data;
                  if (data instanceof Uint8Array || data instanceof ArrayBuffer) {
                    const buffer = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
                    const base64 = Buffer.from(buffer).toString('base64');
                    imageUrl = `data:${mimeType};base64,${base64}`;
                  } else {
                    imageUrl = `data:${mimeType};base64,${String(data)}`;
                  }
                } else {
                  logger.warn('Unknown object response structure, skipping');
                  continue;
                }
              } else {
                logger.warn('Unknown response type, skipping');
                continue;
              }

              if (chunk.fileType === 'jpeg' || chunk.fileType === 'jpg') {
                mimeType = 'image/jpeg';
                if (imageUrl.startsWith('data:')) {
                  imageUrl = imageUrl.replace('data:image/png', 'data:image/jpeg');
                }
              }

              images.push({
                url: imageUrl,
                width: 1024,
                height: 1024,
                metadata: {
                  model: this.defaultModel,
                  provider: this.id,
                  fileId: chunk.fileId,
                  fileName: chunk.fileName,
                  mimeType,
                  source: 'file_download',
                },
              });
              
              logger.info('Successfully extracted image from file:', chunk.fileId);
              logger.info('Image URL length: ' + imageUrl.length + ' characters');
            } catch (error) {
              logger.error('Failed to process file:', error, { fileId: chunk.fileId });
              // Continue to next chunk instead of failing entirely
            }
          }
        }
      }
    }

    logger.info('Extracted ' + images.length + ' images');
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
