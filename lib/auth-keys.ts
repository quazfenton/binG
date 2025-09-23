const STORAGE_KEY = 'binG:user_model_keys_v1'

export function saveUserApiKeyForModel(modelId: string, key: string) {
  const all = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
  all[modelId] = { key, createdAt: new Date().toISOString() }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all))
  return Promise.resolve()
}

export function getUserApiKeyForModel(modelId: string) {
  const all = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
  return all[modelId]?.key ?? ''
}

export function listUserModelKeys() {
  return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
}