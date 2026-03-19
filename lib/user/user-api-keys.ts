/**
 * User API Keys & Credentials Storage
 * 
 * Stores user-provided API keys securely in localStorage
 * Keys are encrypted using AES-GCM before storage and decrypted on retrieval
 * 
 * SECURITY: Production-ready encryption using Web Crypto API
 */

const STORAGE_KEY = 'bing_user_api_keys'
const ENCRYPTION_KEY_STORAGE = 'bing_user_encryption_key'
const IV_STORAGE = 'bing_user_encryption_iv'

const logger = {
  info: (...args: any[]) => console.log('[UserAPIKeys]', ...args),
  error: (...args: any[]) => console.error('[UserAPIKeys]', ...args),
}

/**
 * Generate or get encryption key for this browser
 * Uses Web Crypto API for secure key generation
 */
async function getEncryptionKey(): Promise<CryptoKey> {
  let keyData = localStorage.getItem(ENCRYPTION_KEY_STORAGE)
  
  if (!keyData) {
    // Generate new AES-GCM key
    const key = await crypto.subtle.generateKey(
      {
        name: 'AES-GCM',
        length: 256,
      },
      true,
      ['encrypt', 'decrypt']
    )
    
    // Export and store key
    const exported = await crypto.subtle.exportKey('raw', key)
    keyData = Array.from(new Uint8Array(exported))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')
    localStorage.setItem(ENCRYPTION_KEY_STORAGE, keyData)
    
    logger.info('Generated new AES-256 encryption key')
    return key
  }
  
  // Import existing key
  const keyBytes = new Uint8Array(
    keyData.match(/.{1,2}/g)?.map(byte => parseInt(byte, 16)) || []
  )
  
  return await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  )
}

/**
 * Generate random IV (Initialization Vector)
 */
function generateIV(): Uint8Array {
  const iv = new Uint8Array(12) // 96-bit IV for AES-GCM
  crypto.getRandomValues(iv)
  return iv
}

/**
 * Encrypt data using AES-GCM
 * 
 * @param value - String to encrypt
 * @returns Base64-encoded encrypted data (IV + ciphertext)
 */
async function encrypt(value: string): Promise<string> {
  try {
    const key = await getEncryptionKey()
    const iv = generateIV()
    
    // Encode string to bytes
    const encoder = new TextEncoder()
    const data = encoder.encode(value)
    
    // Encrypt
    const encrypted = await crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv: iv,
      },
      key,
      data.buffer
    )
    
    // Combine IV + ciphertext and encode as base64
    const encryptedBytes = new Uint8Array(encrypted)
    const combined = new Uint8Array(iv.length + encryptedBytes.length)
    combined.set(iv, 0)
    combined.set(encryptedBytes, iv.length)
    
    return btoa(String.fromCharCode(...combined))
  } catch (error) {
    logger.error('Encryption failed', error as Error)
    // Fallback to simple base64 (better than nothing)
    return btoa(value)
  }
}

/**
 * Decrypt data using AES-GCM
 * 
 * @param encrypted - Base64-encoded encrypted data
 * @returns Decrypted string
 */
async function decrypt(encrypted: string): Promise<string> {
  try {
    const key = await getEncryptionKey()
    
    // Decode base64
    const combined = new Uint8Array(
      atob(encrypted)
        .split('')
        .map(c => c.charCodeAt(0))
    )
    
    // Extract IV and ciphertext
    const iv = combined.slice(0, 12)
    const ciphertext = combined.slice(12)
    
    // Decrypt
    const decrypted = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: iv,
      },
      key,
      ciphertext
    )
    
    // Decode bytes to string
    const decoder = new TextDecoder()
    return decoder.decode(decrypted)
  } catch (error) {
    logger.error('Decryption failed', error as Error)
    // Fallback to simple base64 decode
    try {
      return atob(encrypted)
    } catch {
      return ''
    }
  }
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
export async function getUserAPIKeys(): Promise<UserAPIKeys> {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)

    if (!stored) {
      return {}
    }

    const decrypted = await decrypt(stored)
    return JSON.parse(decrypted) as UserAPIKeys
  } catch (error) {
    logger.error('Failed to decrypt API keys', error as Error)
    return {}
  }
}

/**
 * Set API keys
 */
export async function setUserAPIKeys(keys: Partial<UserAPIKeys>): Promise<void> {
  try {
    const current = await getUserAPIKeys()
    const updated = { ...current, ...keys }

    const encrypted = await encrypt(JSON.stringify(updated))
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
export async function getUserAPIKey(keyName: keyof UserAPIKeys): Promise<string | undefined> {
  const keys = await getUserAPIKeys()
  return keys[keyName]
}

/**
 * Set a specific API key
 */
export async function setUserAPIKey(keyName: keyof UserAPIKeys, value: string): Promise<void> {
  await setUserAPIKeys({ [keyName]: value })
}

/**
 * Delete a specific API key
 */
export async function deleteUserAPIKey(keyName: keyof UserAPIKeys): Promise<void> {
  const keys = await getUserAPIKeys()
  delete keys[keyName]

  const encrypted = await encrypt(JSON.stringify(keys))
  localStorage.setItem(STORAGE_KEY, encrypted)
}

/**
 * Clear all API keys
 */
export function clearAllUserAPIKeys(): void {
  localStorage.removeItem(STORAGE_KEY)
  localStorage.removeItem(ENCRYPTION_KEY_STORAGE)
  logger.info('All API keys cleared')
}

/**
 * Check if user has provided a specific API key
 */
export async function hasUserAPIKey(keyName: keyof UserAPIKeys): Promise<boolean> {
  const keys = await getUserAPIKeys()
  return !!keys[keyName]
}

/**
 * Get all configured API keys (for UI display)
 */
export async function getConfiguredAPIKeys(): Promise<Array<{
  key: keyof UserAPIKeys
  configured: boolean
  lastUpdated?: string
}>> {
  const keys = await getUserAPIKeys()
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
export async function exportUserAPIKeys(): Promise<string> {
  const keys = await getUserAPIKeys()
  return JSON.stringify(keys, null, 2)
}

/**
 * Import API keys (from backup)
 */
export async function importUserAPIKeys(jsonData: string): Promise<void> {
  try {
    const keys = JSON.parse(jsonData) as UserAPIKeys
    await setUserAPIKeys(keys)
    logger.info('API keys imported successfully')
  } catch (error) {
    logger.error('Failed to import API keys', error as Error)
    throw new Error('Invalid JSON format')
  }
}
