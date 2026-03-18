import { secureRandomString } from './utils';

// Stock words for naming after OneXX, TwoXX, ThreeXX
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

// Pre-defined first 3 names
const FIRST_THREE = [
  'One',   // Will add 2 random alphanumerics
  'Two',
  'Three',
];

// Session name state (in-memory for server restarts, would need DB for persistence)
let usedNames = new Set<string>();
let currentIndex = 0;

/**
 * Register a session as used (for tracking active sessions)
 * This stores the conversationId in usedNames so it can be cleaned up later
 */
export function registerActiveSession(conversationId: string): void {
  usedNames.add(conversationId.toLowerCase());
}

/**
 * Unregister a session by conversationId (for cleanup when sessions are deleted)
 * Frees up the conversationId from usedNames
 */
export function unregisterActiveSession(conversationId: string): void {
  const lowerId = conversationId.toLowerCase();
  if (usedNames.has(lowerId)) {
    usedNames.delete(lowerId);
    logger.debug(`Unregistered session: ${lowerId}`);
  }
}

/**
 * Reset the naming counter (for testing or fresh starts)
 */
export function resetSessionNaming(): void {
  usedNames.clear();
  currentIndex = 0;
}

/**
 * Generate a 2-character alphanumeric string (uppercase letters and digits)
 */
function generateTwoCharSuffix(): string {
  return secureRandomString(2, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789');
}

/**
 * Get the next stock word name
 */
function getNextStockName(): string {
  if (currentIndex < 3) {
    // First three use OneXX, TwoXX, ThreeXX pattern
    const prefix = FIRST_THREE[currentIndex];
    currentIndex++;
    return `${prefix}${generateTwoCharSuffix()}`;
  }
  
  // After first three, use stock words with suffix if needed
  const baseIndex = currentIndex - 3;
  const wordIndex = baseIndex % STOCK_WORDS.length;
  const repeatCount = Math.floor(baseIndex / STOCK_WORDS.length);
  const baseWord = STOCK_WORDS[wordIndex];
  
  currentIndex++;
  
  if (repeatCount === 0) {
    return baseWord;
  }
  
  return `${baseWord}${repeatCount}`;
}

/**
 * Generate a unique session name
 * First checks if the name is already used, if so appends alphanumeric
 */
function generateUniqueName(baseName: string): string {
  let candidate = baseName.toLowerCase();
  let suffix = '';
  let attempt = 0;
  
  while (usedNames.has(candidate)) {
    suffix = generateTwoCharSuffix();
    attempt++;
    candidate = `${baseName.toLowerCase()}${suffix}`;
    
    // Safety limit to prevent infinite loop
    if (attempt > 100) {
      // Fall back to random unique name
      candidate = `session${generateTwoCharSuffix()}${Date.now().toString(36)}`;
      break;
    }
  }
  
  usedNames.add(candidate);
  return candidate;
}

/**
 * Main function to generate a session name
 * @param suggestedFolderName - Optional folder name from LLM response
 * @param isNewProject - Whether this is a new project (first generation)
 * @param hasOnlyOneFolder - Whether the response has only 1 pre-named folder
 */
export function generateSessionName(
  suggestedFolderName?: string,
  isNewProject: boolean = true,
  hasOnlyOneFolder: boolean = false
): string {
  // Rule 1: If it's a new project, has only 1 folder, and LLM suggested a name,
  // use the LLM-suggested folder name as the session ID
  if (isNewProject && hasOnlyOneFolder && suggestedFolderName) {
    const cleanName = suggestedFolderName
      .replace(/[^a-zA-Z0-9_-]/g, '')  // Remove special chars
      .replace(/^\d+/, '')              // Remove leading numbers
      .substring(0, 50);                // Limit length
    
    if (cleanName.length > 0) {
      return generateUniqueName(cleanName);
    }
  }
  
  // Rule 2: Use stock naming (OneXX, TwoXX, ThreeXX, then stock words)
  return generateUniqueName(getNextStockName());
}

/**
 * Check if a session name already exists in filesystem (for conflict detection)
 * Queries the actual filesystem state, not just in-memory cache
 */
export async function sessionNameExists(name: string): Promise<boolean> {
  // Check in-memory cache first for quick response
  if (usedNames.has(name.toLowerCase())) {
    return true;
  }
  
  // Query filesystem to check if session folder already exists
  try {
    const response = await fetch('/api/filesystem/list', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: `project/sessions/${name}`,
        recursive: false,
      }),
    });
    
    if (response.ok) {
      const payload = await response.json().catch(() => null);
      // If directory exists, name is taken
      if (payload?.success && payload?.data?.nodes?.length > 0) {
        // Register the name so we don't query again
        usedNames.add(name.toLowerCase());
        return true;
      }
    }
  } catch (error) {
    console.warn('Failed to check session name in filesystem:', error);
  }
  
  return false;
}

/**
 * Register a session name as used (for loading existing sessions)
 */
export function registerSessionName(name: string): void {
  usedNames.add(name.toLowerCase());
}

/**
 * Unregister a session name (for cleanup when sessions are deleted)
 * Frees up the name for reuse
 */
export function unregisterSessionName(name: string): void {
  const lowerName = name.toLowerCase();
  if (usedNames.has(lowerName)) {
    usedNames.delete(lowerName);
    // Adjust currentIndex to allow reuse of names if we're at the end
    // This is a simple heuristic - names can be reused if we've cycled through
    const stockWordNames = [...STOCK_WORDS.map(w => w.toLowerCase()), ...FIRST_THREE.map(f => f.toLowerCase())];
    if (!stockWordNames.includes(lowerName)) {
      // It's a generated name with suffix, safe to allow reuse
      logger.debug(`Unregistered session name: ${lowerName}`);
    }
  }
}

// Simple logger for session naming
const logger = {
  debug: (msg: string) => console.debug(`[SessionNaming] ${msg}`),
  info: (msg: string) => console.info(`[SessionNaming] ${msg}`),
  warn: (msg: string) => console.warn(`[SessionNaming] ${msg}`),
  error: (msg: string, err?: Error) => console.error(`[SessionNaming] ${msg}`, err),
};

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