/**
 * Figma REST API Client
 * 
 * TypeScript client for Figma's REST API v1
 * 
 * @see https://www.figma.com/developers/api
 */

import { FIGMA_API_BASE } from './config';
import type {
  FigmaFileResponse,
  FigmaFilesResponse,
  FigmaComponentsResponse,
  FigmaComponentSetResponse,
  FigmaStylesResponse,
  FigmaImageResponse,
  FigmaImageFillResponse,
  FigmaCommentsResponse,
  FigmaWebhooksResponse,
  FigmaNode,
  FigmaFrameNode,
} from './types';

// ============================================================================
// HTTP Client
// ============================================================================

/**
 * Make authenticated request to Figma API
 */
async function figmaRequest<T>(
  endpoint: string,
  accessToken: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${FIGMA_API_BASE}${endpoint}`;
  
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${accessToken}`,
    ...options.headers,
  };

  const response = await fetch(url, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }));
    throw new FigmaApiError(error.error || response.statusText, response.status);
  }

  return response.json();
}

/**
 * GET request helper
 */
async function figmaGet<T>(
  endpoint: string,
  accessToken: string,
  params?: Record<string, string>
): Promise<T> {
  let url = endpoint;
  if (params) {
    const searchParams = new URLSearchParams(params);
    url = `${endpoint}?${searchParams.toString()}`;
  }
  return figmaRequest<T>(url, accessToken, { method: 'GET' });
}

/**
 * POST request helper
 */
async function figmaPost<T>(
  endpoint: string,
  accessToken: string,
  body?: Record<string, unknown>
): Promise<T> {
  return figmaRequest<T>(endpoint, accessToken, {
    method: 'POST',
    body: body ? JSON.stringify(body) : undefined,
  });
}

// ============================================================================
// Files API
// ============================================================================

/**
 * Get file metadata and root node
 */
export async function getFile(
  fileKey: string,
  accessToken: string,
  options?: {
    depth?: number;
    geometry?: 'paths';
    pluginData?: string;
  }
): Promise<FigmaFileResponse> {
  const params: Record<string, string> = {};
  if (options?.depth) params.depth = options.depth.toString();
  if (options?.geometry) params.geometry = options.geometry;
  if (options?.pluginData) params.plugin_data = options.pluginData;

  return figmaGet<FigmaFileResponse>(`/files/${fileKey}`, accessToken, params);
}

/**
 * Get list of files for a user
 */
export async function getFiles(
  accessToken: string,
  userId?: string
): Promise<FigmaFilesResponse> {
  const params: Record<string, string> = {};
  if (userId) params.user_id = userId;

  return figmaGet<FigmaFilesResponse>('/files', accessToken, params);
}

// ============================================================================
// Components API
// ============================================================================

/**
 * Get components from a file
 */
export async function getComponents(
  fileKey: string,
  accessToken: string
): Promise<FigmaComponentsResponse> {
  return figmaGet<FigmaComponentsResponse>(`/files/${fileKey}/components`, accessToken);
}

/**
 * Get component sets from a file
 */
export async function getComponentSets(
  fileKey: string,
  accessToken: string
): Promise<FigmaComponentSetResponse> {
  return figmaGet<FigmaComponentSetResponse>(`/files/${fileKey}/component_sets`, accessToken);
}

/**
 * Get styles from a file
 */
export async function getStyles(
  fileKey: string,
  accessToken: string
): Promise<FigmaStylesResponse> {
  return figmaGet<FigmaStylesResponse>(`/files/${fileKey}/styles`, accessToken);
}

// ============================================================================
// Images API
// ============================================================================

/**
 * Get images for specific nodes
 */
