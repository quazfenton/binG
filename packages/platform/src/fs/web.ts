/**
 * Web File System Implementation
 *
 * Browser-based file operations using File API and drag-and-drop.
 */

export interface FsAdapter {
  readFile(input: string | File): Promise<string>;
  readBinaryFile?(path: string): Promise<Uint8Array>;
  writeFile?(path: string, content: string): Promise<void>;
  writeBinaryFile?(path: string, data: Uint8Array): Promise<void>;
  readDir?(path: string): Promise<{ name: string; isDirectory: boolean; size?: number }[]>;
  createDir?(path: string, recursive?: boolean): Promise<void>;
  removeDir?(path: string, recursive?: boolean): Promise<void>;
  removeFile?(path: string): Promise<void>;
  exists?(path: string): Promise<boolean>;
  copyFile?(src: string, dest: string): Promise<void>;
  openFileDialog(options?: { accept?: string; multiple?: boolean }): Promise<File[] | string[]>;
  saveFileDialog?(options?: { defaultPath?: string }): Promise<string | null>;
  // Web-only methods (optional for desktop)
  readAsDataURL?(file: File): Promise<string>;
  readAsArrayBuffer?(file: File): Promise<ArrayBuffer>;
  downloadFile?(content: string, filename: string, mimeType?: string): void;
}

class WebFs implements FsAdapter {
  async readFile(input: string | File): Promise<string> {
    if (typeof input === 'string') {
      throw new Error('Web fs readFile requires a File object, not a path string');
    }
    return await input.text();
  }

  async readAsDataURL(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async readAsArrayBuffer(file: File): Promise<ArrayBuffer> {
    return await file.arrayBuffer();
  }

  downloadFile(content: string, filename: string, mimeType = 'text/plain'): void {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  openFileDialog(options?: { accept?: string; multiple?: boolean }): Promise<File[]> {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = options?.accept ?? '*';
      input.multiple = options?.multiple ?? false;

      const cleanup = () => {
        window.removeEventListener('focus', onWindowFocus);
        input.remove();
      };

      const onWindowFocus = () => {
        cleanup();
        resolve(Array.from(input.files || []));
      };

      input.onchange = () => {
        cleanup();
        const files = Array.from(input.files || []);
        resolve(files);
      };

      window.addEventListener('focus', onWindowFocus, { once: true });
      input.click();
    });
  }
}

export const fs = new WebFs();
export default fs;
