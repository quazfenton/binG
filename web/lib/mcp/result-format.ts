import type { MCPContent, MCPToolResult } from './types'

export interface FormattedMCPText {
  displayText: string
  rawText: string
  truncated: boolean
  originalLength: number
  returnedLength: number
}

function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function truncateText(text: string, maxLength: number): FormattedMCPText {
  const originalLength = text.length
  if (originalLength <= maxLength) {
    return {
      displayText: text,
      rawText: text,
      truncated: false,
      originalLength,
      returnedLength: originalLength,
    }
  }

  const suffix = `\n... [truncated ${originalLength - maxLength} chars]`
  const trimmed = `${text.slice(0, Math.max(0, maxLength - suffix.length))}${suffix}`

  return {
    displayText: trimmed,
    rawText: text,
    truncated: true,
    originalLength,
    returnedLength: trimmed.length,
  }
}

function combineStdStreams(data: Record<string, unknown>): string | null {
  const stdout = typeof data.stdout === 'string' ? data.stdout.trimEnd() : ''
  const stderr = typeof data.stderr === 'string' ? data.stderr.trimEnd() : ''

  if (!stdout && !stderr) return null
  if (stdout && stderr) return `${stdout}\n\nstderr:\n${stderr}`
  return stdout || `stderr:\n${stderr}`
}

function summarizeObject(data: Record<string, unknown>): string | null {
  const scalarKeys = ['message', 'status', 'path', 'sessionId', 'pid', 'port', 'count', 'summary']
  const scalarLines = scalarKeys
    .filter((key) => typeof data[key] === 'string' || typeof data[key] === 'number' || typeof data[key] === 'boolean')
    .map((key) => `${key}: ${String(data[key])}`)

  const listKeys = ['paths', 'files', 'items', 'results']
  for (const key of listKeys) {
    const value = data[key]
    if (Array.isArray(value) && value.length > 0 && value.every((entry) => typeof entry === 'string')) {
      const lines = value.slice(0, 50).map((entry) => String(entry))
      const suffix = value.length > lines.length ? `\n... [${value.length - lines.length} more]` : ''
      return scalarLines.length > 0
        ? `${scalarLines.join('\n')}\n${lines.join('\n')}${suffix}`
        : `${lines.join('\n')}${suffix}`
    }
  }

  if (scalarLines.length > 0) {
    return scalarLines.join('\n')
  }

  return null
}

function preferredText(value: unknown): string | null {
  if (typeof value === 'string') return value
  if (value === null || value === undefined) return '(no data)'

  if (Array.isArray(value)) {
    if (value.length === 0) return '(empty array)'
    if (value.every((entry) => typeof entry === 'string' || typeof entry === 'number' || typeof entry === 'boolean')) {
      return value.map((entry) => String(entry)).join('\n')
    }
    return null
  }

  if (typeof value !== 'object') {
    return String(value)
  }

  const data = value as Record<string, unknown>
  const streamText = combineStdStreams(data)
  if (streamText) return streamText

  const preferredKeys = ['content', 'output', 'text', 'diff', 'message', 'summary', 'error']
  for (const key of preferredKeys) {
    if (typeof data[key] === 'string' && data[key]!.length > 0) {
      return data[key] as string
    }
  }

  if (Array.isArray(data.content)) {
    const contentText = data.content
      .flatMap((entry) => {
        if (typeof entry === 'string') return [entry]
        if (entry && typeof entry === 'object' && 'text' in entry && typeof (entry as { text?: unknown }).text === 'string') {
          return [(entry as { text: string }).text]
        }
        return []
      })
      .join('\n')

    if (contentText) return contentText
  }

  return summarizeObject(data)
}

function tryParseJson(text: string): unknown {
  const trimmed = text.trim()
  if (!trimmed) return undefined
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return undefined

  try {
    return JSON.parse(trimmed)
  } catch {
    return undefined
  }
}

export function formatValueForMCPText(
  value: unknown,
  options: { fallbackLimit?: number } = {}
): FormattedMCPText {
  const fallbackLimit = options.fallbackLimit ?? 2000
  const rawText = typeof value === 'string' ? value : safeJsonStringify(value)
  const preferred = preferredText(value)

  if (preferred !== null) {
    return {
      displayText: preferred,
      rawText,
      truncated: false,
      originalLength: rawText.length,
      returnedLength: preferred.length,
    }
  }

  const truncated = truncateText(rawText, fallbackLimit)
  return {
    displayText: truncated.displayText,
    rawText,
    truncated: truncated.truncated,
    originalLength: rawText.length,
    returnedLength: truncated.returnedLength,
  }
}

function formatContentItem(content: MCPContent): FormattedMCPText {
  if ('text' in content && typeof content.text === 'string') {
    const parsed = tryParseJson(content.text)
    return parsed === undefined
      ? formatValueForMCPText(content.text)
      : formatValueForMCPText(parsed)
  }

  if ('data' in content && 'mimeType' in content) {
    const text = `[Image: ${content.mimeType}]`
    return {
      displayText: text,
      rawText: text,
      truncated: false,
      originalLength: text.length,
      returnedLength: text.length,
    }
  }

  if ('uri' in content) {
    if (typeof content.text === 'string' && content.text.length > 0) {
      return formatValueForMCPText(content.text)
    }
    const text = `[Resource: ${content.uri}]`
    return {
      displayText: text,
      rawText: safeJsonStringify(content),
      truncated: false,
      originalLength: safeJsonStringify(content).length,
      returnedLength: text.length,
    }
  }

  return formatValueForMCPText(content)
}

export function flattenToolResultContent(result: MCPToolResult): FormattedMCPText {
  const formattedItems = result.content.map((item) => formatContentItem(item))
  const displayText = formattedItems.map((item) => item.displayText).join('\n')
  const rawText = formattedItems.map((item) => item.rawText).join('\n')
  const originalLength = rawText.length
  const returnedLength = displayText.length

  return {
    displayText,
    rawText,
    truncated: formattedItems.some((item) => item.truncated),
    originalLength,
    returnedLength,
  }
}
