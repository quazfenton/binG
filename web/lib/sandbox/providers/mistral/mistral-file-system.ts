/**
 * Mistral Virtual Filesystem
 * 
 * Emulates filesystem operations in the Mistral sandbox environment.
 * Additive module that provides file/directory operations via code execution.
 * 
 * Features:
 * - Virtual file storage
 * - Directory management
 * - File read/write operations
 * - Path resolution
 * - Sync with Mistral conversation context
 */

import type { ToolResult } from '../../types'
import type { Mistral } from '@mistralai/mistralai'

export interface VirtualFile {
  path: string
  content: string
  size: number
  createdAt: number
  modifiedAt: number
  encoding?: string
}

export interface VirtualDirectory {
  path: string
  entries: string[]
  createdAt: number
}

export interface FilesystemStats {
  totalFiles: number
  totalDirectories: number
  totalSize: number
  filesByExtension: Record<string, number>
}

export class MistralVirtualFilesystem {
  private files: Map<string, VirtualFile> = new Map<string, VirtualFile>()
  private directories: Map<string, VirtualDirectory> = new Map<string, VirtualDirectory>()
  private workspaceRoot: string
  private stats: FilesystemStats

  constructor(workspaceRoot: string = '/workspace') {
    this.workspaceRoot = workspaceRoot
    this.initializeRootDirectory()
    this.stats = {
      totalFiles: 0,
      totalDirectories: 1,
      totalSize: 0,
      filesByExtension: {},
    }
  }

  /**
   * Write file to virtual filesystem
   */
  async writeFile(
    filePath: string,
    content: string,
    options?: { encoding?: string }
  ): Promise<ToolResult> {
    try {
      const fullPath = this.resolvePath(filePath)
      const now = Date.now()

      // Check if file exists
      const existingFile = this.files.get(fullPath)
      
      const file: VirtualFile = {
        path: fullPath,
        content,
        size: content.length,
        createdAt: existingFile?.createdAt || now,
        modifiedAt: now,
        encoding: options?.encoding || 'utf-8',
      }

      this.files.set(fullPath, file)

      // Update parent directory
      this.ensureParentDirectoryExists(fullPath)

      // Update stats
      if (!existingFile) {
        this.stats.totalFiles++
        this.stats.totalSize += content.length
        
        const ext = this.getFileExtension(filePath)
        this.stats.filesByExtension[ext] = 
          (this.stats.filesByExtension[ext] || 0) + 1
      } else {
        this.stats.totalSize += content.length - existingFile.size
      }

      return {
        success: true,
        output: `File written: ${fullPath} (${content.length} bytes)`,
        exitCode: 0,
      }
    } catch (error: any) {
      return {
        success: false,
        output: `Failed to write file: ${error.message}`,
        exitCode: 1,
      }
    }
  }

  /**
   * Read file from virtual filesystem
   */
  async readFile(filePath: string): Promise<ToolResult> {
    try {
      const fullPath = this.resolvePath(filePath)
      const file = this.files.get(fullPath)

      if (!file) {
        return {
          success: false,
          output: `File not found: ${filePath}`,
          exitCode: 1,
        }
      }

      return {
        success: true,
        output: file.content,
        exitCode: 0,
      }
    } catch (error: any) {
      return {
        success: false,
        output: `Failed to read file: ${error.message}`,
        exitCode: 1,
      }
    }
  }

  /**
   * Delete file
   */
  async deleteFile(filePath: string): Promise<ToolResult> {
    try {
      const fullPath = this.resolvePath(filePath)
      
      if (!this.files.has(fullPath)) {
        return {
          success: false,
          output: `File not found: ${filePath}`,
          exitCode: 1,
        }
      }

      const file = this.files.get(fullPath)!
      this.files.delete(fullPath)
      this.stats.totalFiles--
      this.stats.totalSize -= file.size

      // Remove from parent directory
      const parentDir = this.getParentDirectory(fullPath)
      const dir = this.directories.get(parentDir)
      if (dir) {
        dir.entries = dir.entries.filter(entry => entry !== filePath)
      }

      return {
        success: true,
        output: `File deleted: ${filePath}`,
        exitCode: 0,
      }
    } catch (error: any) {
      return {
        success: false,
        output: `Failed to delete file: ${error.message}`,
        exitCode: 1,
      }
    }
  }

  /**
   * List directory contents
   */
  async listDirectory(dirPath: string): Promise<ToolResult> {
    try {
      const fullPath = this.resolvePath(dirPath)
      const dir = this.directories.get(fullPath)

      if (!dir) {
        return {
          success: false,
          output: `Directory not found: ${dirPath}`,
          exitCode: 1,
        }
      }

      // Get detailed listing
      const entries: string[] = []
      
      for (const entryName of dir.entries) {
        const entryPath = `${fullPath}/${entryName}`
        if (this.files.has(entryPath)) {
          const file = this.files.get(entryPath)!
          entries.push(`- ${entryName} (${file.size} bytes)`)
        } else if (this.directories.has(entryPath)) {
          entries.push(`d ${entryName}/`)
        }
      }

      return {
        success: true,
        output: entries.join('\n') || '(empty directory)',
        exitCode: 0,
      }
    } catch (error: any) {
      return {
        success: false,
        output: `Failed to list directory: ${error.message}`,
        exitCode: 1,
      }
    }
  }

  /**
   * Create directory
   */
  async createDirectory(dirPath: string): Promise<ToolResult> {
    try {
      const fullPath = this.resolvePath(dirPath)

      if (this.directories.has(fullPath)) {
        return {
          success: false,
          output: `Directory already exists: ${dirPath}`,
          exitCode: 1,
        }
      }

      this.directories.set(fullPath, {
        path: fullPath,
        entries: [],
        createdAt: Date.now(),
      })

      // Ensure parent exists
      this.ensureParentDirectoryExists(fullPath)

      this.stats.totalDirectories++

      return {
        success: true,
        output: `Directory created: ${dirPath}`,
        exitCode: 0,
      }
    } catch (error: any) {
      return {
        success: false,
        output: `Failed to create directory: ${error.message}`,
        exitCode: 1,
      }
    }
  }

