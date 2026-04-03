/**
 * Session Naming Service
 *
 * Optimized for O(1) lookups with comprehensive conflict handling.
 * Uses Set for O(1) has/add/delete operations.
 *
 * Naming scheme:
 * - First 999 sessions: 000, 001, 002, ... 998 (zero-padded sequential, starting at 000)
 * - After 999: Stock words (alpha, beta, gamma, ...)
 * - LLM suggestions: Sanitized and conflict-checked
 * - Copy suffixes: 000a, 000b, 000c... (letter suffixes for variants)
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Set
 */

import { secureRandomString } from './utils';

// Get the base URL for server-side fetch calls
function getBaseUrl(): string {
  if (typeof window !== 'undefined') {
    return ''; // Client-side: relative URL works
  }
  if (process.env.NEXT_PUBLIC_APP_URL) {
    return process.env.NEXT_PUBLIC_APP_URL;
  }
  // Default for local development
  return process.env.NODE_ENV === 'production' 
    ? 'https://binGPT.ai' 
    : 'http://localhost:3000';
}

// Simple logger for session naming (defined early to avoid hoisting issues)
const logger = {
  debug: (msg: string) => console.debug(`[SessionNaming] ${msg}`),
  info: (msg: string) => console.info(`[SessionNaming] ${msg}`),
  warn: (msg: string, err?: unknown) => console.warn(`[SessionNaming] ${msg}`, err),
  error: (msg: string, err?: unknown) => console.error(`[SessionNaming] ${msg}`, err),
};

// Stock words for naming after sequential numbers
const STOCK_WORDS = [
  'alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta',
  'iota', 'kappa', 'lambda', 'mu', 'nu', 'xi', 'omicron', 'pi', 'rho',
  'sigma', 'tau', 'upsilon', 'phi', 'chi', 'psi', 'omega',
  'nova', 'star', 'sun', 'moon', 'planet', 'comet', 'asteroid',
  'ocean', 'river', 'mountain', 'forest', 'desert', 'valley', 'meadow',
  'phoenix', 'dragon', 'tiger', 'eagle', 'wolf', 'bear', 'hawk',
  'crystal', 'emerald', 'ruby', 'sapphire', 'amethyst', 'diamond',
  'thunder', 'storm', 'cloud', 'rain', 'snow', 'wind', 'fire', 'ice',
  'echo', 'shadow', 'light', 'dark', 'wave', 'breeze',
  'canyon', 'dune', 'glacier', 'island', 'jungle', 'lagoon', 'marsh',
  'peak', 'reef', 'spire', 'tundra', 'upland', 'vista', 'wilds',
];

// OPTIMIZATION: Set provides O(1) lookup vs O(n) for Array
const usedNames = new Set<string>();
let currentIndex = 0;
let initialized = false;
// Mutex to prevent race conditions in session name generation
let nameGenerationLock = Promise.resolve();

// Cache for filesystem checks to avoid redundant API calls
const filesystemCheckCache = new Map<string, { exists: boolean; checkedAt: number }>();
const CACHE_TTL_MS = 5000; // 5 second cache

/**
 * Initialize the session naming service by scanning existing sessions
 * This ensures we don't reuse session numbers across tabs/reloads
 */
