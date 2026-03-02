"use client"

import { useState, useEffect } from "react"

export function useVoiceInput() {
  const [isListening, setIsListening] = useState(false)
  const [transcript, setTranscript] = useState("")
  const [recognition, setRecognition] = useState<any>(null)

  useEffect(() => {
    // Initialize speech recognition if available in the browser
    if (typeof window !== "undefined" && window.webkitSpeechRecognition) {
      try {
        // @ts-ignore - WebkitSpeechRecognition is not in the types
        const SpeechRecognition = window.webkitSpeechRecognition
        const recognition = new SpeechRecognition()

        recognition.continuous = true
        recognition.interimResults = true

        recognition.onresult = (event: any) => {
          let interimTranscript = ""
          let finalTranscript = ""

          for (let i = event.resultIndex; i < event.results.length; i++) {
            const transcript = event.results[i][0].transcript
            if (event.results[i].isFinal) {
              finalTranscript += transcript
            } else {
              interimTranscript += transcript
            }
          }

          setTranscript(finalTranscript || interimTranscript)
        }

        recognition.onend = () => {
          setIsListening(false)
        }

        setRecognition(recognition)
      } catch (error) {
        console.error("Error initializing speech recognition:", error)
      }
    }

    return () => {
      if (recognition) {
        try {
          recognition.stop()
        } catch (error) {
          console.error("Error stopping speech recognition:", error)
        }
      }
    }
  }, [])

  const startListening = () => {
    if (recognition) {
      try {
        setTranscript("")
        recognition.start()
        setIsListening(true)
      } catch (error) {
        console.error("Error starting speech recognition:", error)
        setIsListening(false)
      }
    } else {
      console.error("Speech recognition not supported or not initialized")
    }
  }

  const stopListening = () => {
    if (recognition) {
      try {
        recognition.stop()
        setIsListening(false)
      } catch (error) {
        console.error("Error stopping speech recognition:", error)
      }
    }
  }

  return {
    isListening,
    transcript,
    startListening,
    stopListening,
  }
}
