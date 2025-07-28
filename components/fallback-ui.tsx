"use client"

import { Button } from "@/components/ui/button"

interface FallbackUIProps {
  message?: string
  retry?: () => void
}

export default function FallbackUI({ message = "Loading...", retry }: FallbackUIProps) {
  return (
    <div className="flex flex-col items-center justify-center w-full h-screen bg-black text-white">
      <div className="text-center">
        <h2 className="text-xl font-medium text-gray-300 mb-4">
          {message}
        </h2>

        {/* Progress bar - keep the animation */}
        <div className="w-64 h-1 bg-gray-800 rounded-full mb-8 overflow-hidden">
          <div className="h-full bg-gradient-to-r from-purple-500 to-pink-500 rounded-full animate-pulse" 
               style={{ width: '60%' }} />
        </div>

        {/* Retry button */}
        {retry && (
          <Button 
            onClick={retry} 
            variant="outline" 
            className="border-white/20 text-white hover:bg-white/10"
          >
            Retry
          </Button>
        )}
      </div>
    </div>
  )
}
