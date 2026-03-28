"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { AlertCircle, RefreshCw, Shield, Wifi, Zap, Settings, CheckCircle2, XCircle } from "lucide-react"
import type { ModalState, ModalSuggestion } from "@/lib/sandbox/providers/modal-provider"

interface SandboxFallbackModalProps {
  modalState: ModalState
  onAction?: (action: string) => Promise<void>
  onClose?: () => void
}

export function SandboxFallbackModal({ modalState, onAction, onClose }: SandboxFallbackModalProps) {
  const [isProcessing, setIsProcessing] = useState<string | null>(null)

  const handleAction = async (action: string) => {
    if (isProcessing === action) return
    setIsProcessing(action)
    try {
      await onAction?.(action)
    } finally {
      setIsProcessing(null)
    }
  }

  const getReasonIcon = () => {
    switch (modalState.reason) {
      case "all_providers_down":
        return <XCircle className="w-12 h-12 text-red-500" />
      case "quota_exceeded":
        return <Shield className="w-12 h-12 text-orange-500" />
      case "network_error":
        return <Wifi className="w-12 h-12 text-yellow-500" />
      case "configuration_error":
        return <Settings className="w-12 h-12 text-blue-500" />
      default:
        return <AlertCircle className="w-12 h-12 text-gray-500" />
    }
  }

  const getReasonTitle = () => {
    switch (modalState.reason) {
      case "all_providers_down":
        return "All Sandbox Providers Unavailable"
      case "quota_exceeded":
        return "Sandbox Quota Exceeded"
      case "network_error":
        return "Network Connection Error"
      case "configuration_error":
        return "Configuration Error"
      default:
        return "Sandbox Unavailable"
    }
  }

  const getReasonDescription = () => {
    switch (modalState.reason) {
      case "all_providers_down":
        return "All cloud sandbox providers are currently unavailable. This may be due to service outages or API issues."
      case "quota_exceeded":
        return "You've exceeded your sandbox usage quota. Please upgrade your plan or wait for the quota to reset."
      case "network_error":
        return "Unable to connect to sandbox providers. Please check your internet connection and try again."
      case "configuration_error":
        return "There's an issue with your sandbox configuration. Please verify your API keys and settings."
      default:
        return "An unexpected error occurred while trying to create a sandbox environment."
    }
  }

  const getActionIcon = (action: string) => {
    switch (action) {
      case "retry":
        return <RefreshCw className="w-4 h-4" />
      case "use_local":
        return <Zap className="w-4 h-4" />
      case "check_status":
        return <CheckCircle2 className="w-4 h-4" />
      case "upgrade_quota":
        return <Shield className="w-4 h-4" />
      case "check_connection":
        return <Wifi className="w-4 h-4" />
      case "fix_config":
        return <Settings className="w-4 h-4" />
      default:
        return <AlertCircle className="w-4 h-4" />
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <Card className="w-full max-w-2xl bg-gray-900 border-gray-700 shadow-2xl">
        <CardHeader className="space-y-4">
          <div className="flex items-center justify-center">
            {getReasonIcon()}
          </div>
          <CardTitle className="text-2xl font-bold text-center text-white">
            {getReasonTitle()}
          </CardTitle>
          <CardDescription className="text-center text-gray-400">
            {getReasonDescription()}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-6">
          {/* Failed Providers */}
          {modalState.failedProviders.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-sm font-medium text-gray-300">Failed Providers</h4>
              <div className="flex flex-wrap gap-2">
                {modalState.failedProviders.map((provider) => (
                  <Badge
                    key={provider}
                    variant="destructive"
                    className="bg-red-900/50 text-red-200 border-red-700"
                  >
                    {provider}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* Sandbox Info */}
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div className="space-y-1">
              <p className="text-gray-500">Sandbox ID</p>
              <p className="text-gray-300 font-mono text-xs">{modalState.sandboxId}</p>
            </div>
            <div className="space-y-1">
              <p className="text-gray-500">Occurred At</p>
              <p className="text-gray-300 text-xs">
                {new Date(modalState.createdAt).toLocaleString()}
              </p>
            </div>
          </div>

          {/* Suggestions */}
          <div className="space-y-3">
            <h4 className="text-sm font-medium text-gray-300">Suggested Actions</h4>
            <div className="grid gap-2">
              {modalState.suggestions.map((suggestion) => (
                <Button
                  key={suggestion.action}
                  onClick={() => handleAction(suggestion.action)}
                  disabled={isProcessing === suggestion.action}
                  variant="outline"
                  className="w-full justify-start h-auto py-3 px-4 bg-gray-800/50 hover:bg-gray-800 border-gray-700 text-gray-200 hover:text-white transition-all"
                >
                  <div className="flex items-center gap-3">
                    {getActionIcon(suggestion.action)}
                    <div className="text-left">
                      <p className="font-medium">{suggestion.label}</p>
                      <p className="text-xs text-gray-400">{suggestion.description}</p>
                    </div>
                  </div>
                </Button>
              ))}
            </div>
          </div>
        </CardContent>

        <CardFooter className="flex justify-between border-t border-gray-700 pt-4">
          <Button
            variant="ghost"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-200"
          >
            Dismiss
          </Button>
          <Button
            onClick={() => handleAction("retry")}
            disabled={isProcessing === "retry"}
            className="bg-blue-600 hover:bg-blue-700 text-white"
          >
            {isProcessing === "retry" ? (
              <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
            ) : null}
            Try Again
          </Button>
        </CardFooter>
      </Card>
    </div>
  )
}

export default SandboxFallbackModal
