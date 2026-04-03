/**
 * OAuth Permission Tracking System
 * 
 * Tracks and manages OAuth permissions/scopes for connected accounts.
 * Distinguishes between:
 * - Basic login (authentication only)
 * - Extended permissions (Gmail, Drive, Calendar, etc. for automation tools)
 * 
 * This integrates with Composio/Arcade/Nango for tool authorization.
 */

import { getDatabase } from '@/lib/database/connection';

export type PermissionLevel = 'read' | 'write' | 'full';
export type ServiceType = 'gmail' | 'drive' | 'calendar' | 'contacts' | 'docs' | 'sheets' | 'slides' | 'tasks' | 'keep' | 'photos' | 'youtube' | 'maps' | 'custom';

export interface ServicePermission {
  id?: number;
  userId: number;
  connectionId: number;
  serviceName: ServiceType | string;
  permissionLevel: PermissionLevel;
  grantedAt: string;
  isActive: boolean;
  scopes?: string[];
  lastUsedAt?: string;
}

export interface ConnectionWithPermissions {
  id: number;
  provider: string;
  providerDisplayName?: string;
  isConnected: boolean;
  connectedAt?: string;
  lastAccessedAt?: string;
  scopes: string[];
  permissions: ServicePermission[];
  hasExpiredTokens: boolean;
  tokenExpiresAt?: string;
}

/**
 * Permission definitions for common services
 */
export const SERVICE_PERMISSIONS: Record<ServiceType, {
  scopes: string[];
  defaultPermissionLevel: PermissionLevel;
  description: string;
}> = {
  gmail: {
    scopes: ['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/gmail.send'],
    defaultPermissionLevel: 'read',
    description: 'Read and send Gmail messages',
  },
  drive: {
    scopes: ['https://www.googleapis.com/auth/drive.readonly', 'https://www.googleapis.com/auth/drive.file'],
    defaultPermissionLevel: 'read',
    description: 'Access Google Drive files',
  },
  calendar: {
    scopes: ['https://www.googleapis.com/auth/calendar.readonly', 'https://www.googleapis.com/auth/calendar.events'],
    defaultPermissionLevel: 'read',
    description: 'View and manage calendar events',
  },
  contacts: {
    scopes: ['https://www.googleapis.com/auth/contacts.readonly'],
    defaultPermissionLevel: 'read',
    description: 'Access Google Contacts',
  },
  docs: {
    scopes: ['https://www.googleapis.com/auth/documents.readonly'],
    defaultPermissionLevel: 'read',
    description: 'Read Google Docs',
  },
  sheets: {
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly', 'https://www.googleapis.com/auth/spreadsheets'],
    defaultPermissionLevel: 'read',
    description: 'Read and edit Google Sheets',
  },
  slides: {
    scopes: ['https://www.googleapis.com/auth/presentations.readonly'],
    defaultPermissionLevel: 'read',
    description: 'Read Google Slides',
  },
  tasks: {
    scopes: ['https://www.googleapis.com/auth/tasks.readonly'],
    defaultPermissionLevel: 'read',
    description: 'View and manage Google Tasks',
  },
  keep: {
    scopes: ['https://www.googleapis.com/auth/keep.readonly'],
    defaultPermissionLevel: 'read',
    description: 'Read Google Keep notes',
  },
  photos: {
    scopes: ['https://www.googleapis.com/auth/photoslibrary.readonly'],
    defaultPermissionLevel: 'read',
    description: 'Access Google Photos',
  },
  youtube: {
    scopes: ['https://www.googleapis.com/auth/youtube.readonly'],
    defaultPermissionLevel: 'read',
    description: 'Access YouTube channel and videos',
  },
  maps: {
    scopes: ['https://www.googleapis.com/auth/mapsplatform'],
    defaultPermissionLevel: 'read',
    description: 'Access Google Maps Platform',
  },
  custom: {
    scopes: [],
    defaultPermissionLevel: 'read',
    description: 'Custom service integration',
  },
};

/**
 * Get all connections with their permissions for a user
 */