async function initializeSessionNaming(): Promise<void> {
  if (initialized) return;

  try {
    // Retry logic: VFS might not be ready immediately on page load
    let attempts = 0;
    let nodes: any[] = [];

    while (attempts < 3) {
      const response = await fetch(`${getBaseUrl()}/api/filesystem/list?path=${encodeURIComponent('project/sessions')}`);

      if (response.ok) {
        const payload = await response.json().catch(() => null);
        nodes = payload?.data?.nodes || [];

        // If we got results, break out of retry loop
        if (nodes.length > 0 || payload?.success !== false) {
          break;
        }
      }

      // Wait before retrying
      await new Promise(resolve => setTimeout(resolve, 100 * (attempts + 1)));
      attempts++;
    }

    // Find highest sequential number used
    let maxNumber = 0;
    for (const node of nodes) {
      const name = node.name || '';
      // Match 3-digit sequential names (000, 001, etc.)
      const match = /^(\d{3})$/.exec(name);
      if (match) {
        const num = parseInt(match[1], 10);
        if (num > maxNumber) maxNumber = num;
        // Register as used
        usedNames.add(name.toLowerCase());
      } else if (name.length > 0) {
        // Register non-sequential names too (including suffixed versions like 000a, 001a, alpha-2, my-project, etc.)
        usedNames.add(name.toLowerCase());
      }
    }

    // Start from the highest sequential number found
    // The usedNames Set ensures we skip any names that are already taken
    // If maxNumber is 0 (no sessions or only 000), currentIndex = 0, next will be 000 (or 000a if 000 taken)
    // If maxNumber is 1 (001 exists), currentIndex = 1, next will be 001 (or 001a if 001 taken)
    currentIndex = maxNumber;
    logger.info(`Initialized session naming: ${maxNumber} existing sessions found (from ${nodes.length} nodes), next index: ${currentIndex}`);
  } catch (error) {
    logger.warn(`Failed to initialize session naming from filesystem: ${error}`);
  }

  initialized = true;
}

/**
 * Register a session as used (for tracking active sessions)
 * Time complexity: O(1)
 */
export function registerActiveSession(conversationId: string): void {
  const lowerId = conversationId.toLowerCase();
  usedNames.add(lowerId);
  // Also cache filesystem check result
  filesystemCheckCache.set(lowerId, { exists: true, checkedAt: Date.now() });
}

/**
 * Unregister a session by conversationId (for cleanup when sessions are deleted)
 * Time complexity: O(1)
 */
export function unregisterActiveSession(conversationId: string): void {
  const lowerId = conversationId.toLowerCase();
  if (usedNames.has(lowerId)) {
    usedNames.delete(lowerId);
    filesystemCheckCache.delete(lowerId);
    logger.debug(`Unregistered session: ${lowerId}`);
  }
}

/**
 * Reset the naming counter (for testing or fresh starts)
 * Time complexity: O(1)
 */
export function resetSessionNaming(): void {
  usedNames.clear();
  filesystemCheckCache.clear();
  currentIndex = 0;
}

/**
 * Generate a zero-padded 3-digit number (000, 001, 002, etc.)
 * Time complexity: O(1)
 */
function generateSequentialNumber(index: number): string {
  // Use 0-based indexing for technical consistency (000, 001, 002...)
  return String(index).padStart(3, '0');
}

/**
 * Get the next session name using sequential numbering
 * Time complexity: O(1) for in-memory, O(API) if filesystem check needed
 */
async function getNextStockName(): Promise<string> {
  // Use sequential numbering: 000, 001, 002, ... 998
  if (currentIndex < 999) {
    // First check in-memory cache (fast, handles same-session conflicts)
    let candidateName = generateSequentialNumber(currentIndex);
    
    // If name is already used in this session, increment until we find an unused one
    while (usedNames.has(candidateName.toLowerCase())) {
      currentIndex++;
      if (currentIndex >= 999) {
        // Fall through to stock words
        break;
      }
      candidateName = generateSequentialNumber(currentIndex);
    }
    
    // If we're still in sequential range, do a filesystem check for cross-tab safety
    if (currentIndex < 999) {
      // Verify this name doesn't exist in filesystem (cross-tab safety)
      const existsInFs = await checkNameExistsInFilesystem(candidateName);

      if (existsInFs) {
        // Name taken by another tab - increment and try next
        currentIndex++;
        return getNextStockName(); // Recursively try next number
      }
    }

    currentIndex++;
    return candidateName;
  }

  // After 999 sessions, fall back to stock words with suffix if needed
  const baseIndex = currentIndex - 999;
  const wordIndex = baseIndex % STOCK_WORDS.length;
  const repeatCount = Math.floor(baseIndex / STOCK_WORDS.length);
  const baseWord = STOCK_WORDS[wordIndex];

  currentIndex++;

  if (repeatCount === 0) {
    return baseWord;
  }

  return `${baseWord}-${repeatCount}`;
}

