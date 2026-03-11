/**
 * Tambo React Hooks
 * 
 * Wrapper hooks for @tambo-ai/react SDK
 * Provides context helpers, context attachments, and resources support
 * 
 * @see https://tambo.ai/docs
 */

'use client';

import { useEffect, useState, useCallback } from 'react';
import { generateSecureId } from '@/lib/utils';

/**
 * Context Helper function type
 */
export type ContextHelper = () => Promise<Record<string, any>> | Record<string, any>;

/**
 * Context Attachment type
 */
export interface ContextAttachment {
  id: string;
  context: string;
  displayName?: string;
  type?: string;
}

/**
 * Resource type for @-mentions
 */
export interface Resource {
  id: string;
  name: string;
  content: string;
  type: string;
  metadata?: Record<string, any>;
}

/**
 * Hook for managing context helpers
 * 
 * @see https://tambo.ai/docs/guides/give-context/make-ai-aware-of-state
 */
export function useTamboContextHelpers() {
  const [helpers, setHelpers] = useState<Map<string, ContextHelper>>(new Map());

  const addContextHelper = useCallback((name: string, helper: ContextHelper) => {
    setHelpers(prev => {
      const next = new Map(prev);
      next.set(name, helper);
      return next;
    });
  }, []);

  const removeContextHelper = useCallback((name: string) => {
    setHelpers(prev => {
      const next = new Map(prev);
      next.delete(name);
      return next;
    });
  }, []);

  const getContextHelpers = useCallback(() => {
    return Object.fromEntries(helpers);
  }, [helpers]);

  return {
    helpers,
    addContextHelper,
    removeContextHelper,
    getContextHelpers,
  };
}

/**
 * Hook for managing context attachments
 * 
 * @see https://tambo.ai/docs/guides/give-context/let-users-attach-context
 */
export function useTamboContextAttachments() {
  const [attachments, setAttachments] = useState<ContextAttachment[]>([]);

  const addContextAttachment = useCallback((attachment: Omit<ContextAttachment, 'id'>) => {
    const id = generateSecureId('attachment');
    setAttachments(prev => [...prev, { ...attachment, id }]);
    return id;
  }, []);

  const removeContextAttachment = useCallback((id: string) => {
    setAttachments(prev => prev.filter(a => a.id !== id));
  }, []);

  const clearContextAttachments = useCallback(() => {
    setAttachments([]);
  }, []);

  const getAttachments = useCallback(() => {
    return attachments;
  }, [attachments]);

  return {
    attachments,
    addContextAttachment,
    removeContextAttachment,
    clearContextAttachments,
    getAttachments,
  };
}

/**
 * Hook for managing resources (@-mentions)
 * 
 * @see https://tambo.ai/docs/guides/give-context/make-context-referenceable
 */
export function useTamboResources() {
  const [resources, setResources] = useState<Resource[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addResource = useCallback((resource: Resource) => {
    setResources(prev => [...prev, resource]);
  }, []);

  const removeResource = useCallback((id: string) => {
    setResources(prev => prev.filter(r => r.id !== id));
  }, []);

  const addResources = useCallback((newResources: Resource[]) => {
    setResources(prev => [...prev, ...newResources]);
  }, []);

  const clearResources = useCallback(() => {
    setResources([]);
  }, []);

  const searchResources = useCallback(async (query: string): Promise<Resource[]> => {
    setIsLoading(true);
    setError(null);
    
    try {
      const queryLower = query.toLowerCase();
      const results = resources.filter(r =>
        r.name.toLowerCase().includes(queryLower) ||
        r.content.toLowerCase().includes(queryLower) ||
        r.type.toLowerCase().includes(queryLower)
      );
      return results;
    } catch (err: any) {
      setError(err.message);
      return [];
    } finally {
      setIsLoading(false);
    }
  }, [resources]);

  const getResources = useCallback(() => {
    return resources;
  }, [resources]);

  return {
    resources,
    isLoading,
    error,
    addResource,
    removeResource,
    addResources,
    clearResources,
    searchResources,
    getResources,
  };
}

/**
 * Prebuilt context helper: Current time
 */
export const currentTimeContextHelper: ContextHelper = () => ({
  time: new Date().toISOString(),
  formatted: new Date().toLocaleString(),
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
});

/**
 * Prebuilt context helper: Current page
 */
export const currentPageContextHelper: ContextHelper = () => {
  if (typeof window === 'undefined') {
    return null;
  }
  
  return {
    url: window.location.href,
    path: window.location.pathname,
    title: document.title,
    referrer: document.referrer || undefined,
  };
};

/**
 * Prebuilt context helper: User session (requires auth implementation)
 */
export const userSessionContextHelper: ContextHelper = async () => {
  try {
    const response = await fetch('/api/auth/session');
    if (!response.ok) {
      return null;
    }
    const session = await response.json();
    return {
      userId: session.user?.id,
      email: session.user?.email,
      name: session.user?.name,
      role: session.user?.role,
    };
  } catch {
    return null;
  }
};

/**
 * Prebuilt context helper: System info
 */
export const systemInfoContextHelper: ContextHelper = () => {
  if (typeof window === 'undefined') {
    return null;
  }
  
  return {
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    language: navigator.language,
    screen: {
      width: window.screen.width,
      height: window.screen.height,
    },
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
    },
  };
};
