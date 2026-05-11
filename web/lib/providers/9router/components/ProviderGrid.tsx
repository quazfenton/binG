"use client"

import { useState, useEffect, useCallback } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ProviderConnectButton } from "./ProviderConnectButton"
import { getAllProviders } from "@/lib/providers/9router/providers"
import { getUserRouterConnections, revokeUserRouterConnection, isTokenExpiringSoon } from "@/lib/providers/9router/token-store"
import type { OAuthConnection } from "@/lib/auth/oauth-service"

export type ConnectionStatus = "connected" | "disconnected" | "expiring"

export interface ProviderStatus {
  providerId: string
  status: ConnectionStatus
  connection?: OAuthConnection
}

export interface ProviderGridProps {
  userId: string
  baseUrl?: string
  onConnect?: (providerId: string) => void
  onDisconnect?: (providerId: string) => void
  onError?: (error: Error, providerId?: string) => void
  refreshInterval?: number
}

function formatTimeRemaining(expiresAt: Date): string {
  const remaining = expiresAt.getTime() - Date.now()
  if (remaining <= 0) return "Expired"
  const minutes = Math.floor(remaining / 60000)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)
  if (days > 0) return days + "d " + (hours % 24) + "h"
  if (hours > 0) return hours + "h " + (minutes % 60) + "m"
  if (minutes > 0) return minutes + "m"
  return "<1m"
}

function getStatusVariant(status: ConnectionStatus): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "connected": return "default"
    case "expiring": return "secondary"
    case "disconnected": return "outline"
  }
}

function getStatusLabel(status: ConnectionStatus, isExpiring: boolean): string {
  if (status === "expiring" || isExpiring) return "Expiring"
  if (status === "connected") return "Connected"
  return "Not Connected"
}

function useProviderStatuses(userId: string, refreshInterval?: number) {
  const [statuses, setStatuses] = useState<Map<string, ProviderStatus>>(new Map())
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      const connections = await getUserRouterConnections(userId)
      const map = new Map<string, ProviderStatus>()

      for (const provider of getAllProviders()) {
        map.set(provider.id, { providerId: provider.id, status: "disconnected" })
      }

      for (const connection of connections) {
        const expiring = connection.tokenExpiresAt ? isTokenExpiringSoon(connection.tokenExpiresAt) : false
        map.set(connection.provider, {
          providerId: connection.provider,
          status: expiring ? "expiring" : "connected",
          connection,
        })
      }

      setStatuses(map)
      setLoading(false)
    } catch (error) {
      console.error("Failed to load provider statuses:", error)
      setLoading(false)
    }
  }, [userId])

  useEffect(() => {
    load()
    if (refreshInterval && refreshInterval > 0) {
      const interval = setInterval(load, refreshInterval)
      return () => clearInterval(interval)
    }
  }, [load, refreshInterval])

  return { statuses, loading, refresh: load }
}

