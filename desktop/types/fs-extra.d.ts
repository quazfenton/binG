declare module 'fs-extra' {
  import type { Dirent, PathLike, Stats, StatOptions, ReadableStream } from 'fs';
  export * from 'fs';
  export function readFile(path: PathLike, encoding: string): Promise<string>;
  export function writeFile(path: PathLike, data: string, encoding: string): Promise<void>;
  export function remove(path: PathLike): Promise<void>;
  export function pathExists(path: PathLike): Promise<boolean>;
  export function ensureDir(path: PathLike): Promise<void>;
  export function copy(src: PathLike, dest: PathLike): Promise<void>;
  export function readdir(path: PathLike, opts?: { withFileTypes?: false }): Promise<string[]>;
  export function readdir(path: PathLike, opts: { withFileTypes: true }): Promise<Dirent[]>;
  export function readdir(path: PathLike, opts?: { withFileTypes?: boolean; encoding?: string; recursive?: boolean }): Promise<string[] | Dirent[]>;
}