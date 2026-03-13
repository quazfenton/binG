"use client"

/**
 * HorizontalSpaceFiller - Invisible component that fills horizontal space
 * 
 * This component exists to allow ChatPanel and MessageBubbles to expand
 * and utilize more of the available screen width on desktop.
 * 
 * It has a very low z-index to stay behind all interactive elements.
 */
export function HorizontalSpaceFiller() {
  return (
    <div
      className="hidden md:block absolute inset-y-0 left-0 w-full pointer-events-none"
      style={{ 
        zIndex: -1,
        // Ensure this stays behind interaction-panel (z-[1]) and chat-panel (z-10)
      }}
      aria-hidden="true"
    />
  )
}
