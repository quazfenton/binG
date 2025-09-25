/**
 * Bridge utilities to link local site accounts to Puter accounts.
 * Keeps local email/password auth intact. Provides a "Link with Puter" flow.
 */

export async function ensurePuterAuthenticated() {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  const puter = typeof window !== 'undefined' ? (window as any).puter : undefined
  if (!puter) throw new Error('Puter SDK not loaded')
  try {
    const isSigned = await puter.auth.isSignedIn?.()
    if (!isSigned) {
      if (puter.ui?.authenticateWithPuter) {
        await puter.ui.authenticateWithPuter()
      } else if (puter.auth?.signIn) {
        // Must be invoked by user action
        await puter.auth.signIn({ attempt_temp_user_creation: true })
      }
    }
    const user = await puter.auth.getUser()
    return user
  } catch (e) {
    console.error('[puter-auth-bridge] auth failed', e)
    throw e
  }
}

/**
 * Suggestion: After linking, POST to /api/puter/link with the puter user id to record a mapping:
 * { localUserId, puterUserId }
 */