export async function getUserConnectionPermissions(userId: number): Promise<ConnectionWithPermissions[]> {
  const db = getDatabase();
  
  // Get all external connections
  const connections = db.prepare(`
    SELECT 
      id,
      provider,
      provider_display_name,
      scopes,
      token_expires_at,
      last_accessed_at,
      created_at,
      is_active
    FROM external_connections
    WHERE user_id = ?
    ORDER BY created_at DESC
  `).all(userId) as any[];

  const result: ConnectionWithPermissions[] = [];

  for (const conn of connections) {
    // Get permissions for this connection
    const permissions = db.prepare(`
      SELECT id, service_name, permission_level, granted_at, is_active
      FROM service_permissions
      WHERE user_id = ? AND connection_id = ?
      ORDER BY granted_at DESC
    `).all(userId, conn.id) as any[];

    // Parse scopes
    const scopes = conn.scopes ? conn.scopes.split(',').map((s: string) => s.trim()).filter(Boolean) : [];

    // Check if tokens are expired
    const hasExpiredTokens = conn.token_expires_at ? new Date(conn.token_expires_at) < new Date() : false;

    result.push({
      id: conn.id,
      provider: conn.provider,
      providerDisplayName: conn.provider_display_name,
      isConnected: conn.is_active,
      connectedAt: conn.created_at,
      lastAccessedAt: conn.last_accessed_at,
      scopes,
      permissions: permissions.map((p: any) => ({
        id: p.id,
        userId,
        connectionId: conn.id,
        serviceName: p.service_name,
        permissionLevel: p.permission_level,
        grantedAt: p.granted_at,
        isActive: p.is_active,
      })),
      hasExpiredTokens,
      tokenExpiresAt: conn.token_expires_at,
    });
  }

  return result;
}

/**
 * Grant permission for a specific service
 */
