// Feature flags for optional services
export const FEATURE_FLAGS = {
  // Cloud Storage Configuration
  ENABLE_CLOUD_STORAGE: true,
  CLOUD_STORAGE_PROVIDER: 'gcp',
  CLOUD_STORAGE_BUCKET: 'binG-storage',
  CLOUD_STORAGE_MAX_SIZE: 5 * 1024 * 1024 * 1024, // 5GB in bytes
  CLOUD_STORAGE_PER_USER_LIMIT_BYTES: 5 * 1024 * 1024 * 1024, // 5GB per user quota

  // Nextcloud integration
  NEXTCLOUD_URL: 'https://your-nextcloud-instance/remote.php/dav/files/username/',
  NEXTCLOUD_USERNAME: 'admin',
  NEXTCLOUD_PASSWORD: 'securepassword',
  
  // VPS Deployment Configuration  
  ENABLE_VPS_DEPLOYMENT: true,
  VPS_PROVIDER: 'digitalocean',
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
  SKIP_AUTH_IN_DEV: true, // Skip authentication in development
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