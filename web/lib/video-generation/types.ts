/**
 * Video Generation Types
 */

export interface VideoProviderConfig {
  apiKey?: string
  baseURL?: string
  // Provider-specific configuration
  [key: string]: any
}

export interface VideoGenerationRequest {
  prompt: string
  model: string
  provider?: string
  apiKey?: string
  
  // Video generation parameters
  duration?: number // desired duration in seconds
  aspectRatio?: string // e.g., '16:9', '9:16', '1:1'
  width?: number
  height?: number
  quality?: 'low' | 'medium' | 'high' | 'ultra'
  style?: string
  seed?: number | 'random'
  
  // Input media (for image-to-video or video-to-video)
  initImageUrl?: string
  initVideoUrl?: string
  
  // Advanced options
  motionStrength?: number // 0-100
  cameraMovement?: 'none' | 'slight' | 'moderate' | 'strong'
  interpolationFrames?: number
}

export interface VideoGenerationResponse {
  videoUrl: string
  thumbnailUrl?: string
  provider: string
  model: string
  duration: number // actual duration in seconds
  width: number
  height: number
  metadata?: {
    seed?: number
    style?: string
    quality?: string
    framesGenerated?: number
    [key: string]: any
  }
}

export interface VideoGenerationProvider {
  id: string
  name: string
  initialize(config: VideoProviderConfig): void
  isAvailable(): Promise<boolean>
  generateVideo(request: VideoGenerationRequest): Promise<VideoGenerationResponse>
  getModels(): Array<{ 
    id: string; 
    tags?: string[]; 
    type?: string;
    capabilities?: any
  }>
}

export interface VideoProviderModel {
  id: string;
  tags?: string[];
  type?: 'text-to-video' | 'image-to-video' | 'video-to-video' | 'text-to-image' | string;
  capabilities?: {
    maxDuration?: number; // in seconds
    resolutions?: Array<{ width: number; height: number }>;
    styles?: string[];
    [key: string]: any;
  }
}

export interface VideoProvider {
  id: string
  name: string
  models: Array<VideoProviderModel | string>
  supportsStreaming: boolean
  description: string
  isAvailable?: boolean
}
