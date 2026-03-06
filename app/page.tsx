"use client"

import { useState, useEffect } from "react"
import dynamic from "next/dynamic"
import { ThemeProvider } from "../components/theme-provider"
import FallbackUI from "../components/fallback-ui"
import { startCacheCleanup } from "../lib/cache"
import { TamboWrapper } from "../components/tambo/tambo-wrapper"
import { PWAInstallPrompt } from "../components/pwa-install-prompt"

// Import the main conversation interface
import ConversationInterface from "../components/conversation-interface";

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
    const saved = localStorage.getItem(CUSTOM_BG_MEDIA_KEY)
    const fallback = process.env.NEXT_PUBLIC_BG_MEDIA_URL || ""
    const mediaUrl = (saved || fallback).trim()

    if (mediaUrl) {
      root.style.setProperty("--app-bg-media", `url("${mediaUrl}")`)
      root.style.setProperty("--app-bg-media-opacity", "0.12")
    }
  }, [])

  if (!mounted) {
    return <FallbackUI message="Initializing..." />
  }

  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="dark"
      themes={["dark", "light", "ocean", "forest", "sepia", "midnight"]}
      enableSystem={false}
      disableTransitionOnChange
    >
      <TamboWrapper>
        <ConversationInterface />
        <PWAInstallPrompt />
      </TamboWrapper>
    </ThemeProvider>
  )
}
  
