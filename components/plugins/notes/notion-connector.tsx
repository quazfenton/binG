import React, { useState } from 'react'

/**
 * UI component to connect Notion using Composio or a backend OAuth flow.
 * Used by the Notes plugin UI and by Composio tool handlers.
 */

export const NotionConnector: React.FC<{ onClose?: () => void }> = ({ onClose }) => {
  const [connected, setConnected] = useState(false)
  const [loading, setLoading] = useState(false)

  const handleConnect = async () => {
    setLoading(true)
    try {
      // If Composio provides OAuth helper:
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      const composio = typeof window !== 'undefined' ? (window as any).Composio : undefined
      if (composio && typeof composio.openOAuth === 'function') {
        await composio.openOAuth('notion')
        setConnected(true)
      } else {
        // fallback: open backend OAuth start endpoint
        const w = window.open('/api/oauth/notion/start', '_blank')
        if (!w) throw new Error('Could not open OAuth window')
      }
    } catch (e) {
      console.error('Notion connect failed', e)
      alert('Failed to start Notion connect: ' + String(e))
    } finally {
      setLoading(false)
      onClose?.()
    }
  }

  return (
    <div>
      <h4>Notion</h4>
      <p>Save notes to your Notion account. Use this to authorize the Notes plugin.</p>
      <button onClick={handleConnect} disabled={loading}>
        {loading ? 'Connecting…' : connected ? 'Connected' : 'Connect Notion'}
      </button>
    </div>
  )
}