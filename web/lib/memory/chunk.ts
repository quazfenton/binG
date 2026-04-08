/**
 * chunk.ts — Text chunking with overlap
 * Splits large text into overlapping chunks for embedding.
 */

export interface Chunk {
  text: string;
  index: number;
  startChar: number;
  endChar: number;
}

/**
 * Basic character-level chunking with overlap.
 * Use for non-code text (docs, comments, markdown).
 */
export function chunkText(
  text: string,
  size = 500,
  overlap = 50
): Chunk[] {
  // Guard against non-positive step size that would cause an infinite loop
  const effectiveSize = Math.max(1, size);
  const effectiveOverlap = Math.min(overlap, effectiveSize - 1);
  const step = effectiveSize - effectiveOverlap;

  const chunks: Chunk[] = [];
  let index = 0;

  for (let i = 0; i < text.length; i += step) {
    const end = Math.min(i + effectiveSize, text.length);
    chunks.push({
      text: text.slice(i, end),
      index: index++,
      startChar: i,
      endChar: end,
    });
    if (end === text.length) break;
  }

  return chunks;
}

/**
 * Line-aware chunking — respects line boundaries.
 * Better for code where mid-line splits are bad.
 */
export function chunkByLines(
  text: string,
  maxLines = 30,
  overlapLines = 5
): Chunk[] {
  // Guard against non-positive step that would cause an infinite loop
  const effectiveMaxLines = Math.max(1, maxLines);
  const effectiveOverlap = Math.min(overlapLines, effectiveMaxLines - 1);
  const step = effectiveMaxLines - effectiveOverlap;

  const lines = text.split("\n");
  const chunks: Chunk[] = [];
  let index = 0;
  let charOffset = 0;

  for (let i = 0; i < lines.length; i += step) {
    const slice = lines.slice(i, i + effectiveMaxLines);
    const chunkText = slice.join("\n");
    const startChar = charOffset;

    chunks.push({
      text: chunkText,
      index: index++,
      startChar,
      endChar: startChar + chunkText.length,
    });

    // Advance char offset by the non-overlapping lines
    const advanceLines = lines.slice(i, i + step);
    charOffset += advanceLines.join("\n").length + 1;

    if (i + effectiveMaxLines >= lines.length) break;
  }

  return chunks;
}

/**
 * Semantic chunking — splits on blank lines / section breaks.
 * Best for markdown, documentation, and prose.
 */
export function chunkBySections(
  text: string,
  maxSize = 1000
): Chunk[] {
  const sections = text.split(/\n\n+/);
  const chunks: Chunk[] = [];
  let index = 0;
  let current = "";
  let startChar = 0;
  let charCursor = 0;

  for (const section of sections) {
    const sectionWithGap = section + "\n\n";

    if (current.length + section.length > maxSize && current.length > 0) {
      chunks.push({
        text: current.trim(),
        index: index++,
        startChar,
        endChar: charCursor,
      });
      current = "";
      startChar = charCursor;
    }

    current += sectionWithGap;
    charCursor += sectionWithGap.length;
  }

  if (current.trim().length > 0) {
    chunks.push({
      text: current.trim(),
      index: index++,
      startChar,
      endChar: charCursor,
    });
  }

  return chunks;
}
