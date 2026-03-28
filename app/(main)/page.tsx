"use client"

import { useState, useEffect } from "react"
import { ThemeProvider } from "../../components/theme-provider"
import FallbackUI from "../../components/fallback-ui"
import { startCacheCleanup } from "../../lib/cache"
import dynamic from "next/dynamic"

// Dynamically import components to avoid build-time SSR errors
// These components will only load on the client side
const TamboWrapper = dynamic(
  () => import("../../components/tambo/tambo-wrapper").then(mod => mod.TamboWrapper),
  { 
    ssr: false,
    loading: () => <FallbackUI message="Loading Tambo..." />
  }
)

const PWAInstallPrompt = dynamic(
  () => import("../../components/pwa-install-prompt").then(mod => mod.PWAInstallPrompt),
  { 
    ssr: false,
    loading: () => null
  }
)

const ConversationInterface = dynamic(
  () => import("../../components/conversation-interface"),
  { 
    ssr: false,
    loading: () => <FallbackUI message="Loading interface..." />
  }
)

export default function ChatBox() {
  const [mounted, setMounted] = useState(false)
  const CUSTOM_BG_MEDIA_KEY = "custom_bg_media_url"

  // Only render the 3D interface after component has mounted on the client
  useEffect(() => {
    setMounted(true)
    // Initialize cache cleanup
    startCacheCleanup()

    // Apply persisted or env-provided custom background media URL.
    const root = document.documentElement
    const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(CUSTOM_BG_MEDIA_KEY) : null
    const fallback = process.env.NEXT_PUBLIC_BG_MEDIA_URL || ""
    const mediaUrl = (saved || fallback || "").trim()

    if (mediaUrl) {
      // SECURITY: Validate URL before applying (client-side check)
      try {
        const url = new URL(mediaUrl)
        if (url.protocol !== 'https:') {
          console.warn('[Page] Blocked non-HTTPS background URL')
          return
        }
        
        // Block obvious SSRF attempts
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

      // Use image proxy to bypass CORS/hotlinking restrictions
      // The proxy will perform additional server-side SSRF validation
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
      <ConversationInterface />
      <PWAInstallPrompt />
    </TamboWrapper>
  )
}
