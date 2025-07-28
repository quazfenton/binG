"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Sparkles, Code, Zap, Brain } from "lucide-react"

interface FallbackUIProps {
  message?: string
  retry?: () => void
}

export default function FallbackUI({ message = "Loading...", retry }: FallbackUIProps) {
  const [currentIcon, setCurrentIcon] = useState(0)
  const [dots, setDots] = useState("")

  const icons = [
    { Icon: Brain, color: "text-purple-500" },
    { Icon: Code, color: "text-blue-500" },
    { Icon: Zap, color: "text-yellow-500" },
    { Icon: Sparkles, color: "text-pink-500" }
  ]

  useEffect(() => {
    const iconInterval = setInterval(() => {
      setCurrentIcon((prev) => (prev + 1) % icons.length)
    }, 800)

    const dotsInterval = setInterval(() => {
      setDots((prev) => {
        if (prev.length >= 3) return ""
        return prev + "."
      })
    }, 500)

    return () => {
      clearInterval(iconInterval)
      clearInterval(dotsInterval)
    }
  }, [])

  const { Icon, color } = icons[currentIcon]

  return (
    <div className="flex flex-col items-center justify-center w-full h-screen bg-gradient-to-br from-black via-gray-900 to-black text-white overflow-hidden">
      {/* Animated background particles */}
      <div className="absolute inset-0 overflow-hidden">
        {[...Array(20)].map((_, i) => (
          <div
            key={i}
            className="absolute w-1 h-1 bg-white/20 rounded-full animate-pulse"
            style={{
              left: `${Math.random() * 100}%`,
              top: `${Math.random() * 100}%`,
              animationDelay: `${Math.random() * 3}s`,
              animationDuration: `${2 + Math.random() * 3}s`
            }}
          />
        ))}
      </div>

      {/* Main content */}
      <div className="relative z-10 flex flex-col items-center">
        {/* Animated icon with glow effect */}
        <div className="relative mb-8">
          <div className={`absolute inset-0 ${color} opacity-20 blur-xl animate-pulse`}>
            <Icon className="h-16 w-16" />
          </div>
          <Icon className={`h-16 w-16 ${color} animate-bounce relative z-10`} />
        </div>

        {/* Animated title */}
        <div className="text-center mb-6">
          <h1 className="text-4xl font-bold bg-gradient-to-r from-purple-400 via-pink-500 to-blue-500 bg-clip-text text-transparent mb-2">
            kuji
          </h1>
          <h2 className="text-xl font-medium text-gray-300">
            {message}
            <span className="inline-block w-8 text-left">{dots}</span>
          </h2>
        </div>

        {/* Progress bar */}
        <div className="w-64 h-1 bg-gray-800 rounded-full mb-8 overflow-hidden">
          <div className="h-full bg-gradient-to-r from-purple-500 to-pink-500 rounded-full animate-pulse" 
               style={{ width: '60%' }} />
        </div>

        {/* Status text */}
        <p className="text-sm text-gray-400 text-center max-w-md mb-4">
          Initializing spatial interface & AI systems
        </p>

        {/* Retry button */}
        {retry && (
          <Button 
            onClick={retry} 
            variant="outline" 
            className="border-purple-500/50 text-purple-400 hover:bg-purple-500/10"
          >
            Retry Connection
          </Button>
        )}

        {/* Version info */}
        <div className="absolute bottom-8 text-xs text-gray-600">
          <span>v1.0.0 • Spatial AI Interface</span>
        </div>
      </div>
    </div>
  )
}