  /**
   * Delete directory
   */
  async deleteDirectory(dirPath: string, recursive: boolean = false): Promise<ToolResult> {
    try {
      const fullPath = this.resolvePath(dirPath)
      const dir = this.directories.get(fullPath)

      if (!dir) {
        return {
          success: false,
          output: `Directory not found: ${dirPath}`,
          exitCode: 1,
        }
      }

      if (dir.entries.length > 0 && !recursive) {
        return {
          success: false,
          output: `Directory not empty: ${dirPath}. Use recursive=true to delete.`,
          exitCode: 1,
        }
      }

      // Delete contents recursively
      if (recursive) {
        for (const entryName of [...dir.entries]) {
          const entryPath = `${fullPath}/${entryName}`
          if (this.directories.has(entryPath)) {
            await this.deleteDirectory(entryPath, true)
          } else if (this.files.has(entryPath)) {
            await this.deleteFile(entryPath)
          }
        }
      }

      this.directories.delete(fullPath)
      this.stats.totalDirectories--

      return {
        success: true,
        output: `Directory deleted: ${dirPath}`,
        exitCode: 0,
      }
    } catch (error: any) {
      return {
        success: false,
        output: `Failed to delete directory: ${error.message}`,
        exitCode: 1,
      }
    }
  }

  /**
   * Check if file exists
   */
  async fileExists(filePath: string): Promise<boolean> {
    const fullPath = this.resolvePath(filePath)
    return this.files.has(fullPath)
  }

  /**
   * Check if directory exists
   */
  async directoryExists(dirPath: string): Promise<boolean> {
    const fullPath = this.resolvePath(dirPath)
    return this.directories.has(fullPath)
  }

  /**
   * Get file info
   */
  async stat(filePath: string): Promise<{
    exists: boolean
    isFile: boolean
    isDirectory: boolean
    size?: number
    createdAt?: number
    modifiedAt?: number
  } | null> {
    const fullPath = this.resolvePath(filePath)
    
    const file = this.files.get(fullPath)
    if (file) {
      return {
        exists: true,
        isFile: true,
        isDirectory: false,
        size: file.size,
        createdAt: file.createdAt,
        modifiedAt: file.modifiedAt,
      }
    }

    const dir = this.directories.get(fullPath)
    if (dir) {
      return {
        exists: true,
        isFile: false,
        isDirectory: true,
        createdAt: dir.createdAt,
      }
    }

    return {
      exists: false,
      isFile: false,
      isDirectory: false,
    }
  }

  /**
   * Get filesystem statistics
   */
  getStats(): FilesystemStats {
    return { ...this.stats }
  }

  /**
   * Get all files
   */
  getAllFiles(): VirtualFile[] {
    return Array.from(this.files.values())
  }

  /**
   * Get all directories
   */
  getAllDirectories(): VirtualDirectory[] {
    return Array.from(this.directories.values())
  }

  /**
   * Clear filesystem
   */
  clear(): void {
    this.files.clear()
    this.directories.clear()
    this.initializeRootDirectory()
    this.stats = {
      totalFiles: 0,
      totalDirectories: 1,
      totalSize: 0,
      filesByExtension: {},
    }
  }

  /**
   * Export filesystem state
   */
  exportState(): {
    files: VirtualFile[]
    directories: VirtualDirectory[]
    stats: FilesystemStats
  } {
    return {
      files: this.getAllFiles(),
      directories: this.getAllDirectories(),
      stats: this.getStats(),
    }
  }

  /**
   * Import filesystem state
   */
  importState(state: {
    files: VirtualFile[]
    directories: VirtualDirectory[]
  }): void {
    this.clear()
    
    for (const dir of state.directories) {
      this.directories.set(dir.path, dir)
      this.stats.totalDirectories++
    }

    for (const file of state.files) {
      this.files.set(file.path, file)
      this.stats.totalFiles++
      this.stats.totalSize += file.size
      const ext = this.getFileExtension(file.path)
      this.stats.filesByExtension[ext] = 
        (this.stats.filesByExtension[ext] || 0) + 1
    }
  }

  /**
   * Initialize root directory
   */
  private initializeRootDirectory(): void {
    this.directories.set(this.workspaceRoot, {
      path: this.workspaceRoot,
      entries: [],
      createdAt: Date.now(),
    })
  }

  /**
   * Resolve path to absolute path
   */
  private resolvePath(path: string): string {
    if (path.startsWith('/')) {
      return path
    }
    return `${this.workspaceRoot}/${path}`
  }

  /**
   * Get parent directory path
   */
  private getParentDirectory(path: string): string {
    const parts = path.split('/')
    return parts.slice(0, -1).join('/') || '/'
  }

  /**
   * Ensure parent directory exists
   */
  private ensureParentDirectoryExists(fullPath: string): void {
    const parentDir = this.getParentDirectory(fullPath)
    
    if (!this.directories.has(parentDir)) {
      // Recursively create parent directories
      this.createDirectory(parentDir)
    }

    // Add file to parent directory entries
    const dir = this.directories.get(parentDir)
    if (dir) {
      const fileName = fullPath.split('/').pop() || ''
      if (!dir.entries.includes(fileName)) {
        dir.entries.push(fileName)
      }
    }
  }

  /**
   * Get file extension
   */
  private getFileExtension(path: string): string {
    const parts = path.split('.')
    return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : 'unknown'
  }
}