export function ProviderGrid({
  userId,
  baseUrl,
  onConnect,
  onDisconnect,
  onError,
  refreshInterval = 60000,
}: ProviderGridProps) {
  const { statuses, loading, refresh } = useProviderStatuses(userId, refreshInterval)
  const [disconnectingProvider, setDisconnectingProvider] = useState<string | null>(null)

  const handleDisconnect = async (providerId: string) => {
    setDisconnectingProvider(providerId)
    try {
      await revokeUserRouterConnection(userId, providerId)
      await refresh()
      onDisconnect?.(providerId)
    } catch (error) {
      onError?.(error as Error, providerId)
    } finally {
      setDisconnectingProvider(null)
    }
  }

  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {[1, 2, 3].map((i) => (
          <Card key={i} className="animate-pulse">
            <CardHeader>
              <div className="h-6 bg-muted rounded w-3/4" />
            </CardHeader>
            <CardContent>
              <div className="h-4 bg-muted rounded w-1/2" />
            </CardContent>
          </Card>
        ))}
      </div>
    )
  }

  const providers = getAllProviders()

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {providers.map((provider) => {
        const status = statuses.get(provider.id)
        const isConnected = status?.status === "connected" || status?.status === "expiring"
        const isExpiring = status?.status === "expiring"
        const isDisconnecting = disconnectingProvider === provider.id

        return (
          <Card
            key={provider.id}
            className={
              "relative overflow-hidden transition-all duration-200 " +
              (isConnected ? "border-primary" : "")
            }
          >
            {isConnected && (
              <div
                className={
                  "absolute top-0 left-0 right-0 h-1 " +
                  (isExpiring ? "bg-yellow-500" : "bg-green-500")
                }
              />
            )}
            <CardHeader className="pb-2">
              <div className="flex items-center gap-3">
                {provider.icon && (
                  <img
                    src={provider.icon}
                    alt={provider.name}
                    className="w-10 h-10 rounded-full object-contain bg-white border"
                    onError={(e) => {
                      const target = e.target as HTMLImageElement
                      target.style.display = "none"
                    }}
                  />
                )}
                <div className="flex-1 min-w-0">
                  <CardTitle className="text-base">{provider.name}</CardTitle>
                  <CardDescription className="text-xs truncate">
                    {provider.description}
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-2">
              <div className="flex items-center justify-between gap-2">
                <Badge variant={getStatusVariant(status?.status || "disconnected")}>
                  {getStatusLabel(status?.status || "disconnected", isExpiring)}
                </Badge>
                {isConnected && status?.connection?.tokenExpiresAt && (
                  <span className="text-xs text-muted-foreground">
                    {formatTimeRemaining(new Date(status.connection.tokenExpiresAt))}
                  </span>
                )}
              </div>
              <div className="mt-3">
                {isConnected ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={() => handleDisconnect(provider.id)}
                    disabled={isDisconnecting}
                  >
                    {isDisconnecting ? "Disconnecting..." : "Disconnect"}
                  </Button>
                ) : (
                  <ProviderConnectButton
                    provider={provider}
                    userId={userId}
                    baseUrl={baseUrl}
                    onSuccess={(connectionId) => {
                      refresh()
                      onConnect?.(provider.id)
                    }}
                    onError={(error: string) => onError?.(new Error(error), provider.id)}
                  />
                )}
              </div>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}

export interface ProviderGridCompactProps {
  userId: string
  baseUrl?: string
  maxProviders?: number
  onConnect?: (providerId: string) => void
  onDisconnect?: (providerId: string) => void
  onError?: (error: Error, providerId?: string) => void
}

export function ProviderGridCompact({
  userId,
  baseUrl,
  maxProviders = 6,
  onConnect,
  onDisconnect,
  onError,
}: ProviderGridCompactProps) {
  const { statuses, loading, refresh } = useProviderStatuses(userId, undefined)
  const [disconnectingProvider, setDisconnectingProvider] = useState<string | null>(null)

  const handleDisconnect = async (providerId: string) => {
    setDisconnectingProvider(providerId)
    try {
      await revokeUserRouterConnection(userId, providerId)
      await refresh()
      onDisconnect?.(providerId)
    } catch (error) {
      onError?.(error as Error, providerId)
    } finally {
      setDisconnectingProvider(null)
    }
  }

  if (loading) {
    return <div className="space-y-2 animate-pulse">
      {[1, 2, 3].map((i) => (
        <div key={i} className="h-12 bg-muted rounded" />
      ))}
    </div>
  }

  const providers = getAllProviders().slice(0, maxProviders)

  return (
    <div className="space-y-2">
      {providers.map((provider) => {
        const status = statuses.get(provider.id)
        const isConnected = status?.status === "connected" || status?.status === "expiring"
        const isExpiring = status?.status === "expiring"
        const isDisconnecting = disconnectingProvider === provider.id

        return (
          <div
            key={provider.id}
            className={
              "flex items-center gap-3 p-2 rounded-lg border transition-colors " +
              (isConnected ? "bg-primary/5 border-primary/20" : "bg-card")
            }
          >
            {provider.icon && (
              <img
                src={provider.icon}
                alt={provider.name}
                className="w-8 h-8 rounded-full object-contain bg-white border"
                onError={(e) => {
                  const target = e.target as HTMLImageElement
                  target.style.display = "none"
                }}
              />
            )}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{provider.name}</p>
              <div className="flex items-center gap-1">
                <Badge variant={getStatusVariant(status?.status || "disconnected")} className="text-xs">
                  {getStatusLabel(status?.status || "disconnected", isExpiring)}
                </Badge>
                {isConnected && status?.connection?.tokenExpiresAt && (
                  <span className="text-xs text-muted-foreground">
                    {formatTimeRemaining(new Date(status.connection.tokenExpiresAt))}
                  </span>
                )}
              </div>
            </div>            {isConnected ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleDisconnect(provider.id)}
                disabled={isDisconnecting}
                className="text-destructive hover:text-destructive"
              >
                {isDisconnecting ? "..." : "×"}
              </Button>
            ) : (
              <ProviderConnectButton
                provider={provider}
                userId={userId}
                baseUrl={baseUrl}
                onSuccess={() => {
                  refresh()
                  onConnect?.(provider.id)
                }}
                onError={(error: string) => onError?.(new Error(error), provider.id)}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}
