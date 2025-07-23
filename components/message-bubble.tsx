"use client"

import { useState } from "react"
import ReactMarkdown from "react-markdown"
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter"
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism"
import { Button } from "@/components/ui/button"
import { Copy, Check } from "lucide-react"
import type { Message } from "@/types"

interface MessageBubbleProps {
  message: Message
  isStreaming?: boolean
}

export default function MessageBubble({ message, isStreaming = false }: MessageBubbleProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(message.content)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const isUser = message.role === "user"

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"} mb-4 group`}>
      <div
        className={`
          max-w-[80%] rounded-2xl px-4 py-3 relative
          ${isUser ? "bg-purple-600 text-white" : "bg-black border border-white/20 text-white"}
          ${isStreaming ? "animate-pulse" : ""}
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
          {message.content}
        </ReactMarkdown>

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
