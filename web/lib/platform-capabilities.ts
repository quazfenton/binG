/**
 * Platform Capabilities
 * 
 * Declarative runtime-environment registry replacing raw env flags.
 * Components query platform capabilities (fs type, vector backend, etc.)
 * instead of checking isDesktop/isWeb.
 * Desktop overrides these defaults via platform init.
 * 
 * NOTE: This is separate from tools/capabilities.ts which defines
 * agent tool-routing capabilities (file.read, sandbox.execute, etc.).
 * 
 * @module platform-capabilities
 */

export type Capabilities = {
  fs: 'virtual' | 'local';
  vectorStore: 'memory' | 'sqlite' | 'remote';
  watcher: 'none' | 'polling' | 'native';
  compute: 'main' | 'worker' | 'rust';
  embedding: 'api' | 'local' | 'hash';
  /** Native shell access (bash/powershell) via Tauri invoke */
  nativeShell: boolean;
  /** Native dialogs (file/folder picker) via Tauri */
  nativeDialogs: boolean;
  /** System monitoring (CPU, memory, disk) via Tauri */
  systemMonitoring: boolean;
};

const defaults: Capabilities = {
  fs: 'virtual',
  vectorStore: 'memory',
  watcher: 'none',
  compute: 'main',
  embedding: 'hash',
  nativeShell: false,
  nativeDialogs: false,
  systemMonitoring: false,
};

// Auto-detect desktop capabilities
if (typeof process !== 'undefined' && process.env) {
  const isDesktop = process.env.DESKTOP_MODE === 'true' || process.env.DESKTOP_LOCAL_EXECUTION === 'true';
  if (isDesktop) {
    defaults.nativeShell = true;
    defaults.nativeDialogs = true;
    defaults.systemMonitoring = true;
    defaults.fs = 'local';
  }
}

let current: Capabilities = { ...defaults };

export function getCapabilities(): Readonly<Capabilities> {
  return current;
}

export function setCapabilities(overrides: Partial<Capabilities>): void {
  current = { ...current, ...overrides };
}

export function resetCapabilities(): void {
  current = { ...defaults };
}

export function hasCapability<K extends keyof Capabilities>(
  key: K,
  value: Capabilities[K]
): boolean {
  return current[key] === value;
}
