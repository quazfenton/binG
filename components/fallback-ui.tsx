"use client"

import { Button } from "@/components/ui/button"
import { Loader2 } from "lucide-react"

interface FallbackUIProps {
  message?: string
  retry?: () => void
}

export default function FallbackUI({ message = "Loading...", retry }: FallbackUIProps) {
  return (
    <div className="flex flex-col items-center justify-center w-full h-screen bg-black text-white">
      <Loader2 className="h-12 w-12 animate-spin mb-4 text-purple-500" />
      <h2 className="text-xl font-bold mb-4">{message}</h2>
      {retry && (
        <Button onClick={retry} variant="outline">
          Retry
        </Button>
      )}
      <p className="mt-8 text-sm text-gray-400 max-w-md text-center">
        ayooo chat requires WebGL and modern browser features. If loading takes too long, try a different browser or
        device.
      </p>
    </div>
  )
}
