export type VirtualFilesystemNodeType = 'file' | 'directory';

export interface VirtualFile {
  path: string;
  content: string;
  language: string;
  lastModified: string;
  version: number;
  size: number;
  isDirectoryMarker?: boolean; // True for .directory marker files
  
  // Shadow commit system properties (for VFS sync and session tracking)
  commitId?: string;
  sessionId?: string | null;
  workspaceVersion?: number;
  previousVersion?: number | null;
}

export interface VirtualFilesystemNode {
  path: string;
  name: string;
  type: VirtualFilesystemNodeType;
  language?: string;
  lastModified?: string;
  size?: number;
  isExplicit?: boolean; // True for explicitly created directories (vs implicit from file paths)
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
