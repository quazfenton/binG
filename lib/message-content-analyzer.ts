export interface ContentAnalysis {
  hasCodeBlocks: boolean
  hasInlineCode: boolean
  hasUrls: boolean
  hasLongWords: boolean
  hasLists: boolean
  hasImages: boolean
  estimatedLines: number
  longestWord: string
  urlCount: number
  codeBlockCount: number
}

export function analyzeMessageContent(content: string): ContentAnalysis {
  // Detect code blocks (fenced with ``` or indented)
  const codeBlockRegex = /```[\s\S]*?```|^[ ]{4,}.+$/gm
  const codeBlocks = content.match(codeBlockRegex) || []
  const hasCodeBlocks = codeBlocks.length > 0

  // Detect inline code (backticks)
  const inlineCodeRegex = /`[^`\n]+`/g
  const hasInlineCode = inlineCodeRegex.test(content)

  // Detect URLs
  const urlRegex = /(https?:\/\/[^\s]+|www\.[^\s]+|[^\s]+\.[a-z]{2,}\/[^\s]*)/gi
  const urls = content.match(urlRegex) || []
  const hasUrls = urls.length > 0

  // Detect long words (potential overflow issues)
  const words = content.split(/\s+/)
  const longWords = words.filter(word => word.length > 30)
  const hasLongWords = longWords.length > 0
  const longestWord = words.reduce((longest, current) => 
    current.length > longest.length ? current : longest, ''
  )

  // Detect lists
  const listRegex = /^[\s]*[-*+]\s|^[\s]*\d+\.\s/gm
  const hasLists = listRegex.test(content)

  // Detect images
  const imageRegex = /!\[.*?\]\(.*?\)/g
  const hasImages = imageRegex.test(content)

  // Estimate lines (rough calculation)
  const lines = content.split('\n')
  const estimatedLines = lines.length + Math.floor(content.length / 80) // Assume ~80 chars per line

  return {
    hasCodeBlocks,
    hasInlineCode,
    hasUrls,
    hasLongWords,
    hasLists,
    hasImages,
    estimatedLines,
    longestWord,
    urlCount: urls.length,
    codeBlockCount: codeBlocks.length
  }
}

export function getContentBasedStyling(analysis: ContentAnalysis, isMobile: boolean) {
  const styles: Record<string, string> = {}

  // Handle code blocks
  if (analysis.hasCodeBlocks) {
    if (isMobile) {
      styles.overflowX = 'auto'
      styles.whiteSpace = 'pre'
    } else {
      styles.whiteSpace = 'pre-wrap'
    }
  }

  // Handle long words
  if (analysis.hasLongWords) {
    if (isMobile) {
      styles.wordBreak = 'break-all'
      styles.overflowWrap = 'break-word'
    } else {
      styles.overflowWrap = 'break-word'
    }
  }

  // Handle URLs
  if (analysis.hasUrls) {
    if (isMobile) {
      styles.wordBreak = 'break-all'
    }
  }

  return styles
}

export function shouldUseCompactLayout(
  analysis: ContentAnalysis,
  screenWidth: number,
  screenHeight: number
): boolean {
  // Use compact layout on small screens with long content
  const isSmallScreen = screenWidth < 390 || screenHeight < 600
  const isLongContent = analysis.estimatedLines > 10
  const hasComplexContent = analysis.hasCodeBlocks || analysis.hasLists || analysis.hasImages

  return isSmallScreen && (isLongContent || hasComplexContent)
}