/**
 * Check if a name exists in filesystem (without caching)
 * Used for cross-tab collision avoidance during name generation
 */
async function checkNameExistsInFilesystem(name: string): Promise<boolean> {
  try {
    // Check if the directory itself exists by listing parent and finding the name
    const response = await fetch(`${getBaseUrl()}/api/filesystem/list?path=${encodeURIComponent('project/sessions')}`);

    if (response.ok) {
      const payload = await response.json().catch(() => null);
      if (payload?.success && Array.isArray(payload?.data?.nodes)) {
        // Check if any node matches our name (case-insensitive)
        const nameLower = name.toLowerCase();
        return payload.data.nodes.some((node: any) => 
          node.name && node.name.toLowerCase() === nameLower
        );
      }
    }
  } catch (error) {
    logger.warn(`Failed to check name in filesystem: ${error}`);
  }
  return false;
}

/**
 * Generate a unique session name with O(1) conflict detection
 *
 * OPTIMIZATION: Uses Set for O(1) lookup instead of Array.includes() which is O(n)
 * Suffix strategy:
 * - Sequential names (000): 000a, 000b, 000c, ... (letter suffixes)
 * - Stock words (alpha): alpha-a, alpha-b, alpha-c, ...
 *
 * Note: We use letter suffixes (a, b, c) for clarity and to distinguish
 * from numeric suffixes used for stock word repeats (alpha-1, alpha-2).
 * This makes names like '000a' clearly identifiable as copies/variants.
 *
 * Time complexity: O(1) average case, O(k) worst case where k = number of conflicts
 *
 * @param baseName - Base name to make unique
 * @returns Unique name with suffix if needed
 */
function generateUniqueName(baseName: string): string {
  const normalizedName = baseName.toLowerCase();

  // OPTIMIZATION: O(1) lookup with Set
  if (!usedNames.has(normalizedName)) {
    usedNames.add(normalizedName);
    return normalizedName;
  }

  // Conflict detected - need suffix
  let attempt = 0;
  let candidate = '';

  // Letter suffixes for copies: a, b, c, d, e, f, g, h, i, j, k...
  const letterSuffixes = 'abcdefghijklmnopqrstuvwxyz';

  while (true) {
    attempt++;

    // Use letter suffix (a, b, c...) for first 26 attempts
    // Then fall back to numeric suffix with dash (name-1, name-2...)
    if (attempt <= 26) {
      const letter = letterSuffixes[attempt - 1];
      candidate = `${normalizedName}${letter}`;
    } else {
      // After 26 letter suffixes, use numeric with dash
      candidate = `${normalizedName}-${attempt - 26}`;
    }

    // O(1) conflict check
    if (!usedNames.has(candidate)) {
      usedNames.add(candidate);
      return candidate;
    }

    // Safety limit to prevent infinite loop (should never reach with good suffix strategy)
    if (attempt > 100) {
      // Fall back to guaranteed unique name with timestamp
      candidate = `session${Date.now().toString(36)}${secureRandomString(4)}`;
      usedNames.add(candidate);
      logger.warn(`Generated fallback unique name after 100 conflicts: ${candidate}`);
      return candidate;
    }
  }
}

/**
 * Detect folder structure from response content
 * Returns the single folder name if all files are in one folder
 */
