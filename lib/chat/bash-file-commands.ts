/**
 * Bash-Native File Command Parser
 * 
 * Parses bash heredoc syntax for file operations:
 * - cat > file << 'EOF' ... EOF (create/overwrite)
 * - cat >> file << 'EOF' ... EOF (append)
 * - mkdir -p path (create directory)
 * - rm file (delete file)
 * - sed -i 's/old/new/g' file (patch)
 * 
 * This syntax is more natural for LLMs trained on code and bash scripts,
 * compared to XML-like <file_write> tags.
 * 
 * @see lib/chat/file-edit-parser.ts - Integration point
 * 
 * @example
 * ```typescript
 * const content = `
 *   cat > src/app.ts << 'EOF'
 *   export default function App() {
 *     return <div>Hello</div>;
 *   }
 *   EOF
 * `;
 * 
 * const edits = extractBashFileEdits(content);
 * // edits.writes[0] = { path: 'src/app.ts', content: '...', mode: 'write' }
 * ```
 */

import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('Parser:BashFileCommands');

/**
 * File edit from bash command
 */
export interface BashFileEdit {
  /** File path */
  path: string;
  /** File content */
  content: string;
  /** Write mode: 'write' (overwrite) or 'append' */
  mode: 'write' | 'append';
}

/**
 * Directory creation
 */
export interface BashDirectoryEdit {
  /** Directory path */
  path: string;
  /** Always 'create' for mkdir */
  mode: 'create';
}

/**
 * File deletion
 */
export interface BashDeleteEdit {
  /** File path to delete */
  path: string;
}

/**
 * Patch edit via sed
 */
export interface BashPatchEdit {
  /** File path */
  path: string;
  /** Search pattern */
  pattern: string;
  /** Replacement string */
  replacement: string;
  /** sed flags (g, i, m, etc.) */
  flags?: string;
}

/**
 * Extract cat heredoc commands: cat > file << 'EOF' ... EOF
 * 
 * Handles:
 * - cat > file << 'EOF' (overwrite, quoted delimiter)
 * - cat > file << EOF (overwrite, unquoted delimiter)
 * - cat >> file << 'EOF' (append, quoted delimiter)
 * - cat >> file << EOF (append, unquoted delimiter)
 * - Various whitespace variations
 */
