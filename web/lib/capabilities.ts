/**
 * Capability Registry
 * 
 * Declarative capability system replacing raw env flags.
 * Components query capabilities instead of checking isDesktop/isWeb.
 * Desktop overrides these defaults via platform init.
 * 
 * @module capabilities
 */

export type Capabilities = {
  fs: 'virtual' | 'local';
  vectorStore: 'memory' | 'sqlite' | 'remote';
  watcher: 'none' | 'polling' | 'native';
  compute: 'main' | 'worker' | 'rust';
  embedding: 'api' | 'local' | 'hash';
};

const defaults: Capabilities = {
  fs: 'virtual',
  vectorStore: 'memory',
  watcher: 'none',
  compute: 'main',
  embedding: 'hash',
};

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
