"use client"

import { useState, useEffect } from "react"
import FallbackUI from "../../components/fallback-ui"
import { startCacheCleanup } from "../../lib/utils/cache"
import dynamic from "next/dynamic"
import { Toaster } from "@/components/ui/sonner"

// Dynamically import components to avoid build-time SSR errors
const TamboWrapper = dynamic(
  () => import("../../components/tambo/tambo-wrapper").then(mod => mod.TamboWrapper),
  { ssr: false, loading: () => <FallbackUI message="Loading Tambo..." /> }
)

const PWAInstallPrompt = dynamic(
  () => import("../../components/pwa-install-prompt").then(mod => mod.PWAInstallPrompt),
  { ssr: false, loading: () => null }
)

const ConversationInterface = dynamic(
  () => import("../../components/conversation-interface"),
  { ssr: false, loading: () => <FallbackUI message="Loading interface..." /> }
)

const ResponseStyleProvider = dynamic(
  () => import("@/contexts/response-style-context").then(mod => mod.ResponseStyleProvider),
  { ssr: false, loading: () => null }
)

const TopPanel = dynamic(
  () => import("@/components/top-panel"),
  { ssr: false, loading: () => null }
)

const PreviewToast = dynamic(
  () => import("@/components/preview-toast"),
  { ssr: false, loading: () => null }
)

export default function ChatBox() {
  const [mounted, setMounted] = useState(false)
  const [workspaceId, setWorkspaceId] = useState<string | undefined>(undefined)
  const CUSTOM_BG_MEDIA_KEY = "custom_bg_media_url"

  useEffect(() => {
    setMounted(true)
    startCacheCleanup()

    // Derive the workspace ID from session storage for preview subscriptions.
    // Uses the same format as ConversationInterface's filesystemScopePath.
    //
    // Polling + storage event listener because:
    // - sessionStorage changes are same-origin but the 'storage' event only
    //   fires for OTHER tabs, not the current one
    // - ConversationInterface updates sessionStorage asynchronously after
    //   the LLM detects a folder name or generates a new session ID
    // - A 2s poll interval catches same-tab changes without overhead
    const deriveWorkspaceId = () => {
      try {
        const compositeId = sessionStorage.getItem('current_composite_session_id');
        if (compositeId) {
          const dollarIndex = compositeId.lastIndexOf('$');
          const folder = dollarIndex !== -1 ? compositeId.slice(dollarIndex + 1) : compositeId;
          setWorkspaceId(`workspace/sessions/${folder}`);
        }
      } catch { /* sessionStorage unavailable */ }
    };

    deriveWorkspaceId();
    const interval = setInterval(deriveWorkspaceId, 2000);
    window.addEventListener('storage', deriveWorkspaceId);
    return () => {
      clearInterval(interval);
      window.removeEventListener('storage', deriveWorkspaceId);
    };

    // Apply background media
    const root = document.documentElement
    const saved = typeof window !== "undefined" && localStorage.getItem(CUSTOM_BG_MEDIA_KEY)
    const fallback = process.env.NEXT_PUBLIC_BG_MEDIA_URL || ""
    const mediaUrl = (saved || fallback || "").trim()

    if (mediaUrl) {
      try {
        const url = new URL(mediaUrl)
        if (url.protocol !== 'https:') {
          console.warn('[Page] Blocked non-HTTPS background URL')
          return
        }

        const hostname = url.hostname.toLowerCase()
        const blockedPatterns = [
          'localhost', '127.', '10.', '192.168.', '172.16.', '172.17.', '172.18.',
          '172.19.', '172.20.', '172.21.', '172.22.', '172.23.', '172.24.', '172.25.',
          '172.26.', '172.27.', '172.28.', '172.29.', '172.30.', '172.31.',
          '169.254.', '0.0.0.0', '.local', '.internal', 'metadata'
        ]

        if (blockedPatterns.some(pattern => hostname.includes(pattern))) {
          console.warn('[Page] Blocked unsafe background URL:', mediaUrl)
          return
        }
      } catch (e) {
        console.warn('[Page] Invalid background URL:', mediaUrl)
        return
      }

      const proxiedUrl = `/api/image-proxy?url=${encodeURIComponent(mediaUrl)}`
      root.style.setProperty("--app-bg-media", `url("${proxiedUrl}")`)
      root.style.setProperty("--app-bg-media-opacity", "0.12")
    }
  }, [])

  if (!mounted) {
    return <FallbackUI message="Initializing..." />
  }

  return (
    <TamboWrapper>
      <TopPanel />
      <ResponseStyleProvider>
        <ConversationInterface />
      </ResponseStyleProvider>
      <PWAInstallPrompt />
      <PreviewToast workspaceId={workspaceId} />
      <Toaster position="bottom-right" expand={false} richColors closeButton />
    </TamboWrapper>
  )
}
