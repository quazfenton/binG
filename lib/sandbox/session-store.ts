import type { WorkspaceSession } from './types'

const sessions = new Map<string, WorkspaceSession>()
const SESSION_TTL_MS = 4 * 60 * 60 * 1000 // 4 hours

export function saveSession(session: WorkspaceSession): void {
  session.lastActive = new Date().toISOString()
  sessions.set(session.sessionId, session)
}

export function getSession(sessionId: string): WorkspaceSession | undefined {
  const session = sessions.get(sessionId)
  if (!session) return undefined

  const elapsed = Date.now() - new Date(session.lastActive).getTime()
  if (elapsed > SESSION_TTL_MS) {
    sessions.delete(sessionId)
    return undefined
  }

  return session
}

export function getSessionByUserId(userId: string): WorkspaceSession | undefined {
  for (const session of sessions.values()) {
    if (session.userId === userId && session.status === 'active') {
      const elapsed = Date.now() - new Date(session.lastActive).getTime()
      if (elapsed <= SESSION_TTL_MS) return session
    }
  }
  return undefined
}

export function updateSession(sessionId: string, updates: Partial<WorkspaceSession>): void {
  const session = sessions.get(sessionId)
  if (session) {
    Object.assign(session, updates, { lastActive: new Date().toISOString() })
  }
}

export function deleteSession(sessionId: string): void {
  sessions.delete(sessionId)
}

export function getAllActiveSessions(): WorkspaceSession[] {
  const now = Date.now()
  const active: WorkspaceSession[] = []
  for (const [id, session] of sessions) {
    const elapsed = now - new Date(session.lastActive).getTime()
    if (elapsed > SESSION_TTL_MS) {
      sessions.delete(id)
    } else if (session.status === 'active') {
      active.push(session)
    }
  }
  return active
}
