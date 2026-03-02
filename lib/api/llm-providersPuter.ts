// Merge local provider list with Puter list, mark external models and prioritise unknown models.
// Exports helper to get flat model list and Puter adapter getter.

import localProviders from './llm-providers-data' // adjust if your data file is elsewhere
import { fetchPuterModels, getPuterAdapter } from './puter'

type ProviderModel = { id: string; name?: string; meta?: any; external?: boolean; labelSymbol?: string }

export async function getProvidersWithPuter(defaultApiKey?: string, puterBase?: string) {
  const providers: Record<string, any> = { ...localProviders }

  const puterList = await fetchPuterModels(puterBase).catch(() => [])
  const puterModels: Record<string, ProviderModel> = {}
  for (const raw of puterList) {
    const id = raw.id ?? raw.model ?? raw.name
    if (!id) continue
    puterModels[id] = {
      id,
      name: raw.name ?? id,
      meta: raw,
      external: true,
      labelSymbol: '·', // visible symbol for Puter-external models
    }
  }

  // Ensure providers.puter exists
  providers.puter = providers.puter || {
    id: 'puter',
    name: 'Puter (via proxy/server)',
    options: { baseURL: puterBase ?? 'https://api.puter.com/puterai/chat' },
    models: {},
  }

  // Build flat list for UI selection
  const allModels: ProviderModel[] = []

  // Local models first
  for (const p of Object.values(providers)) {
    for (const [mid, m] of Object.entries(p.models || {})) {
      allModels.push({
        id: mid,
        name: (m as any).name ?? mid,
        meta: m,
        external: false,
        labelSymbol: '',
      })
    }
  }

  // Add external puter models not in local list — push to front so they appear early
  for (const m of Object.values(puterModels)) {
    const exists = allModels.some((am) => am.id === m.id)
    if (!exists) {
      allModels.unshift(m)
    }
  }

  return {
    providers,
    flatModels: allModels,
    getPuterAdapterFor: (modelId: string, userApiKey?: string) => getPuterAdapter(modelId, { apiKey: userApiKey ?? defaultApiKey, baseURL: providers.puter.options.baseURL }),
    isExternalModel: (id: string) => !!puterModels[id],
  }
}