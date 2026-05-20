"use client"

import { useState, useEffect, useCallback } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { toast } from "sonner"
import {
  ArrowLeft,
  Plug,
  AlertCircle,
  CheckCircle2,
  Shield,
  RefreshCw,
} from "lucide-react"
import { ProviderGrid } from "@/lib/providers/9router/components/ProviderConnectButton"
import { revokeUserRouterConnection, getUserRouterConnections } from "@/lib/providers/9router/token-store"
import type { OAuthConnection } from "@/lib/auth/oauth-service"

export default function ProvidersSettingsPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [mounted, setMounted] = useState(false)
  const [connections, setConnections] = useState<OAuthConnection[]>([])
  const [loading, setLoading] = useState(true)
  const [disconnecting, setDisconnecting] = useState<string | null>(null)

  const userId = "default-user"

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    const success = searchParams.get("success")
    const error = searchParams.get("error")
    const connected = searchParams.get("connected")

    if (success && connected === "true") {
      toast.success(`${success} connected successfully`)
    }
    if (error) {
      toast.error(decodeURIComponent(error))
    }
  }, [searchParams])

  const loadConnections = useCallback(async () => {
    try {
      setLoading(true)
      const conns = await getUserRouterConnections(userId)
      setConnections(conns)
    } catch (err) {
      console.error("[Providers] Failed to load connections:", err)
    } finally {
      setLoading(false)
    }
  }, [userId])

  useEffect(() => {
    if (mounted) {
      loadConnections()
    }
  }, [mounted, loadConnections])

  const handleConnect = useCallback((providerId: string) => {
    toast.success(`${providerId} connected`)
    loadConnections()
  }, [loadConnections])

  const handleDisconnect = useCallback(async (providerId: string) => {
    setDisconnecting(providerId)
    try {
      const revoked = await revokeUserRouterConnection(userId, providerId)
      if (revoked) {
        toast.success(`${providerId} disconnected`)
        loadConnections()
      } else {
        toast.error(`Failed to disconnect ${providerId}`)
      }
    } catch (err) {
      console.error(`[Providers] Failed to disconnect ${providerId}:`, err)
      toast.error(`Failed to disconnect ${providerId}`)
    } finally {
      setDisconnecting(null)
    }
  }, [userId, loadConnections])

  if (!mounted) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-white/20 border-t-white/80 rounded-full animate-spin mx-auto mb-4" />
          <p className="text-white/60 text-sm">Loading providers...</p>
        </div>
      </div>
    )
  }

  const connectedIds = connections.map(c => c.provider)

  return (
    <div className="min-h-screen bg-gradient-to-b from-black via-black to-white/5 text-white">
      {/* Header */}
      <div className="border-b border-white/10 bg-black/40 backdrop-blur-xl">
        <div className="container mx-auto px-4 py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => router.push("/settings")}
                className="text-white/60 hover:text-white"
              >
                <ArrowLeft className="w-4 h-4 mr-1" />
                Back
              </Button>
              <div>
                <h1 className="text-2xl font-bold text-white">Provider Connections</h1>
                <p className="text-sm text-white/60 mt-1">
                  Connect your AI provider accounts via 9Router
                </p>
              </div>
            </div>
            <Badge variant="outline" className="border-purple-400/50 text-purple-400">
              <Plug className="w-3 h-3 mr-1" />
              {connectedIds.length} connected
            </Badge>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 py-8 max-w-6xl">
        {/* Security Notice */}
        <Card className="mb-6 bg-white/5 border-white/10">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Shield className="w-5 h-5 text-green-400" />
              <CardTitle className="text-white">Secure Token Storage</CardTitle>
            </div>
            <CardDescription className="text-white/60">
              OAuth tokens are encrypted at rest using AES-256-GCM and automatically refreshed before expiry
            </CardDescription>
          </CardHeader>
        </Card>

        {/* Connected Providers Summary */}
        {connectedIds.length > 0 && (
          <Card className="mb-6 bg-white/5 border-white/10">
            <CardHeader>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-green-400" />
                <CardTitle className="text-white">Active Connections</CardTitle>
              </div>
              <CardDescription className="text-white/60">
                {connectedIds.length} provider{connectedIds.length > 1 ? "s" : ""} connected to your account
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {connections.map(conn => (
                  <Badge
                    key={conn.id}
                    variant="outline"
                    className="border-green-400/50 text-green-400 flex items-center gap-2"
                  >
                    <span className="w-2 h-2 bg-green-500 rounded-full inline-block" />
                    {conn.providerDisplayName || conn.provider}
                    {conn.tokenExpiresAt && (
                      <span className="text-white/40 text-xs">
                        expires {conn.tokenExpiresAt.toLocaleDateString()}
                      </span>
                    )}
                    <button
                      onClick={() => handleDisconnect(conn.provider)}
                      disabled={disconnecting === conn.provider}
                      className="ml-1 text-white/40 hover:text-red-400 disabled:opacity-50"
                      title={`Disconnect ${conn.provider}`}
                    >
                      {disconnecting === conn.provider ? (
                        <RefreshCw className="w-3 h-3 animate-spin" />
                      ) : (
                        "×"
                      )}
                    </button>
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Provider Connection Grid */}
        <Card className="bg-white/5 border-white/10">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Plug className="w-5 h-5 text-blue-400" />
              <CardTitle className="text-white">Connect Providers</CardTitle>
            </div>
            <CardDescription className="text-white/60">
              Select a provider to connect via OAuth. You will be redirected to authorize access.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!process.env.NEXT_PUBLIC_NINEROUTER_BASE_URL ? (
              <div className="p-6 border border-amber-200/30 rounded-lg bg-amber-500/10">
                <div className="flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-amber-400 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-amber-300">9Router not configured</p>
                    <p className="text-xs text-amber-400/70 mt-1">
                      Set <code className="px-1 py-0.5 bg-black/30 rounded">NEXT_PUBLIC_NINEROUTER_BASE_URL</code> in your environment to enable provider connections.
                    </p>
                  </div>
                </div>
              </div>
            ) : loading ? (
              <div className="flex items-center justify-center py-12">
                <RefreshCw className="w-6 h-6 animate-spin text-white/40" />
              </div>
            ) : (
              <ProviderGrid
                userId={userId}
                connectedProviders={connectedIds}
                onConnect={handleConnect}
                onDisconnect={handleDisconnect}
                baseUrl={process.env.NEXT_PUBLIC_NINEROUTER_BASE_URL}
              />
            )}
          </CardContent>
        </Card>

        {/* Footer */}
        <div className="mt-8 text-center text-xs text-white/40">
          <p>Provider connections are managed through 9Router</p>
          <p className="mt-1">Tokens are encrypted and refreshed automatically</p>
        </div>
      </div>
    </div>
  )
}
