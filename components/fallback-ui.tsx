"use client"

import { Button } from "@/components/ui/button"

interface FallbackUIProps {
  message?: string
  retry?: () => void
}

export default function FallbackUI({ message = "Loading...", retry }: FallbackUIProps) {
  return (
    <div className="flex flex-col items-center justify-center w-full h-screen bg-black text-white overflow-hidden">
      {/* Subtle background animation */}
      <div className="absolute inset-0 opacity-10">
        <div className="absolute top-1/3 left-1/4 w-96 h-96 bg-white/5 rounded-full blur-3xl animate-float-slow"></div>
        <div className="absolute bottom-1/3 right-1/4 w-80 h-80 bg-gray-400/5 rounded-full blur-3xl animate-float-reverse"></div>
      </div>
      
      <div className="text-center relative z-10">
        {/* Ultra minimalist animated icon */}
        <div className="mb-12 relative">
          <div className="w-12 h-12 mx-auto mb-6 relative">
            {/* Simple pulsing square */}
            <div className="absolute inset-0 bg-gray-700 animate-minimal-pulse"></div>
            {/* Subtle corner indicators */}
            <div className="absolute -top-1 -left-1 w-2 h-2 bg-gray-600 animate-corner-fade"></div>
            <div className="absolute -top-1 -right-1 w-2 h-2 bg-gray-600 animate-corner-fade" style={{animationDelay: '0.5s'}}></div>
            <div className="absolute -bottom-1 -left-1 w-2 h-2 bg-gray-600 animate-corner-fade" style={{animationDelay: '1s'}}></div>
            <div className="absolute -bottom-1 -right-1 w-2 h-2 bg-gray-600 animate-corner-fade" style={{animationDelay: '1.5s'}}></div>
          </div>
        </div>

        <h2 className="text-lg font-light text-gray-400 mb-8 tracking-wide">
          {message}
        </h2>

        {/* Three minimal dots */}
        <div className="flex justify-center space-x-2 mb-8">
          <div className="w-1 h-1 bg-gray-600 rounded-full animate-dot-bounce"></div>
          <div className="w-1 h-1 bg-gray-600 rounded-full animate-dot-bounce" style={{animationDelay: '0.2s'}}></div>
          <div className="w-1 h-1 bg-gray-600 rounded-full animate-dot-bounce" style={{animationDelay: '0.4s'}}></div>
        </div>

        {/* Retry button */}
        {retry && (
          <Button 
            onClick={retry} 
            variant="outline" 
            className="border-gray-600 text-gray-300 hover:bg-gray-800/50 hover:border-gray-500 transition-all duration-300"
          >
            Retry
          </Button>
        )}
      </div>
    </div>
  )
}