export async function getImages(
  fileKey: string,
  nodeIds: string[],
  accessToken: string,
  options?: {
    scale?: number;
    format?: 'png' | 'jpg' | 'svg' | 'pdf';
    svgOutlineText?: boolean;
    svgIncludeId?: boolean;
    constraint?: { type: 'SCALE' | 'WIDTH' | 'HEIGHT'; value: number };
    onlyVisible?: boolean;
    useAbsoluteBounds?: boolean;
  }
): Promise<FigmaImageResponse> {
  const params: Record<string, string> = {
    ids: nodeIds.join(','),
  };

  if (options?.scale) params.scale = options.scale.toString();
  if (options?.format) params.format = options.format;
  if (options?.svgOutlineText !== undefined) params.svg_outline_text = options.svgOutlineText.toString();
  if (options?.svgIncludeId !== undefined) params.svg_include_id = options.svgIncludeId.toString();
  if (options?.onlyVisible !== undefined) params.only_visible = options.onlyVisible.toString();
  if (options?.useAbsoluteBounds !== undefined) params.use_absolute_bounds = options.useAbsoluteBounds.toString();
  
  if (options?.constraint) {
    params.constraint_type = options.constraint.type;
    params.constraint_value = options.constraint.value.toString();
  }

  return figmaGet<FigmaImageResponse>(`/images/${fileKey}`, accessToken, params);
}

/**
 * Get image fills for specific nodes
 */
export async function getImageFills(
  fileKey: string,
  nodeIds: string[],
  accessToken: string,
  options?: {
    onlyVisible?: boolean;
    useAbsoluteBounds?: boolean;
  }
): Promise<FigmaImageFillResponse> {
  const params: Record<string, string> = {
    ids: nodeIds.join(','),
  };

  if (options?.onlyVisible !== undefined) params.only_visible = options.onlyVisible.toString();
  if (options?.useAbsoluteBounds !== undefined) params.use_absolute_bounds = options.useAbsoluteBounds.toString();

  return figmaGet<FigmaImageFillResponse>(`/images/${fileKey}/fills`, accessToken, params);
}

// ============================================================================
// Comments API
// ============================================================================

/**
 * Get comments from a file
 */
export async function getComments(
  fileKey: string,
  accessToken: string
): Promise<FigmaCommentsResponse> {
  return figmaGet<FigmaCommentsResponse>(`/files/${fileKey}/comments`, accessToken);
}

/**
 * Add a comment to a file
 */
export async function addComment(
  fileKey: string,
  accessToken: string,
  params: {
    nodeId: string;
    message: string;
    clientId?: string;
  }
): Promise<{ status: number; comment: { id: string } }> {
  return figmaPost(`/files/${fileKey}/comments`, accessToken, {
    node_id: params.nodeId,
    message: params.message,
    client_id: params.clientId,
  });
}

/**
 * Delete a comment
 */
export async function deleteComment(
  fileKey: string,
  commentId: string,
  accessToken: string
): Promise<{ status: number }> {
  return figmaRequest(`/files/${fileKey}/comments/${commentId}`, accessToken, {
    method: 'DELETE',
  });
}

// ============================================================================
// Webhooks API
// ============================================================================

/**
 * Get webhooks for a team
 */
export async function getWebhooks(
  accessToken: string
): Promise<FigmaWebhooksResponse> {
  return figmaGet<FigmaWebhooksResponse>('/webhooks', accessToken);
}

/**
 * Create a webhook
 */
export async function createWebhook(
  accessToken: string,
  params: {
    teamId: string;
    endpoint: string;
    passcode: string;
    eventType: string;
    filters?: { fileKey?: string };
  }
): Promise<{ status: number; webhook: { id: string } }> {
  return figmaPost('/webhooks', accessToken, {
    team_id: params.teamId,
    endpoint: params.endpoint,
    passcode: params.passcode,
    event_type: params.eventType,
    filters: params.filters,
  });
}

/**
 * Delete a webhook
 */
export async function deleteWebhook(
  webhookId: string,
  accessToken: string
): Promise<{ status: number }> {
  return figmaRequest(`/webhooks/${webhookId}`, accessToken, {
    method: 'DELETE',
  });
}

// ============================================================================
// Node Utilities
// ============================================================================

/**
 * Find a node by ID in a file tree
 */
export function findNodeById(root: FigmaNode, nodeId: string): FigmaNode | null {
  if (root.id === nodeId) {
    return root;
  }

  if ('children' in root && Array.isArray(root.children)) {
    for (const child of root.children) {
      const found = findNodeById(child, nodeId);
      if (found) return found;
    }
  }

  return null;
}

