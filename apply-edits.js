#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

function applyEdits() {
  // 1. clipboard.ts - add thread-safety comment
  const clipboardPath = './packages/platform/src/clipboard.ts';
  let clipboard = fs.readFileSync(clipboardPath, 'utf8');
  clipboard = clipboard.replace(
    '  function getClipboard(): ClipboardAdapter {\n    if (!clipboardInstance) {\n      clipboardInstance = isDesktopMode()\n        ? new DesktopClipboard()\n        : new WebClipboard();\n    }\n    return clipboardInstance;\n  }',
    `  function getClipboard(): ClipboardAdapter {
    if (!clipboardInstance) {
      // Note: This lazy initialization is not thread-safe. In a multi-threaded or
      // async environment with rapid concurrent calls before first initialization,
      // multiple instances could be created. For most web use cases this is acceptable,
      // but consider using a lock mechanism or initializing at module load time if needed.
      clipboardInstance = isDesktopMode()
        ? new DesktopClipboard()
        : new WebClipboard();
    }
    return clipboardInstance;
  }`
  );
  fs.writeFileSync(clipboardPath, clipboard);
  console.log('✓ clipboard.ts updated');

  // 2. env.ts - better error handling and validation
  const envPath = './packages/platform/src/env.ts';
  let env = fs.readFileSync(envPath, 'utf8');
  env = env.replace(
    `  export function getDefaultWorkspaceRoot(): string | null {
  // Priority 1: explicit desktop/workspace launch env vars.
  if (typeof process !== 'undefined' && process.env) {
    const explicitRoot =
      process.env.INITIAL_CWD ||
      process.env.LAUNCH_CWD ||
      process.env.DESKTOP_WORKSPACE_ROOT;
    if (explicitRoot) {
      return explicitRoot;
    }
  }

  // Priority 2: CLI/standalone mode — use the process's actual working directory.
  // The parent process's cwd is the directory from which the CLI was invoked,
  // which is the correct workspace root (not the bundled binary's location).
  if (typeof process !== 'undefined' && process.cwd) {
    try {
      const cwd = process.cwd();
      if (cwd) {
        return cwd;
      }
    } catch {
      // process.cwd() may throw in some environments — fall through
    }
  }
  
  const platform = typeof process !== 'undefined' ? process.platform : 'linux';

  if (platform === 'win32') {
    const userProfile = typeof process !== 'undefined' && process.env ? process.env.USERPROFILE : undefined;
    if (!userProfile) {
      return null;
    }
    return \`\${userProfile}\\\\workspace\`;
  }

  const home = typeof process !== 'undefined' ? process.env.HOME : undefined;
  if (!home) {
    return null;
  }
  return \`\${home}/workspace\`;
}`, 
`  export function getDefaultWorkspaceRoot(): string | null {
  // Priority 1: explicit desktop/workspace launch env vars.
  if (typeof process !== 'undefined' && process.env) {
    const explicitRoot =
      process.env.INITIAL_CWD ||
      process.env.LAUNCH_CWD ||
      process.env.DESKTOP_WORKSPACE_ROOT;
    if (explicitRoot) {
      return explicitRoot;
    }
  }

  // Priority 2: CLI/standalone mode — use the process's actual working directory.
  // The parent process's cwd is the directory from which the CLI was invoked,
  // which is the correct workspace root (not the bundled binary's location).
  if (typeof process !== 'undefined' && process.cwd) {
    try {
      const cwd = process.cwd();
      if (cwd) {
        return cwd;
      }
    } catch (err) {
      // process.cwd() may throw in some environments (e.g., restricted context, permission denied)
      // Log for debugging but continue to fallback logic
      if (typeof console !== 'undefined') {
        console.warn('[env.ts] Failed to get process.cwd():', err);
      }
    }
  }
  
  const platform = typeof process !== 'undefined' ? process.platform : 'linux';

  if (platform === 'win32') {
    const userProfile = typeof process !== 'undefined' && process.env ? process.env.USERPROFILE : undefined;
    if (!userProfile || typeof userProfile !== 'string' || userProfile.trim() === '') {
      return null;
    }
    return \`\${userProfile}\\\\workspace\`;
  }

  const home = typeof process !== 'undefined' ? process.env.HOME : undefined;
  if (!home || typeof home !== 'string' || home.trim() === '') {
    return null;
  }
  return \`\${home}/workspace\`;
}`);
  fs.writeFileSync(envPath, env);
  console.log('✓ env.ts updated');

  // 3. fs/desktop.ts - add error handling to all methods
  const desktopFsPath = './packages/platform/src/fs/desktop.ts';
  let desktopFs = fs.readFileSync(desktopFsPath, 'utf8');
  
  desktopFs = desktopFs.replace(
    `  async readFile(pathOrFile: string | File): Promise<string> {
    if (typeof pathOrFile === 'string') {
      const { readTextFile, BaseDirectory } = await import('@tauri-apps/plugin-fs');
      return await readTextFile(pathOrFile, { baseDir: BaseDirectory.Home });
    }
    // Fallback for File object (drag-and-drop)
    return await pathOrFile.text();
  }
  
  async readBinaryFile(path: string): Promise<Uint8Array> {
    const { readBinaryFile, BaseDirectory } = await import('@tauri-apps/plugin-fs');
    return await readBinaryFile(path, { baseDir: BaseDirectory.Home });
  }
  
  async writeFile(path: string, content: string): Promise<void> {
    const { writeTextFile, BaseDirectory } = await import('@tauri-apps/plugin-fs');
    await writeTextFile(path, content, { baseDir: BaseDirectory.Home });
  }
  
  async writeBinaryFile(path: string, data: Uint8Array): Promise<void> {
    const { writeBinaryFile, BaseDirectory } = await import('@tauri-apps/plugin-fs');
    await writeBinaryFile(path, data, { baseDir: BaseDirectory.Home });
  }
  
  async readDir(path: string): Promise<{ name: string; isDirectory: boolean; size?: number }[]> {
    const { readDir, BaseDirectory } = await import('@tauri-apps/plugin-fs');
    const entries = await readDir(path, { baseDir: BaseDirectory.Home });
    return entries.map(e => ({
      name: e.name,
      isDirectory: e.isDirectory,
      size: (e as any).size,
    }));
  }
  
  async createDir(path: string, recursive = false): Promise<void> {
    const { mkdir, BaseDirectory } = await import('@tauri-apps/plugin-fs');
    await mkdir(path, { baseDir: BaseDirectory.Home, recursive });
  }
  
  async removeDir(path: string, recursive = false): Promise<void> {
    const { remove, BaseDirectory } = await import('@tauri-apps/plugin-fs');
    await remove(path, { baseDir: BaseDirectory.Home, recursive });
  }
  
  async removeFile(path: string): Promise<void> {
    const { remove, BaseDirectory } = await import('@tauri-apps/plugin-fs');
    await remove(path, { baseDir: BaseDirectory.Home });
  }`,
    `  async readFile(pathOrFile: string | File): Promise<string> {
    if (typeof pathOrFile === 'string') {
      try {
        const { readTextFile, BaseDirectory } = await import('@tauri-apps/plugin-fs');
        return await readTextFile(pathOrFile, { baseDir: BaseDirectory.Home });
      } catch (err) {
        throw new Error(\`Failed to read file \${pathOrFile}: \${err instanceof Error ? err.message : String(err)}\`);
      }
    }
    // Fallback for File object (drag-and-drop)
    try {
      return await pathOrFile.text();
    } catch (err) {
      throw new Error(\`Failed to read File object: \${err instanceof Error ? err.message : String(err)}\`);
    }
  }
  
  async readBinaryFile(path: string): Promise<Uint8Array> {
    try {
      const { readBinaryFile, BaseDirectory } = await import('@tauri-apps/plugin-fs');
      return await readBinaryFile(path, { baseDir: BaseDirectory.Home });
    } catch (err) {
      throw new Error(\`Failed to read binary file \${path}: \${err instanceof Error ? err.message : String(err)}\`);
    }
  }
  
  async writeFile(path: string, content: string): Promise<void> {
    try {
      const { writeTextFile, BaseDirectory } = await import('@tauri-apps/plugin-fs');
      await writeTextFile(path, content, { baseDir: BaseDirectory.Home });
    } catch (err) {
      throw new Error(\`Failed to write file \${path}: \${err instanceof Error ? err.message : String(err)}\`);
    }
  }
  
  async writeBinaryFile(path: string, data: Uint8Array): Promise<void> {
    try {
      const { writeBinaryFile, BaseDirectory } = await import('@tauri-apps/plugin-fs');
      await writeBinaryFile(path, data, { baseDir: BaseDirectory.Home });
    } catch (err) {
      throw new Error(\`Failed to write binary file \${path}: \${err instanceof Error ? err.message : String(err)}\`);
    }
  }
  
  async readDir(path: string): Promise<{ name: string; isDirectory: boolean; size?: number }[]> {
    try {
      const { readDir, BaseDirectory } = await import('@tauri-apps/plugin-fs');
      const entries = await readDir(path, { baseDir: BaseDirectory.Home });
      return entries.map(e => {
        // Validate entry structure before accessing properties
        if (!e || typeof e.name !== 'string' || typeof e.isDirectory !== 'boolean') {
          throw new Error(\`Invalid directory entry structure: missing required fields\`);
        }
        return {
          name: e.name,
          isDirectory: e.isDirectory,
          size: typeof (e as any).size === 'number' ? (e as any).size : undefined,
        };
      });
    } catch (err) {
      throw new Error(\`Failed to read directory \${path}: \${err instanceof Error ? err.message : String(err)}\`);
    }
  }
  
  async createDir(path: string, recursive = false): Promise<void> {
    try {
      const { mkdir, BaseDirectory } = await import('@tauri-apps/plugin-fs');
      await mkdir(path, { baseDir: BaseDirectory.Home, recursive });
    } catch (err) {
      throw new Error(\`Failed to create directory \${path}: \${err instanceof Error ? err.message : String(err)}\`);
    }
  }
  
  async removeDir(path: string, recursive = false): Promise<void> {
    try {
      const { remove, BaseDirectory } = await import('@tauri-apps/plugin-fs');
      await remove(path, { baseDir: BaseDirectory.Home, recursive });
    } catch (err) {
      throw new Error(\`Failed to remove directory \${path}: \${err instanceof Error ? err.message : String(err)}\`);
    }
  }
  
  async removeFile(path: string): Promise<void> {
    try {
      const { remove, BaseDirectory } = await import('@tauri-apps/plugin-fs');
      await remove(path, { baseDir: BaseDirectory.Home });
    } catch (err) {
      throw new Error(\`Failed to remove file \${path}: \${err instanceof Error ? err.message : String(err)}\`);
    }
  }`
  );
  
  // fs/index.ts - add error handling with proper validation
  desktopFs = desktopFs.replace(
    `  async exists(path: string): Promise<boolean> {
    const { exists, BaseDirectory } = await import('@tauri-apps/plugin-fs');
    return await exists(path, { baseDir: BaseDirectory.Home });
  }
  
  async copyFile(src: string, dest: string): Promise<void> {
    const { copyFile, BaseDirectory } = await import('@tauri-apps/plugin-fs');
    await copyFile(src, dest, { baseDir: BaseDirectory.Home });
  }
  
  async openFileDialog(options?: { accept?: string; multiple?: boolean }): Promise<File[] | string[]> {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const result = await open({
      multiple: options?.multiple ?? false,
      directory: false,
    });

    if (Array.isArray(result)) {
      return result as string[];
    } else if (typeof result === 'string') {
      return [result];
    }
    return [];
  }
  
  async saveFileDialog(options?: { defaultPath?: string }): Promise<string | null> {
    const { save } = await import('@tauri-apps/plugin-dialog');
    return await save({
      defaultPath: options?.defaultPath,
    });
  }`,
    `  async exists(path: string): Promise<boolean> {
    try {
      const { exists, BaseDirectory } = await import('@tauri-apps/plugin-fs');
      return await exists(path, { baseDir: BaseDirectory.Home });
    } catch (err) {
      throw new Error(\`Failed to check if file exists \${path}: \${err instanceof Error ? err.message : String(err)}\`);
    }
  }
  
  async copyFile(src: string, dest: string): Promise<void> {
    try {
      const { copyFile, BaseDirectory } = await import('@tauri-apps/plugin-fs');
      await copyFile(src, dest, { baseDir: BaseDirectory.Home });
    } catch (err) {
      throw new Error(\`Failed to copy file from \${src} to \${dest}: \${err instanceof Error ? err.message : String(err)}\`);
    }
  }
  
  async openFileDialog(options?: { accept?: string; multiple?: boolean }): Promise<File[] | string[]> {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const result = await open({
        multiple: options?.multiple ?? false,
        directory: false,
      });

      if (Array.isArray(result)) {
        return result as string[];
      } else if (typeof result === 'string') {
        return [result];
      }
      return [];
    } catch (err) {
      throw new Error(\`Failed to open file dialog: \${err instanceof Error ? err.message : String(err)}\`);
    }
  }
  
  async saveFileDialog(options?: { defaultPath?: string }): Promise<string | null> {
    try {
      const { save } = await import('@tauri-apps/plugin-dialog');
      return await save({
        defaultPath: options?.defaultPath,
      });
    } catch (err) {
      throw new Error(\`Failed to save file dialog: \${err instanceof Error ? err.message : String(err)}\`);
    }
  }`
  );
  fs.writeFileSync(desktopFsPath, desktopFs);
  console.log('✓ fs/desktop.ts updated');

  // 4. fs/web.ts - defer URL revocation and fix null handling
  const webFsPath = './packages/platform/src/fs/web.ts';
  let webFs = fs.readFileSync(webFsPath, 'utf8');
  webFs = webFs.replace(
    `  downloadFile(content: string, filename: string, mimeType = 'text/plain'): void {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }`,
    `  downloadFile(content: string, filename: string, mimeType = 'text/plain'): void {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // Defer URL revocation to reduce risk of premature revocation before download starts
    setTimeout(() => URL.revokeObjectURL(url), 100);
  }`
  );
  webFs = webFs.replace(
    `  const settle = (files: File[]) => {`,
    `  const settle = (files: File[] | null) => {`
  );
  webFs = webFs.replace(
    `  resolve(files);`,
    `  resolve(files || []);`
  );
  webFs = webFs.replace(
    `  const onWindowFocus = () => settle(Array.from(input.files || []));`,
    `  const onWindowFocus = () => {
      // When window regains focus, explicitly check if files were actually selected
      // (empty result indicates cancellation, not successful empty selection)
      const files = input.files ? Array.from(input.files) : [];
      settle(files.length > 0 ? files : null);
    };`
  );
  fs.writeFileSync(webFsPath, webFs);
  console.log('✓ fs/web.ts updated');

  // 5. fs/index.ts - add proper null checks for optional methods
  const fsIndexPath = './packages/platform/src/fs/index.ts';
  let fsIndex = fs.readFileSync(fsIndexPath, 'utf8');
  fsIndex = fsIndex.replace(
    `  readBinaryFile: async (path: string) => (await getFs()).readBinaryFile?.(path),
  writeFile: async (path: string, content: string) => (await getFs()).writeFile?.(path, content),
  writeBinaryFile: async (path: string, data: Uint8Array) => (await getFs()).writeBinaryFile?.(path, data),
  readDir: async (path: string) => (await getFs()).readDir?.(path),
  createDir: async (path: string, recursive?: boolean) => (await getFs()).createDir?.(path, recursive),
  removeDir: async (path: string, recursive?: boolean) => (await getFs()).removeDir?.(path, recursive),
  removeFile: async (path: string) => (await getFs()).removeFile?.(path),
  exists: async (path: string) => (await getFs()).exists?.(path),
  copyFile: async (src: string, dest: string) => (await getFs()).copyFile?.(src, dest),
  openFileDialog: async (options?: { accept?: string; multiple?: boolean }) => (await
  getFs()).openFileDialog(options),
  saveFileDialog: async (options?: { defaultPath?: string }) => (await getFs()).saveFileDialog?.(options),
  // Web-only methods
  readAsDataURL: async (file: File) => (await getFs()).readAsDataURL?.(file),
  readAsArrayBuffer: async (file: File) => (await getFs()).readAsArrayBuffer?.(file),
  downloadFile: async (content: string, filename: string, mimeType?: string) => (await
  getFs()).downloadFile?.(content, filename, mimeType),`,
    `  readBinaryFile: async (path: string) => {
    const adapter = await getFs();
    if (!adapter.readBinaryFile) throw new Error('readBinaryFile is not supported on this platform');
    return adapter.readBinaryFile(path);
  },
  writeFile: async (path: string, content: string) => {
    const adapter = await getFs();
    if (!adapter.writeFile) throw new Error('writeFile is not supported on this platform');
    return adapter.writeFile(path, content);
  },
  writeBinaryFile: async (path: string, data: Uint8Array) => {
    const adapter = await getFs();
    if (!adapter.writeBinaryFile) throw new Error('writeBinaryFile is not supported on this platform');
    return adapter.writeBinaryFile(path, data);
  },
  readDir: async (path: string) => {
    const adapter = await getFs();
    if (!adapter.readDir) throw new Error('readDir is not supported on this platform');
    return adapter.readDir(path);
  },
  createDir: async (path: string, recursive?: boolean) => {
    const adapter = await getFs();
    if (!adapter.createDir) throw new Error('createDir is not supported on this platform');
    return adapter.createDir(path, recursive);
  },
  removeDir: async (path: string, recursive?: boolean) => {
    const adapter = await getFs();
    if (!adapter.removeDir) throw new Error('removeDir is not supported on this platform');
    return adapter.removeDir(path, recursive);
  },
  removeFile: async (path: string) => {
    const adapter = await getFs();
    if (!adapter.removeFile) throw new Error('removeFile is not supported on this platform');
    return adapter.removeFile(path);
  },
  exists: async (path: string) => {
    const adapter = await getFs();
    if (!adapter.exists) throw new Error('exists is not supported on this platform');
    return adapter.exists(path);
  },
  copyFile: async (src: string, dest: string) => {
    const adapter = await getFs();
    if (!adapter.copyFile) throw new Error('copyFile is not supported on this platform');
    return adapter.copyFile(src, dest);
  },
  openFileDialog: async (options?: { accept?: string; multiple?: boolean }) => (await getFs()).openFileDialog(options),
  saveFileDialog: async (options?: { defaultPath?: string }) => {
    const adapter = await getFs();
    if (!adapter.saveFileDialog) throw new Error('saveFileDialog is not supported on this platform');
    return adapter.saveFileDialog(options);
  },
  // Web-only methods
  readAsDataURL: async (file: File) => {
    const adapter = await getFs();
    if (!adapter.readAsDataURL) throw new Error('readAsDataURL is not supported on this platform');
    return adapter.readAsDataURL(file);
  },
  readAsArrayBuffer: async (file: File) => {
    const adapter = await getFs();
    if (!adapter.readAsArrayBuffer) throw new Error('readAsArrayBuffer is not supported on this platform');
    return adapter.readAsArrayBuffer(file);
  },
  downloadFile: async (content: string, filename: string, mimeType?: string) => {
    const adapter = await getFs();
    if (!adapter.downloadFile) throw new Error('downloadFile is not supported on this platform');
    return adapter.downloadFile(content, filename, mimeType);
  },`
  );
  fs.writeFileSync(fsIndexPath, fsIndex);
  console.log('✓ fs/index.ts updated');

  console.log('\\nAll edits applied successfully!');
}

applyEdits();
