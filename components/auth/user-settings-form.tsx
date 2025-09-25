import React, { useEffect, useState } from 'react'

export const UserSettingsForm: React.FC<{ selectedModelId?: string; onClose?: () => void }> = ({ selectedModelId, onClose }) => {
  const [userInfo, setUserInfo] = useState<any>(null)
  const [authing, setAuthing] = useState(false)

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    const puter = typeof window !== 'undefined' ? (window as any).puter : undefined
    if (puter?.auth?.getUser) {
      puter.auth.getUser().then((u: any) => setUserInfo(u)).catch(() => setUserInfo(null))
    }
  }, [selectedModelId])

  const handleAuthenticate = async () => {
    setAuthing(true)
    try {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      const puter = (window as any).puter
      if (!puter) throw new Error('Puter SDK not loaded')
      if (puter.ui && typeof puter.ui.authenticateWithPuter === 'function') {
        await puter.ui.authenticateWithPuter()
      } else if (puter.auth && typeof puter.auth.signIn === 'function') {
        await puter.auth.signIn({ attempt_temp_user_creation: true })
      } else {
        throw new Error('No supported Puter auth method found')
      }
      const u = await puter.auth.getUser()
      setUserInfo(u)
    } catch (e) {
      console.error('Puter auth failed', e)
      alert('Authentication failed: ' + String((e as Error).message ?? e))
    } finally {
      setAuthing(false)
      onClose?.()
    }
  }

  return (
    <div>
      <h3>User settings</h3>
      <p>
        If you choose a Puter model, Puter manages authentication and storage for you — there is no API key to paste. Click Authenticate to sign in with Puter.
      </p>
      <div>
        <button onClick={handleAuthenticate} disabled={authing}>
          {authing ? 'Authenticating…' : 'Authenticate with Puter'}
        </button>
      </div>
      {userInfo ? <pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(userInfo, null, 2)}</pre> : <div>Not signed in</div>}
    </div>
  )
}