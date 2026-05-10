"use client"

import { Button } from "@/components/ui/button"

interface FallbackUIProps {
  message?: string
  retry?: () => void
}

export default function FallbackUI({ message = "Loading...", retry }: FallbackUIProps) {
  return (
    <div className="flex flex-col items-center justify-center w-full h-screen bg-black text-white overflow-hidden">
      <div className="w-full max-w-xs relative z-10 px-6">
        <h2 className="text-[10px] uppercase font-medium text-gray-500 mb-2 tracking-[0.2em] text-center">
          {message}
        </h2>
        
        {/* Minimal dark loading bar */}
        <div className="h-[2px] w-full bg-gray-900 rounded-full overflow-hidden">
          <div className="h-full bg-gray-600 w-1/3 animate-loading-bar-sweep"></div>
        </div>

        {/* Retry button */}
        {retry && (
          <div className="mt-8 flex justify-center">
            <Button 
              onClick={retry} 
              variant="outline" 
              className="border-gray-800 text-gray-500 hover:bg-gray-900 hover:border-gray-700 transition-all duration-300 text-[10px] h-8 px-4 uppercase tracking-widest"
            >
              Retry
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
