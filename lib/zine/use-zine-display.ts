/**
 * Zine Display API Hooks
 *
 * React hooks for Zine Display API integration
 */

import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';

export interface ZineContent {
  id: string;
  title: string;
  content: string;
  source: string;
  sourceUrl?: string;
  imageUrl?: string;
  author?: string;
  publishedAt: number;
  createdAt: number;
  tags: string[];
  priority: 'low' | 'normal' | 'high';
  read: boolean;
  starred: boolean;
}

export interface ZineStats {
  totalItems: number;
  unreadItems: number;
  starredItems: number;
  itemsBySource: Record<string, number>;
  itemsToday: number;
}

/**
 * Hook to fetch and manage zine content
 */
export function useZineContent(limit = 50, source?: string) {
  const [content, setContent] = useState<ZineContent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadContent = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      params.set('limit', limit.toString());
      if (source) params.set('source', source);

      const response = await fetch(`/api/zine-display/content?${params}`);
      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Failed to load content');
      }

      setContent(data.content || []);
      setError(null);
    } catch (err: any) {
      console.error('[useZineContent] Failed to load:', err);
      setError(err.message);
      toast.error('Failed to load zine content');
    } finally {
      setLoading(false);
    }
  }, [limit, source]);

  useEffect(() => {
    loadContent();
    const interval = setInterval(loadContent, 60000); // Refresh every minute
    return () => clearInterval(interval);
  }, [loadContent]);

  return { content, loading, error, refresh: loadContent };
}

/**
 * Hook to fetch zine statistics
 */
export function useZineStats() {
  const [stats, setStats] = useState<ZineStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadStats = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/zine-display/stats');
      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Failed to load stats');
      }

      setStats(data.stats || null);
      setError(null);
    } catch (err: any) {
      console.error('[useZineStats] Failed to load:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStats();
    const interval = setInterval(loadStats, 30000); // Refresh every 30s
    return () => clearInterval(interval);
  }, [loadStats]);

  return { stats, loading, error, refresh: loadStats };
}

/**
 * Hook to mark content as read
 */
export function useMarkAsRead() {
  const markAsRead = useCallback(async (id: string) => {
    try {
      const response = await fetch(`/api/zine-display/content/${id}/read`, {
        method: 'POST',
      });

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Failed to mark as read');
      }

      return true;
    } catch (err: any) {
      console.error('[useMarkAsRead] Failed:', err);
      return false;
    }
  }, []);

  return markAsRead;
}

/**
 * Hook to star/unstar content
 */
export function useStarContent() {
  const starContent = useCallback(async (id: string, starred: boolean) => {
    try {
      const response = await fetch(`/api/zine-display/content/${id}/star`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ starred }),
      });

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Failed to update star status');
      }

      return true;
    } catch (err: any) {
      console.error('[useStarContent] Failed:', err);
      return false;
    }
  }, []);

  return starContent;
}
