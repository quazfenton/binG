"use client"

import React, { useState } from "react"
import ReactMarkdown from "react-markdown"
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter"
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism"
import { Button } from "@/components/ui/button"
import { Copy, Check, ChevronDown, ChevronUp, Brain } from "lucide-react"
import type { Message } from "@/types"

interface MessageBubbleProps {
  message: Message
  isStreaming?: boolean
}

export default function MessageBubble({ message, isStreaming = false }: MessageBubbleProps) {
  const [copied, setCopied] = useState(false)
  const [displayedContent, setDisplayedContent] = useState("")
  const [showReasoning, setShowReasoning] = useState(false)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(message.content)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const isUser = message.role === "user"

  // Parse reasoning/thinking content from models like DeepSeek R1
  const parseReasoningContent = (content: string) => {
    // Look for thinking tags or reasoning patterns
    const thinkingRegex = /<think>([\s\S]*?)<\/think>/g
    const reasoningRegex = /\*\*Reasoning:\*\*([\s\S]*?)(?=\*\*|$)/g
    const thoughtRegex = /\*\*Thought:\*\*([\s\S]*?)(?=\*\*|$)/g
    
    let reasoning = ""
    let mainContent = content
    
    // Extract thinking content
    let match
    while ((match = thinkingRegex.exec(content)) !== null) {
      reasoning += match[1].trim() + "\n\n"
      mainContent = mainContent.replace(match[0], "")
    }
    
    // Extract reasoning sections
    while ((match = reasoningRegex.exec(content)) !== null) {
      reasoning += "**Reasoning:**" + match[1].trim() + "\n\n"
      mainContent = mainContent.replace(match[0], "")
    }
    
    // Extract thought sections
    while ((match = thoughtRegex.exec(content)) !== null) {
      reasoning += "**Thought:**" + match[1].trim() + "\n\n"
      mainContent = mainContent.replace(match[0], "")
    }
    
    return {
      reasoning: reasoning.trim(),
      mainContent: mainContent.trim()
    }
  }

  const { reasoning, mainContent } = parseReasoningContent(message.content)

  // Fixed streaming effect - smooth character-by-character reveal without glitching
  React.useEffect(() => {
    if (isStreaming && !isUser) {
      // Only start streaming if we don't already have content displayed
      // or if the new content is longer than what we're displaying
      const currentLength = displayedContent.length;
      const newLength = message.content.length;
      
      if (newLength > currentLength) {
        // Continue from where we left off
        let currentIndex = currentLength;
        
        const streamInterval = setInterval(() => {
          if (currentIndex < message.content.length) {
            setDisplayedContent(message.content.slice(0, currentIndex + 1));
            currentIndex++;
          } else {
            clearInterval(streamInterval);
          }
        }, 7); // Smooth streaming - 14ms per character
        
        return () => clearInterval(streamInterval);
      }
    } else {
      // Not streaming or is user message - show full content immediately
      setDisplayedContent(message.content);
    }
  }, [message.content, isStreaming, isUser, displayedContent.length]);

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"} mb-6 group`}>
      <div
        className={`
          max-w-[85%] rounded-2xl px-5 py-4 relative
          ${isUser ? "bg-purple-600 text-white" : "bg-black border border-white/20 text-white"}
          ${isStreaming && !isUser ? "border-purple-500/50" : ""}
        `}
      >
        <ReactMarkdown
          className="prose prose-invert text-base"
          components={{
            code({ node, className, children, ...props }) {
              const match = /language-(\w+)/.exec(className || "");
              return node && !node.properties.inline && match ? (
                <SyntaxHighlighter
                  style={vscDarkPlus as any}
                  language={match[1]}
                  PreTag="div"
                >
                  {String(children).replace(/\n$/, "")}
                </SyntaxHighlighter>
              ) : (
                <code className={className} {...props}>
                  {children}
                </code>
              );
            },
            // Add custom components for better formatting
            p: ({ children }) => <p className="mb-4">{children}</p>,
            ul: ({ children }) => <ul className="list-disc list-inside mb-4">{children}</ul>,
            ol: ({ children }) => <ol className="list-decimal list-inside mb-4">{children}</ol>,
            li: ({ children }) => <li className="mb-2">{children}</li>,
            hr: () => <hr className="my-4 border-t border-white/20" />,
            blockquote: ({ children }) => (
              <blockquote className="border-l-4 border-purple-500 pl-4 italic mb-4">
                {children}
              </blockquote>
            ),
          }}
        >
          {isStreaming ? displayedContent : (isUser ? message.content : mainContent)}
        </ReactMarkdown>
        
        {/* Streaming cursor */}
        {isStreaming && !isUser && (
          <span className="inline-block w-2 h-5 bg-purple-400 animate-pulse ml-1" />
        )}

        {/* Reasoning section for AI responses */}
        {!isUser && reasoning && (
          <div className="mt-4 border-t border-white/10 pt-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowReasoning(!showReasoning)}
              className="flex items-center gap-2 text-xs text-white/60 hover:text-white/80 mb-2"
            >
              <Brain className="w-3 h-3" />
              {showReasoning ? "Hide" : "Show"} Reasoning
              {showReasoning ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </Button>
            
            {showReasoning && (
              <div className="bg-black/20 rounded-lg p-3 border border-white/10">
                <ReactMarkdown
                  className="text-sm text-white/70 prose prose-invert max-w-none"
                  components={{
                    code: ({ node, inline, className, children, ...props }) => {
                      const match = /language-(\w+)/.exec(className || "");
                      return node && !node.properties.inline && match ? (
                        <SyntaxHighlighter
                          style={vscDarkPlus as any}
                          language={match[1]}
                          PreTag="div"
                        >
                          {String(children).replace(/\n$/, "")}
                        </SyntaxHighlighter>
                      ) : (
                        <code className={className} {...props}>
                          {children}
                        </code>
                      );
                    },
                    p: ({ children }) => <p className="mb-2 text-xs">{children}</p>,
                  }}
                >
                  {reasoning}
                </ReactMarkdown>
              </div>
            )}
          </div>
        )}

        {/* Copy button */}
        <Button
          variant="ghost"
          size="icon"
          className={`
        absolute -right-2 top-1/2 transform -translate-y-1/2 h-6 w-6
        opacity-0 group-hover:opacity-100 transition-all duration-200
        bg-black/80 hover:bg-black/90 border border-white/20
          `}
          onClick={handleCopy}
        >
          {copied ? <Check className="h-3 w-3 text-green-400" /> : <Copy className="h-3 w-3 text-white/70" />}
        </Button>
      </div>
    </div>
  )
}
