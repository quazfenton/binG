/**
 * Desktop Secrets Implementation (Tauri Custom Commands)
 *
 * Uses custom Rust commands defined in desktop/src-tauri/
 * for secure storage via OS keychain/credential manager.
 *
 * On macOS: Keychain
 * On Windows: Credential Manager
 * On Linux: libsecret (GNOME Keyring / KDE Wallet)
 */

export interface SecretsAdapter {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

const SERVICE_NAME = 'binG';

async function getWebSecrets() {
  return import('./web');
}

class DesktopSecrets implements SecretsAdapter {
  async get(key: string): Promise<string | null> {
    try {
      const mod = await import('@tauri-apps/api/core');
      if (typeof mod?.invoke !== 'function') {
        throw new Error('Tauri invoke is unavailable');
      }
      return await mod.invoke<string>('get_secret', { service: SERVICE_NAME, key });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      // Missing secrets are expected — return null for not-found
      if (errorMsg.includes('not found') || errorMsg.includes('NotFound')) {
        return null;
      }
      // If Tauri isn't ready yet, fall back to the web adapter instead of failing boot.
      console.warn('[DesktopSecrets] Falling back to web secrets for get():', errorMsg);
      return getWebSecrets().then(({ secrets }) => secrets.get(key));
    }
  }

  async set(key: string, value: string): Promise<void> {
    try {
      const mod = await import('@tauri-apps/api/core');
      if (typeof mod?.invoke !== 'function') {
        throw new Error('Tauri invoke is unavailable');
      }
      await mod.invoke('set_secret', { service: SERVICE_NAME, key, value });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.warn('[DesktopSecrets] Falling back to web secrets for set():', errorMsg);
      const { secrets } = await getWebSecrets();
      await secrets.set(key, value);
    }
  }

  async remove(key: string): Promise<void> {
    try {
      const mod = await import('@tauri-apps/api/core');
      if (typeof mod?.invoke !== 'function') {
        throw new Error('Tauri invoke is unavailable');
      }
      await mod.invoke('delete_secret', { service: SERVICE_NAME, key });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.warn('[DesktopSecrets] Falling back to web secrets for remove():', errorMsg);
      const { secrets } = await getWebSecrets();
      await secrets.remove(key);
    }
  }
}

export const secrets = new DesktopSecrets();
export default secrets;
