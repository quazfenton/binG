"use client"

import { useState, useEffect, useMemo, useCallback } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter"
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism"
import { Button } from "@/components/ui/button"
import { Copy, Check, ChevronDown, ChevronUp, Brain, Loader2, SkipForward, Pause, Play, Terminal, ExternalLink, FileCode, Plus, Minus, Eye, Download, CheckCircle, XCircle } from "lucide-react"
import type { Message, CodeArtifact } from "@/types"
import { useEnhancedStreamingDisplay } from "@/hooks/use-enhanced-streaming-display"
import { useResponsiveLayout, calculateDynamicWidth, getOverflowStrategy } from "@/hooks/use-responsive-layout"
import { analyzeMessageContent, getContentBasedStyling, shouldUseCompactLayout } from "@/lib/message-content-analyzer"
import { useTouchHandler, useKeyboardHandler } from "@/hooks/use-touch-handler"
import IntegrationAuthPrompt from "@/components/integrations/IntegrationAuthPrompt"
import { isEmbeddableUrl, transformToEmbed, getSuggestedPlugin } from "@/lib/utils/iframe-helper"
import { ReasoningDisplay, ReasoningSummary } from "@/components/reasoning-display"
import { ToolInvocationsList } from "@/components/tool-invocation-card"
import { VersionHistoryPanel, VersionIndicator } from "@/components/version-history-panel"
import { AgentStatusDisplay, MultiAgentStatusDisplay } from "@/components/agent-status-display"
import { clipboard } from "@bing/platform/clipboard"
import { SpecAmplificationProgress, DAGProgressDisplay } from "@/components/spec-amplification-progress"
import { normalizeToolInvocations } from "@/lib/types/tool-invocation"
import { useReasoningStream } from "@/hooks/use-reasoning-stream"
import { toast } from "sonner"
import { buildApiHeaders } from "@/lib/utils"
import {
  extractReasoningContent,
  sanitizeAssistantDisplayContent,
} from "@/lib/chat/file-edit-parser"
import { EnhancedDiffViewer } from "@/components/enhanced-diff-viewer"
import { useMultiRotatingStatements } from "@/hooks/use-rotating-statements"

function LoadingIndicator() {
  const statement = useMultiRotatingStatements(['interesting', 'funny', 'task'], 2500);
  return (
    <div className="flex items-center gap-2 text-white/60 mb-2">
      <Loader2 className="w-4 h-4 thinking-spinner" />
      <span className="text-sm thinking-pulse">{statement}</span>
    </div>
  );
}

/**
 * Client-side sanitization for message content
 * Uses centralized file-edit-parser for all formats
 * This is a safety net in case the backend sanitization missed any edge cases
 */
