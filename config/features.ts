// Feature flags for optional services
export const FEATURE_FLAGS = {
  // Cloud Storage Configuration
  ENABLE_CLOUD_STORAGE: true, // Set to false to disable cloud storage features
  CLOUD_STORAGE_PROVIDER: 'gcp', // 'gcp', 'aws', 's3', 'azure', 'minio'
  CLOUD_STORAGE_BUCKET: 'binG-storage',
  CLOUD_STORAGE_MAX_SIZE: 5 * 1024 * 1024 * 1024, // 5GB in bytes
  
  // VPS Deployment Configuration  
  ENABLE_VPS_DEPLOYMENT: true, // Set to false to disable VPS deployment features
  VPS_PROVIDER: 'digitalocean', // 'digitalocean', 'linode', 'vultr', 'gcp'
  VPS_DEFAULT_REGION: 'nyc1',
  VPS_DEFAULT_SIZE: 's-1vcpu-1gb',
  
  // Development flags
  IS_DEVELOPMENT: process.env.NODE_ENV === 'development',
  ENABLE_DEBUG_LOGS: process.env.NODE_ENV === 'development',
  
  // GitHub Integration
  ENABLE_GITHUB_INTEGRATION: true,
  GITHUB_API_BASE: 'https://api.github.com',
  
  // Hugging Face Integration
  ENABLE_HUGGINGFACE_SPACES: true,
  HUGGINGFACE_API_BASE: 'https://huggingface.co',
  
  // Advertisement System
  ENABLE_ADS: true,
  AD_FREQUENCY: 3, // Show ad every N prompts for free users
  
  // Premium Features
  ENABLE_PREMIUM_THEMES: true,
  ENABLE_UNLIMITED_PROMPTS: true,
  ENABLE_PROMPT_HISTORY: true,
} as const;

// Helper functions
export const isFeatureEnabled = (feature: keyof typeof FEATURE_FLAGS): boolean => {
  return FEATURE_FLAGS[feature] as boolean;
};

export const getFeatureConfig = <T>(feature: keyof typeof FEATURE_FLAGS): T => {
  return FEATURE_FLAGS[feature] as T;
};

// Cloud Storage Service Interface
export interface CloudStorageService {
  upload(file: File, path: string): Promise<string>;
  download(path: string): Promise<Blob>;
  delete(path: string): Promise<void>;
  list(prefix?: string): Promise<string[]>;
  getSignedUrl(path: string, expiresIn?: number): Promise<string>;
}

// VPS Deployment Service Interface
export interface VPSDeploymentService {
  createDroplet(config: VPSConfig): Promise<VPSInstance>;
  deployApp(instanceId: string, appConfig: AppConfig): Promise<DeploymentResult>;
  getStatus(instanceId: string): Promise<VPSStatus>;
  destroy(instanceId: string): Promise<void>;
}

export interface VPSConfig {
  name: string;
  region: string;
  size: string;
  image: string;
  sshKeys?: string[];
  userData?: string;
}

export interface VPSInstance {
  id: string;
  name: string;
  status: string;
  ipAddress: string;
  region: string;
  createdAt: Date;
}

export interface AppConfig {
  repository: string;
  branch: string;
  buildCommand?: string;
  startCommand?: string;
  envVars?: Record<string, string>;
  domain?: string;
}

export interface DeploymentResult {
  success: boolean;
  deploymentId: string;
  url?: string;
  logs: string[];
  error?: string;
}

export interface VPSStatus {
  status: 'creating' | 'active' | 'off' | 'archive';
  ipAddress?: string;
  memory: number;
  vcpus: number;
  disk: number;
  region: string;
}