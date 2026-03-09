export type VirtualFilesystemNodeType = 'file' | 'directory';

export interface VirtualFile {
  path: string;
  content: string;
  language: string;
  lastModified: string;
  version: number;
  size: number;
}

export interface VirtualFilesystemNode {
  path: string;
  name: string;
  type: VirtualFilesystemNodeType;
  language?: string;
  lastModified?: string;
  size?: number;
}

export interface VirtualFilesystemDirectoryListing {
  path: string;
  nodes: VirtualFilesystemNode[];
}

export interface VirtualFilesystemSearchResult {
  path: string;
  name: string;
  language: string;
  score: number;
  snippet: string;
  lastModified: string;
}

export interface VirtualWorkspaceSnapshot {
  root: string;
  version: number;
  updatedAt: string;
  files: VirtualFile[];
}