export async function grantServicePermission(
  userId: number,
  connectionId: number,
  serviceName: ServiceType | string,
  permissionLevel: PermissionLevel = 'read',
  scopes?: string[]
): Promise<ServicePermission> {
  const db = getDatabase();
  
  // Check if permission already exists
  const existing = db.prepare(`
    SELECT id, is_active FROM service_permissions
    WHERE user_id = ? AND connection_id = ? AND service_name = ?
  `).get(userId, connectionId, serviceName) as any;

  if (existing) {
    // Reactivate if exists
    db.prepare(`
      UPDATE service_permissions
      SET is_active = TRUE, permission_level = ?, granted_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(permissionLevel, existing.id);

    return {
      id: existing.id,
      userId,
      connectionId,
      serviceName,
      permissionLevel,
      grantedAt: new Date().toISOString(),
      isActive: true,
      scopes,
    };
  }

  // Create new permission
  const result = db.prepare(`
    INSERT INTO service_permissions (user_id, connection_id, service_name, permission_level)
    VALUES (?, ?, ?, ?)
  `).run(userId, connectionId, serviceName, permissionLevel);

  return {
    id: result.lastInsertRowid as number,
    userId,
    connectionId,
    serviceName,
    permissionLevel,
    grantedAt: new Date().toISOString(),
    isActive: true,
    scopes,
  };
}

/**
 * Revoke permission for a specific service
 */
export async function revokeServicePermission(
  userId: number,
  connectionId: number,
  serviceName: ServiceType | string
): Promise<boolean> {
  const db = getDatabase();
  
  const result = db.prepare(`
    UPDATE service_permissions
    SET is_active = FALSE
    WHERE user_id = ? AND connection_id = ? AND service_name = ?
  `).run(userId, connectionId, serviceName);

  return result.changes > 0;
}

/**
 * Check if a specific service permission is granted
 */
export function hasServicePermission(
  userId: number,
  connectionId: number,
  serviceName: ServiceType | string,
  requiredLevel: PermissionLevel = 'read'
): boolean {
  const db = getDatabase();
  
  const permission = db.prepare(`
    SELECT permission_level, is_active
    FROM service_permissions
    WHERE user_id = ? AND connection_id = ? AND service_name = ?
  `).get(userId, connectionId, serviceName) as any;

  if (!permission || !permission.is_active) {
    return false;
  }

  // Check permission level hierarchy: full > write > read
  const levels: Record<PermissionLevel, number> = {
    read: 1,
    write: 2,
    full: 3,
  };

  return levels[permission.permission_level] >= levels[requiredLevel];
}

/**
 * Get all granted permissions for automation tools (Composio/Arcade/Nango)
 * Returns permissions that can be used for tool authorization
 */
export async function getAutomationToolPermissions(userId: number): Promise<{
  provider: string;
  serviceName: string;
  permissionLevel: PermissionLevel;
  scopes: string[];
  connectionId: number;
}[]> {
  const db = getDatabase();
  
  const permissions = db.prepare(`
    SELECT 
      sp.service_name,
      sp.permission_level,
      sp.is_active,
      ec.provider,
      ec.id as connection_id,
      ec.scopes
    FROM service_permissions sp
    JOIN external_connections ec ON sp.connection_id = ec.id
    WHERE sp.user_id = ? AND sp.is_active = TRUE AND ec.is_active = TRUE
  `).all(userId) as any[];

  return permissions.map((p: any) => ({
    provider: p.provider,
    serviceName: p.service_name,
    permissionLevel: p.permission_level,
    scopes: p.scopes ? p.scopes.split(',').map((s: string) => s.trim()).filter(Boolean) : [],
    connectionId: p.connection_id,
  }));
}

/**
 * Update permission level for a service
 */
export async function updatePermissionLevel(
  userId: number,
  connectionId: number,
  serviceName: ServiceType | string,
  newLevel: PermissionLevel
): Promise<boolean> {
  const db = getDatabase();
  
  const result = db.prepare(`
    UPDATE service_permissions
    SET permission_level = ?
    WHERE user_id = ? AND connection_id = ? AND service_name = ? AND is_active = TRUE
  `).run(newLevel, userId, connectionId, serviceName);

  return result.changes > 0;
}

/**
 * Log permission usage for analytics and security auditing
 */
export async function logPermissionUsage(
  userId: number,
  connectionId: number,
  serviceName: string,
  action: string,
  success: boolean
): Promise<void> {
  const db = getDatabase();
  
  try {
    db.prepare(`
      INSERT INTO token_refresh_logs (connection_id, success, error_message)
      VALUES (?, ?, ?)
    `).run(connectionId, success, success ? null : `Permission usage: ${action}`);

    // Update last_used_at in service_permissions
    db.prepare(`
      UPDATE service_permissions
      SET last_used_at = CURRENT_TIMESTAMP
      WHERE user_id = ? AND connection_id = ? AND service_name = ?
    `).run(userId, connectionId, serviceName);
  } catch (error) {
    console.error('[Permission Tracking] Failed to log usage:', error);
  }
}

/**
 * Get permission usage statistics
 */
export async function getPermissionUsageStats(userId: number): Promise<{
  totalConnections: number;
  activePermissions: number;
  servicesUsed: string[];
  lastActivityAt?: string;
}> {
  const db = getDatabase();
  
  // Get total connections
  const totalConnections = db.prepare(`
    SELECT COUNT(*) as count
    FROM external_connections
    WHERE user_id = ? AND is_active = TRUE
  `).get(userId) as any;

  // Get active permissions
  const activePermissions = db.prepare(`
    SELECT COUNT(*) as count
    FROM service_permissions
    WHERE user_id = ? AND is_active = TRUE
  `).get(userId) as any;

  // Get services used
  const servicesResult = db.prepare(`
    SELECT DISTINCT service_name
    FROM service_permissions
    WHERE user_id = ? AND is_active = TRUE
  `).all(userId) as any[];

  // Get last activity
  const lastActivity = db.prepare(`
    SELECT MAX(last_used_at) as lastActivity
    FROM service_permissions
    WHERE user_id = ?
  `).get(userId) as any;

  return {
    totalConnections: totalConnections.count,
    activePermissions: activePermissions.count,
    servicesUsed: servicesResult.map((s: any) => s.service_name),
    lastActivityAt: lastActivity.lastActivity,
  };
}
