/**
 * Web Secrets Implementation (localStorage - NOT SECURE)
 *
 * WARNING: This is NOT secure. Use only for development/testing.
 * In production web, use a proper backend or secure credential manager.
 */

export interface SecretsAdapter {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

const SECRET_PREFIX = '__secret__';

class WebSecrets implements SecretsAdapter {
  async get(key: string): Promise<string | null> {
    try {
      return localStorage.getItem(`${SECRET_PREFIX}${key}`);
    } catch {
      return null;
    }
  }

  async set(key: string, value: string): Promise<void> {
    localStorage.setItem(`${SECRET_PREFIX}${key}`, value);
  }

  async remove(key: string): Promise<void> {
    localStorage.removeItem(`${SECRET_PREFIX}${key}`);
  }
}

export const secrets = new WebSecrets();
export default secrets;