/**
 * Get all frames from a file
 */
export function getAllFrames(root: FigmaFrameNode): FigmaFrameNode[] {
  const frames: FigmaFrameNode[] = [];

  const traverse = (node: FigmaNode) => {
    if (node.type === 'FRAME' || node.type === 'GROUP' || node.type === 'SECTION') {
      frames.push(node as FigmaFrameNode);
    }

    if ('children' in node && Array.isArray(node.children)) {
      node.children.forEach(traverse);
    }
  };

  traverse(root);
  return frames;
}

/**
 * Get all text nodes from a file
 */
export function getAllTextNodes(root: FigmaNode): Array<FigmaNode & { type: 'TEXT' }> {
  const textNodes: Array<FigmaNode & { type: 'TEXT' }> = [];

  const traverse = (node: FigmaNode) => {
    if (node.type === 'TEXT') {
      textNodes.push(node as FigmaNode & { type: 'TEXT' });
    }

    if ('children' in node && Array.isArray(node.children)) {
      node.children.forEach(traverse);
    }
  };

  traverse(root);
  return textNodes;
}

// ============================================================================
// Error Handling
// ============================================================================

export class FigmaApiError extends Error {
  constructor(
    message: string,
    public statusCode: number
  ) {
    super(message);
    this.name = 'FigmaApiError';
  }
}

// ============================================================================
// Convenience API (for programmatic usage)
// ============================================================================

/**
 * Create Figma API client with access token
 * Returns an object with all API methods bound to the token
 */
export function createFigmaApi(accessToken: string) {
  return {
    /**
     * Get file metadata and root node
     */
    getFile: (fileKey: string, options?: { depth?: number; geometry?: 'paths'; pluginData?: string }) =>
      getFile(fileKey, accessToken, options),

    /**
     * Get list of files
     */
    getFiles: (userId?: string) =>
      getFiles(accessToken, userId),

    /**
     * Get components from a file
     */
    getComponents: (fileKey: string) =>
      getComponents(fileKey, accessToken),

    /**
     * Get component sets from a file
     */
    getComponentSets: (fileKey: string) =>
      getComponentSets(fileKey, accessToken),

    /**
     * Get styles from a file
     */
    getStyles: (fileKey: string) =>
      getStyles(fileKey, accessToken),

    /**
     * Get images for specific nodes
     */
    getImages: (
      fileKey: string,
      nodeIds: string[],
      options?: {
        scale?: number;
        format?: 'png' | 'jpg' | 'svg' | 'pdf';
        svgOutlineText?: boolean;
        svgIncludeId?: boolean;
        constraint?: { type: 'SCALE' | 'WIDTH' | 'HEIGHT'; value: number };
        onlyVisible?: boolean;
        useAbsoluteBounds?: boolean;
      }
    ) =>
      getImages(fileKey, nodeIds, accessToken, options),

    /**
     * Get image fills for specific nodes
     */
    getImageFills: (
      fileKey: string,
      nodeIds: string[],
      options?: {
        onlyVisible?: boolean;
        useAbsoluteBounds?: boolean;
      }
    ) =>
      getImageFills(fileKey, nodeIds, accessToken, options),

    /**
     * Get comments from a file
     */
    getComments: (fileKey: string) =>
      getComments(fileKey, accessToken),

    /**
     * Add a comment to a file
     */
    addComment: (fileKey: string, params: { nodeId: string; message: string; clientId?: string }) =>
      addComment(fileKey, accessToken, params),

    /**
     * Delete a comment
     */
    deleteComment: (fileKey: string, commentId: string) =>
      deleteComment(fileKey, commentId, accessToken),

    /**
     * Find a node by ID
     */
    findNodeById: (nodeId: string, root: FigmaNode) =>
      findNodeById(root, nodeId),

    /**
     * Get all frames from root node
     */
    getAllFrames: (root: FigmaFrameNode) =>
      getAllFrames(root),

    /**
     * Get all text nodes from root node
     */
    getAllTextNodes: (root: FigmaNode) =>
      getAllTextNodes(root),
  };
}

export type FigmaApi = ReturnType<typeof createFigmaApi>;

// Re-export types
export * from './types';
