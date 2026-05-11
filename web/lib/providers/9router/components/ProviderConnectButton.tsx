"use client"

import { useState, useEffect } from "react"
import { getRouterClient } from '@/lib/storage/ipfs/client'
import { createOAuthState } from "@/lib/providers/9router/oauth-utils"
import { getAllProviders, type ProviderConfig } from "@/lib/sandbox/providers/sandbox-provider"
import type { OAuthProvider } from '@/lib/voice/types'

interface Props {
  provider: ProviderConfig
  userId: string
  baseUrl?: string
  onSuccess?: (connectionId: string) => void
  onError?: (error: string) => void
}

export function ProviderConnectButton({ provider, userId, baseUrl, onSuccess, onError }: Props) {
  const [isLoading, setIsLoading] = useState(false)
  const [pollingInterval, setPollingInterval] = useState<number | null>(null)
  const [deviceCodeData, setDeviceCodeData] = useState<{ userCode: string; verificationUri: string } | null>(null)
  const routerBaseUrl = baseUrl || process.env.NEXT_PUBLIC_NINEROUTER_BASE_URL || ""

  useEffect(() => {
    return () => { if (pollingInterval) clearInterval(pollingInterval) }
  }, [pollingInterval])

  const handleConnect = async () => {
    setIsLoading(true)
    setDeviceCodeData(null)
    try {
      const client = getRouterClient({ baseUrl: routerBaseUrl, adminKey: process.env.NINEROUTER_ADMIN_KEY || "" })
      if (provider.oauthType === "device_code") {
        const result = await client.startOAuth(provider.id as OAuthProvider)
        if (result.deviceCode) {
          setDeviceCodeData({ userCode: result.userCode!, verificationUri: result.verificationUri! })
          const interval = window.setInterval(async () => {
            const pollResult = await client.pollDeviceCode(provider.id as OAuthProvider, result.deviceCode!)
            if (pollResult.success) { clearInterval(interval); setPollingInterval(null); onSuccess?.(pollResult.connection!.id) }
            else if (pollResult.error && pollResult.error !== "pending" && pollResult.error !== "slow_down") { clearInterval(interval); setPollingInterval(null); onError?.(pollResult.error!) }
          }, result.pollInterval! * 1000)
          setPollingInterval(interval)
        }
      } else {
        const callbackUrl = "${window.location.origin}/api/9router/callback"
        const codeVerifier = generateRandomString(64)
        const state = await createOAuthState({ provider: provider.id, userId, codeVerifier, redirectUri: callbackUrl })
        const authResult = await client.startOAuth(provider.id as OAuthProvider, callbackUrl)
        if (authResult.authUrl) {
          const redirectUrl = authResult.authUrl.includes("state=") ? authResult.authUrl : authResult.authUrl + (authResult.authUrl.includes("?") ? "&" : "?") + "state=" + state
          window.location.href = redirectUrl
        }
      }
    } catch (err: any) { onError?.(err.message || "Failed to start OAuth"); setIsLoading(false) }
  }

  const cancelPolling = () => { if (pollingInterval) clearInterval(pollingInterval); setPollingInterval(null); setDeviceCodeData(null); setIsLoading(false) }

  if (deviceCodeData) return (
    <div className="p-4 border border-gray-200 rounded-lg bg-gray-50">
      <p className="text-sm font-medium">Authorize {provider.name}</p>
      <p className="text-xs text-gray-500 mt-1">Visit: <a href={deviceCodeData.verificationUri} target="_blank" rel="noopener" className="text-blue-600 hover:underline">{deviceCodeData.verificationUri}</a></p>
      <p className="text-lg font-mono mt-2 p-2 bg-white border rounded">{deviceCodeData.userCode}</p>
      <button onClick={cancelPolling} className="mt-2 text-xs text-gray-500 hover:text-gray-700">Cancel</button>
    </div>
  )

  return (
    <button onClick={handleConnect} disabled={isLoading} className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-white transition-all duration-200 ${isLoading ? "opacity-50 cursor-not-allowed" : "hover:opacity-90"}`} style={{ backgroundColor: provider.color }}>
      {isLoading ? <span>*</span> : <img src={provider.icon} alt={provider.name} className="w-5 h-5" />}
      Connect {provider.name}
    </button>
  )
}

function generateRandomString(length: number): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~"
  const array = new Uint8Array(length); crypto.getRandomValues(array)
  return Array.from(array, byte => chars[byte % chars.length]).join("")
}

interface ProviderGridProps { userId: string; connectedProviders?: string[]; onConnect: (providerId: string) => void; baseUrl?: string }

export function ProviderGrid({ userId, connectedProviders = [], onConnect, baseUrl }: ProviderGridProps) {
  const providers = getAllProviders()
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 p-4">
      {providers.map(p => (
        <div key={p.id} className="p-4 border rounded-lg hover:border-gray-400 transition-colors">
          <div className="flex items-center gap-2 mb-2"><img src={p.icon} alt={p.name} className="w-6 h-6" /><span className="font-medium">{p.name}</span></div>
          <p className="text-xs text-gray-500 mb-3">{p.description}</p>
          {connectedProviders.includes(p.id) ? <span className="text-xs text-green-600 font-medium">Connected</span> : <ProviderConnectButton provider={p} userId={userId} baseUrl={baseUrl} onSuccess={() => onConnect(p.id)} onError={(err) => console.error(err)} />}
        </div>
      ))}
    </div>
  )
}