export function extractCatHeredocEdits(content: string): BashFileEdit[] {
  const edits: BashFileEdit[] = [];
  
  // Fast-path: check for heredoc signature
  if (!content.includes('<<') || !content.includes('cat')) {
    return edits;
  }
  
  // Match: cat > path << 'EOF' ... EOF  OR  cat >> path << 'EOF' ... EOF
  // Groups: 1=mode (> or >>), 2=path, 3=delimiter, 4=content
  const regex = /cat\s*(>>?)\s*([^\s<>&|]+)\s*<<\s*['"]?(\w+)['"]?\s*\n([\s\S]*?)\n?\3(?:\s|$)/gi;
  let match: RegExpExecArray | null;
  
  while ((match = regex.exec(content)) !== null) {
    try {
      const mode = match[1] === '>>' ? 'append' : 'write';
      const path = match[2]?.trim();
      const fileContent = match[4] ?? '';
      
      if (!path || path.startsWith('-')) {
        logger.debug('Skipping invalid path', { path });
        continue;
      }
      
      edits.push({ 
        path, 
        content: fileContent.trimEnd(), // Remove trailing newline from heredoc
        mode 
      });
      
      logger.debug('Extracted cat heredoc', { path, mode, contentLength: fileContent.length });
    } catch (error: any) {
      logger.warn('Failed to parse cat heredoc', { 
        error: error.message,
        match: match[0].substring(0, 100) 
      });
    }
  }
  
  return edits;
}

/**
 * Strip heredoc bodies from content to prevent false positives
 * in secondary scanners (mkdir, rm, sed).
 *
 * Handles:
 * - <<'DELIM' ... DELIM (quoted - no variable expansion)
 * - <<DELIM ... DELIM (unquoted)
 * - <<-DELIM ... DELIM (indented)
 */
export function stripHeredocBodies(content: string): string {
  let result = content;

  // Match heredocs: <<['"]?DELIM['"]? ... DELIM
  // Handles: <<'EOF', <<EOF, <<-'EOF', <<-EOF
  const heredocRegex = /<<-?['"]?(\w+)['"]?([\s\S]*?)\n?\1(?:\s|$)/gi;

  result = result.replace(heredocRegex, (match, delimiter, body) => {
    // Replace heredoc body with placeholder to preserve line structure
    const placeholder = `[HEREDOC:${delimiter}:${body.split('\n').length} lines]`;
    return match.replace(body, placeholder);
  });

  return result;
}

/**
 * Extract mkdir commands: mkdir -p path
 * 
 * Handles:
 * - mkdir path
 * - mkdir -p path (recursive)
 * - mkdir -p path1 path2 (multiple paths)
 */
export function extractMkdirEdits(content: string): BashDirectoryEdit[] {
  const edits: BashDirectoryEdit[] = [];
  
  if (!content.includes('mkdir')) {
    return edits;
  }
  
  const stripped = stripHeredocBodies(content);

  // Match: mkdir [-p] path1 [path2 ...]
  // FIX: Don't capture across newlines to avoid parsing subsequent commands as paths
  const regex = /mkdir\s+(-p\s+)?([^\n&|;<>]+)/gi;
  let match: RegExpExecArray | null;
  
  while ((match = regex.exec(stripped)) !== null) {
    try {
      const recursive = !!match[1];
      const pathsStr = match[2]?.trim();
      
      if (!pathsStr) {
        continue;
      }
      
      // Split on whitespace to handle multiple paths: mkdir -p path1 path2
      const paths = pathsStr.split(/\s+/).filter(p => p && !p.startsWith('-'));
      
      for (const path of paths) {
        edits.push({ path, mode: 'create' });
        logger.debug('Extracted mkdir', { path, recursive });
      }
    } catch (error: any) {
      logger.warn('Failed to parse mkdir', { 
        error: error.message,
        match: match[0].substring(0, 100) 
      });
    }
  }
  
  return edits;
}

/**
 * Extract rm commands: rm file
 * 
 * Handles:
 * - rm file
 * - rm -f file (force)
 * - rm -rf path (recursive force)
 */
export function extractRmEdits(content: string): BashDeleteEdit[] {
  const deletes: BashDeleteEdit[] = [];
  
  if (!content.includes('rm ')) {
    return deletes;
  }
  
  const stripped = stripHeredocBodies(content);
  
  // Match: rm [-flags] path
  const regex = /rm\s+(-[rf]+\s+)?([^\s&|;<>]+)/gi;
  let match: RegExpExecArray | null;
  
  while ((match = regex.exec(stripped)) !== null) {
    try {
      const path = match[2]?.trim();
      
      // Skip if path looks like a flag or is empty
      if (!path || path.startsWith('-')) {
        continue;
      }
      
      deletes.push({ path });
      logger.debug('Extracted rm', { path });
    } catch (error: any) {
      logger.warn('Failed to parse rm', { 
        error: error.message,
        match: match[0].substring(0, 100) 
      });
    }
  }
  
  return deletes;
}

/**
 * Extract sed patch commands: sed -i 's/old/new/g' file
 * 
 * Handles:
 * - sed -i 's/old/new/g' file (GNU sed)
 * - sed -i '' 's/old/new/g' file (BSD sed with backup)
 * - sed -i "s/old/new/g" file (double quotes)
 */
export function extractSedEdits(content: string): BashPatchEdit[] {
  const patches: BashPatchEdit[] = [];
  
  if (!content.includes('sed')) {
    return patches;
  }
  
  const stripped = stripHeredocBodies(content);
  
  // Match: sed -i ['"]s/pattern/replacement/flags['"] file
  // Groups: 1=pattern, 2=replacement, 3=flags, 4=file
  const regex = /sed\s+-i\s+('')?\s*['"]s\/([^\/]+)\/([^\/]+)\/([gim]*)['"]\s+([^\s&|;<>]+)/gi;
  let match: RegExpExecArray | null;
  
  while ((match = regex.exec(stripped)) !== null) {
    try {
      const pattern = match[2];
      const replacement = match[3];
      const flags = match[4];
      const path = match[5]?.trim();
      
      if (!path || !pattern) {
        continue;
      }
      
      patches.push({ path, pattern, replacement, flags: flags || undefined });
      logger.debug('Extracted sed', { path, pattern, replacement });
    } catch (error: any) {
      logger.warn('Failed to parse sed', { 
        error: error.message,
        match: match[0].substring(0, 100) 
      });
    }
  }
  
  return patches;
}

/**
 * Extract all bash file commands
 * 
 * @param content - LLM output text
 * @returns Object with arrays of different edit types
 */
export function extractBashFileEdits(content: string): {
  writes: BashFileEdit[];
  directories: BashDirectoryEdit[];
  deletes: BashDeleteEdit[];
  patches: BashPatchEdit[];
} {
  logger.debug('Extracting bash file edits', { contentLength: content.length });
  
  const result = {
    writes: extractCatHeredocEdits(content),
    directories: extractMkdirEdits(content),
    deletes: extractRmEdits(content),
    patches: extractSedEdits(content),
  };
  
  const total = result.writes.length + result.directories.length + 
                result.deletes.length + result.patches.length;
  
  logger.info('Bash file edits extracted', { 
    total,
    writes: result.writes.length,
    directories: result.directories.length,
    deletes: result.deletes.length,
    patches: result.patches.length,
  });
  
  return result;
}

/**
 * Convert bash edits to standard FileEdit format
 * For backward compatibility with existing code
 */
export function toStandardFileEdits(bashEdits: {
  writes: BashFileEdit[];
  directories: BashDirectoryEdit[];
  deletes: BashDeleteEdit[];
  patches: BashPatchEdit[];
}): Array<{ path: string; content: string; action?: 'write' | 'append' | 'delete' | 'patch' }> {
  const edits: Array<{ path: string; content: string; action?: 'write' | 'append' | 'delete' | 'patch' }> = [];

  // Convert writes
  for (const write of bashEdits.writes) {
    edits.push({
      path: write.path,
      content: write.content,
      action: write.mode,
    });
  }

  // Convert directories (mkdir - represented as write with empty content)
  for (const dir of bashEdits.directories) {
    edits.push({
      path: dir.path,
      content: '',
      action: 'write',
    });
  }

  // Convert deletes (empty content)
  for (const del of bashEdits.deletes) {
    edits.push({
      path: del.path,
      content: '',
      action: 'delete',
    });
  }

  // Convert patches (sed commands)
  for (const patch of bashEdits.patches) {
    edits.push({
      path: patch.path,
      content: `s/${patch.pattern}/${patch.replacement}/${patch.flags || ''}`,
      action: 'patch',
    });
  }

  return edits;
}
