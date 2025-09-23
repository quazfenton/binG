/* Parse assistant outputs into edits / ProjectStructure updates.
   Minimal heuristics: JSON with file array, unified diff detection, or fallback to assistant-output.txt.
*/

import { StreamPart } from './streaming'

export type CodeEdit = {
  filePath: string
  patch?: string
  content?: string
  action?: 'replace' | 'append' | 'patch' | 'create' | 'delete'
}

export type ProjectStructure = {
  files: Record<string, { content: string }>
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