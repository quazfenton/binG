/**
 * Simple in-memory VFS with sync read/write for WASM host calls.
 *
 * The WASM runner needs synchronous file operations because host imports
 * (host_read, host_write) are called from the wasm execution context where
 * async operations are not possible. This VFS wraps our main virtual
 * filesystem with a sync-compatible interface.
 */

class SimpleVFS {
  private store = new Map<string, string | Uint8Array>();

  writeSync(path: string, data: string | Uint8Array): void {
    this.store.set(path, data);
  }

  readSync(path: string): string {
    const content = this.store.get(path);
    if (content === undefined) {
      throw new Error(`File not found: ${path}`);
    }
    return typeof content === 'string' ? content : new TextDecoder().decode(content);
  }

  async write(path: string, data: string | Uint8Array): Promise<void> {
    this.store.set(path, data);
  }

  async read(path: string): Promise<string> {
    const content = this.store.get(path);
    if (content === undefined) {
      throw new Error(`File not found: ${path}`);
    }
    return typeof content === 'string' ? content : new TextDecoder().decode(content);
  }

  async list(prefix: string = ''): Promise<string[]> {
    return [...this.store.keys()].filter(k => k.startsWith(prefix));
  }

  existsSync(path: string): boolean {
    return this.store.has(path);
  }

  clear(): void {
    this.store.clear();
  }
}

export const globalVFS = new SimpleVFS();
