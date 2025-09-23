import React, { useState, useEffect } from 'react'
import { saveUserApiKeyForModel, getUserApiKeyForModel } from '../../lib/auth-keys'

type Props = {
  onClose?: () => void
  selectedModelId?: string
  isExternal?: boolean
}

export const UserSettingsForm: React.FC<Props> = ({ onClose, selectedModelId, isExternal }) => {
  const [apiKey, setApiKey] = useState<string>('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (selectedModelId) {
      setApiKey(getUserApiKeyForModel(selectedModelId))
    }
  }, [selectedModelId])

  const handleSave = async () => {
    if (!selectedModelId) return
    setSaving(true)
    try {
      await saveUserApiKeyForModel(selectedModelId, apiKey)
    } catch (e) {
      console.error('failed save', e)
    } finally {
      setSaving(false)
      onClose?.()
    }
  }

  return (
    <div>
      <h3>User settings</h3>
      {isExternal && (
        <>
          <p>
            You selected an external model ({selectedModelId}). To use it in the browser, paste your API key below. Keys are stored locally in the browser for this demo.
          </p>
          <input value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="Paste model API key (kept locally)" />
        </>
      )}

      <div style={{ marginTop: 12 }}>
        <button onClick={handleSave} disabled={saving || (isExternal && !apiKey)}>
          Save
        </button>
        <button onClick={() => onClose?.()}>
          Cancel
        </button>
      </div>
    </div>
  )
}