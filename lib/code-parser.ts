/**
 * @module code-parser
 * @compatibility-boundary
 *
 * LEGACY: Parse assistant text outputs into edits / ProjectStructure updates.
 * Minimal heuristics: JSON with file array, unified diff detection, or fallback
 * to assistant-output.txt.
 *
 * Canonical tool invocations and file-effect events are now emitted directly by
 * agent producers (priority-router, V2 executor, Mastra, OpenCode engine).
 * This module is retained as a fallback for agents that cannot provide
 * structured events. Prefer consuming `ToolInvocation[]` from message metadata
 * before falling back to text parsing here.
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
 * LEGACY: This parses LLM response text, NOT actual filesystem files.
 * The parsed blocks are startup/shell commands (e.g., 'npm run dev'),
 * not the files written to VFS by the WRITE tool.
 * Use scopedPreviewFiles from VFS for actual project files.
 */
export function parseCodeBlocksFromMessages(messages: Message[]): ParsedCodeData {
  const codeBlocks: CodeBlock[] = []
  let nonCodeText = ''
  let shellCommands = ''
  let blockIndex = 0

  for (const message of messages) {
    if (message.role !== 'assistant') continue

    const content = typeof message.content === 'string' ? message.content : ''

    // Enhanced regex to capture filenames from multiple formats:
    // ```javascript:src/App.js
    // ```javascript src/App.js
    // ```javascript filename="src/App.js"
    // ```javascript // src/App.js
    const codeBlockRegex = /```(\w+)?(?:\s*[:\s]\s*(?:filename\s*=\s*)?["']?([^"'\s\n]+)["']?)?\s*(?:\/\/\s*(.+?))?\n([\s\S]*?)```/g
    let match

    while ((match = codeBlockRegex.exec(content)) !== null) {
      const [, language, filenameFromColon, filenameFromComment, code] = match

      // Priority for filename: colon format > comment format > generate default
      let filename = ''
      
      if (filenameFromColon && filenameFromColon.trim()) {
        // From ```javascript:src/App.js or ```javascript src/App.js
        filename = filenameFromColon.trim()
      } else if (filenameFromComment && filenameFromComment.trim()) {
        // From ```javascript // src/App.js
        filename = filenameFromComment.trim()
      } else {
        // Generate meaningful default filename based on content analysis
        filename = generateMeaningfulFilename(language, code, blockIndex)
      }

      codeBlocks.push({
        language: language?.toLowerCase() || 'text',
        code: code.trim(),
        filename: cleanFilename(filename),
        index: blockIndex++,
        isError: false
      })

      // Collect shell commands
      if (language?.toLowerCase() === 'bash' || language?.toLowerCase() === 'sh' || language?.toLowerCase() === 'shell') {
        shellCommands += code.trim() + '\n\n'
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
function getExtensionForLanguage(language: string | undefined): string {
  if (!language) return 'txt';
  
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
 * Generate a meaningful filename based on code content analysis
 */
function generateMeaningfulFilename(language: string | undefined, code: string, index: number): string {
  const ext = getExtensionForLanguage(language)
  const lowerCode = code.toLowerCase()
  
  // Check for common entry point patterns
  if (lowerCode.includes('package.json') || lowerCode.includes('"name"')) {
    return `package.json`
  }
  if (lowerCode.includes('<!doctype html') || lowerCode.includes('<html') && ext === 'html') {
    return `index.html`
  }
  if (lowerCode.includes('import react') || lowerCode.includes('from react') || lowerCode.includes('create-react-app')) {
    return `App.${ext === 'jsx' ? 'jsx' : 'tsx'}`
  }
  if (lowerCode.includes('vue.createapp') || lowerCode.includes('createapp')) {
    return `main.vue`
  }
  if (lowerCode.includes('def main') || lowerCode.includes('if __name__')) {
    return `main.py`
  }
  if (lowerCode.includes('function main') || lowerCode.includes('void main')) {
    return `main.${ext}`
  }
  if (lowerCode.includes('express()') || lowerCode.includes('app.get(') || lowerCode.includes('app.post(')) {
    return `server.${ext}`
  }
  if (lowerCode.includes('flask') || lowerCode.includes('@app.route')) {
    return `app.py`
  }
  if (lowerCode.includes('fastapi') || lowerCode.includes('@app.get')) {
    return `main.py`
  }
  if (lowerCode.includes('#!/bin/bash') || lowerCode.includes('#!/bin/sh')) {
    return index === 0 ? 'start.sh' : `script-${index}.sh`
  }
  if (lowerCode.includes('dockerfile') || lowerCode.includes('from ')) {
    return `Dockerfile`
  }
  if (lowerCode.includes('version:') && (ext === 'yml' || ext === 'yaml')) {
    return `docker-compose.yml`
  }
  if (lowerCode.includes('module.exports') || lowerCode.includes('export default')) {
    return `index.${ext}`
  }
  if (lowerCode.includes('class ') && lowerCode.includes('extends')) {
    // Extract class name if possible
    const classMatch = code.match(/class\s+(\w+)/)
    if (classMatch) {
      return `${classMatch[1]}.${ext}`
    }
  }
  if (lowerCode.includes('const ') || lowerCode.includes('let ') || lowerCode.includes('var ')) {
    return index === 0 ? `index.${ext}` : `module-${index}.${ext}`
  }
  
  // Default: use meaningful names based on language
  const nameMap: Record<string, string[]> = {
    sh: ['start.sh', 'setup.sh', 'deploy.sh', 'build.sh', 'test.sh', 'script.sh'],
    bash: ['start.sh', 'setup.sh', 'deploy.sh', 'build.sh', 'test.sh', 'script.sh'],
    shell: ['start.sh', 'setup.sh', 'deploy.sh', 'build.sh', 'test.sh', 'script.sh'],
    js: ['index.js', 'main.js', 'app.js', 'server.js', 'config.js', 'utils.js'],
    ts: ['index.ts', 'main.ts', 'app.ts', 'server.ts', 'config.ts', 'utils.ts'],
    jsx: ['App.jsx', 'index.jsx', 'main.jsx', 'component.jsx'],
    tsx: ['App.tsx', 'index.tsx', 'main.tsx', 'component.tsx'],
    py: ['main.py', 'app.py', 'server.py', 'config.py', 'utils.py'],
    html: ['index.html', 'main.html', 'template.html'],
    css: ['style.css', 'main.css', 'app.css', 'index.css'],
    json: ['config.json', 'settings.json', 'data.json'],
    vue: ['App.vue', 'main.vue', 'component.vue'],
  }
  
  const names = nameMap[language?.toLowerCase() || ''] || ['file']
  return names[Math.min(index, names.length - 1)]
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
