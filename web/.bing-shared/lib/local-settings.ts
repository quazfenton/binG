/**
 * Local Settings Manager
 * 
 * Unified settings storage for CLI and Desktop (headless) modes.
 * Handles reading/writing settings to disk with proper error handling.
 * 
 * Storage location priority:
 * 1. DESKTOP_WORKSPACE_ROOT/env-based location (Desktop)
 * 2. INITIAL_CWD/env-based location (CLI with workspace context)
 * 3. ~/.quaz/settings.json (CLI standalone)
 * 
 * Import from this module in both CLI and Desktop implementations
 * to ensure consistent settings behavior.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import {
  UnifiedSettings,
  ProviderKeys,
  AuthState,
  SETTINGS_FILENAME,
  APP_DATA_DIR,
  CURRENT_SETTINGS_VERSION,
  createDefaultSettings,
} from './settings-schema';

// ============================================================================
// Constants
// ============================================================================

const CONFIG_DIR_LEGACY = '.bing-cli'; // Old CLI config directory name

// ============================================================================
// Storage Path Resolution
// ============================================================================

/**
 * Resolve the settings directory path.
 * Priority: DESKTOP_WORKSPACE_ROOT > INITIAL_CWD > HOME/.quaz
 */
export function resolveSettingsDir(): string {
  // Desktop mode - use workspace root or app data
  if (process.env.DESKTOP_WORKSPACE_ROOT) {
    return path.join(process.env.DESKTOP_WORKSPACE_ROOT, APP_DATA_DIR);
  }
  
  // Tauri sidecar mode - use INITIAL_CWD
  if (process.env.INITIAL_CWD) {
    return path.join(process.env.INITIAL_CWD, APP_DATA_DIR);
  }
  
  // CLI standalone mode - use ~/.quaz with legacy fallback
  const userHome = os.homedir();
  const quazDir = path.join(userHome, APP_DATA_DIR);
  const legacyDir = path.join(userHome, CONFIG_DIR_LEGACY);
  
  // Migrate from legacy directory if it exists
  if (fs.existsSync(legacyDir) && !fs.existsSync(quazDir)) {
    return legacyDir;
  }
  
  return quazDir;
}

/**
 * Get the full path to the settings file
 */
export function getSettingsPath(): string {
  return path.join(resolveSettingsDir(), SETTINGS_FILENAME);
}

/**
 * Get the full path to the keys file (separate for security)
 */
export function getKeysPath(): string {
  return path.join(resolveSettingsDir(), 'keys.json');
}

/**
 * Get the full path to the auth file (separate for security)
 */
export function getAuthPath(): string {
  return path.join(resolveSettingsDir(), 'auth.json');
}

// ============================================================================
// Settings Operations
// ============================================================================

/**
 * Load unified settings from disk
 */
export function loadSettings(): UnifiedSettings {
  const settingsPath = getSettingsPath();
  
  try {
    if (fs.existsSync(settingsPath)) {
      const raw = fs.readFileSync(settingsPath, 'utf-8');
      const parsed = JSON.parse(raw) as UnifiedSettings;
      
      // Migration: convert from legacy format if needed
      if (!parsed.version) {
        return migrateFromLegacy(parsed);
      }
      
      return parsed;
    }
  } catch (error) {
    console.warn(`Warning: Failed to load settings from ${settingsPath}:`, error);
  }
  
  // Return defaults on error or if file doesn't exist
  return createDefaultSettings();
}

/**
 * Save unified settings to disk
 */
export function saveSettings(settings: UnifiedSettings): void {
  const settingsDir = resolveSettingsDir();
  const settingsPath = getSettingsPath();
  
  // Ensure directory exists
  fs.mkdirSync(settingsDir, { recursive: true });
  
  // Update timestamp
  settings.updatedAt = Date.now();
  settings.version = CURRENT_SETTINGS_VERSION;
  
  // Write settings file
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
  
  // Set secure file permissions (Unix only)
  try {
    fs.chmodSync(settingsPath, 0o600);
  } catch {
    // chmod not supported on Windows
  }
}

/**
 * Update a specific section of settings
 */
export function updateSettings(updates: Partial<UnifiedSettings>): UnifiedSettings {
  const current = loadSettings();
  const updated = {
    ...current,
    ...updates,
    // Ensure nested objects are merged properly
    workspace: { ...current.workspace, ...updates.workspace },
    llm: { ...current.llm, ...updates.llm },
    sandbox: { ...current.sandbox, ...updates.sandbox },
    display: { ...current.display, ...updates.display },
  };
  saveSettings(updated);
  return updated;
}

