"use client"

import * as React from "react"
import { useToast } from "@/components/ui/use-toast"
import { cn } from "@/lib/utils"
import { HelpCircle, AlertTriangle, Lightbulb, X, ChevronRight, BookOpen } from "lucide-react"

interface StruggleDetection {
  type: 'repeated_error' | 'long_pause' | 'failed_attempt' | 'confusion'
  message: string
  suggestion?: string
  timestamp: number
}

interface ContextHelpState {
  struggles: StruggleDetection[]
  showTutorial: boolean
  tutorialStep: number
}

export function useContextHelp(thresholds = { errorThreshold: 3, pauseThreshold: 30000, attemptThreshold: 2 }) {
  const errorTimestamps = React.useRef<number[]>([])
  const actionTimestamps = React.useRef<Map<string, number>>(new Map())
  const [state, setState] = React.useState<ContextHelpState>({ struggles: [], showTutorial: false, tutorialStep: 0 })

  const detectError = React.useCallback((error: string) => {
    const now = Date.now()
    errorTimestamps.current.push(now)
    const recentErrors = errorTimestamps.current.filter(t => now - t < 60000)
    if (recentErrors.length >= thresholds.errorThreshold) {
      setState(s => ({ ...s, struggles: [...s.struggles, { type: 'repeated_error', message: 'Multiple errors detected', suggestion: 'Check your input format', timestamp: now }] }))
    }
  }, [thresholds.errorThreshold])

  const detectPause = React.useCallback((action: string) => {
    const now = Date.now()
    const lastAction = actionTimestamps.current.get(action) || now
    const elapsed = now - lastAction
    if (elapsed > thresholds.pauseThreshold) {
      setState(s => ({ ...s, struggles: [...s.struggles, { type: 'long_pause', message: `Long delay on ${action}`, suggestion: 'Try a simpler action', timestamp: now }] }))
    }
    actionTimestamps.current.set(action, now)
  }, [thresholds.pauseThreshold])

  const clearStruggles = React.useCallback(() => {
    setState(s => ({ ...s, struggles: [] }))
    errorTimestamps.current = []
    actionTimestamps.current = new Map()
  }, [])

  return { struggles: state.struggles, detectError, detectPause, clearStruggles, showTutorial: state.showTutorial, setShowTutorial: (v: boolean) => setState(s => ({ ...s, showTutorial: v })) }
}

interface ContextHelpToastProps { struggles: StruggleDetection[] }

export const ContextHelpToast: React.FC<ContextHelpToastProps> = ({ struggles }) => {
  const { toast } = useToast()
  React.useEffect(() => {
    if (struggles.length > 0) {
      const latest = struggles[struggles.length - 1]
      toast({ title: latest.type.replace('_', ' '), description: latest.suggestion || 'Need help?', duration: 5000 })
    }
  }, [struggles, toast])
  return null
}

interface TutorialStep { title: string; description: string; targetSelector?: string }

interface TutorialOverlayProps { steps: TutorialStep[]; currentStep: number; onNext: () => void; onPrev: () => void; onClose: () => void }

export const TutorialOverlay: React.FC<TutorialOverlayProps> = ({ steps, currentStep, onNext, onPrev, onClose }) => {
  const step = steps[currentStep]
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-background rounded-lg shadow-lg p-6 max-w-md w-full mx-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-primary" />
            <span className="font-semibold">Step {currentStep + 1} of {steps.length}</span>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-secondary rounded"><X className="w-4 h-4" /></button>
        </div>
        <h3 className="text-lg font-medium mb-2">{step.title}</h3>
        <p className="text-muted-foreground mb-4">{step.description}</p>
        <div className="flex justify-between">
          <button onClick={onPrev} disabled={currentStep === 0} className={cn("px-4 py-2 rounded", currentStep === 0 ? "opacity-50" : "bg-secondary")}>Previous</button>
          <button onClick={currentStep === steps.length - 1 ? onClose : onNext} className="px-4 py-2 bg-primary text-primary-foreground rounded flex items-center gap-2">
            {currentStep === steps.length - 1 ? "Finish" : "Next"}
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  )
}