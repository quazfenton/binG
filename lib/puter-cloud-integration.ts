/**
 * Bridge helpers: use Puter SDK when present, otherwise defer to a registered cloud plugin via __COMPOSIO_CALL__.
 */

export const puterFS = {
  async write(path: string, content: string) {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    const puter = typeof window !== 'undefined' ? (window as any).puter : undefined
    if (puter?.fs?.write) return puter.fs.write(path, content)
    if (typeof (window as any).__COMPOSIO_CALL__ === 'function') return (window as any).__COMPOSIO_CALL__('cloud.fs.write', { path, content })
    throw new Error('No Puter SDK or cloud plugin available to write files')
  },

  async read(path: string) {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    const puter = typeof window !== 'undefined' ? (window as any).puter : undefined
    if (puter?.fs?.read) return puter.fs.read(path)
    if (typeof (window as any).__COMPOSIO_CALL__ === 'function') return (window as any).__COMPOSIO_CALL__('cloud.fs.read', { path })
    throw new Error('No Puter SDK or cloud plugin available to read files')
  },

  async list(prefix = '') {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    const puter = typeof window !== 'undefined' ? (window as any).puter : undefined
    if (puter?.fs?.list) return puter.fs.list(prefix)
    if (typeof (window as any).__COMPOSIO_CALL__ === 'function') return (window as any).__COMPOSIO_CALL__('cloud.fs.list', { prefix })
    return []
  },
}

export const puterKV = {
  async set(key: string, value: string) {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    const puter = typeof window !== 'undefined' ? (window as any).puter : undefined
    if (puter?.kv?.set) return puter.kv.set(key, value)
    if (typeof (window as any).__COMPOSIO_CALL__ === 'function') return (window as any).__COMPOSIO_CALL__('cloud.kv.set', { key, value })
    throw new Error('No Puter SDK or cloud plugin available to set kv')
  },

  async get(key: string) {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    const puter = typeof window !== 'undefined' ? (window as any).puter : undefined
    if (puter?.kv?.get) return puter.kv.get(key)
    if (typeof (window as any).__COMPOSIO_CALL__ === 'function') return (window as any).__COMPOSIO_CALL__('cloud.kv.get', { key })
    return null
  },
}