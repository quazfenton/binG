/**
 * User API Keys & Credentials Storage
 * 
 * Stores user-provided API keys securely in localStorage
 * Keys are encrypted before storage and decrypted on retrieval
 */

const STORAGE_KEY = 'bing_user_api_keys'
const ENCRYPTION_KEY_STORAGE = 'bing_user_keys_salt'

const logger = {
  info: (...args: any[]) => console.log('[UserAPIKeys]', ...args),
  error: (...args: any[]) => console.error('[UserAPIKeys]', ...args),
}

/**
 * Get or generate encryption salt for this browser
 */
function getEncryptionSalt(): string {
  let salt = localStorage.getItem(ENCRYPTION_KEY_STORAGE)
  
  if (!salt) {
    // Generate random salt
    const array = new Uint8Array(32)
    crypto.getRandomValues(array)
    salt = Array.from(array)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')
    localStorage.setItem(ENCRYPTION_KEY_STORAGE, salt)
  }
  
  return salt
}

/**
 * Simple XOR encryption for localStorage (NOT for production security)
 * For production, use proper encryption with user password
 */
function encrypt(value: string): string {
  const salt = getEncryptionSalt()
  let result = ''
  
  for (let i = 0; i < value.length; i++) {
    const saltChar = salt[i % salt.length]
    const xorValue = value.charCodeAt(i) ^ saltChar.charCodeAt(0)
    result += String.fromCharCode(xorValue)
  }
  
  return btoa(result)
}

function decrypt(encrypted: string): string {
  const salt = getEncryptionSalt()
  const decoded = atob(encrypted)
  let result = ''
  
  for (let i = 0; i < decoded.length; i++) {
    const saltChar = salt[i % salt.length]
    const xorValue = decoded.charCodeAt(i) ^ saltChar.charCodeAt(0)
    result += String.fromCharCode(xorValue)
  }
  
  return result
}

/**
 * User API Keys interface
 */
export interface UserAPIKeys {
  // LLM Providers
  openai_api_key?: string
  anthropic_api_key?: string
  google_api_key?: string
  mistral_api_key?: string
  together_api_key?: string
  replicate_api_token?: string
  openrouter_api_key?: string
  
  // MCP & Tools
  composio_api_key?: string
  nango_api_key?: string
  
  // OAuth Tokens (stored separately)
  notion_oauth_token?: string
  slack_oauth_token?: string
  github_oauth_token?: string
  google_oauth_token?: string
  
  // Other Services
  serper_api_key?: string
  exa_api_key?: string
}

/**
 * Get all stored API keys
 */
export function getUserAPIKeys(): UserAPIKeys {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    
    if (!stored) {
      return {}
    }
    
    const decrypted = decrypt(stored)
    return JSON.parse(decrypted) as UserAPIKeys
  } catch (error) {
    logger.error('Failed to decrypt API keys', error as Error)
    return {}
  }
}

/**
 * Set API keys
 */
export function setUserAPIKeys(keys: Partial<UserAPIKeys>): void {
  try {
    const current = getUserAPIKeys()
    const updated = { ...current, ...keys }
    
    const encrypted = encrypt(JSON.stringify(updated))
    localStorage.setItem(STORAGE_KEY, encrypted)
    
    logger.info('API keys updated successfully')
  } catch (error) {
    logger.error('Failed to store API keys', error as Error)
    throw new Error('Failed to store API keys')
  }
}

/**
 * Get a specific API key
 */
export function getUserAPIKey(keyName: keyof UserAPIKeys): string | undefined {
  const keys = getUserAPIKeys()
  return keys[keyName]
}

/**
 * Set a specific API key
 */
export function setUserAPIKey(keyName: keyof UserAPIKeys, value: string): void {
  setUserAPIKeys({ [keyName]: value })
}

/**
 * Delete a specific API key
 */
export function deleteUserAPIKey(keyName: keyof UserAPIKeys): void {
  const keys = getUserAPIKeys()
  delete keys[keyName]
  
  const encrypted = encrypt(JSON.stringify(keys))
  localStorage.setItem(STORAGE_KEY, encrypted)
}

/**
 * Clear all API keys
 */
export function clearAllUserAPIKeys(): void {
  localStorage.removeItem(STORAGE_KEY)
  logger.info('All API keys cleared')
}

/**
 * Check if user has provided a specific API key
 */
export function hasUserAPIKey(keyName: keyof UserAPIKeys): boolean {
  const keys = getUserAPIKeys()
  return !!keys[keyName]
}

/**
 * Get all configured API keys (for UI display)
 */
export function getConfiguredAPIKeys(): Array<{
  key: keyof UserAPIKeys
  configured: boolean
  lastUpdated?: string
}> {
  const keys = getUserAPIKeys()
  const allKeys: (keyof UserAPIKeys)[] = [
    'openai_api_key',
    'anthropic_api_key',
    'google_api_key',
    'mistral_api_key',
    'together_api_key',
    'replicate_api_token',
    'openrouter_api_key',
    'composio_api_key',
    'nango_api_key',
    'notion_oauth_token',
    'slack_oauth_token',
    'github_oauth_token',
    'google_oauth_token',
    'serper_api_key',
    'exa_api_key',
  ]
  
  return allKeys.map(key => ({
    key,
    configured: !!keys[key],
  }))
}

/**
 * Export API keys (for backup)
 */
export function exportUserAPIKeys(): string {
  const keys = getUserAPIKeys()
  return JSON.stringify(keys, null, 2)
}

/**
 * Import API keys (from backup)
 */
export function importUserAPIKeys(jsonData: string): void {
  try {
    const keys = JSON.parse(jsonData) as UserAPIKeys
    setUserAPIKeys(keys)
    logger.info('API keys imported successfully')
  } catch (error) {
    logger.error('Failed to import API keys', error as Error)
    throw new Error('Invalid JSON format')
  }
}
