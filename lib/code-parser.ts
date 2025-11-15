/* Parse assistant outputs into edits / ProjectStructure updates.
   Minimal heuristics: JSON with file array, unified diff detection, or fallback to assistant-output.txt.
*/

import { StreamPart } from './streaming'
import type { Message } from '../types/index'

export type CodeEdit = {
  filePath: string
  patch?: string
  content?: string
  action?: 'replace' | 'append' | 'patch' | 'create' | 'delete'
}

export type ProjectStructure = {
  files: Record<string, { content: string }>
}

export type CodeBlock = {
  language: string
  code: string
  filename: string
  index: number
  isError?: boolean
}

export type ParsedCodeData = {
  codeBlocks: CodeBlock[]
  projectStructure?: any
  nonCodeText?: string
  shellCommands?: string
}

export function parseTextToEdits(text: string): CodeEdit[] {
  const edits: CodeEdit[] = []
  const trimmed = text.trim()
  if (!trimmed) return edits

  try {
    const j = JSON.parse(trimmed)
    if (Array.isArray(j.files)) {
      for (const f of j.files) {
        if (f.path && f.content) {
          edits.push({ filePath: f.path, content: f.content, action: 'replace' })
        }
      }
      return edits
    }
    if (j.file && j.content) {
      edits.push({ filePath: j.file, content: j.content, action: 'replace' })
      return edits
    }
  } catch {
    // not JSON
  }

  if (trimmed.startsWith('diff ') || trimmed.startsWith('@@') || trimmed.includes('+++') || trimmed.includes('---')) {
    edits.push({ filePath: 'unknown.patch', patch: trimmed, action: 'patch' })
    return edits
  }

  edits.push({ filePath: 'assistant-output.txt', content: text, action: 'create' })
  return edits
}

export function applyEditsToProject(proj: ProjectStructure, edits: CodeEdit[]) {
  for (const e of edits) {
    if (e.action === 'replace' || e.action === 'create') {
      proj.files[e.filePath] = { content: e.content ?? '' }
    } else if (e.action === 'append') {
      const prev = proj.files[e.filePath]?.content ?? ''
      proj.files[e.filePath] = { content: prev + (e.content ?? '') }
    } else if (e.action === 'patch') {
      proj.files[e.filePath] = { content: e.patch ?? '' }
    } else if (e.action === 'delete') {
      delete proj.files[e.filePath]
    }
  }
  return proj
}

export async function* streamPartsToEdits(parts: AsyncIterable<StreamPart>, currentProject: ProjectStructure) {
  let buffer = ''
  for await (const p of parts) {
    if (p.text) buffer += p.text
    if (buffer.includes('```') || buffer.includes('{') || buffer.includes('diff ') || buffer.length > 4096) {
      const edits = parseTextToEdits(buffer)
      if (edits.length) {
        currentProject = applyEditsToProject(currentProject, edits)
        yield { project: currentProject, edits }
        buffer = ''
      }
    }
  }
  if (buffer.trim()) {
    const edits = parseTextToEdits(buffer)
    if (edits.length) {
      currentProject = applyEditsToProject(currentProject, edits)
      yield { project: currentProject, edits }
    }
  }
}

/**
 * Parse code blocks from chat messages
 */
export function parseCodeBlocksFromMessages(messages: Message[]): ParsedCodeData {
  const codeBlocks: CodeBlock[] = []
  let nonCodeText = ''
  let shellCommands = ''
  let blockIndex = 0

  for (const message of messages) {
    if (message.role !== 'assistant') continue
    
    const content = typeof message.content === 'string' ? message.content : ''
    
    // Extract code blocks using regex - makes newline optional and captures optional info string without requiring //
    const codeBlockRegex = /```(\w+)?\s*([^\n]*?)(?:\n([\s\S]*?))?```/g
    let match
    
    while ((match = codeBlockRegex.exec(content)) !== null) {
      const [, language = 'text', infoString, rawCode = ''] = match
      
      // Use infoString as filename when present (without requiring //), otherwise fall back to language extension
      let filename = infoString?.trim() || ''
      if (!filename) {
        const ext = getExtensionForLanguage(language)
        filename = `file-${blockIndex}.${ext}`
      }
      
      codeBlocks.push({
        language: language.toLowerCase(),
        code: rawCode?.trim() || '',
        filename: cleanFilename(filename),
        index: blockIndex++,
        isError: false
      })
      
      // Collect shell commands
      if (language.toLowerCase() === 'bash' || language.toLowerCase() === 'sh' || language.toLowerCase() === 'shell') {
        shellCommands += rawCode?.trim() + '\n\n'
      }
    }
    
    // Extract non-code text
    const textWithoutCode = content.replace(/```[\s\S]*?```/g, '').trim()
    if (textWithoutCode) {
      nonCodeText += textWithoutCode + '\n\n'
    }
  }
  
  return {
    codeBlocks,
    nonCodeText: nonCodeText.trim(),
    shellCommands: shellCommands.trim()
  }
}

/**
 * Get file extension for a language
 */
function getExtensionForLanguage(language: string): string {
  const extensions: Record<string, string> = {
    javascript: 'js',
    typescript: 'ts',
    python: 'py',
    java: 'java',
    cpp: 'cpp',
    c: 'c',
    html: 'html',
    css: 'css',
    json: 'json',
    xml: 'xml',
    sql: 'sql',
    jsx: 'jsx',
    tsx: 'tsx',
    php: 'php',
    vue: 'vue',
    svelte: 'svelte',
    astro: 'astro',
    ruby: 'rb',
    go: 'go',
    rust: 'rs',
    swift: 'swift',
    kotlin: 'kt',
    scala: 'scala',
    r: 'r',
    shell: 'sh',
    bash: 'sh',
    yaml: 'yml',
    yml: 'yml',
    markdown: 'md',
    md: 'md',
  }
  return extensions[language.toLowerCase()] || 'txt'
}

/**
 * Clean and normalize filename
 */
function cleanFilename(filename: string): string {
  // Remove leading/trailing whitespace
  let cleaned = filename.trim()
  
  // Remove common prefixes
  cleaned = cleaned.replace(/^(file:|path:|filename:)\s*/i, '')
  
  // Remove quotes
  cleaned = cleaned.replace(/^["']|["']$/g, '')
  
  // Ensure no leading slash (for sandpack compatibility)
  cleaned = cleaned.replace(/^\/+/, '')
  
  // Replace backslashes with forward slashes
  cleaned = cleaned.replace(/\\/g, '/')
  
  return cleaned || 'untitled.txt'
}
