"use client"

import React, { useState, useEffect, useRef, useMemo } from "react"
import ReactMarkdown from "react-markdown"
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter"
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism"
import { Button } from "@/components/ui/button"
import { Copy, Check, ChevronDown, ChevronUp, Brain, Loader2, SkipForward, Pause, Play } from "lucide-react"
import type { Message } from "@/types"
import { useEnhancedStreamingDisplay } from "@/hooks/use-enhanced-streaming-display"
import { useResponsiveLayout, calculateDynamicWidth, getOverflowStrategy } from "@/hooks/use-responsive-layout"
import { analyzeMessageContent, getContentBasedStyling, shouldUseCompactLayout } from "@/lib/message-content-analyzer"
import { useTouchHandler, useKeyboardHandler } from "@/hooks/use-touch-handler"
import IntegrationAuthPrompt from "@/components/integrations/IntegrationAuthPrompt"

interface MessageBubbleProps {
  message: Message
  isStreaming?: boolean
  streamingContent?: string
  onStreamingComplete?: () => void
  maxWidth?: number
  responsive?: boolean
  overflow?: 'wrap' | 'scroll' | 'ellipsis'
  onAuthPromptDismiss?: () => void
  userId?: string
}

const inferProviderFromTool = (toolName?: string): string => {
  if (!toolName) return 'unknown';
  const normalized = toolName.toLowerCase();
  if (normalized.startsWith('gmail.') || normalized.startsWith('google')) return 'google';
  if (normalized.startsWith('github.')) return 'github';
  if (normalized.startsWith('slack.')) return 'slack';
  if (normalized.startsWith('notion.')) return 'notion';
  if (normalized.startsWith('discord.')) return 'discord';
  if (normalized.startsWith('twitter.') || normalized.startsWith('x.')) return 'twitter';
  if (normalized.startsWith('spotify.')) return 'spotify';
  if (normalized.startsWith('twilio.')) return 'twilio';
  return normalized.split('.')[0] || 'unknown';
};

/**
 * Get authorization URL for provider, mirroring backend routing logic
 * Routes Arcade/Nango providers to their respective endpoints
 */
const getAuthUrlForProvider = (provider: string): string => {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || '';
  
  // Normalize provider to lowercase for comparison
  const normalizedProvider = provider.toLowerCase();

  // Arcade providers (Google ecosystem, Exa, Twilio, Spotify, etc.)
  const arcadeProviders = [
    'google', 'gmail', 'googledocs', 'googlesheets',
    'googlecalendar', 'googledrive', 'googlemaps',
    'exa', 'twilio', 'spotify', 'vercel', 'railway'
  ];

  // Nango providers (GitHub, Slack, Discord, etc.)
  const nangoProviders = [
    'github', 'slack', 'discord', 'twitter', 'reddit'
  ];

  if (arcadeProviders.includes(normalizedProvider)) {
    return `${baseUrl}/api/auth/arcade/authorize?provider=${encodeURIComponent(provider)}&redirect=1`;
  }

  if (nangoProviders.includes(normalizedProvider)) {
    return `${baseUrl}/api/auth/nango/authorize?provider=${encodeURIComponent(provider)}&redirect=1`;
  }
  
  // Default to standard OAuth flow
  return `${baseUrl}/api/auth/oauth/initiate?provider=${encodeURIComponent(provider)}`;
};

