"use client";

import { useState, useRef, useEffect, memo } from "react";
import { type Message } from "ai/react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Copy,
  Check,
  User,
  Bot,
  AlertCircle,
  Volume2,
  VolumeX,
  MoreVertical,
  RefreshCw,
  Zap,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";

interface EnhancedMessageBubbleProps {
  message: Message;
  isStreaming?: boolean;
  isMobile?: boolean;
  touchTargetSize?: number;
  showSkeleton?: boolean;
  onRetry?: () => void;
  onSpeak?: (text: string) => void;
  isPlaying?: boolean;
}

const EnhancedMessageBubble = memo(({
  message,
  isStreaming = false,
  isMobile = false,
  touchTargetSize = 44,
  showSkeleton = false,
  onRetry,
  onSpeak,
  isPlaying = false,
}: EnhancedMessageBubbleProps) => {
  const [copied, setCopied] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const isAssistant = message.role === "assistant";
  const isUser = message.role === "user";

  // Handle copy to clipboard with haptic feedback
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);

      // Haptic feedback on mobile
      if (isMobile && 'vibrate' in navigator) {
        navigator.vibrate(50);
      }

      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error("Failed to copy:", error);
    }
  };

  // Handle text-to-speech
  const handleSpeak = () => {
    onSpeak?.(message.content);
  };

  // Streaming text animation effect
  useEffect(() => {
    if (isStreaming && contentRef.current) {
      contentRef.current.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
    }
  }, [isStreaming, message.content]);

  // Skeleton loading component for TTFT
  const SkeletonLoader = () => (
    <div className="space-y-3 animate-pulse">
      <div className="flex items-center gap-2">
        <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" />
        <div className="text-xs text-muted-foreground">Thinking...</div>
      </div>
      <div className="space-y-2">
        <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-3/4"></div>
        <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/2"></div>
        <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-5/6"></div>
      </div>
    </div>
  );

  // Streaming indicator
  const StreamingIndicator = () => (
    <div className="flex items-center gap-2 mt-2">
      <div className="flex gap-1">
        <div className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
        <div className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-bounce [animation-delay:-0.15s]"></div>
        <div className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-bounce"></div>
      </div>
      <div className="text-xs text-muted-foreground">
        <Zap className="w-3 h-3 inline mr-1" />
        Streaming...
      </div>
    </div>
  );

  // Custom renderers for markdown
  const markdownComponents = {
    code({ node, inline, className, children, ...props }: any) {
      const match = /language-(\w+)/.exec(className || "");
      const language = match ? match[1] : "";

      return !inline && match ? (
        <div className="relative group">
          <SyntaxHighlighter
            style={oneDark}
            language={language}
            PreTag="div"
            className="rounded-lg overflow-x-auto text-sm"
            customStyle={{
              margin: 0,
              fontSize: isMobile ? "14px" : "13px",
              lineHeight: "1.4",
            }}
            {...props}
          >
            {String(children).replace(/\n$/, "")}
          </SyntaxHighlighter>
          <Button
            size="sm"
            variant="ghost"
            className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={() => navigator.clipboard.writeText(String(children))}
            style={{ minHeight: touchTargetSize, minWidth: touchTargetSize }}
          >
            <Copy className="w-3 h-3" />
          </Button>
        </div>
      ) : (
        <code
          className="bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded text-sm font-mono"
          {...props}
        >
          {children}
        </code>
      );
    },
    pre({ children }: any) {
      return <div className="overflow-x-auto">{children}</div>;
    },
    a({ href, children }: any) {
      return (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-500 hover:text-blue-600 underline break-words"
          style={{ minHeight: touchTargetSize }}
        >
          {children}
        </a>
      );
    },
    p({ children }: any) {
      return (
        <p className={cn("mb-3 last:mb-0 leading-relaxed", isMobile && "text-base")}>
          {children}
        </p>
      );
    },
    ul({ children }: any) {
      return <ul className="list-disc list-inside space-y-1 mb-3">{children}</ul>;
    },
    ol({ children }: any) {
      return <ol className="list-decimal list-inside space-y-1 mb-3">{children}</ol>;
    },
    li({ children }: any) {
      return <li className="leading-relaxed">{children}</li>;
    },
    h1: ({ children }: any) => (
      <h1 className="text-xl font-bold mb-3 mt-4 first:mt-0">{children}</h1>
    ),
    h2: ({ children }: any) => (
      <h2 className="text-lg font-semibold mb-2 mt-3 first:mt-0">{children}</h2>
    ),
    h3: ({ children }: any) => (
      <h3 className="text-base font-medium mb-2 mt-2 first:mt-0">{children}</h3>
    ),
  };

  return (
    <div
      className={cn(
        "flex w-full mb-4 animate-slide-up",
        isUser ? "justify-end" : "justify-start"
      )}
    >
      <div
        className={cn(
          "flex gap-3 max-w-[85%] group",
          isMobile ? "max-w-[90%]" : "max-w-[80%]",
          isUser && "flex-row-reverse"
        )}
      >
        {/* Avatar */}
        <div
          className={cn(
            "flex-shrink-0 flex items-start justify-center rounded-full p-2",
            "transition-all duration-200",
            isUser
              ? "bg-blue-500 text-white"
              : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300",
            isMobile && "mt-1"
          )}
          style={{
            minWidth: Math.max(32, touchTargetSize * 0.75),
            minHeight: Math.max(32, touchTargetSize * 0.75),
          }}
        >
          {isUser ? (
            <User className="w-4 h-4" />
          ) : (
            <Bot className={cn("w-4 h-4", isStreaming && "animate-pulse")} />
          )}
        </div>

        {/* Message Content */}
        <div
          className={cn(
            "flex flex-col",
            isUser ? "items-end" : "items-start"
          )}
        >
          {/* Message Bubble */}
          <div
            ref={contentRef}
            className={cn(
              "relative rounded-2xl px-4 py-3 shadow-sm transition-all duration-200",
              "max-w-full overflow-hidden",
              isUser
                ? "bg-blue-500 text-white rounded-br-md"
                : "bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 border border-gray-200 dark:border-gray-700 rounded-bl-md",
              isMobile && "text-base leading-relaxed",
              isStreaming && !showSkeleton && "ring-2 ring-blue-200 dark:ring-blue-800 ring-opacity-50",
              "group-hover:shadow-md"
            )}
            style={{
              wordBreak: "break-word",
              overflowWrap: "break-word",
            }}
          >
            {/* Show skeleton for TTFT */}
            {showSkeleton ? (
              <SkeletonLoader />
            ) : (
              <>
                {/* Message content */}
                <div className={cn("prose prose-sm max-w-none", isUser && "prose-invert")}>
                  {isUser ? (
                    <p className="mb-0 whitespace-pre-wrap">{message.content}</p>
                  ) : (
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={markdownComponents}
                      className="markdown-content"
                    >
                      {message.content}
                    </ReactMarkdown>
                  )}
                </div>

                {/* Streaming indicator */}
                {isStreaming && !showSkeleton && <StreamingIndicator />}
              </>
            )}
          </div>

          {/* Message Actions */}
          <div
            className={cn(
              "flex items-center gap-1 mt-2 opacity-0 group-hover:opacity-100 transition-opacity",
              isMobile && "opacity-100", // Always show on mobile
              isUser ? "flex-row-reverse" : ""
            )}
          >
            {/* Copy button */}
            <Button
              size="sm"
              variant="ghost"
              onClick={handleCopy}
              className={cn(
                "h-auto p-2 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300",
                copied && "text-green-500"
              )}
              style={{ minHeight: touchTargetSize, minWidth: touchTargetSize }}
              title="Copy message"
            >
              {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
            </Button>

            {/* Speak button (for assistant messages) */}
            {isAssistant && onSpeak && (
              <Button
                size="sm"
                variant="ghost"
                onClick={handleSpeak}
                className={cn(
                  "h-auto p-2 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300",
                  isPlaying && "text-blue-500"
                )}
                style={{ minHeight: touchTargetSize, minWidth: touchTargetSize }}
                title={isPlaying ? "Stop speaking" : "Speak message"}
              >
                {isPlaying ? <VolumeX className="w-3 h-3" /> : <Volume2 className="w-3 h-3" />}
              </Button>
            )}

            {/* Retry button (for failed messages) */}
            {message.id === "loading" && onRetry && (
              <Button
                size="sm"
                variant="ghost"
                onClick={onRetry}
                className="h-auto p-2 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                style={{ minHeight: touchTargetSize, minWidth: touchTargetSize }}
                title="Retry"
              >
                <RefreshCw className="w-3 h-3" />
              </Button>
            )}

            {/* More actions dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-auto p-2 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                  style={{ minHeight: touchTargetSize, minWidth: touchTargetSize }}
                >
                  <MoreVertical className="w-3 h-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align={isUser ? "end" : "start"} className="min-w-[120px]">
                <DropdownMenuItem onClick={handleCopy}>
                  <Copy className="w-4 h-4 mr-2" />
                  Copy
                </DropdownMenuItem>
                {isAssistant && onSpeak && (
                  <DropdownMenuItem onClick={handleSpeak}>
                    <Volume2 className="w-4 h-4 mr-2" />
                    Speak
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem>
                  <AlertCircle className="w-4 h-4 mr-2" />
                  Report Issue
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Timestamp and status */}
          <div
            className={cn(
              "text-xs text-gray-500 mt-1 opacity-0 group-hover:opacity-100 transition-opacity",
              isMobile && "opacity-70", // More visible on mobile
              isUser ? "text-right" : "text-left"
            )}
          >
            {isStreaming ? (
              <div className="flex items-center gap-1">
                <div className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
                Live
              </div>
            ) : (
              <div className="flex items-center gap-1">
                <div className="w-1.5 h-1.5 bg-gray-400 rounded-full" />
                {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});

EnhancedMessageBubble.displayName = "EnhancedMessageBubble";

export default EnhancedMessageBubble;
