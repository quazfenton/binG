/**
 * OPFS Utility Functions
 * 
 * Common utilities for OPFS operations
 */

import type { OPFSStats } from './opfs-core';

/**
 * Format bytes to human-readable string
 */
export function formatBytes(bytes: number, decimals = 2): string {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

/**
 * Format stats for display
 */
export function formatStats(stats: OPFSStats): string {
  return `${stats.totalFiles} files, ${stats.totalDirectories} dirs, ${formatBytes(stats.totalSize)} (${stats.quotaUsage.toFixed(1)}% quota used)`;
}

/**
 * Check if OPFS is supported with detailed info
 */
export function getOPFSSupportInfo(): {
  supported: boolean;
  browser: string;
  version?: string;
  details: string;
} {
  if (typeof window === 'undefined') {
    return {
      supported: false,
      browser: 'Server-side',
      details: 'OPFS is only available in browser environments',
    };
  }
  
  const userAgent = navigator.userAgent;
  let browser = 'Unknown';
  let version = '';
  
  // Detect browser
  if (userAgent.includes('Chrome')) {
    browser = 'Chrome';
    const match = userAgent.match(/Chrome\/(\d+)/);
    version = match ? match[1] : '';
  } else if (userAgent.includes('Edg')) {
    browser = 'Edge';
    const match = userAgent.match(/Edg\/(\d+)/);
    version = match ? match[1] : '';
  } else if (userAgent.includes('Firefox')) {
    browser = 'Firefox';
    const match = userAgent.match(/Firefox\/(\d+)/);
    version = match ? match[1] : '';
  } else if (userAgent.includes('Safari')) {
    browser = 'Safari';
    const match = userAgent.match(/Version\/(\d+)/);
    version = match ? match[1] : '';
  }
  
  // Check support
  const isSupported = 'storage' in navigator && typeof navigator.storage === 'object' && navigator.storage !== null && 'getDirectory' in navigator.storage;
  
  let details = '';
  if (isSupported) {
    details = 'OPFS is fully supported';
  } else {
    details = getUnsupportedReason(browser, parseInt(version || '0', 10));
  }
  
  return {
    supported: isSupported,
    browser,
    version: version || undefined,
    details,
  };
}

/**
 * Get reason why OPFS might not be supported
 */
function getUnsupportedReason(browser: string, version: number): string {
  switch (browser) {
    case 'Chrome':
      if (version < 119) {
        return 'Chrome 119+ required for OPFS support';
      }
      return 'OPFS may be disabled or unavailable';
    case 'Edge':
      if (version < 119) {
        return 'Edge 119+ required for OPFS support';
      }
      return 'OPFS may be disabled or unavailable';
    case 'Firefox':
      return 'Firefox has limited OPFS support (behind flag)';
    case 'Safari':
      if (version < 17) {
        return 'Safari 17.4+ required for OPFS support';
      }
      return 'Safari has limited OPFS support';
    default:
      return 'Browser does not support OPFS';
  }
}

/**
 * Request persistent storage permission
 */
export async function requestPersistentStorage(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.storage) {
    return false;
  }
  
  try {
    if ('persist' in navigator.storage) {
      const persisted = await navigator.storage.persist();
      return persisted;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Get storage estimate with formatted values
 */
export async function getFormattedStorageEstimate(): Promise<{
  usage: string;
  quota: string;
  percentUsed: number;
  available: string;
} | null> {
  if (typeof navigator === 'undefined' || !navigator.storage) {
    return null;
  }
  
  try {
    const estimate = await navigator.storage.estimate();
    const usage = estimate.usage || 0;
    const quota = estimate.quota || 0;
    
    return {
      usage: formatBytes(usage),
      quota: formatBytes(quota),
      percentUsed: quota > 0 ? (usage / quota) * 100 : 0,
      available: formatBytes(quota - usage),
    };
  } catch {
    return null;
  }
}

/**
 * Sanitize file path for OPFS
 */
export function sanitizePath(path: string): string {
  // Remove leading/trailing slashes
  let sanitized = path.replace(/^\/+|\/+$/g, '');
  
  // Replace multiple slashes with single
  sanitized = sanitized.replace(/\/+/g, '/');
  
  // Remove invalid characters
  sanitized = sanitized.replace(/[<>:"|?*]/g, '_');
  
  // Ensure path is not empty
  if (!sanitized) {
    sanitized = '.';
  }
  
  return sanitized;
}

/**
 * Get file extension
 */
export function getFileExtension(path: string): string {
  const parts = path.split('.');
  return parts.length > 1 ? parts.pop()?.toLowerCase() || '' : '';
}

/**
 * Get file name without extension
 */
export function getFileNameWithoutExtension(path: string): string {
  const fileName = path.split('/').pop() || '';
  const parts = fileName.split('.');
  if (parts.length > 1) {
    parts.pop();
  }
  return parts.join('.');
}

/**
 * Detect language from file path
 */
export function detectLanguageFromPath(path: string): string {
  const ext = getFileExtension(path);
  const languageMap: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    py: 'python',
    java: 'java',
    cs: 'csharp',
    cpp: 'cpp',
    c: 'c',
    h: 'c',
    hpp: 'cpp',
    go: 'go',
    rs: 'rust',
    rb: 'ruby',
    php: 'php',
    swift: 'swift',
    kt: 'kotlin',
    scala: 'scala',
    html: 'html',
    htm: 'html',
    css: 'css',
    scss: 'scss',
    sass: 'sass',
    less: 'less',
    json: 'json',
    xml: 'xml',
    md: 'markdown',
    markdown: 'markdown',
    yaml: 'yaml',
    yml: 'yaml',
    sh: 'bash',
    bash: 'bash',
    zsh: 'zsh',
    sql: 'sql',
    graphql: 'graphql',
    gql: 'graphql',
    txt: 'text',
    text: 'text',
  };
  return languageMap[ext] || 'text';
}

/**
 * Create a debounced function
 */
export function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  
  return function executedFunction(...args: Parameters<T>) {
    const later = () => {
      timeout = null;
      func(...args);
    };
    
    if (timeout) {
      clearTimeout(timeout);
    }
    timeout = setTimeout(later, wait);
  };
}

/**
 * Create a throttled function
 */
export function throttle<T extends (...args: any[]) => any>(
  func: T,
  limit: number
): (...args: Parameters<T>) => void {
  let inThrottle: boolean;
  
  return function executedFunction(...args: Parameters<T>) {
    if (!inThrottle) {
      func(...args);
      inThrottle = true;
      setTimeout(() => (inThrottle = false), limit);
    }
  };
}

/**
 * Sleep for specified milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry a function with exponential backoff
 */
export async function retry<T>(
  fn: () => Promise<T>,
  options: {
    maxRetries?: number;
    initialDelay?: number;
    maxDelay?: number;
    multiplier?: number;
  } = {}
): Promise<T> {
  const {
    maxRetries = 3,
    initialDelay = 100,
    maxDelay = 5000,
    multiplier = 2,
  } = options;
  
  let lastError: Error | null = null;
  let delay = initialDelay;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      
      if (attempt < maxRetries) {
        console.warn(`[OPFS] Retry attempt ${attempt + 1}/${maxRetries} failed:`, error.message);
        await sleep(delay);
        delay = Math.min(delay * multiplier, maxDelay);
      }
    }
  }
  
  throw lastError;
}
