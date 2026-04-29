/**
 * Image Generation Quota Manager
 * Tracks usage of free-tier image generation models to prevent overages
 * 
 * Currently manages:
 * - Google Imagen: gemini-2.5-flash-image-preview (500 images/day limit)
 */

import { createLogger } from '@/lib/utils/logger';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

const log = createLogger('ImageQuotaManager');

interface ImageQuota {
  provider: string;
  model: string;
  dailyLimit: number;
  currentUsage: number;
  lastResetDate: string; // ISO date of last reset
  isDisabled: boolean;
}

// Default daily limits for free-tier models
const DEFAULT_QUOTAS: ImageQuota[] = [
  {
    provider: 'google',
    model: 'gemini-2.5-flash-image-preview',
    dailyLimit: 500, // 500 images per day
    currentUsage: 0,
    lastResetDate: new Date().toISOString().split('T')[0], // Today
    isDisabled: false,
  },
];

class ImageQuotaManager {
  private quotas: Map<string, ImageQuota> = new Map();
  private readonly quotaFilePath: string;
  private initialized = false;

  constructor() {
    this.quotaFilePath = process.env.IMAGE_QUOTA_FILE_PATH || 
                         join(process.cwd(), 'data', 'image-quotas.json');
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    
    try {
      // Load from file if exists
      if (existsSync(this.quotaFilePath)) {
        const data = readFileSync(this.quotaFilePath, 'utf-8');
        const savedQuotas = JSON.parse(data) as ImageQuota[];
        
        // Initialize quotas from file
        savedQuotas.forEach(quota => {
          this.quotas.set(this.getQuotaKey(quota.provider, quota.model), quota);
        });
      } else {
        // Initialize with default quotas
        DEFAULT_QUOTAS.forEach(quota => {
          this.quotas.set(this.getQuotaKey(quota.provider, quota.model), quota);
        });
        await this.saveQuotas();
      }
      
      // Check if we need to reset daily quotas
      await this.checkDailyReset();
      
      this.initialized = true;
      log.info('Image quota manager initialized', { 
        quotaCount: this.quotas.size,
        quotaFile: this.quotaFilePath 
      });
    } catch (error) {
      log.error('Failed to initialize image quota manager', { error });
      // Fallback: initialize with default quotas
      DEFAULT_QUOTAS.forEach(quota => {
        this.quotas.set(this.getQuotaKey(quota.provider, quota.model), quota);
      });
      this.initialized = true;
    }
  }

  private getQuotaKey(provider: string, model: string): string {
    return `${provider}:${model}`;
  }

  private async checkDailyReset(): Promise<void> {
    const today = new Date().toISOString().split('T')[0];
    
    for (const [key, quota] of this.quotas) {
      if (quota.lastResetDate !== today) {
        // Reset daily quota
        quota.currentUsage = 0;
        quota.lastResetDate = today;
        quota.isDisabled = false;
        log.info('Reset daily quota', { 
          provider: quota.provider,
          model: quota.model,
          dailyLimit: quota.dailyLimit
        });
      }
    }
    
    await this.saveQuotas();
  }

  private async saveQuotas(): Promise<void> {
    try {
      // Ensure directory exists
      const dir = dirname(this.quotaFilePath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      
      const quotasArray = Array.from(this.quotas.values());
      writeFileSync(this.quotaFilePath, JSON.stringify(quotasArray, null, 2), 'utf-8');
    } catch (error) {
      log.error('Failed to save image quotas', { error });
    }
  }

  async checkQuota(provider: string, model: string): Promise<{ 
    allowed: boolean; 
    remaining?: number; 
    limit?: number; 
    resetDate?: string; 
  }> {
    if (!this.initialized) {
      await this.initialize();
    }
    
    const quotaKey = this.getQuotaKey(provider, model);
    const quota = this.quotas.get(quotaKey);
    
    // If no quota defined for this model, allow unlimited usage
    if (!quota) {
      return { allowed: true };
    }
    
    // Check if quota is disabled
    if (quota.isDisabled) {
      return { 
        allowed: false,
        remaining: 0,
        limit: quota.dailyLimit,
        resetDate: quota.lastResetDate,
      };
    }
    
    // Check if limit reached
    if (quota.currentUsage >= quota.dailyLimit) {
      quota.isDisabled = true;
      await this.saveQuotas();
      
      return { 
        allowed: false,
        remaining: 0,
        limit: quota.dailyLimit,
        resetDate: quota.lastResetDate,
      };
    }
    
    // Quota available
    return { 
      allowed: true,
      remaining: quota.dailyLimit - quota.currentUsage,
      limit: quota.dailyLimit,
      resetDate: quota.lastResetDate,
    };
  }

  async incrementUsage(provider: string, model: string, amount: number = 1): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
    
    const quotaKey = this.getQuotaKey(provider, model);
    const quota = this.quotas.get(quotaKey);
    
    if (quota) {
      quota.currentUsage += amount;
      
      // Check if we just hit the limit
      if (quota.currentUsage >= quota.dailyLimit) {
        quota.isDisabled = true;
        log.warn('Daily quota reached', { 
          provider: quota.provider,
          model: quota.model,
          usage: quota.currentUsage,
          limit: quota.dailyLimit
        });
      }
      
      await this.saveQuotas();
    }
  }

  async getQuotaStatus(provider: string, model: string): Promise<ImageQuota | null> {
    if (!this.initialized) {
      await this.initialize();
    }
    
    const quotaKey = this.getQuotaKey(provider, model);
    return this.quotas.get(quotaKey) || null;
  }

  async resetQuota(provider: string, model: string): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
    
    const quotaKey = this.getQuotaKey(provider, model);
    const quota = this.quotas.get(quotaKey);
    
    if (quota) {
      quota.currentUsage = 0;
      quota.isDisabled = false;
      quota.lastResetDate = new Date().toISOString().split('T')[0];
      await this.saveQuotas();
      
      log.info('Quota manually reset', { 
        provider: quota.provider,
        model: quota.model
      });
    }
  }

  async resetAllQuotas(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
    
    const today = new Date().toISOString().split('T')[0];
    
    for (const quota of this.quotas.values()) {
      quota.currentUsage = 0;
      quota.isDisabled = false;
      quota.lastResetDate = today;
    }
    
    await this.saveQuotas();
    log.info('All image quotas reset');
  }
}

// Singleton instance
export const imageQuotaManager = new ImageQuotaManager();