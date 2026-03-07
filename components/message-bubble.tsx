"use client"

import { useState, useEffect, useMemo, useCallback } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter"
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism"
import { Button } from "@/components/ui/button"
import { Copy, Check, ChevronDown, ChevronUp, Brain, Loader2, SkipForward, Pause, Play, Terminal, ExternalLink } from "lucide-react"
import type { Message } from "@/types"
import { useEnhancedStreamingDisplay } from "@/hooks/use-enhanced-streaming-display"
import { useResponsiveLayout, calculateDynamicWidth, getOverflowStrategy } from "@/hooks/use-responsive-layout"
import { analyzeMessageContent, getContentBasedStyling, shouldUseCompactLayout } from "@/lib/message-content-analyzer"
import { useTouchHandler, useKeyboardHandler } from "@/hooks/use-touch-handler"
import IntegrationAuthPrompt from "@/components/integrations/IntegrationAuthPrompt"
import { isEmbeddableUrl, transformToEmbed, getSuggestedPlugin } from "@/lib/utils/iframe-helper"
import { ReasoningDisplay, ReasoningSummary } from "@/components/reasoning-display"
import { ToolInvocationsList } from "@/components/tool-invocation-card"
import { useReasoningStream } from "@/hooks/use-reasoning-stream"

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
  userId: _userId
}: MessageBubbleProps) {
  const [copied, setCopied] = useState(false)
  const [showReasoning, setShowReasoning] = useState(false)
  const [showStreamingControls, setShowStreamingControls] = useState(false)
  const [authDismissed, setAuthDismissed] = useState(false)
  const [isApplyingEditAction, setIsApplyingEditAction] = useState(false)
  const [fileEditDecision, setFileEditDecision] = useState<"auto_applied" | "accepted" | "denied" | "reverted_with_conflicts" | null>(null)

  const isUser = message.role === "user"

  // Initialize reasoning stream hook
  const reasoningStream = useReasoningStream({
    sandboxId: message.metadata?.sandboxId,
    messageId: message.id,
    autoExpand: isStreaming,
  });

  // Sync metadata reasoning chunks with hook
  useEffect(() => {
    if (message.metadata?.reasoningChunks && message.metadata.reasoningChunks.length > 0) {
      // Chunks are provided via metadata, use them directly
    }
  }, [message.metadata?.reasoningChunks]);

  const fileEditInfo = useMemo(() => {
    const metadataFilesystem = (message.metadata as any)?.filesystem;
    if (!metadataFilesystem || typeof metadataFilesystem !== "object") return null;
    const txId = typeof metadataFilesystem.transactionId === "string" ? metadataFilesystem.transactionId : "";
    if (!txId) return null;
    return {
      transactionId: txId,
      applied: Array.isArray(metadataFilesystem.applied) ? metadataFilesystem.applied : [],
      errors: Array.isArray(metadataFilesystem.errors) ? metadataFilesystem.errors : [],
      status: typeof metadataFilesystem.status === "string" ? metadataFilesystem.status : "auto_applied",
    };
  }, [message.metadata]);

  useEffect(() => {
    if (fileEditInfo?.status) {
      setFileEditDecision(fileEditInfo.status);
    }
  }, [fileEditInfo?.status]);

  const buildRequestHeaders = useCallback((): HeadersInit => {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (typeof window !== "undefined") {
      const token = localStorage.getItem("token");
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }

      const anonymousSessionId = localStorage.getItem("anonymous_session_id");
      if (anonymousSessionId) {
        headers["x-anonymous-session-id"] = anonymousSessionId;
      }
    }

    return headers;
  }, []);

  const handleAcceptEdits = useCallback(async () => {
    if (!fileEditInfo?.transactionId || isApplyingEditAction) return;
    setIsApplyingEditAction(true);
    try {
      const response = await fetch("/api/filesystem/edits/accept", {
        method: "POST",
        headers: buildRequestHeaders(),
        body: JSON.stringify({ transactionId: fileEditInfo.transactionId }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.success) {
        throw new Error(payload?.error || `Failed to accept edits (${response.status})`);
      }
      setFileEditDecision("accepted");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to accept edits";
      console.error(message);
    } finally {
      setIsApplyingEditAction(false);
    }
  }, [buildRequestHeaders, fileEditInfo?.transactionId, isApplyingEditAction]);

  const handleDenyEdits = useCallback(async () => {
    if (!fileEditInfo?.transactionId || isApplyingEditAction) return;
    setIsApplyingEditAction(true);
    try {
      const response = await fetch("/api/filesystem/edits/deny", {
        method: "POST",
        headers: buildRequestHeaders(),
        body: JSON.stringify({
          transactionId: fileEditInfo.transactionId,
          reason: "User denied AI file edits from chat UI",
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.success) {
        throw new Error(payload?.error || `Failed to deny edits (${response.status})`);
      }
      const txStatus = payload?.data?.transaction?.status;
      setFileEditDecision(
        txStatus === "reverted_with_conflicts" ? "reverted_with_conflicts" : "denied",
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to deny edits";
      console.error(message);
    } finally {
      setIsApplyingEditAction(false);
    }
  }, [buildRequestHeaders, fileEditInfo?.transactionId, isApplyingEditAction]);
  
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
  const metadataReasoning = typeof (message as any).metadata?.reasoning === 'string'
    ? (message as any).metadata.reasoning
    : ''
  const combinedReasoning = [reasoning, metadataReasoning].filter(Boolean).join('\n\n')
  const toolInvocations = Array.isArray((message as any).metadata?.toolInvocations)
    ? (message as any).metadata.toolInvocations
    : []

  // Use reasoning from hook if available, otherwise fall back to metadata
  const activeReasoningChunks = reasoningStream.reasoningChunks.length > 0
    ? reasoningStream.reasoningChunks
    : (message.metadata?.reasoningChunks || []);
  const activeFullReasoning = reasoningStream.fullReasoning || combinedReasoning;

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
    <div className={`flex ${isUser ? "justify-end" : "justify-start"} ${useCompactLayout ? 'mb-3' : 'mb-6'} group w-full px-1`}>
      <div
        className={`
          message-bubble-responsive relative transition-all duration-200
          ${isUser ? "text-white" : "border"}
          ${streamingDisplay.isStreaming ? "border-purple-500/50 shadow-lg shadow-purple-500/20" : ""}
          ${streamingDisplay.isAnimating ? "animate-pulse-subtle" : ""}
          ${layout.isMobile ? 'rounded-xl touch-friendly' : 'rounded-2xl'}
          ${contentAnalysis.hasCodeBlocks && layout.isMobile ? 'overflow-x-auto' : ''}
          ${contentAnalysis.hasLongWords && layout.isMobile ? 'break-all' : 'break-words'}
          ${layout.isMobile ? 'mobile-layout' : layout.isTablet ? 'tablet-layout' : 'desktop-layout'}
          ${layout.isPortrait ? 'portrait-layout' : 'landscape-layout'}
        `}
        style={{
          maxWidth: layout.isMobile ? 'calc(100vw - 2.25rem)' : dynamicStyles.maxWidth,
          padding: dynamicStyles.padding,
          fontSize: dynamicStyles.fontSize,
          backgroundColor: isUser ? 'var(--user-bubble-bg)' : 'var(--assistant-bubble-bg)',
          color: isUser ? 'var(--user-bubble-text)' : 'var(--assistant-bubble-text)',
          borderColor: isUser ? 'transparent' : 'var(--assistant-bubble-border)',
          wordBreak: dynamicStyles.overflowStrategy === 'wrap' ? 'break-word' : 'normal',
          overflowWrap: dynamicStyles.overflowStrategy === 'wrap' ? 'break-word' : 'normal',
          whiteSpace: contentAnalysis.hasCodeBlocks && layout.isMobile ? 'pre' : 'pre-wrap'
        }}
        onMouseEnter={() => !layout.isMobile && setShowStreamingControls(true)}
        onMouseLeave={() => {
          if (!layout.isMobile) {
            setShowStreamingControls(false)
          }
        }}
        {...(touchHandlers as any)}
        onKeyDown={(e) => handleKeyDown(e.nativeEvent as KeyboardEvent, handleCopy)}
        tabIndex={0}
        role="article"
        aria-label={`${isUser ? 'User' : 'Assistant'} message`}
      >
        {/* Thinking indicator - shown at start of streaming */}
        {isStreaming && streamingDisplay.showLoadingIndicator && (
          <div className="flex items-center gap-2 text-white/60 mb-2">
            <Loader2 className="w-4 h-4 thinking-spinner" />
            <span className="text-sm thinking-pulse">Thinking...</span>
          </div>
        )}

        {/* Streaming cursor - shown while receiving content */}
        {isStreaming && streamingDisplay.isStreaming && streamingDisplay.isAnimating && !streamingDisplay.showLoadingIndicator && (
          <span className="inline-block w-2 h-5 bg-gradient-to-t from-purple-400 to-purple-300 animate-typing-cursor ml-1 rounded-sm" />
        )}

        {/* Main content */}
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          className={`prose prose-invert transition-opacity duration-200 ${
            useCompactLayout ? 'prose-sm' : 'prose-base'
          } ${layout.isMobile ? 'prose-sm' : 'prose-base'}`}
          components={{
                code({ className, children, ...props }) {
                  const match = /language-(\w+)/.exec(className || "");
                  const isInline = Boolean((props as any).inline);
                  const codeStr = String(children).replace(/\n$/, "");
                  const isShellLang = match && ['bash', 'sh', 'shell', 'zsh', 'console', 'terminal'].includes(match[1]);
                  return !isInline && match ? (
                    <div className={`${layout.isMobile ? 'text-xs' : 'text-sm'} ${contentAnalysis.hasCodeBlocks && layout.isMobile ? 'overflow-x-auto' : ''} relative group/code`}>
                      {isShellLang && (
                        <div className="absolute top-2 right-2 z-10 opacity-0 group-hover/code:opacity-100 transition-opacity">
                          <button
                            className="flex items-center gap-1 bg-green-600/80 hover:bg-green-500 text-white text-[10px] px-2 py-1 rounded"
                            title="Run in Terminal"
                            onClick={() => {
                              window.dispatchEvent(new CustomEvent('terminal-run-command', {
                                detail: { command: codeStr }
                              }));
                            }}
                          >
                            <Terminal className="w-3 h-3" />
                            Run
                          </button>
                        </div>
                      )}
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
                        {codeStr}
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
                a: ({ children, href, ...props }) => {
                  const isEmbeddable = href && isEmbeddableUrl(href);
                  const embedInfo = href ? transformToEmbed(href) : null;
                  const suggestedPlugin = embedInfo?.suggestedPluginId;

                  // SECURITY: Validate URL scheme to prevent XSS via javascript: URLs
                  const safeHref = typeof href === 'string' && /^(https?:|mailto:|tel:)/i.test(href) 
                    ? href 
                    : '#';

                  return (
                    <div className="inline-flex flex-col items-start gap-1">
                      <a
                        href={safeHref}
                        rel="noopener noreferrer"
                        target="_blank"
                        className={`text-purple-300 hover:text-purple-200 underline inline-flex items-center gap-1 ${
                          layout.isMobile && dynamicStyles.overflowStrategy === 'ellipsis'
                            ? 'truncate inline-block max-w-full'
                            : 'break-all'
                        }`}
                        {...props}
                      >
                        {children}
                        {isEmbeddable && (
                          <span
                            className="use-iframe inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] bg-purple-500/20 text-purple-300 border border-purple-500/30 hover:bg-purple-500/30 transition-colors cursor-pointer"
                            title={`Open in ${suggestedPlugin ? suggestedPlugin.replace('-embed', '') : 'embed'} viewer`}
                            onClick={(e) => {
                              e.preventDefault();
                              // Dispatch custom event to open in embed plugin
                              window.dispatchEvent(new CustomEvent('open-embed-plugin', {
                                detail: {
                                  url: safeHref,
                                  suggestedPlugin,
                                  embedInfo
                                }
                              }));
                            }}
                          >
                            <ExternalLink className="w-3 h-3" />
                            Embed
                          </span>
                        )}
                      </a>
                    </div>
                  );
                },
                table: ({ children }) => (
                  <div className="table-wrapper">
                    <table className="w-full border-collapse">
                      {children}
                    </table>
                  </div>
                ),
                thead: ({ children }) => (
                  <thead>
                    {children}
                  </thead>
                ),
                tbody: ({ children }) => (
                  <tbody>
                    {children}
                  </tbody>
                ),
                tr: ({ children }) => (
                  <tr>
                    {children}
                  </tr>
                ),
                th: ({ children }) => (
                  <th>
                    {children}
                  </th>
                ),
                td: ({ children }) => (
                  <td>
                    {children}
                  </td>
                ),
                h1: ({ children }) => (
                  <h1 className="text-2xl font-bold mb-4 pb-2 border-b border-purple-500/30">
                    {children}
                  </h1>
                ),
                h2: ({ children }) => (
                  <h2 className="text-xl font-semibold mb-3 pb-1 border-b border-purple-500/20">
                    {children}
                  </h2>
                ),
                h3: ({ children }) => (
                  <h3 className="text-lg font-semibold mb-2">
                    {children}
                  </h3>
                ),
                h4: ({ children }) => (
                  <h4 className="text-base font-semibold mb-2">
                    {children}
                  </h4>
                ),
              }}
            >
              {isUser ? message.content : mainContent}
        </ReactMarkdown>

        {/* Reasoning Display - Shows before main content when agent is thinking */}
        {!isUser && activeReasoningChunks.length > 0 && (
          reasoningStream.isExpanded || activeReasoningChunks.length === 1 ? (
            <ReasoningDisplay
              reasoningChunks={activeReasoningChunks}
              isStreaming={reasoningStream.isStreaming}
              isExpanded={reasoningStream.isExpanded}
              onToggle={() => reasoningStream.setIsExpanded(!reasoningStream.isExpanded)}
              fullReasoning={activeFullReasoning}
            />
          ) : (
            <ReasoningSummary
              fullReasoning={activeFullReasoning}
              isStreaming={reasoningStream.isStreaming}
              onExpand={() => reasoningStream.setIsExpanded(true)}
            />
          )
        )}

        {/* Tool Invocations Display - Enhanced with new component */}
        {!isUser && toolInvocations.length > 0 && (
          <ToolInvocationsList toolInvocations={toolInvocations} />
        )}

        {!isUser && fileEditInfo && (
          <div className="mt-3 rounded-lg border border-white/15 bg-black/25 p-2 text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="text-white/80">
                File edits: {fileEditInfo.applied.length} applied
              </span>
              <span className="text-white/60">
                {fileEditDecision === "reverted_with_conflicts"
                  ? "Reverted with conflicts"
                  : fileEditDecision === "denied"
                    ? "Denied and reverted"
                    : fileEditDecision === "accepted" || fileEditDecision === "auto_applied"
                      ? "Auto accepted"
                      : "Pending"}
              </span>
            </div>
            {fileEditInfo.applied.length > 0 && (
              <div className="mt-1 text-white/55">
                {fileEditInfo.applied.slice(0, 4).map((edit: any) => (
                  <div key={`${edit.path}-${edit.version}`} className="truncate">
                    {edit.path}
                  </div>
                ))}
                {fileEditInfo.applied.length > 4 && (
                  <div>+{fileEditInfo.applied.length - 4} more</div>
                )}
              </div>
            )}
            <div className="mt-2 flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2 text-[11px]"
                onClick={handleAcceptEdits}
                disabled={
                  isApplyingEditAction ||
                  fileEditDecision === "accepted" ||
                  fileEditDecision === "auto_applied"
                }
              >
                Accept
              </Button>
              <Button
                size="sm"
                variant="destructive"
                className="h-7 px-2 text-[11px]"
                onClick={handleDenyEdits}
                disabled={
                  isApplyingEditAction ||
                  fileEditDecision === "denied" ||
                  fileEditDecision === "reverted_with_conflicts"
                }
              >
                Deny + Revert
              </Button>
            </div>
          </div>
        )}

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

            {!isUser && combinedReasoning && (
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
                      remarkPlugins={[remarkGfm]}
                      className={`text-white/70 prose prose-invert max-w-none ${
                        layout.isMobile ? 'prose-xs text-xs' : 'prose-sm text-sm'
                      }`}
                      components={{
                        code: ({ className, children, ...props }) => {
                          const match = /language-(\w+)/.exec(className || "");
                          const isInline = Boolean((props as any).inline);
                          return !isInline && match ? (
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
                        table: ({ children }) => (
                          <div className="table-wrapper">
                            <table className="w-full border-collapse text-xs">
                              {children}
                            </table>
                          </div>
                        ),
                        thead: ({ children }) => (
                          <thead>
                            {children}
                          </thead>
                        ),
                        tbody: ({ children }) => (
                          <tbody>
                            {children}
                          </tbody>
                        ),
                        tr: ({ children }) => (
                          <tr>
                            {children}
                          </tr>
                        ),
                        th: ({ children }) => (
                          <th className="text-left font-semibold py-1 px-2 border-b border-white/20">
                            {children}
                          </th>
                        ),
                        td: ({ children }) => (
                          <td className="py-1 px-2 border-b border-white/10">
                            {children}
                          </td>
                        ),
                        h1: ({ children }) => (
                          <h1 className="text-sm font-bold mb-2 pb-1 border-b border-white/20">
                            {children}
                          </h1>
                        ),
                        h2: ({ children }) => (
                          <h2 className="text-xs font-semibold mb-1">
                            {children}
                          </h2>
                        ),
                        h3: ({ children }) => (
                          <h3 className="text-xs font-semibold mb-1">
                            {children}
                          </h3>
                        ),
                        ul: ({ children }) => (
                          <ul className="list-disc list-inside mb-2 pl-2 text-xs">
                            {children}
                          </ul>
                        ),
                        ol: ({ children }) => (
                          <ol className="list-decimal list-inside mb-2 pl-2 text-xs">
                            {children}
                          </ol>
                        ),
                        li: ({ children }) => (
                          <li className="mb-0.5">
                            {children}
                          </li>
                        ),
                      }}
                    >
                      {combinedReasoning}
                    </ReactMarkdown>
                  </div>
                )}
              </div>
            )}

        <Button
          variant="ghost"
          size="icon"
          className={`
            button-responsive absolute ${layout.isMobile ? 'right-1 top-1' : '-right-2 top-1/2 -translate-y-1/2'}
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
                      onKeyDown={(e) => handleKeyDown(e.nativeEvent as KeyboardEvent, handleCopy)}
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
