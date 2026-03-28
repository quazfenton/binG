/**
 * Mode Manager
 *
 * Handles mode-aware response processing to ensure proper separation
 * between Chat and Code modes, preventing incorrect diff proposals
 * and code preview panel triggers.
 */

import { extractFileEdits, extractFencedDiffEdits, isFullFileContent } from './file-edit-parser'

export type AppMode = 'chat' | 'code' | 'extras' | 'integrations' | 'shell'

export interface ProcessedResponse {
  mode: AppMode
  content: string
  codeBlocks?: CodeBlock[]
  fileDiffs?: FileDiff[]
  shouldShowDiffs: boolean
  shouldOpenCodePreview: boolean
  isInputParsing: boolean
}

export interface CodeBlock {
  language: string
  code: string
  filename?: string
  isFileEdit: boolean
}

export interface FileDiff {
  path: string
  diff: string
  type: 'create' | 'modify' | 'delete'
}

export interface FileOperation {
  type: 'create' | 'modify' | 'delete'
  path: string
  content?: string
  diff?: string
}

/** Detected folder structure from LLM response */
export interface DetectedFolderStructure {
  isSingleFolder: boolean
  folderName: string | null
  totalFiles: number
  filesInFolder: number
  filesOutsideFolder: string[]
  isNewProject: boolean
}

// ---------------------------------------------------------------------------
// Shared constants
// ---------------------------------------------------------------------------

/** File extensions / name patterns that imply a complete, editable file. */
const FILE_STRUCTURE_LANGUAGES = new Set(['javascript', 'typescript', 'jsx', 'tsx'])
const CONFIG_FILENAME_PATTERNS = ['.json', '.yml', '.yaml', 'config']

const EXAMPLE_KEYWORDS = ['example', 'demo', 'sample'] as const

/** Minimum number of files in a folder for it to be treated as a new project. */
const NEW_PROJECT_MIN_FILES = 2

// ---------------------------------------------------------------------------
// ModeManager
// ---------------------------------------------------------------------------

export class ModeManager {
  private currentMode: AppMode = 'chat'

  setMode(mode: AppMode): void {
    this.currentMode = mode
  }

  getCurrentMode(): AppMode {
    return this.currentMode
  }

  /**
   * Route and process a response based on the current mode.
   */
  routeResponse(response: string, isInputParsing: boolean = false): ProcessedResponse {
    const codeBlocks = this.extractCodeBlocks(response)
    const fileDiffs = this.detectFileDiffs(response)

    if (isInputParsing) {
      return {
        mode: this.currentMode,
        content: response,
        codeBlocks: codeBlocks.map(block => ({ ...block, isFileEdit: false })),
        fileDiffs: [],
        shouldShowDiffs: false,
        shouldOpenCodePreview: false,
        isInputParsing: true,
      }
    }

    switch (this.currentMode) {
      case 'code':
        return this.processCodeResponse(response, codeBlocks, fileDiffs)
      default:
        return this.processChatResponse(response, codeBlocks, fileDiffs)
    }
  }

  // -------------------------------------------------------------------------
  // Mode-specific processing
  // -------------------------------------------------------------------------

  private processChatResponse(
    response: string,
    codeBlocks: CodeBlock[],
    fileDiffs: FileDiff[],
  ): ProcessedResponse {
    // Auto-escalate to Code mode processing when file edits are detected.
    const hasFileEdits =
      fileDiffs.length > 0 || codeBlocks.some(block => this.isFileEdit(block))
    if (hasFileEdits) {
      return this.processCodeResponse(response, codeBlocks, fileDiffs)
    }

    return {
      mode: 'chat',
      content: response,
      codeBlocks: codeBlocks.map(block => ({ ...block, isFileEdit: false })),
      fileDiffs: [],
      shouldShowDiffs: false,
      shouldOpenCodePreview: false,
      isInputParsing: false,
    }
  }

  private processCodeResponse(
    response: string,
    codeBlocks: CodeBlock[],
    fileDiffs: FileDiff[],
  ): ProcessedResponse {
    const processedCodeBlocks = codeBlocks.map(block => ({
      ...block,
      isFileEdit: this.isFileEdit(block),
    }))

    const actualFileDiffs = this.filterActualFileDiffs(fileDiffs)
    const hasActualCode =
      processedCodeBlocks.some(block => block.isFileEdit) || actualFileDiffs.length > 0

    return {
      mode: 'code',
      content: response,
      codeBlocks: processedCodeBlocks,
      fileDiffs: actualFileDiffs,
      shouldShowDiffs: actualFileDiffs.length > 0,
      shouldOpenCodePreview: hasActualCode,
      isInputParsing: false,
    }
  }

  // -------------------------------------------------------------------------
  // Code-block classification
  // -------------------------------------------------------------------------

