/**
 * Terminal Session Storage
 * 
 * Persists terminal state (command history, sandbox info) to localStorage
 * for session recovery across page reloads and tab switches.
 */

export interface TerminalSessionData {
  id: string;
  name: string;
  commandHistory: string[];
  sandboxInfo?: {
    sessionId?: string;
    sandboxId?: string;
    status: 'creating' | 'active' | 'error' | 'none';
    resources?: {
      cpu?: string;
      memory?: string;
    };
  };
  lastUsed: number;
}

const STORAGE_KEY = 'terminal_sessions';
const MAX_SESSIONS = 5;
const SESSION_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Save terminal session to localStorage
 */
export function saveTerminalSession(session: TerminalSessionData): void {
  try {
    const sessions = getTerminalSessions();
    
    // Remove existing session with same id
    const filtered = sessions.filter(s => s.id !== session.id);
    
    // Add updated session
    filtered.push({
      ...session,
      lastUsed: Date.now()
    });
    
    // Keep only most recent sessions
    const sorted = filtered.sort((a, b) => b.lastUsed - a.lastUsed).slice(0, MAX_SESSIONS);
    
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sorted));
  } catch (error) {
    console.error('Failed to save terminal session:', error);
  }
}

/**
 * Get all terminal sessions from localStorage
 */
export function getTerminalSessions(): TerminalSessionData[] {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    if (!data) return [];
    
    const sessions = JSON.parse(data) as TerminalSessionData[];
    
    // Filter out expired sessions
    const now = Date.now();
    return sessions.filter(s => now - s.lastUsed < SESSION_TTL);
  } catch (error) {
    console.error('Failed to get terminal sessions:', error);
    return [];
  }
}

/**
 * Get a specific terminal session by id
 */
export function getTerminalSession(sessionId: string): TerminalSessionData | null {
  const sessions = getTerminalSessions();
  return sessions.find(s => s.id === sessionId) || null;
}

/**
 * Clear all terminal sessions
 */
export function clearTerminalSessions(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    console.error('Failed to clear terminal sessions:', error);
  }
}

/**
 * Delete a specific terminal session
 */
export function deleteTerminalSession(sessionId: string): void {
  try {
    const sessions = getTerminalSessions();
    const filtered = sessions.filter(s => s.id !== sessionId);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
  } catch (error) {
    console.error('Failed to delete terminal session:', error);
  }
}

/**
 * Save command to session history
 */
export function addCommandToHistory(sessionId: string, command: string): void {
  const session = getTerminalSession(sessionId);
  if (session) {
    const updatedHistory = [...session.commandHistory, command].slice(-100); // Keep last 100
    saveTerminalSession({
      ...session,
      commandHistory: updatedHistory,
      lastUsed: Date.now()
    });
  }
}
