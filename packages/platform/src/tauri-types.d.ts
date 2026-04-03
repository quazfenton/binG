/**
 * Tauri Module Type Declarations
 *
 * These declarations suppress TypeScript errors for Tauri packages
 * that are only available in the desktop (tauri/) subfolder.
 *
 * The actual imports use dynamic import() which only executes at runtime
 * when running in a Tauri desktop environment.
 */

declare module '@tauri-apps/api/core' {
  export function invoke<T>(command: string, payload?: Record<string, unknown>): Promise<T>;
}

declare module '@tauri-apps/api/window' {
  export class LogicalSize {
    constructor(width: number, height: number);
  }
  export class LogicalPosition {
    constructor(x: number, y: number);
  }
  export interface WindowOptions {
    title?: string;
    width?: number;
    height?: number;
  }
  export function getCurrentWindow(): {
    setTitle: (title: string) => Promise<void>;
    setSize: (size: LogicalSize) => Promise<void>;
    setPosition: (pos: LogicalPosition) => Promise<void>;
    minimize: () => Promise<void>;
    maximize: () => Promise<void>;
    isFullscreen: () => Promise<boolean>;
    setFullscreen: (fullscreen: boolean) => Promise<void>;
    close: () => Promise<void>;
    isFocused: () => Promise<boolean>;
    setFocus: () => Promise<void>;
  };
}

declare module '@tauri-apps/plugin-fs' {
  export enum BaseDirectory {
    Home = 1,
    AppData = 2,
  }
  export interface FsOptions {
    baseDir?: BaseDirectory;
    recursive?: boolean;
  }
  export function readTextFile(path: string, options?: FsOptions): Promise<string>;
  export function readBinaryFile(path: string, options?: FsOptions): Promise<Uint8Array>;
  export function writeTextFile(path: string, content: string, options?: FsOptions): Promise<void>;
  export function writeBinaryFile(path: string, data: Uint8Array, options?: FsOptions): Promise<void>;
  export function mkdir(path: string, options?: FsOptions): Promise<void>;
  export function remove(path: string, options?: FsOptions): Promise<void>;
  export function exists(path: string, options?: FsOptions): Promise<boolean>;
  export function copyFile(src: string, dest: string, options?: FsOptions): Promise<void>;
  export function readDir(path: string, options?: FsOptions): Promise<{ name: string; isDirectory: boolean; size?: number }[]>;
}

declare module '@tauri-apps/plugin-dialog' {
  export interface OpenDialogOptions {
    multiple?: boolean;
    directory?: boolean;
    filters?: { name: string; extensions: string[] }[];
  }
  export interface SaveDialogOptions {
    defaultPath?: string;
    filters?: { name: string; extensions: string[] }[];
  }
  export function open(options?: OpenDialogOptions): Promise<string | string[] | null>;
  export function save(options?: SaveDialogOptions): Promise<string | null>;
}

declare module '@tauri-apps/plugin-clipboard-manager' {
  export function readText(): Promise<string>;
  export function writeText(text: string): Promise<void>;
  export function readFiles(): Promise<string[]>;
  export function writeFiles(paths: string[]): Promise<void>;
  export function clear(): Promise<void>;
}

declare module '@tauri-apps/plugin-secure-store' {
  export function get(service: string, key: string): Promise<string | null>;
  export function set(service: string, key: string, value: string): Promise<void>;
  export function remove(service: string, key: string): Promise<void>;
}

declare module '@tauri-apps/plugin-notification' {
  export interface NotificationOptions {
    title: string;
    body?: string;
    icon?: string;
  }
  export function sendNotification(options: NotificationOptions): Promise<void>;
}
