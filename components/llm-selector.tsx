import React, { useEffect, useState } from 'react'
import { getProvidersWithPuter } from '../lib/api/llm-providers'
import { getUserApiKeyForModel } from '../lib/auth-keys'

export const LLMSelector: React.FC<{ defaultKey?: string; puterBase?: string; onSelect?: (modelId: string, key?: string) => void }> = ({ defaultKey, puterBase, onSelect }) => {
  const [models, setModels] = useState<Array<any>>([])

  useEffect(() => {
    ;(async () => {
      const { flatModels } = await getProvidersWithPuter(defaultKey, puterBase)
      setModels(flatModels)
    })()
  }, [defaultKey, puterBase])

  const handleSelect = (id: string) => {
    const userKey = getUserApiKeyForModel(id)
    onSelect?.(id, userKey || defaultKey)
  }

  return (
    <div>
      <label>Model</label>
      <select onChange={(e) => handleSelect(e.target.value)}>
        {models.map((m) => (
          <option key={m.id} value={m.id}>
            {(m.labelSymbol ? `${m.labelSymbol} ` : '') + (m.name ?? m.id)}
          </option>
        ))}
      </select>
    </div>
  )
}