"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { Clock, CheckCircle2, AlertCircle } from "lucide-react"

export function formatTime(ms: number): string {
  if (ms <= 0) return 'Calculating...'
  if (ms < 1000) return '< 1s'
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return seconds + 's'
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  if (minutes < 60) return remainingSeconds > 0 ? minutes + 'm ' + remainingSeconds + 's' : minutes + 'm'
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  return hours + 'h ' + remainingMinutes + 'm'
}

interface EnhancedProgressProps {
  value: number
  label?: string
  sublabel?: string
  estimatedMs?: number
  completed?: boolean
  error?: string
  size?: 'sm' | 'md' | 'lg'
  showPercent?: boolean
  showTime?: boolean
  className?: string
}

export const EnhancedProgress: React.FC<EnhancedProgressProps> = ({
  value, label, sublabel, estimatedMs, completed = false, error,
  size = 'md', showPercent = true, showTime = true, className
}) => {
  const startTimeRef = React.useRef<number>(Date.now())
  const [calculatedETA, setCalculatedETA] = React.useState<number>(0)

  React.useEffect(() => {
    if (completed || error || !showTime) return
    const interval = setInterval(() => {
      if (value > 0 && value < 100) {
        const elapsed = Date.now() - startTimeRef.current
        setCalculatedETA(Math.max(0, (elapsed / value) * 100 - elapsed))
      }
    }, 1000)
    return () => clearInterval(interval)
  }, [value, completed, error, showTime])

  React.useEffect(() => { if (value === 0) { startTimeRef.current = Date.now(); setCalculatedETA(0) } }, [value])

  const displayETA = estimatedMs !== undefined ? estimatedMs : calculatedETA
  const heightClasses = { sm: 'h-1', md: 'h-2', lg: 'h-3' }
  const textSizeClasses = { sm: 'text-xs', md: 'text-sm', lg: 'text-base' }

  return (
    <div className={cn('w-full', className)}>
      <div className='flex items-center justify-between mb-1'>
        <div className='flex items-center gap-2'>
          {label && <span className={cn('font-medium', textSizeClasses[size])}>{label}</span>}
          {sublabel && <span className={cn('text-muted-foreground', textSizeClasses[size])}>{sublabel}</span>}
        </div>
        <div className='flex items-center gap-2'>
          {completed && <CheckCircle2 className='w-4 h-4 text-green-500' />}
          {error && <AlertCircle className='w-4 h-4 text-destructive' />}
          {showPercent && <span className={cn('font-mono', textSizeClasses[size])}>{Math.round(value)}%</span>}
          {showTime && !completed && !error && displayETA > 0 && (<span className={cn('flex items-center gap-1 text-muted-foreground', textSizeClasses[size])}><Clock className='w-3 h-3' />{formatTime(displayETA)}</span>)}
        </div>
      </div>
      <div className={cn('relative w-full overflow-hidden rounded-full bg-secondary', heightClasses[size])}>
        <div className='h-full bg-primary transition-all duration-300' style={{ width: Math.min(100, Math.max(0, value)) + '%' }} />
      </div>
      {error && <p className={cn('mt-1 text-xs text-destructive', textSizeClasses[size])}>{error}</p>}
    </div>
  )
}

interface StepProgressProps { steps: string[]; currentStep: number; completed?: boolean; className?: string }

export const StepProgress: React.FC<StepProgressProps> = ({ steps, currentStep, completed = false, className }) => (
  <div className={cn('flex items-center gap-2', className)}>
    {steps.map((step, index) => {
      const isCompleted = index < currentStep || completed
      const isCurrent = index === currentStep && !completed
      return (<React.Fragment key={index}>
        <div className={cn('flex items-center justify-center w-6 h-6 rounded-full text-xs font-medium transition-colors', isCompleted && 'bg-primary text-primary-foreground', isCurrent && 'bg-primary/20 text-primary border-2 border-primary', !isCompleted && !isCurrent && 'bg-secondary text-muted-foreground')}>
          {isCompleted ? <CheckCircle2 className='w-4 h-4' /> : index + 1}
        </div>
        <span className={cn('text-sm', isCurrent && 'font-medium', !isCompleted && !isCurrent && 'text-muted-foreground')}>{step}</span>
        {index < steps.length - 1 && <div className='flex-1 h-0.5 bg-secondary' />}
      </React.Fragment>)
    })}
  </div>
)

interface CircularProgressProps { value: number; size?: number; strokeWidth?: number; estimatedMs?: number; completed?: boolean; className?: string }

export const CircularProgress: React.FC<CircularProgressProps> = ({ value, size = 48, strokeWidth = 4, estimatedMs, completed = false, className }) => {
  const radius = (size - strokeWidth) / 2
  const circumference = radius * 2 * Math.PI
  const offset = circumference - (Math.min(100, Math.max(0, value)) / 100) * circumference
  return (
    <div className={cn('relative inline-flex items-center justify-center', className)} style={{ width: size, height: size }}>
      <svg className='transform -rotate-90' width={size} height={size}>
        <circle className='text-secondary' stroke='currentColor' strokeWidth={strokeWidth} fill='transparent' r={radius} cx={size / 2} cy={size / 2} />
        <circle className={cn('text-primary transition-all', completed && 'text-green-500')} stroke='currentColor' strokeWidth={strokeWidth} strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap='round' fill='transparent' r={radius} cx={size / 2} cy={size / 2} />
      </svg>
      <div className='absolute inset-0 flex items-center justify-center'><span className='text-xs font-mono'>{completed ? '✓' : Math.round(value) + '%'}</span></div>
      {estimatedMs && estimatedMs > 0 && <div className='absolute -bottom-4 left-1/2 -translate-x-1/2 text-[10px] text-muted-foreground whitespace-nowrap'>{formatTime(estimatedMs)}</div>}
    </div>
  )
}