export function detectSingleFolderFromResponse(content: string): string | null {
  if (!content || content.trim().length === 0) return null;
  
  const folderSet = new Set<string>();
  
  // Extract paths from WRITE commands: WRITE path <<<content>>>
  const writeRegex = /WRITE\s+<?([^\s<>]+)>?\s*<<<[\s\S]*?>>>/gi;
  let match: RegExpExecArray | null;
  while ((match = writeRegex.exec(content)) !== null) {
    const path = match[1]?.trim();
    if (path && path.includes('/')) {
      const folder = path.split('/')[0];
      if (folder && !folder.startsWith('<') && !folder.endsWith('>')) {
        folderSet.add(folder);
      }
    }
  }
  
  // Extract paths from <file_edit path="..."> tags
  const fileEditRegex = /<file_edit\s*path=["']([^"']+)["']/gi;
  while ((match = fileEditRegex.exec(content)) !== null) {
    const path = match[1]?.trim();
    if (path && path.includes('/')) {
      const folder = path.split('/')[0];
      folderSet.add(folder);
    }
  }
  
  // Extract paths from fenced code blocks with filename hints
  const codeBlockRegex = /```[a-zA-Z]*\s*(?:file|path|filename)\s*[:=]\s*([^\n]+)/gi;
  while ((match = codeBlockRegex.exec(content)) !== null) {
    const path = match[1]?.trim();
    if (path && path.includes('/')) {
      const folder = path.split('/')[0];
      folderSet.add(folder);
    }
  }
  
  // If exactly one folder found, return it
  if (folderSet.size === 1) {
    const folderName = Array.from(folderSet)[0];
    // Validate folder name (alphanumeric, no special chars)
    if (/^[a-zA-Z0-9_-]+$/.test(folderName)) {
      return folderName;
    }
  }
  
  return null;
}

/**
 * Main function to generate a session name
 * @param suggestedFolderName - Optional folder name from LLM response
 * @param isNewProject - Whether this is a new project (first generation)
 * @param hasOnlyOneFolder - Whether the response has only 1 pre-named folder
 *
 * Naming scheme:
 * - First 999 sessions: 000, 001, 002, ... 998 (zero-padded sequential, starting at 000)
 * - After 999: Stock words (alpha, beta, gamma, ...)
 * - If LLM suggests a name for single-folder projects, use that (with conflict check)
 * - Copy suffixes: 000a, 000b, 000c... (letter suffixes for variants)
 *
 * Conflict handling:
 * - Editing existing files in existing session = OK (auto-apply)
 * - New files with same names = CONFLICT (require approval in UI)
 * - LLM suggests existing folder name = Use it if empty, otherwise append suffix
 */
export async function generateSessionName(
  suggestedFolderName?: string,
  isNewProject: boolean = true,
  hasOnlyOneFolder: boolean = false
): Promise<string> {
  // Use mutex to prevent race conditions between concurrent requests
  let releaseLock: () => void;
  const lockPromise = new Promise<void>(resolve => {
    releaseLock = resolve;
  });

  const currentLock = nameGenerationLock;
  nameGenerationLock = lockPromise;

  await currentLock;

  try {
    // Ensure we've scanned existing sessions to avoid collisions
    await initializeSessionNaming();

    // Rule 1: If it's a new project, has only 1 folder, and LLM suggested a name,
    // use the LLM-suggested folder name as the session ID (with conflict handling)
    if (isNewProject && hasOnlyOneFolder && suggestedFolderName) {
      const cleanName = suggestedFolderName
        .replace(/[^a-zA-Z0-9_-]/g, '')  // Remove special chars (keep numbers!)
        .substring(0, 50);                // Limit length

      if (cleanName.length > 0) {
        // generateUniqueName will handle conflicts by appending suffix
        const name = generateUniqueName(cleanName);
        // Register immediately to prevent duplicate generation in same session
        registerSessionName(name);
        return name;
      }
    }

    // Rule 2: Use sequential numbering (001, 002, 003, ...)
    const name = generateUniqueName(await getNextStockName());
    // Register immediately to prevent duplicate generation in same session
    registerSessionName(name);
    return name;
  } finally {
    releaseLock!();
  }
}

/**
 * Check if a session name already exists in filesystem (for conflict detection)
 * 
 * OPTIMIZATION: Uses 2-level caching:
 * 1. In-memory Set (O(1) lookup)
 * 2. Filesystem check cache (5 second TTL to avoid redundant API calls)
 * 
 * Time complexity: O(1) for cached checks, O(API) for uncached
 * 
 * @param name - Session name to check
 * @returns true if name exists (in memory or filesystem)
 */
export async function sessionNameExists(name: string): Promise<boolean> {
  // Guard against undefined/null names to prevent URL parsing failures
  if (!name || typeof name !== 'string') {
    return false;
  }
  
  const normalizedName = name.toLowerCase();
  
  // Level 1: Check in-memory Set (O(1))
  if (usedNames.has(normalizedName)) {
    return true;
  }
  
  // Level 2: Check filesystem cache (O(1) if cached)
  const cached = filesystemCheckCache.get(normalizedName);
  if (cached) {
    const isFresh = (Date.now() - cached.checkedAt) < CACHE_TTL_MS;
    if (isFresh) {
      return cached.exists;
    }
    // Cache expired, remove it
    filesystemCheckCache.delete(normalizedName);
  }
  
  // Level 3: Query filesystem (expensive, but cached for 5 seconds)
  try {
    const response = await fetch(`${getBaseUrl()}/api/filesystem/list?path=${encodeURIComponent(`project/sessions/${name}`)}`);

    if (response.ok) {
      const payload = await response.json().catch(() => null);
      // If directory exists, name is taken
      const exists = !!(payload?.success && payload?.data?.nodes?.length > 0);
      
      // Cache the result
      filesystemCheckCache.set(normalizedName, {
        exists,
        checkedAt: Date.now(),
      });
      
      return exists;
    }
  } catch (error) {
    console.warn('Failed to check session name in filesystem:', error);
  }

  return false;
}

/**
 * Register a session name as used (for loading existing sessions)
 * Time complexity: O(1)
 */
export function registerSessionName(name: string): void {
  const normalizedName = name.toLowerCase();
  usedNames.add(normalizedName);
  filesystemCheckCache.set(normalizedName, { exists: true, checkedAt: Date.now() });
}

/**
 * Unregister a session name (for cleanup when sessions are deleted)
 * Frees up the name for reuse
 * Time complexity: O(1)
 */
export function unregisterSessionName(name: string): void {
  const lowerName = name.toLowerCase();
  if (usedNames.has(lowerName)) {
    usedNames.delete(lowerName);
    filesystemCheckCache.delete(lowerName);

    // Sequential names (001-999) and stock words can be reused safely
    const isSequential = /^\d{3}$/.test(lowerName);
    const isStockWord = STOCK_WORDS.some(w => w.toLowerCase() === lowerName);

    // Check if it's a suffixed name (e.g., 001-1, alpha-2) - these are safe to reuse
    const isSuffixedName = /^(\d{3}|\w+)-\d+$/.test(lowerName);

    if (isSuffixedName || (!isSequential && !isStockWord)) {
      // It's a generated name with suffix or custom name, safe to allow reuse
      logger.debug(`Unregistered session name: ${lowerName}`);
    }
  }
}

/**
 * Check if writes would potentially overwrite existing files
 * Returns true if there are existing files in the target directory
 */
export interface FileConflictCheck {
  hasConflict: boolean;
  existingFiles: string[];
  needsApproval: boolean;
}

/**
 * Analyze if a write operation would overwrite existing files
 * @param existingFiles - List of existing file paths in the target directory
 * @param newFiles - List of new file paths being written
 * @param isExistingSession - Whether this is an existing session (not new)
 */
export function checkFileConflicts(
  existingFiles: string[],
  newFiles: string[],
  isExistingSession: boolean
): FileConflictCheck {
  if (!isExistingSession) {
    // New project - no conflicts possible
    return { hasConflict: false, existingFiles: [], needsApproval: false };
  }
  
  const existingSet = new Set(existingFiles.map(f => f.toLowerCase()));
  const conflictingFiles = newFiles.filter(f => existingSet.has(f.toLowerCase()));
  
  // If same filename exists, needs approval
  const needsApproval = conflictingFiles.length > 0;
  
  return {
    hasConflict: conflictingFiles.length > 0,
    existingFiles: conflictingFiles,
    needsApproval,
  };
}

/**
 * Generate a unique name with suffix for conflict resolution
 */
export function generateUniqueNameWithSuffix(baseName: string): string {
  return generateUniqueName(baseName);
}