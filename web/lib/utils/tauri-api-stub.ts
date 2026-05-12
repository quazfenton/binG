/**
 * Tauri API Stub for non-desktop (web) builds
 *
 * This stub is used when @tauri-apps/api is imported in a web context.
 * Desktop builds use the real Tauri APIs via dynamic imports inside `if (isDesktop)` blocks.
 */

const notAvailable = (name: string) => () => {
  throw new Error(`Tauri ${name}() is only available in desktop builds`);
};

export const invoke = notAvailable('invoke');
export const readTextFile = notAvailable('readTextFile');
export const writeTextFile = notAvailable('writeTextFile');
export const exists = notAvailable('exists');
export const mkdir = notAvailable('mkdir');
export const remove = notAvailable('remove');
export const rename = notAvailable('rename');
export const copyFile = notAvailable('copyFile');
export const readDir = notAvailable('readDir');
export const readFile = notAvailable('readFile');
export const writeFile = notAvailable('writeFile');

export const BaseDirectory = { app: 'app', data: 'data', config: 'config', home: 'home' };

export const ask = async () => false;
export const confirm = async () => false;
export const message = async () => {};
export const open = async () => null;
export const save = async () => null;

export const listen = async () => { throw new Error('Tauri listen() is only available in desktop builds'); };
export type UnlistenFn = () => void;

export const getCurrentWindow = notAvailable('getCurrentWindow') as any;
export const LogicalSize = class { constructor(public width: number, public height: number) {} };
export const LogicalPosition = class { constructor(public x: number, public y: number) {} };

export const appWindow = { listen: listen };

export const Command = { create: notAvailable('Command.create') };
export const spawn: any = notAvailable('spawn');