function sanitizeMessageContent(content: string): string {
  if (!content || typeof content !== 'string') return '';

  return sanitizeAssistantDisplayContent(content);
}

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
  const [expandedArtifacts, setExpandedArtifacts] = useState<Set<string>>(new Set())
  const [applyingArtifact, setApplyingArtifact] = useState<string | null>(null)
  const [showAllFiles, setShowAllFiles] = useState(false)

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

  // Extract file edits from tool invocations (VFS MCP tools like write_file, apply_diff, batch_write)
  const toolInvocationFileEdits = useMemo(() => {
    const toolInvocations = normalizeToolInvocations((message.metadata as any)?.toolInvocations);
    const edits: any[] = [];
    
    for (const tool of toolInvocations) {
      if (tool.state !== 'result') continue;
      const result = tool.result as any;
      if (!result) continue;
      
      // Handle VFS write tools: write_file, batch_write
      if (tool.toolName === 'write_file' || tool.toolName === 'batch_write') {
        if (tool.toolName === 'write_file') {
          // Single file write
          if (result.success === false) {
            // Tool failed - add as error entry
            edits.push({
              path: result.path,
              operation: 'write',
              version: 1,
              error: result.error,
              content: '',
            });
          } else if (result.path) {
            // Tool succeeded - add with content if available
            edits.push({
              path: result.path,
              operation: 'write',
              version: result.version || 1,
              content: result.content || '',
            });
          }
        } else if (tool.toolName === 'batch_write' && result.results) {
          // Batch write - process each result
          for (const fileResult of result.results) {
            if (fileResult.success === false) {
              edits.push({
                path: fileResult.path,
                operation: 'write',
                version: 1,
                error: fileResult.error,
                content: '',
              });
            } else if (fileResult.path) {
              edits.push({
                path: fileResult.path,
                operation: 'write',
                version: fileResult.version || 1,
              });
            }
          }
        }
      }
      
      // Handle apply_diff tool
      if (tool.toolName === 'apply_diff') {
        if (result.success === false) {
          // Diff failed - add as error entry
          edits.push({
            path: result.path,
            operation: 'patch',
            version: 1,
            error: result.error,
            diff: '',
          });
        } else if (result.path) {
          // Diff applied successfully
          edits.push({
            path: result.path,
            operation: 'patch',
            version: result.version || 1,
          });
        }
      }
      
      // Handle delete_file tool
      if (tool.toolName === 'delete_file') {
        if (result.success === false) {
          edits.push({
            path: result.path,
            operation: 'delete',
            version: 1,
            error: result.error,
          });
        } else if (result.path) {
          edits.push({
            path: result.path,
            operation: 'delete',
            version: result.version || 1,
          });
        }
      }
    }
    
    return edits;
  }, [message.metadata?.toolInvocations]);

  const fileEditInfo = useMemo(() => {
    // First check for filesystem transaction (standard chat flow)
    const metadataFilesystem = (message.metadata as any)?.filesystem;
    const metadataFileEdits = (message.metadata as any)?.fileEdits;
    
    if (metadataFilesystem && typeof metadataFilesystem === "object") {
      // FIX: Show diff viewer even when transactionId is null but files were applied
      // This handles "auto_applied" status where no transaction is needed
      const txId = typeof metadataFilesystem.transactionId === "string" ? metadataFilesystem.transactionId : "";
      const applied = Array.isArray(metadataFilesystem.applied) ? metadataFilesystem.applied : [];

      if (txId || applied.length > 0) {
        // CRITICAL FIX: Use fileEdits if available (has content for diff viewer)
        // Otherwise fall back to filesystem.applied (no content, just paths)
        const usedApplied = (metadataFileEdits && Array.isArray(metadataFileEdits) && metadataFileEdits.length > 0)
          ? metadataFileEdits
          : applied;

        return {
          transactionId: txId || undefined,
          applied: usedApplied,
          errors: Array.isArray(metadataFilesystem.errors) ? metadataFilesystem.errors : [],
          status: typeof metadataFilesystem.status === "string" ? metadataFilesystem.status : "auto_applied",
          isSpecEnhancement: false,
        };
      }
    }

    // Check for spec enhancement file edits (stored directly in metadata.fileEdits)
    if (metadataFileEdits && Array.isArray(metadataFileEdits) && metadataFileEdits.length > 0) {
      // Spec enhancement edits are already applied server-side, just for display
      return {
        transactionId: undefined, // No transaction for spec enhancement
        applied: metadataFileEdits.map((edit: any, index: number) => ({
          path: edit.path,
          operation: edit.operation || 'write',
          version: typeof edit.version === 'number' ? edit.version : index + 1,
          existedBefore: false,
          content: edit.content, // Store full content for diff viewer
          diff: edit.diff, // Include diff for PATCH operations
        })),
        errors: [],
        status: 'auto_applied', // Already applied server-side
        isSpecEnhancement: true, // Flag for UI handling
      };
    }

    // NEW: Check for file edits from VFS MCP tool invocations
    if (toolInvocationFileEdits.length > 0) {
      // Check if any have errors
      const errors = toolInvocationFileEdits.filter(e => e.error).map(e => ({
        path: e.path,
        message: e.error,
      }));
      
      return {
        transactionId: undefined,
        applied: toolInvocationFileEdits,
        errors,
        status: errors.length > 0 ? 'error' : 'auto_applied',
        isSpecEnhancement: false,
        isToolInvocation: true, // Flag to indicate these came from tool invocations
      };
    }

    return null;
  }, [message.metadata, toolInvocationFileEdits]);

  useEffect(() => {
    if (fileEditInfo?.status) {
      setFileEditDecision(fileEditInfo.status);
    }
  }, [fileEditInfo?.status]);

  const buildRequestHeaders = useCallback((): HeadersInit => {
    return buildApiHeaders();
  }, []);

  const handleAcceptEdits = useCallback(async () => {
    if (!fileEditInfo?.transactionId || isApplyingEditAction) return;
    setIsApplyingEditAction(true);
    try {
      const response = await fetch("/api/filesystem/edits/accept", {
        method: "POST",
        headers: buildRequestHeaders(),
        credentials: 'include',
        body: JSON.stringify({ transactionId: fileEditInfo.transactionId }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.success) {
        throw new Error(payload?.error || `Failed to accept edits (${response.status})`);
      }
      setFileEditDecision("accepted");
      toast.success("File edits accepted", {
        description: "Changes are now permanent",
        duration: 2000,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to accept edits";
      console.error(message);
      toast.error("Failed to accept edits", {
        description: message,
        duration: 4000,
      });
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
        credentials: 'include',
        body: JSON.stringify({
          transactionId: fileEditInfo.transactionId,
          reason: "User denied AI file edits from chat UI",
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.success) {
        throw new Error(payload?.error || `Failed to deny edits (${response.status})`);
      }
      
      // SECURITY: Add explicit checks for expected response structure
      const txStatus = payload?.data?.transaction?.status ?? 'unknown';
      const conflicts = Array.isArray(payload?.data?.conflicts) ? payload.data.conflicts : [];
      const revertedPaths = Array.isArray(payload?.data?.revertedPaths) ? payload.data.revertedPaths : [];

      if (txStatus === "reverted_with_conflicts") {
        setFileEditDecision("reverted_with_conflicts");
        toast.error("Reverted with conflicts", {
          description: conflicts.length > 0
            ? `${revertedPaths.length} files reverted, ${conflicts.length} conflicts detected`
            : "Some files could not be fully reverted",
          duration: 5000,
        });
      } else {
        setFileEditDecision("denied");
        // Check if Git-backed rollback was used (all files reverted without conflicts)
        const usedGitRollback = revertedPaths.length === fileEditInfo.applied.length && conflicts.length === 0;
        toast.success("File edits reverted", {
          description: usedGitRollback
            ? `${revertedPaths.length} file(s) restored using Git-backed rollback`
            : `${revertedPaths.length} file(s) restored to previous state`,
          duration: 3000,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to deny edits";
      console.error(message);
      toast.error("Failed to revert edits", {
        description: message,
        duration: 5000,
      });
    } finally {
      setIsApplyingEditAction(false);
    }
  }, [buildRequestHeaders, fileEditInfo?.transactionId, isApplyingEditAction, fileEditInfo?.applied?.length]);
  
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
    // Use sanitized content for copy to match what's displayed in UI
    const contentToCopy = isUser ? message.content : sanitizedContent;
    try {
      await clipboard.writeText(contentToCopy)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (error) {
      // Fallback for when document is not focused or clipboard API is unavailable
      // This commonly happens when the tab is in the background or focus is elsewhere
      console.warn('Clipboard copy failed, using fallback:', error)
      const textArea = document.createElement('textarea')
      textArea.value = contentToCopy
      textArea.style.position = 'fixed'
      textArea.style.left = '-999999px'
      document.body.appendChild(textArea)
      textArea.select()
      try {
        document.execCommand('copy')
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      } catch (fallbackError) {
        console.error('Fallback copy also failed:', fallbackError)
      }
      document.body.removeChild(textArea)
    }
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

  // Check for integration OAuth auth_required in message metadata
  // Only show IntegrationAuthPrompt for real 3rd-party integrations (Arcade/Composio/Nango),
  // NOT for generic site login auth (which has requiresAuth=false, loginRequired=true)
  const authInfo = useMemo(() => {
    const meta = (message as any).metadata;
    if (meta?.requiresAuth && meta.toolName && meta.provider && meta.provider !== 'unknown') {
      const authUrl = meta.authUrl || getAuthUrlForProvider(meta.provider);
      return {
        toolName: meta.toolName,
        provider: meta.provider,
        authUrl
      }
    }
    return null
  }, [message])

  // Strip AUTH_REQUIRED sentinel from content if auth was dismissed
  const displayContent = authInfo && authDismissed && !isUser
    ? message.content.replace(/AUTH_REQUIRED:[\s\S]*?(?=\n\n|$)/, '')
    : message.content;

  // Memoize sanitized content to avoid expensive regex on every render
  const sanitizedContent = useMemo(() => {
    if (isUser) return message.content;
    // Apply client-side sanitization to assistant messages as a safety net
    const rawContent = streamingDisplay.displayContent || message.content;
    return sanitizeMessageContent(rawContent);
  }, [message.content, streamingDisplay.displayContent, isUser]);

  const contentToDisplay = useMemo(() => {
    if (isUser) return message.content;
    if (authInfo && authDismissed) {
      return sanitizeMessageContent(displayContent);
    }
    return sanitizedContent;
  }, [authDismissed, authInfo, displayContent, isUser, message.content, sanitizedContent]);

  const { reasoning, mainContent } = useMemo(
    () => extractReasoningContent(contentToDisplay),
    [contentToDisplay],
  )
  const metadataReasoning = typeof (message as any).metadata?.reasoning === 'string'
    ? (message as any).metadata.reasoning
    : ''
  const combinedReasoning = [reasoning, metadataReasoning].filter(Boolean).join('\n\n')
  const toolInvocations = normalizeToolInvocations((message as any).metadata?.toolInvocations)

  // Use reasoning from hook if available, otherwise fall back to metadata
  const activeReasoningChunks = reasoningStream.reasoningChunks.length > 0
    ? reasoningStream.reasoningChunks
    : (message.metadata?.reasoningChunks || []);
  const activeFullReasoning = reasoningStream.fullReasoning || combinedReasoning;

  // Code artifacts from V2 agent execution
  const codeArtifacts = useMemo(() => {
    const artifacts = message.metadata?.codeArtifacts as CodeArtifact[] | undefined;
    if (!artifacts || !Array.isArray(artifacts)) return [];
    return artifacts.filter(a => a && a.path);
  }, [message.metadata?.codeArtifacts]);

  // Generate unified diff between two contents
  const generateDiff = useCallback((oldContent: string | undefined, newContent: string | undefined, path: string) => {
    const oldLines = oldContent?.split('\n') || [];
    const newLines = newContent?.split('\n') || [];
    const result: string[] = [`--- a/${path}`, `+++ b/${path}`];
    const maxLen = Math.max(oldLines.length, newLines.length);
    for (let i = 0; i < maxLen; i++) {
      const oldLine = oldLines[i];
      const newLine = newLines[i];
      if (oldLine === newLine) {
        result.push(` ${oldLine || ''}`);
      } else if (oldLine === undefined) {
        result.push(`+${newLine}`);
      } else if (newLine === undefined) {
        result.push(`-${oldLine}`);
      } else {
        result.push(`-${oldLine}`);
        result.push(`+${newLine}`);
      }
    }
    return result.join('\n');
  }, []);

  // Toggle artifact expansion
  const toggleArtifact = useCallback((path: string) => {
    setExpandedArtifacts(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  // Apply artifact to filesystem
  const handleApplyArtifact = useCallback(async (artifact: CodeArtifact) => {
    if (applyingArtifact) return;
    if (artifact.operation !== 'delete' && artifact.content == null) return;
    setApplyingArtifact(artifact.path);
    try {
      const isDelete = artifact.operation === 'delete';
      const response = await fetch(isDelete ? '/api/filesystem/delete' : '/api/filesystem/write', {
        method: 'POST',
        headers: buildRequestHeaders(),
        credentials: 'include',
        body: JSON.stringify({
          path: artifact.path,
          content: isDelete ? undefined : artifact.content ?? '',
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.success) {
        throw new Error(payload?.error || `Failed to apply (${response.status})`);
      }
      toast.success(isDelete ? 'File deleted' : 'File applied', { description: artifact.path, duration: 2000 });
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : 'Failed to apply';
      toast.error('Failed to apply file', { description: errMsg, duration: 4000 });
    } finally {
      setApplyingArtifact(null);
    }
  }, [buildRequestHeaders, applyingArtifact]);

  const handleAuthDismiss = () => {
    setAuthDismissed(true)
    onAuthPromptDismiss?.()
  }

  // Check if this is a pending refinement message (show loading with rotating statements)
  const isPendingRefinement = message.metadata?.isRefinement && message.metadata?.isPending && message.metadata?.isLoading;

  // Hook must be called unconditionally at top level
  const rotatingStatement = useMultiRotatingStatements(['interesting', 'task', 'funny'], 2000);

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

  if (isPendingRefinement) {
    return (
      <div className={`flex justify-start mb-6 group w-full px-1`}>
        <div
          className={`
            message-bubble-responsive relative transition-all duration-200
            border border-purple-500/50 shadow-lg shadow-purple-500/20
            rounded-2xl p-4 bg-gray-800/50
          `}
          style={{
            maxWidth: '600px',
          }}
        >
          <div className="flex items-center gap-3">
            <Loader2 className="w-5 h-5 text-purple-400 animate-spin" />
            <div>
              <p className="text-sm font-medium text-purple-300">AI is refining the response...</p>
              <p className="text-xs text-gray-400 mt-1">{rotatingStatement}</p>
            </div>
          </div>
        </div>
      </div>
    );
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
          maxWidth: layout.isMobile ? 'min(calc(100vw - 2.25rem), 600px)' : dynamicStyles.maxWidth,
          padding: dynamicStyles.padding,
          fontSize: dynamicStyles.fontSize,
          backgroundColor: isUser ? 'var(--user-bubble-bg)' : 'var(--assistant-bubble-bg)',
          color: isUser ? 'var(--user-bubble-text)' : 'var(--assistant-bubble-text)',
          borderColor: isUser ? 'transparent' : 'var(--assistant-bubble-border)',
          wordBreak: dynamicStyles.overflowStrategy === 'wrap' ? 'break-word' : 'normal',
          overflowWrap: dynamicStyles.overflowStrategy === 'wrap' ? 'break-word' : 'normal',
          whiteSpace: contentAnalysis.hasCodeBlocks && layout.isMobile ? 'pre' : 'pre-wrap',
          // Mobile scrolling: allow touch scrolling on message bubbles
          touchAction: 'auto',
          // Prevent text from breaking out of bubble
          overflowX: layout.isMobile ? 'hidden' : 'visible',
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
          <LoadingIndicator />
        )}

        {/* Streaming cursor - shown while receiving content */}
        {isStreaming && streamingDisplay.isStreaming && streamingDisplay.isAnimating && !streamingDisplay.showLoadingIndicator && (
          <span className="inline-block w-2 h-5 bg-gradient-to-t from-purple-400 to-purple-300 animate-typing-cursor ml-1 rounded-sm" />
        )}

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
                            className="flex items-center gap-1 bg-white/10 hover:bg-white/20 backdrop-blur-sm text-white text-[10px] px-2 py-1 rounded border border-white/20"
                            title="Open in Preview Panel"
                            onClick={() => {
                              // Open code preview panel with this code
                              window.dispatchEvent(new CustomEvent('open-code-preview', {
                                detail: { code: codeStr, language: match[1] }
                              }));
                              toast.success('Opening preview panel');
                            }}
                          >
                            <Eye className="w-3 h-3" />
                            Preview
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
                  <blockquote className={`border-l-4 border-white/30 bg-white/5 ${
                    layout.isMobile ? 'pl-2' : 'pl-4'
                  } italic ${useCompactLayout ? 'mb-2' : 'mb-4'} py-1 rounded-r`}>
                    {children}
                  </blockquote>
                ),
                a: ({ children, href, ...props }) => {
                  // Normalize href once and use the normalized value for all checks
                  const normalizedHref = typeof href === 'string' ? href.trim() : '';
                  const isValidHref = normalizedHref.length > 0;
                  const isEmbeddable = isValidHref && isEmbeddableUrl(normalizedHref);
                  const embedInfo = isValidHref ? transformToEmbed(normalizedHref) : null;
                  const suggestedPlugin = embedInfo?.suggestedPluginId;

                  // SECURITY: Validate URL scheme to prevent XSS via javascript: URLs
                  const safeHref = isValidHref && /^(https?:|mailto:|tel:)/i.test(normalizedHref)
                    ? normalizedHref
                    : '#';

                  return (
                    <span className="inline-flex flex-col items-start gap-1">
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
                    </span>
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
                  <h1 className="text-2xl font-bold mb-4 pb-2 border-b border-white/10">
                    {children}
                  </h1>
                ),
                h2: ({ children }) => (
                  <h2 className="text-xl font-semibold mb-3 pb-1 border-b border-white/10">
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
          {/* Main content */}
          {isUser ? message.content : mainContent}
        </ReactMarkdown>

        {/* Tool Invocations Display - Enhanced with new component */}
        {!isUser && toolInvocations.length > 0 && (
          <ToolInvocationsList toolInvocations={toolInvocations} />
        )}

        {/* Agent Status Display - Shows agent type and current state.
            Only render when there is real agent activity to show. The pipeline
            always emits a wrapper "Start agentic pipeline" step, so its mere
            presence is not enough to justify the (large) status panel — that
            was rendering on every plain assistant reply and looking ugly. */}
        {!isUser && (() => {
          const rawSteps: any[] = Array.isArray((message.metadata as any)?.processingSteps)
            ? ((message.metadata as any).processingSteps as any[])
            : [];
          // Filter out the framing wrapper steps that always run, even on a
          // plain text response with no tools.
          const meaningfulSteps = rawSteps.filter(
            (s) => s && typeof s.step === 'string' && s.step !== 'Start agentic pipeline'
          );
          const hasTools = toolInvocations.length > 0;
          const agentType = (message.metadata as any)?.agentType || 'single';
          const isMultiAgent = agentType !== 'single';
          // Hide entirely when the model just produced a normal response.
          if (!hasTools && meaningfulSteps.length === 0 && !isMultiAgent && !isStreaming) {
            return null;
          }
          // While streaming we still suppress the panel until something
          // interesting actually happens (a tool call or non-wrapper step).
          if (isStreaming && !hasTools && meaningfulSteps.length === 0 && !isMultiAgent) {
            return null;
          }
          return (
            <div className="mt-3">
              <AgentStatusDisplay
                agentType={agentType}
                status={isStreaming ? 'executing' : 'completed'}
                currentAction={(message.metadata as any)?.currentAction}
                toolInvocations={toolInvocations}
                processingSteps={meaningfulSteps}
                isVisible={true}
                compact
              />
            </div>
          );
        })()}

        {/* Spec Amplification Progress */}
        {!isUser && (message.metadata as any)?.specAmplification && (
          <div className="mt-3">
            <SpecAmplificationProgress
              stage={(message.metadata as any).specAmplification.stage}
              fastModel={(message.metadata as any).specAmplification.fastModel}
              specScore={(message.metadata as any).specAmplification.specScore}
              sectionsGenerated={(message.metadata as any).specAmplification.sectionsGenerated}
              currentIteration={(message.metadata as any).specAmplification.currentIteration}
              totalIterations={(message.metadata as any).specAmplification.totalIterations}
              currentSection={(message.metadata as any).specAmplification.currentSection}
              error={(message.metadata as any).specAmplification.error}
              timestamp={(message.metadata as any).specAmplification.timestamp}
            />
          </div>
        )}

        {/* DAG Progress Display */}
        {!isUser && (message.metadata as any)?.dagProgress && (
          <div className="mt-3">
            <DAGProgressDisplay
              tasks={(message.metadata as any).dagProgress.tasks ?? []}
              overallProgress={(message.metadata as any).dagProgress.overallProgress ?? 0}
              activeTasks={(message.metadata as any).dagProgress.activeTasks ?? []}
              timestamp={(message.metadata as any).dagProgress.timestamp}
            />
          </div>
        )}

        {/* Version History Panel - Git-backed VFS versions */}
        {!isUser && message.metadata?.sessionId && (
          <div className="mt-3">
            <VersionHistoryPanel
              sessionId={message.metadata.sessionId}
              currentVersion={(message.metadata as any)?.version}
              compact
            />
          </div>
        )}

        {/* Code Artifacts Display - V2 Agent Generated Files */}
        {!isUser && codeArtifacts.length > 0 && (
          <div className="mt-3 rounded-lg border border-white/15 bg-black/25 p-3">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2 text-white/80">
                <FileCode className="w-4 h-4" />
                <span className="text-sm font-medium">Generated Files</span>
                <span className="text-xs text-white/50">({codeArtifacts.length})</span>
              </div>
            </div>
            <div className="space-y-2">
              {codeArtifacts.map((artifact) => {
                const isExpanded = expandedArtifacts.has(artifact.path);
                const isApplying = applyingArtifact === artifact.path;
                const diff = artifact.previousContent 
                  ? generateDiff(artifact.previousContent, artifact.content, artifact.path)
                  : null;
                const additions = diff ? diff.split('\n').filter(l => l.startsWith('+') && !l.startsWith('+++')).length : 0;
                const deletions = diff ? diff.split('\n').filter(l => l.startsWith('-') && !l.startsWith('---')).length : 0;
                
                return (
                  <div key={artifact.path} className="rounded border border-white/10 overflow-hidden">
                    <div 
                      className="flex items-center justify-between px-3 py-2 bg-white/5 cursor-pointer hover:bg-white/10 transition-colors"
                      onClick={() => toggleArtifact(artifact.path)}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        {artifact.operation === 'write' && <Plus className="w-3.5 h-3.5 text-green-400 shrink-0" />}
                        {artifact.operation === 'patch' && <FileCode className="w-3.5 h-3.4 text-blue-400 shrink-0" />}
                        {artifact.operation === 'delete' && <Minus className="w-3.5 h-3.5 text-red-400 shrink-0" />}
                        <code className="text-xs text-white/80 truncate">{artifact.path}</code>
                        {artifact.language && (
                          <span className="text-[10px] text-white/40 px-1.5 py-0.5 bg-white/10 rounded">
                            {artifact.language}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {additions > 0 && <span className="text-xs text-green-400">+{additions}</span>}
                        {deletions > 0 && <span className="text-xs text-red-400">-{deletions}</span>}
                        {isExpanded ? <ChevronUp className="w-4 h-4 text-white/50" /> : <ChevronDown className="w-4 h-4 text-white/50" />}
                      </div>
                    </div>
                    {isExpanded && (
                      <div className="border-t border-white/10">
                        {diff && diff.length > 100 ? (
                          <div className="max-h-64 overflow-y-auto bg-black/30 p-2">
                            <pre className="text-xs font-mono text-white/70 whitespace-pre-wrap">
                              {diff.split('\n').slice(0, 50).join('\n')}
                              {diff.split('\n').length > 50 && '\n... (truncated)'}
                            </pre>
                          </div>
                        ) : artifact.content ? (
                          <div className="max-h-64 overflow-y-auto bg-black/30 p-2">
                            <SyntaxHighlighter
                              style={vscDarkPlus as any}
                              language={artifact.language || 'typescript'}
                              customStyle={{
                                fontSize: '11px',
                                padding: '8px',
                                borderRadius: '4px',
                                margin: 0,
                                background: 'transparent',
                              }}
                            >
                              {artifact.content.slice(0, 2000)}
                              {artifact.content.length > 2000 && '\n// ... truncated'}
                            </SyntaxHighlighter>
                          </div>
                        ) : (
                          <div className="p-3 text-xs text-white/50">No content available</div>
                        )}
                        <div className="flex items-center justify-end gap-2 px-3 py-2 border-t border-white/10 bg-white/5">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 text-xs"
                            onClick={(e) => {
                              e.stopPropagation();
                              clipboard.writeText(artifact.content || '');
                              toast.success('Copied', { duration: 1500 });
                            }}
                          >
                            <Copy className="w-3 h-3 mr-1" />
                            Copy
                          </Button>
                          <Button
                            size="sm"
                            variant="default"
                            className="h-7 text-xs bg-green-600 hover:bg-green-500"
                            disabled={isApplying || !artifact.content}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleApplyArtifact(artifact);
                            }}
                          >
                            {isApplying ? (
                              <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                            ) : (
                              <CheckCircle className="w-3 h-3 mr-1" />
                            )}
                            Apply
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {!isUser && fileEditInfo && (
          <div className="mt-3 rounded-lg border border-white/15 bg-black/25 p-2 text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="text-white/80">
                File edits: {fileEditInfo.applied.length} applied
                {fileEditInfo.errors.length > 0 && (
                  <span className="text-red-400 ml-1">({fileEditInfo.errors.length} failed)</span>
                )}
              </span>
              <span className="text-white/60">
                {(fileEditInfo as any)?.isToolInvocation && fileEditInfo.errors.length > 0
                  ? "Tool errors"
                  : fileEditInfo.isSpecEnhancement
                    ? "Applied (spec enhancement)"
                    : fileEditDecision === "reverted_with_conflicts"
                      ? "Reverted with conflicts"
                      : fileEditDecision === "denied"
                        ? "Denied and reverted"
                        : fileEditDecision === "accepted" || fileEditDecision === "auto_applied"
                          ? "Auto accepted"
                          : fileEditInfo.errors.length > 0
                            ? "Failed"
                            : "Pending"}
              </span>
            </div>
            {fileEditInfo.applied.length > 0 && (
              <div className="mt-1 text-white/55">
                {(showAllFiles ? fileEditInfo.applied : fileEditInfo.applied.slice(0, 4)).map((edit: any) => (
                  <div key={`${edit.path}-${edit.version}`} className="truncate">
                    {edit.path}
                  </div>
                ))}
                {fileEditInfo.applied.length > 4 && (
                  <button
                    onClick={() => setShowAllFiles(!showAllFiles)}
                    className="text-xs text-cyan-400 hover:text-cyan-300 transition-colors mt-0.5"
                  >
                    {showAllFiles ? `Show less` : `+${fileEditInfo.applied.length - 4} more`}
                  </button>
                )}
              </div>
            )}
            {/* Only show Accept/Deny buttons for non-spec-enhancement edits */}
            {!fileEditInfo.isSpecEnhancement && (
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
                  title="Accept the AI's file changes permanently"
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
                  title="Revert all file changes to their previous state using Git-backed rollback"
                >
                  Deny + Revert
                </Button>
              </div>
            )}
            {/* Enhanced Diff Viewer */}
            {fileEditInfo.applied.length > 0 && (
              <div className="mt-3 pt-3 border-t border-white/10">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <FileCode className="w-4 h-4 text-white/60" />
                    <span className="text-xs text-white/80 font-medium">Change Details</span>
                    <span className="text-[10px] text-white/50">({fileEditInfo.applied.length} files)</span>
                  </div>
                  {fileEditInfo.applied.length > 3 && (
                    <button
                      onClick={() => setShowAllFiles(!showAllFiles)}
                      className="text-xs text-cyan-400 hover:text-cyan-300 transition-colors flex items-center gap-1"
                    >
                      {showAllFiles ? 'Show less' : `Show all ${fileEditInfo.applied.length} files`}
                      <ChevronDown className={`w-3 h-3 transition-transform ${showAllFiles ? 'rotate-180' : ''}`} />
                    </button>
                  )}
                </div>
                <div className="space-y-2 max-h-[600px] overflow-y-auto scrollbar-thin scrollbar-thumb-white/5 scrollbar-track-transparent hover:scrollbar-thumb-white/20">
                  {(showAllFiles ? fileEditInfo.applied : fileEditInfo.applied.slice(0, 3)).map((edit: any) => {
                    // CRITICAL FIX: ROBUST detection of unified diff vs full content
                    // Don't rely on operation field or diff field alone
                    // LLM may return: diffs in <file_edit>, full content for existing files, etc.
                    // EnhancedDiffViewer has isDiffFormat() to auto-detect
                    const hasUnifiedDiff = edit.diff && 
                                           edit.diff.trim().length > 0 && 
                                           edit.diff.startsWith('---') &&
                                           edit.diff.includes('+++');
                    
                    return (
                      <EnhancedDiffViewer
                        key={`${edit.path}-${edit.version}`}
                        path={edit.path}
                        serverContent={hasUnifiedDiff ? edit.diff : (edit.content || '')}
                        compareWithLocal={false}
                        compareWithGit={false}
                        showUnsynced={false}
                        isFullContent={!hasUnifiedDiff} // Let EnhancedDiffViewer auto-detect if unsure
                        fullyExpanded={false} // Keep large diffs bounded but allow scrolling
                        sessionId={message.metadata?.sessionId}
                      />
                    );
                  })}
                </div>
              </div>
            )}
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