  private isFileEdit(codeBlock: CodeBlock): boolean {
    if (!codeBlock.filename) return false

    const lang = codeBlock.language.toLowerCase()
    const filename = codeBlock.filename.toLowerCase()
    const code = codeBlock.code.toLowerCase()

    // Exclude example / demo / sample code
    if (
      EXAMPLE_KEYWORDS.some(kw => filename.includes(kw)) ||
      code.includes('// example') ||
      code.includes('// demo') ||
      code.includes('/* example') ||
      code.includes('# example')
    ) {
      return false
    }

    // JS/TS: must have import or export or module.exports
    if (FILE_STRUCTURE_LANGUAGES.has(lang)) {
      return code.includes('import') || code.includes('export') || code.includes('module.exports')
    }

    // HTML
    if (lang === 'html') return code.includes('<!doctype')

    // CSS: any selector block
    if (lang === 'css') return code.includes('{') && code.includes('}')

    // Python
    if (lang === 'python') return code.includes('def ') || code.includes('class ')

    // Config files
    if (CONFIG_FILENAME_PATTERNS.some(p => filename.includes(p))) return true

    return false
  }

  // -------------------------------------------------------------------------
  // Code block extraction
  // -------------------------------------------------------------------------

  private extractCodeBlocks(content: string): CodeBlock[] {
    const regex = /```(?:([a-zA-Z0-9+\-_.]+)(?:\s+(.+?))?)?[\r\n]([\s\S]*?)```/g
    const blocks: CodeBlock[] = []
    let match: RegExpExecArray | null

    while ((match = regex.exec(content)) !== null) {
      const [, language = 'text', filename, code] = match
      blocks.push({
        language: language.toLowerCase(),
        code: code.trim(),
        filename: filename?.trim(),
        isFileEdit: false,
      })
    }

    return blocks
  }

  // -------------------------------------------------------------------------
  // File diff detection
  // -------------------------------------------------------------------------

