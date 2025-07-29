"use client"

import { useState, useEffect } from "react"
import dynamic from "next/dynamic"
import { ThemeProvider } from "@/components/theme-provider"
import FallbackUI from "@/components/fallback-ui"
import { startCacheCleanup } from "@/lib/cache"

// Import the main conversation interface
import ConversationInterface from "@/components/conversation-interface";

export default function ChatBox() {
  const [mounted, setMounted] = useState(false)

  // Only render the 3D interface after component has mounted on the client
  useEffect(() => {
    setMounted(true)
    // Initialize cache cleanup
    startCacheCleanup()
  }, [])

  if (!mounted) {
    return <FallbackUI message="Initializing..." />
  }

  return (
    <ThemeProvider>
      <ConversationInterface />
    </ThemeProvider>
  )
}
  
