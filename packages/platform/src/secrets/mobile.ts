/**
 * Mobile Secrets Implementation (expo-secure-store)
 *
 * Uses the device's secure keychain/keystore:
 * - iOS: Keychain
 * - Android: Keystore
 *
 * This is cryptographically secure.
 */

import * as SecureStore from 'expo-secure-store';
import type { SecretsAdapter } from './index';

class MobileSecrets implements SecretsAdapter {
  async get(key: string): Promise<string | null> {
    try {
      return await SecureStore.getItemAsync(key);
    } catch {
      return null;
    }
  }

  async set(key: string, value: string): Promise<void> {
    await SecureStore.setItemAsync(key, value);
  }

  async remove(key: string): Promise<void> {
    try {
      await SecureStore.deleteItemAsync(key);
    } catch {
      // Item may not exist - ignore
    }
  }
}

export const secrets = new MobileSecrets();
export default secrets;
