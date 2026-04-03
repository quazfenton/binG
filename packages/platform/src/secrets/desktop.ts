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

class DesktopSecrets implements SecretsAdapter {
  async get(key: string): Promise<string | null> {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      return await invoke<string>('get_secret', { service: SERVICE_NAME, key });
    } catch {
      return null;
    }
  }

  async set(key: string, value: string): Promise<void> {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('set_secret', { service: SERVICE_NAME, key, value });
    } catch (error) {
      console.error('[DesktopSecrets] Failed to set secret:', error);
      throw error;
    }
  }

  async remove(key: string): Promise<void> {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('delete_secret', { service: SERVICE_NAME, key });
    } catch (error) {
      console.error('[DesktopSecrets] Failed to remove secret:', error);
      throw error;
    }
  }
}

export const secrets = new DesktopSecrets();
export default secrets;