export default function MessageBubble({ 
  message, 
  isStreaming = false, 
  streamingContent,
  onStreamingComplete,
  maxWidth,
  responsive = true,
  overflow,
  onAuthPromptDismiss,
  userId
}: MessageBubbleProps) {
  const [copied, setCopied] = useState(false)
  const [showReasoning, setShowReasoning] = useState(false)
  const [showStreamingControls, setShowStreamingControls] = useState(false)
  const [authDismissed, setAuthDismissed] = useState(false)

  const isUser = message.role === "user"
  
  const layout = useResponsiveLayout()
  
  const contentAnalysis = useMemo(() => {
    const content = isUser ? message.content : (streamingContent || message.content)
    return analyzeMessageContent(content)
  }, [message.content, streamingContent, isUser])
  
  const dynamicStyles = useMemo(() => {
    const baseStyles = getContentBasedStyling(contentAnalysis, layout.isMobile)
    
    const dynamicWidth = responsive 
      ? calculateDynamicWidth(
          layout.screenWidth, 
          layout.messageBubbleConfig.maxWidthPercentage,
          layout.isMobile ? 280 : 320,
          layout.isDesktop ? 800 : 600
        )
      : maxWidth || 600
    
    const overflowStrategy = overflow || getOverflowStrategy(
      message.content.length,
      contentAnalysis.hasCodeBlocks,
      contentAnalysis.hasUrls,
      layout.screenWidth
    )
    
    return {
      ...baseStyles,
      maxWidth: `${dynamicWidth}px`,
      overflowStrategy,
      padding: layout.messageBubbleConfig.padding,
      fontSize: layout.messageBubbleConfig.fontSize,
      touchTargetSize: layout.messageBubbleConfig.touchTargetSize
    }
  }, [contentAnalysis, layout, responsive, maxWidth, overflow, message.content])
  
  const useCompactLayout = shouldUseCompactLayout(
    contentAnalysis,
    layout.screenWidth,
    layout.screenHeight
  )
  
  const streamingDisplay = useEnhancedStreamingDisplay({
    messageId: message.id,
    content: streamingContent || message.content,
    isStreaming: isStreaming && !isUser,
    onStreamingComplete,
    animationSpeed: 3,
    enableProgressIndicator: true
  })

  const handleCopy = async () => {
    const contentToCopy = isUser ? message.content : streamingDisplay.displayContent
    await navigator.clipboard.writeText(contentToCopy)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const { touchHandlers } = useTouchHandler({
    onTap: handleCopy,
    onLongPress: () => {
      if (layout.isMobile) {
        setShowStreamingControls(!showStreamingControls)
      }
    }
  })
  
  const { handleKeyDown } = useKeyboardHandler()

  const parseReasoningContent = (content: string) => {
    const thinkingRegex = /<think>([\s\S]*?)<\/think>/g
    const reasoningRegex = /\*\*Reasoning:\*\*([\s\S]*?)(?=\*\*|$)/g
    const thoughtRegex = /\*\*Thought:\*\*([\s\S]*?)(?=\*\*|$)/g
    
    let reasoning = ""
    let mainContent = content
    
    let match
    while ((match = thinkingRegex.exec(content)) !== null) {
      reasoning += match[1].trim() + "\n\n"
      mainContent = mainContent.replace(match[0], "")
    }
    
    while ((match = reasoningRegex.exec(content)) !== null) {
      reasoning += "**Reasoning:**" + match[1].trim() + "\n\n"
      mainContent = mainContent.replace(match[0], "")
    }
    
    while ((match = thoughtRegex.exec(content)) !== null) {
      reasoning += "**Thought:**" + match[1].trim() + "\n\n"
      mainContent = mainContent.replace(match[0], "")
    }
    
    return {
      reasoning: reasoning.trim(),
      mainContent: mainContent.trim()
    }
  }

  // Check for auth_required in message metadata
  const authInfo = useMemo(() => {
    if ((message as any).metadata?.requiresAuth) {
      const toolName = (message as any).metadata.toolName || 'unknown';
      const provider = (message as any).metadata.provider || inferProviderFromTool(toolName);
      // Use provided authUrl or generate correct one based on provider routing
      const authUrl = (message as any).metadata.authUrl || getAuthUrlForProvider(provider);
      return {
        toolName,
        provider,
        authUrl
      }
    }
    return null
  }, [message])

  // Strip AUTH_REQUIRED sentinel from content if auth was dismissed
  const displayContent = authInfo && authDismissed && !isUser
    ? message.content.replace(/AUTH_REQUIRED:[\s\S]*?(?=\n\n|$)/, '')
    : message.content;

  const getContentToDisplay = () => {
    if (isUser) return message.content
    // Use displayContent if auth was dismissed (strips AUTH_REQUIRED sentinel)
    if (authInfo && authDismissed) {
      return displayContent;
    }
    return streamingDisplay.displayContent || message.content
  }

  const { reasoning, mainContent } = parseReasoningContent(getContentToDisplay())

  const handleAuthDismiss = () => {
    setAuthDismissed(true)
    onAuthPromptDismiss?.()
  }

  // If auth is required and not dismissed, show auth prompt
  if (authInfo && !authDismissed && !isUser) {
    return (
      <IntegrationAuthPrompt
        toolName={authInfo.toolName}
        provider={authInfo.provider}
        authUrl={authInfo.authUrl}
        onDismiss={handleAuthDismiss}
        onAuthorized={() => {
          setAuthDismissed(true)
          onAuthPromptDismiss?.()
        }}
      />
    )
  }

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"} ${useCompactLayout ? 'mb-3' : 'mb-6'} group w-full`}>
      <div
        className={`
          message-bubble-responsive relative transition-all duration-200
          ${isUser ? "bg-purple-600 text-white" : "bg-black border border-white/20 text-white"}
          ${streamingDisplay.isStreaming ? "border-purple-500/50 shadow-lg shadow-purple-500/20" : ""}
          ${streamingDisplay.isAnimating ? "animate-pulse-subtle" : ""}
          ${layout.isMobile ? 'rounded-xl touch-friendly' : 'rounded-2xl'}
          ${contentAnalysis.hasCodeBlocks && layout.isMobile ? 'overflow-x-auto' : ''}
          ${contentAnalysis.hasLongWords && layout.isMobile ? 'break-all' : 'break-words'}
          ${layout.isMobile ? 'mobile-layout' : layout.isTablet ? 'tablet-layout' : 'desktop-layout'}
          ${layout.isPortrait ? 'portrait-layout' : 'landscape-layout'}
        `}
        style={{
          maxWidth: dynamicStyles.maxWidth,
          padding: dynamicStyles.padding,
          fontSize: dynamicStyles.fontSize,
          wordBreak: dynamicStyles.overflowStrategy === 'wrap' ? 'break-word' : 'normal',
          overflowWrap: dynamicStyles.overflowStrategy === 'wrap' ? 'break-word' : 'normal',
          whiteSpace: contentAnalysis.hasCodeBlocks && layout.isMobile ? 'pre' : 'pre-wrap'
        }}
        onMouseEnter={() => !layout.isMobile && setShowStreamingControls(true)}
        onMouseLeave={() => !layout.isMobile && setShowStreamingControls(false)}
        {...touchHandlers}
        onKeyDown={(e) => handleKeyDown(e, handleCopy)}
        tabIndex={0}
        role="article"
        aria-label={`${isUser ? 'User' : 'Assistant'} message`}
      >
        {/* Thinking indicator - shown at start of streaming */}
        {isStreaming && streamingDisplay.showLoadingIndicator && (
          <div className="flex items-center gap-2 text-white/60 mb-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-sm animate-pulse">Thinking...</span>
          </div>
        )}

        {/* Streaming cursor - shown while receiving content */}
        {isStreaming && streamingDisplay.isStreaming && streamingDisplay.isAnimating && !streamingDisplay.showLoadingIndicator && (
          <span className="inline-block w-2 h-5 bg-gradient-to-t from-purple-400 to-purple-300 animate-typing-cursor ml-1 rounded-sm" />
        )}

        {/* Main content */}
        <ReactMarkdown
              className={`prose prose-invert transition-opacity duration-200 ${
                useCompactLayout ? 'prose-sm' : 'prose-base'
              } ${layout.isMobile ? 'prose-sm' : 'prose-base'}`}
              components={{
                code({ node, className, children, ...props }) {
                  const match = /language-(\w+)/.exec(className || "");
                  return node && !node.properties.inline && match ? (
                    <div className={`${layout.isMobile ? 'text-xs' : 'text-sm'} ${contentAnalysis.hasCodeBlocks && layout.isMobile ? 'overflow-x-auto' : ''}`}>
                      <SyntaxHighlighter
                        style={vscDarkPlus as any}
                        language={match[1]}
                        PreTag="div"
                        customStyle={{
                          fontSize: layout.isMobile ? '12px' : '14px',
                          padding: layout.isMobile ? '8px' : '12px',
                          borderRadius: '6px',
                          margin: '8px 0',
                          maxWidth: '100%',
                          overflowX: layout.isMobile ? 'auto' : 'visible'
                        }}
                      >
                        {String(children).replace(/\n$/, "")}
                      </SyntaxHighlighter>
                    </div>
                  ) : (
                    <code 
                      className={`${className} ${
                        layout.isMobile ? 'text-xs' : 'text-sm'
                      } bg-white/10 px-1 py-0.5 rounded break-all`} 
                      {...props}
                    >
                      {children}
                    </code>
                  );
                },
                p: ({ children }) => (
                  <p className={`${useCompactLayout ? 'mb-2' : 'mb-4'} leading-relaxed`}>
                    {children}
                  </p>
                ),
                ul: ({ children }) => (
                  <ul className={`list-disc list-inside ${useCompactLayout ? 'mb-2' : 'mb-4'} ${
                    layout.isMobile ? 'pl-2' : 'pl-4'
                  }`}>
                    {children}
                  </ul>
                ),
                ol: ({ children }) => (
                  <ol className={`list-decimal list-inside ${useCompactLayout ? 'mb-2' : 'mb-4'} ${
                    layout.isMobile ? 'pl-2' : 'pl-4'
                  }`}>
                    {children}
                  </ol>
                ),
                li: ({ children }) => (
                  <li className={`${useCompactLayout ? 'mb-1' : 'mb-2'} leading-relaxed`}>
                    {children}
                  </li>
                ),
                hr: () => (
                  <hr className={`${useCompactLayout ? 'my-2' : 'my-4'} border-t border-white/20`} />
                ),
                blockquote: ({ children }) => (
                  <blockquote className={`border-l-4 border-purple-500 ${
                    layout.isMobile ? 'pl-2' : 'pl-4'
                  } italic ${useCompactLayout ? 'mb-2' : 'mb-4'}`}>
                    {children}
                  </blockquote>
                ),
                a: ({ children, href, ...props }) => (
                  <a 
                    href={href} 
                    className={`text-purple-300 hover:text-purple-200 underline ${
                      layout.isMobile && dynamicStyles.overflowStrategy === 'ellipsis' 
                        ? 'truncate inline-block max-w-full' 
                        : 'break-all'
                    }`}
                    {...props}
                  >
                    {children}
                  </a>
                ),
              }}
            >
              {isUser ? message.content : mainContent}
            </ReactMarkdown>

            {streamingDisplay.isStreaming && streamingDisplay.progress > 0 && (
              <div className="absolute -bottom-1 left-0 right-0 h-0.5 bg-white/10 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-purple-500 to-purple-400 transition-all duration-300 ease-out"
                  style={{ width: `${streamingDisplay.progress}%` }}
                />
              </div>
            )}

            {streamingDisplay.isStreaming && showStreamingControls && (
              <div className={`absolute -top-2 -right-2 flex gap-1 bg-black/80 backdrop-blur-sm border border-white/20 rounded-lg ${
                layout.isMobile ? 'p-1.5' : 'p-1'
              }`}>
                {streamingDisplay.isAnimating ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    className={`text-white/70 hover:text-white ${
                      layout.isMobile ? 'h-8 w-8' : 'h-6 w-6'
                    }`}
                    style={{
                      minHeight: layout.isMobile ? dynamicStyles.touchTargetSize : 'auto',
                      minWidth: layout.isMobile ? dynamicStyles.touchTargetSize : 'auto'
                    }}
                    onClick={streamingDisplay.pauseAnimation}
                    title="Pause streaming"
                  >
                    <Pause className={`${layout.isMobile ? 'h-4 w-4' : 'h-3 w-3'}`} />
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    size="icon"
                    className={`text-white/70 hover:text-white ${
                      layout.isMobile ? 'h-8 w-8' : 'h-6 w-6'
                    }`}
                    style={{
                      minHeight: layout.isMobile ? dynamicStyles.touchTargetSize : 'auto',
                      minWidth: layout.isMobile ? dynamicStyles.touchTargetSize : 'auto'
                    }}
                    onClick={streamingDisplay.resumeAnimation}
                    title="Resume streaming"
                  >
                    <Play className={`${layout.isMobile ? 'h-4 w-4' : 'h-3 w-3'}`} />
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className={`text-white/70 hover:text-white ${
                    layout.isMobile ? 'h-8 w-8' : 'h-6 w-6'
                  }`}
                  style={{
                    minHeight: layout.isMobile ? dynamicStyles.touchTargetSize : 'auto',
                    minWidth: layout.isMobile ? dynamicStyles.touchTargetSize : 'auto'
                  }}
                  onClick={streamingDisplay.skipToEnd}
                  title="Skip to end"
                >
                  <SkipForward className={`${layout.isMobile ? 'h-4 w-4' : 'h-3 w-3'}`} />
                </Button>
              </div>
            )}

            {!isUser && reasoning && (
              <div className={`${useCompactLayout ? 'mt-2' : 'mt-4'} border-t border-white/10 ${useCompactLayout ? 'pt-2' : 'pt-3'}`}>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowReasoning(!showReasoning)}
                  className={`flex items-center gap-2 text-white/60 hover:text-white/80 ${useCompactLayout ? 'mb-1' : 'mb-2'} ${
                    layout.isMobile ? 'text-xs h-8' : 'text-xs'
                  }`}
                  style={{
                    minHeight: layout.isMobile ? dynamicStyles.touchTargetSize : 'auto'
                  }}
                >
                  <Brain className={`${layout.isMobile ? 'w-4 h-4' : 'w-3 h-3'}`} />
                  {showReasoning ? "Hide" : "Show"} Reasoning
                  {showReasoning ? (
                    <ChevronUp className={`${layout.isMobile ? 'w-4 h-4' : 'w-3 h-3'}`} />
                  ) : (
                    <ChevronDown className={`${layout.isMobile ? 'w-4 h-4' : 'w-3 h-3'}`} />
                  )}
                </Button>
                
                {showReasoning && (
                  <div className={`bg-black/20 rounded-lg border border-white/10 ${
                    layout.isMobile ? 'p-2' : 'p-3'
                  }`}>
                    <ReactMarkdown
                      className={`text-white/70 prose prose-invert max-w-none ${
                        layout.isMobile ? 'prose-xs text-xs' : 'prose-sm text-sm'
                      }`}
                      components={{
                        code: ({ node, inline, className, children, ...props }) => {
                          const match = /language-(\w+)/.exec(className || "");
                          return node && !node.properties.inline && match ? (
                            <SyntaxHighlighter
                              style={vscDarkPlus as any}
                              language={match[1]}
                              PreTag="div"
                              customStyle={{
                                fontSize: layout.isMobile ? '10px' : '12px',
                                padding: layout.isMobile ? '6px' : '8px',
                                borderRadius: '4px',
                                margin: '4px 0'
                              }}
                            >
                              {String(children).replace(/\n$/, "")}
                            </SyntaxHighlighter>
                          ) : (
                            <code className={`${className} bg-white/10 px-1 py-0.5 rounded text-xs`} {...props}>
                              {children}
                            </code>
                          );
                        },
                        p: ({ children }) => (
                          <p className={`${useCompactLayout ? 'mb-1' : 'mb-2'} ${layout.isMobile ? 'text-xs' : 'text-sm'}`}>
                            {children}
                          </p>
                        ),
                      }}
                    >
                      {reasoning}
                    </ReactMarkdown>
                  </div>
                )}
              </div>
            )}

        <Button
          variant="ghost"
          size="icon"
          className={`
            button-responsive absolute -right-2 top-1/2 transform -translate-y-1/2
            ${layout.isMobile ? 'opacity-70' : 'opacity-0 group-hover:opacity-100'} 
            transition-all duration-200 bg-black/80 hover:bg-black/90 border border-white/20
            ${layout.isMobile ? 'h-10 w-10' : 'h-6 w-6'}
            focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-purple-400
          `}
          style={{
            minHeight: layout.isMobile ? dynamicStyles.touchTargetSize : 'auto',
            minWidth: layout.isMobile ? dynamicStyles.touchTargetSize : 'auto'
          }}
          onClick={handleCopy}
          onKeyDown={(e) => handleKeyDown(e, handleCopy)}
          aria-label="Copy message content"
          title="Copy message"
        >
          {copied ? (
            <Check className={`${layout.isMobile ? 'h-5 w-5' : 'h-3 w-3'} text-green-400`} />
          ) : (
            <Copy className={`${layout.isMobile ? 'h-5 w-5' : 'h-3 w-3'} text-white/70`} />
          )}
        </Button>
      </div>
    </div>
  )
}