// ============================================================================
// Legacy Format Migration
// ============================================================================

interface LegacyConfig {
  apiBase?: string;
  provider?: string;
  model?: string;
  sandboxProvider?: string;
  currentSandbox?: string;
}

/**
 * Migrate from legacy config format to unified settings
 */
function migrateFromLegacy(legacy: LegacyConfig & Record<string, unknown>): UnifiedSettings {
  const settings = createDefaultSettings();
  
  // Map legacy fields
  if (legacy.provider) settings.llm.provider = legacy.provider;
  if (legacy.model) settings.llm.model = legacy.model;
  if (legacy.sandboxProvider) settings.sandbox.provider = legacy.sandboxProvider;
  if (legacy.currentSandbox) settings.sandbox.currentSandboxId = legacy.currentSandbox;
  
  // Mark as migrated
  settings.version = CURRENT_SETTINGS_VERSION;
  
  return settings;
}

// ============================================================================
// Keys Operations (Separate for security)
// ============================================================================

/**
 * Load API keys (stored separately with stricter permissions)
 */
export function loadKeys(): ProviderKeys {
  const keysPath = getKeysPath();
  
  try {
    if (fs.existsSync(keysPath)) {
      return JSON.parse(fs.readFileSync(keysPath, 'utf-8'));
    }
  } catch {
    // Ignore errors
  }
  
  return {};
}

/**
 * Save API keys
 */
export function saveKeys(keys: ProviderKeys): void {
  const keysDir = path.dirname(getKeysPath());
  fs.mkdirSync(keysDir, { recursive: true });
  
  fs.writeFileSync(getKeysPath(), JSON.stringify(keys, null, 2), 'utf-8');
  
  // Stricter permissions for keys
  try {
    fs.chmodSync(getKeysPath(), 0o600);
  } catch {
    // Windows doesn't support chmod
  }
}

/**
 * Get a specific API key
 */
export function getKey(provider: string): string | undefined {
  const keys = loadKeys();
  return keys[provider.toLowerCase()];
}

/**
 * Set a specific API key
 */
export function setKey(provider: string, apiKey: string): void {
  const keys = loadKeys();
  keys[provider.toLowerCase()] = apiKey;
  saveKeys(keys);
}

/**
 * Delete a specific API key
 */
export function deleteKey(provider: string): void {
  const keys = loadKeys();
  delete keys[provider.toLowerCase()];
  saveKeys(keys);
}

// ============================================================================
// Auth Operations
// ============================================================================

/**
 * Load auth state
 */
export function loadAuth(): AuthState {
  const authPath = getAuthPath();
  
  try {
    if (fs.existsSync(authPath)) {
      return JSON.parse(fs.readFileSync(authPath, 'utf-8'));
    }
  } catch {
    // Ignore
  }
  
  return { token: null, userId: null, email: null, expiresAt: null };
}

/**
 * Save auth state
 */
export function saveAuth(auth: AuthState): void {
  const authDir = path.dirname(getAuthPath());
  fs.mkdirSync(authDir, { recursive: true });
  
  fs.writeFileSync(getAuthPath(), JSON.stringify(auth, null, 2), 'utf-8');
  
  // Secure permissions
  try {
    fs.chmodSync(getAuthPath(), 0o600);
  } catch {
    // Windows
  }
}

// ============================================================================
// Workspace Root Operations
// ============================================================================

/**
 * Get the workspace root from settings
 */
export function getWorkspaceRoot(): string {
  const settings = loadSettings();
  return settings.workspace.root || process.cwd();
}

/**
 * Set the workspace root in settings
 */
export function setWorkspaceRoot(workspacePath: string): void {
  const settings = loadSettings();
  settings.workspace.root = workspacePath;
  settings.workspace.lastOpened = new Date().toISOString();
  saveSettings(settings);
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Check if settings exist
 */
export function settingsExist(): boolean {
  return fs.existsSync(getSettingsPath());
}

/**
 * Get settings directory path (for display/debugging)
 */
export function getSettingsDir(): string {
  return resolveSettingsDir();
}

/**
 * Clear all settings (for logout/reset)
 */
export function clearSettings(): void {
  const settingsPath = getSettingsPath();
  const keysPath = getKeysPath();
  const authPath = getAuthPath();
  
  try {
    if (fs.existsSync(settingsPath)) fs.unlinkSync(settingsPath);
    if (fs.existsSync(keysPath)) fs.unlinkSync(keysPath);
    if (fs.existsSync(authPath)) fs.unlinkSync(authPath);
  } catch {
    // Ignore errors during cleanup
  }
}