  private detectFileDiffs(content: string): FileDiff[] {
    const diffs: FileDiff[] = []
    // Deduplicate by path (first occurrence wins across all parsers)
    const seen = new Set<string>()

    const addDiff = (path: string, diff: string, type: FileDiff['type']) => {
      if (!seen.has(path)) {
        seen.add(path)
        diffs.push({ path, diff, type })
      }
    }

    // <file_edit> tags (both compact and multi-line)
    for (const edit of extractFileEdits(content)) {
      addDiff(
        edit.path,
        edit.content,
        isFullFileContent(edit.content) ? 'create' : 'modify',
      )
    }

    // Fenced diff blocks
    for (const diff of extractFencedDiffEdits(content)) {
      addDiff(diff.path, diff.diff, this.determineDiffType(diff.diff))
    }

    // COMMANDS blocks with write_diffs
    const commandsRegex = /=== COMMANDS_START ===([\s\S]*?)=== COMMANDS_END ===/g
    let match: RegExpExecArray | null

    while ((match = commandsRegex.exec(content)) !== null) {
      const commandBlock = match[1]
      const diffsMatch = commandBlock.match(/write_diffs:\s*\[([\s\S]*?)\]/)
      if (!diffsMatch) continue

      try {
        const items = diffsMatch[1]
          .split(/},/)
          .map(s => (s.endsWith('}') ? s : s + '}'))
          .map(s => s.trim())
          .filter(Boolean)

        for (const item of items) {
          const pathMatch = item.match(/path:\s*"([^"]+)"/)
          const diffMatch = item.match(/diff:\s*"((?:\\.|[^"\\])*)"/)
          if (pathMatch && diffMatch) {
            const rawDiff = diffMatch[1].replace(/\\n/g, '\n')
            addDiff(pathMatch[1], rawDiff, this.determineDiffType(rawDiff))
          }
        }
      } catch (error) {
        // Malformed COMMANDS block — skip gracefully
      }
    }

    return diffs
  }

  private determineDiffType(diffContent: string): FileDiff['type'] {
    let added = 0
    let removed = 0
    for (const line of diffContent.split('\n')) {
      if (line.startsWith('+')) added++
      else if (line.startsWith('-')) removed++
    }
    if (added > 0 && removed === 0) return 'create'
    if (added === 0 && removed > 0) return 'delete'
    return 'modify'
  }

  // -------------------------------------------------------------------------
  // Filtering
  // -------------------------------------------------------------------------

  private filterActualFileDiffs(diffs: FileDiff[]): FileDiff[] {
    return diffs.filter(diff => {
      const path = diff.path.toLowerCase()
      // Exclude obvious example / demo / sample files
      if (EXAMPLE_KEYWORDS.some(kw => path.includes(kw))) return false
      // Exclude test files unless they live under src/test
      if (path.includes('test') && !path.includes('src/test')) return false
      return true
    })
  }

  // -------------------------------------------------------------------------
  // File operations
  // -------------------------------------------------------------------------

  extractFileOperations(response: string): FileOperation[] {
    return this.detectFileDiffs(response).map(diff => ({
      type: diff.type,
      path: diff.path,
      diff: diff.diff,
    }))
  }

  // -------------------------------------------------------------------------
  // Folder structure detection
  // -------------------------------------------------------------------------

  detectFolderStructure(fileOperations: FileOperation[]): DetectedFolderStructure {
    if (fileOperations.length === 0) {
      return {
        isSingleFolder: false,
        folderName: null,
        totalFiles: 0,
        filesInFolder: 0,
        filesOutsideFolder: [],
        isNewProject: false,
      }
    }

    const paths = fileOperations.map(op => op.path)
    const folderNames = new Set<string>()
    const filesOutsideAnyFolder: string[] = []

    for (const path of paths) {
      const parts = path.split('/').filter(Boolean)
      if (parts.length >= 2) {
        folderNames.add(parts[0])
      } else {
        filesOutsideAnyFolder.push(path)
      }
    }

    const folderNameArray = Array.from(folderNames)
    const isSingleFolder = folderNameArray.length === 1
    const singleFolderName = isSingleFolder ? folderNameArray[0] : null

    const filesInFolder =
      isSingleFolder && singleFolderName
        ? paths.filter(p => p.startsWith(singleFolderName + '/')).length
        : 0

    const isNewProject =
      isSingleFolder || (paths.length > 1 && filesOutsideAnyFolder.length === 0)

    return {
      isSingleFolder,
      folderName: singleFolderName,
      totalFiles: paths.length,
      filesInFolder,
      filesOutsideFolder: filesOutsideAnyFolder,
      isNewProject,
    }
  }

  // -------------------------------------------------------------------------
  // Path extraction from code blocks
  // -------------------------------------------------------------------------

  extractPathsFromCodeBlocks(response: string): string[] {
    const paths: string[] = []
    const regex = /```(?:[a-zA-Z0-9+\-_.]+)?(?:\s+(.+?))?[\r\n]/g
    let match: RegExpExecArray | null

    while ((match = regex.exec(response)) !== null) {
      const filename = match[1]?.trim()
      if (filename?.includes('/')) {
        paths.push(filename)
      }
    }

    return paths
  }

  // -------------------------------------------------------------------------
  // New-project folder detection
  // -------------------------------------------------------------------------

  detectNewProjectFolder(response: string): string | null {
    const fileOperations = this.extractFileOperations(response)
    const structure =
      fileOperations.length > 0
        ? this.detectFolderStructure(fileOperations)
        : this.detectFolderStructure(
            this.extractPathsFromCodeBlocks(response).map(p => ({
              type: 'create' as const,
              path: p,
            })),
          )

    if (
      structure.isSingleFolder &&
      structure.folderName &&
      structure.filesInFolder >= NEW_PROJECT_MIN_FILES &&
      structure.filesOutsideFolder.length === 0
    ) {
      return structure.folderName
    }

    return null
  }

  // -------------------------------------------------------------------------
  // Convenience predicates
  // -------------------------------------------------------------------------

  shouldGenerateDiffs(response: string, mode?: AppMode): boolean {
    const currentMode = mode ?? this.currentMode
    if (currentMode === 'chat') return false
    return this.filterActualFileDiffs(this.detectFileDiffs(response)).length > 0
  }

  shouldOpenCodePreview(response: string, mode?: AppMode): boolean {
    const currentMode = mode ?? this.currentMode
    if (currentMode === 'chat') return false

    const hasActualCode = this.extractCodeBlocks(response).some(b => this.isFileEdit(b))
    const hasActualDiffs = this.filterActualFileDiffs(this.detectFileDiffs(response)).length > 0
    return hasActualCode || hasActualDiffs
  }
}

// ---------------------------------------------------------------------------
// Singleton + convenience exports
// ---------------------------------------------------------------------------

export const modeManager = new ModeManager()

export function setCurrentMode(mode: AppMode): void {
  modeManager.setMode(mode)
}

export function getCurrentMode(): AppMode {
  return modeManager.getCurrentMode()
}

export function processResponse(
  response: string,
  isInputParsing: boolean = false,
): ProcessedResponse {
  return modeManager.routeResponse(response, isInputParsing)
}

export function shouldShowDiffs(response: string, mode?: AppMode): boolean {
  return modeManager.shouldGenerateDiffs(response, mode)
}

export function shouldOpenCodePreview(response: string, mode?: AppMode): boolean {
  return modeManager.shouldOpenCodePreview(response, mode)
}

export function detectNewProjectFolder(response: string): string | null {
  return modeManager.detectNewProjectFolder(response)
}

export function detectFolderStructure(response: string): DetectedFolderStructure {
  return modeManager.detectFolderStructure(modeManager.extractFileOperations(response))
}
