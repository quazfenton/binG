// Feature flags for optional services
export const FEATURE_FLAGS = {
  // Cloud Storage Configuration
  ENABLE_CLOUD_STORAGE: true,
  CLOUD_STORAGE_PROVIDER: 'gcp',
  CLOUD_STORAGE_BUCKET: 'binG-storage',
  CLOUD_STORAGE_MAX_SIZE: 5 * 1024 * 1024 * 1024, // 5GB in bytes
  CLOUD_STORAGE_PER_USER_LIMIT_BYTES: 5 * 1024 * 1024 * 1024, // 5GB per user quota

  // Nextcloud integration
  NEXTCLOUD_URL: process.env.NEXT_PUBLIC_NEXTCLOUD_URL ||
    'https://your-nextcloud-instance/remote.php/dav/files/username/',
  NEXTCLOUD_USERNAME: process.env.NEXTCLOUD_USERNAME || '',
  NEXTCLOUD_PASSWORD: process.env.NEXTCLOUD_PASSWORD || '',
  
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
  // Disabled by default. To enable intentionally, set NEXT_PUBLIC_SKIP_AUTH_IN_DEV=true
  SKIP_AUTH_IN_DEV: process.env.NEXT_PUBLIC_SKIP_AUTH_IN_DEV === 'true',
} as const;

// Boolean feature flags only
const BOOLEAN_FEATURES = [
  'ENABLE_CLOUD_STORAGE',
  'ENABLE_VPS_DEPLOYMENT',
  'IS_DEVELOPMENT',
  'ENABLE_DEBUG_LOGS',
  'ENABLE_GITHUB_INTEGRATION',
  'ENABLE_HUGGINGFACE_SPACES',
  'ENABLE_ADS',
  'ENABLE_PREMIUM_THEMES',
  'ENABLE_UNLIMITED_PROMPTS',
  'ENABLE_PROMPT_HISTORY',
  'SKIP_AUTH_IN_DEV',
] as const;

type BooleanFeatureKey = typeof BOOLEAN_FEATURES[number];

export const isFeatureEnabled = (feature: BooleanFeatureKey): boolean => {
  return FEATURE_FLAGS[feature] as boolean;
};

export const getFeatureConfig = <T>(feature: keyof typeof FEATURE_FLAGS): T => {
  return FEATURE_FLAGS[feature] as T;
};

// ---------------------------------------------------------------------------
// Client-side debug logger factory
// ---------------------------------------------------------------------------

export interface DebugLogger {
  log: (...args: any[]) => void;
  warn: (...args: any[]) => void;
  error: (...args: any[]) => void;
}

/**
 * Create a debug logger controlled by a localStorage flag.
 *
 * This is the single source of truth for the repeated pattern:
 *   const DEBUG = localStorage.getItem('DEBUG_X') === 'true' || process.env.NODE_ENV === 'development';
 *   const log = (...args) => DEBUG && console.log('[Tag]', ...args);
 *
 * @param tag        Display prefix, e.g. "CodePreviewPanel"
 * @param storageKey localStorage key, e.g. "DEBUG_CODE_PREVIEW"
 */
export function createDebugLogger(tag: string, storageKey: string): DebugLogger {
  const isEnabled = (): boolean => {
    if (typeof window === 'undefined') return false;
    try {
      return localStorage.getItem(storageKey) === 'true' || process.env.NODE_ENV === 'development';
    } catch {
      return false;
    }
  };

  return {
    log: (...args: any[]) => { if (isEnabled()) console.log(`[${tag}]`, ...args); },
    warn: (...args: any[]) => { if (isEnabled()) console.warn(`[${tag} WARN]`, ...args); },
    error: (...args: any[]) => { if (isEnabled()) console.error(`[${tag} ERROR]`, ...args); },
  };
}

// Cloud Storage Service Interface
export interface CloudStorageService {
  upload(file: File, path: string): Promise<string>;
  download(path: string): Promise<Blob>;
  delete(path: string): Promise<void>;
  list(prefix?: string): Promise<string[]>;
  getSignedUrl(path: string, expiresIn?: number): Promise<string>;
}
