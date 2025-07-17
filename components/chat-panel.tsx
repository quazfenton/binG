"use client"

import { useState, useEffect, useRef } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import {
  Copy,
  Download,
  Settings,
  User,
  Bot,
  Check,
  Code,
  Volume2,
  VolumeX,
  Eye,
  EyeOff
} from "lucide-react"
import ReactMarkdown from "react-markdown"
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter"
import { oneDark } from "react-syntax-highlighter/dist/cjs/styles/prism"
import type { Message } from "@/types"
import type { LLMProvider } from "@/lib/api/llm-providers"

interface ChatPanelProps {
  messages: Message[]
  isProcessing: boolean
  onProviderChange: (provider: string, model: string) => void
  onVoiceToggle: (enabled: boolean) => void
  onVisibilityToggle: (visible: boolean) => void
  selectedProvider?: string
  selectedModel?: string
  voiceEnabled?: boolean
  visible?: boolean
  onToggleCodePreview?: () => void
}

interface StreamingMessageProps {
  content: string
  isStreaming: boolean
  role: "user" | "assistant"
  onCopy: () => void
}

const TYPING_SPEED = 30 // milliseconds per character

function StreamingMessage({ content, isStreaming, role, onCopy }: StreamingMessageProps) {
  const [displayedContent, setDisplayedContent] = useState("")
  const [showCursor, setShowCursor] = useState(false)
  const contentRef = useRef(content)

  useEffect(() => {
    contentRef.current = content

    if (!isStreaming) {
      setDisplayedContent(content)
      setShowCursor(false)
      return
    }

    setShowCursor(true)
    setDisplayedContent("")

    let currentIndex = 0
    const typeInterval = setInterval(() => {
      if (currentIndex < contentRef.current.length) {
        setDisplayedContent(contentRef.current.slice(0, currentIndex + 1))
        currentIndex++
      } else {
        setShowCursor(false)
        clearInterval(typeInterval)
      }
    }, TYPING_SPEED)

    return () => clearInterval(typeInterval)
  }, [content, isStreaming])

  // Cursor blinking effect
  useEffect(() => {
    if (!showCursor) return

    const cursorInterval = setInterval(() => {
      setShowCursor(prev => !prev)
    }, 500)

    return () => clearInterval(cursorInterval)
  }, [showCursor])

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className={`flex gap-3 p-4 rounded-lg ${
        role === "user"
          ? "bg-blue-500/10 border border-blue-500/20"
          : "bg-gray-500/10 border border-gray-500/20"
      }`}
    >
      <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
        role === "user" ? "bg-blue-500" : "bg-gray-600"
      }`}>
        {role === "user" ? (
          <User className="w-4 h-4 text-white" />
        ) : (
          <Bot className="w-4 h-4 text-white" />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="prose prose-invert prose-sm max-w-none">
          <ReactMarkdown
            components={{
              code: ({ node, className, children, ...props }: any) => {
                const inline = node?.type === 'element' && node.children?.[0]?.type === 'text' && !node.children[0].value.includes('\n');
                const match = /language-(\w+)/.exec(className || '')
                const language = match ? match[1] : ''

                if (!inline && language) {
                  return (
                    <div className="relative">
                      <div className="flex items-center justify-between bg-gray-800 px-4 py-2 text-sm">
                        <span className="text-gray-300">{language}</span>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            navigator.clipboard.writeText(String(children))
                          }}
                          className="h-6 px-2"
                        >
                          <Code className="w-3 h-3" />
                        </Button>
                      </div>
                      <SyntaxHighlighter
                        style={oneDark as any}
                        language={language}
                        PreTag="div"
                        {...props}
                      >
                        {String(children).replace(/\n$/, '')}
                      </SyntaxHighlighter>
                    </div>
                  )
                }

                return (
                  <code className="bg-gray-800 px-1 py-0.5 rounded text-sm" {...props}>
                    {children}
                  </code>
                )
              }
            }}
          >
            {displayedContent}
          </ReactMarkdown>
          {showCursor && (
            <span className="inline-block w-2 h-5 bg-white ml-1 animate-pulse" />
          )}
        </div>

        <div className="flex items-center gap-2 mt-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={onCopy}
            className="h-6 px-2 text-xs"
          >
            <Copy className="w-3 h-3 mr-1" />
            Copy
          </Button>

          {role === "assistant" && (displayedContent.includes("```") || displayedContent.includes("function") || displayedContent.includes("const")) && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                // Extract code blocks and create downloadable file
                const codeBlocks = displayedContent.match(/```[\s\S]*?```/g) || []
                if (codeBlocks.length > 0) {
                  const code = codeBlocks.map(block =>
                    block.replace(/```\w*\n?/, '').replace(/```$/, '')
                  ).join('\n\n')

                  const blob = new Blob([code], { type: 'text/plain' })
                  const url = URL.createObjectURL(blob)
                  const a = document.createElement('a')
                  a.href = url
                  a.download = `code-${Date.now()}.txt`
                  a.click()
                  URL.revokeObjectURL(url)
                }
              }}
              className="h-6 px-2 text-xs"
            >
              <Download className="w-3 h-3 mr-1" />
              Code
            </Button>
          )}
        </div>
      </div>
    </motion.div>
  )
}

export default function ChatPanel({
  messages,
  isProcessing,
  onProviderChange,
  onVoiceToggle,
  onVisibilityToggle,
  selectedProvider = "openai",
  selectedModel = "gpt-4",
  voiceEnabled = false,
  visible = true,
  onToggleCodePreview
}: ChatPanelProps) {
  const [providers, setProviders] = useState<LLMProvider[]>([])
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null)
  const scrollAreaRef = useRef<HTMLDivElement>(null)
  const [streamingMessageIndex, setStreamingMessageIndex] = useState<number | null>(null)

  // Fetch available providers on mount
  useEffect(() => {
    fetch('/api/chat')
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          setProviders(data.data.providers)
        }
      })
      .catch(console.error)
  }, [])

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (scrollAreaRef.current) {
      const scrollElement = scrollAreaRef.current.querySelector('[data-radix-scroll-area-viewport]')
      if (scrollElement) {
        scrollElement.scrollTop = scrollElement.scrollHeight
      }
    }
  }, [messages])

  // Set streaming state for the latest message
  useEffect(() => {
    if (isProcessing && messages.length > 0) {
      const lastMessage = messages[messages.length - 1]
      if (lastMessage.role === "assistant") {
        setStreamingMessageIndex(messages.length - 1)
      }
    } else {
      setStreamingMessageIndex(null)
    }
  }, [isProcessing, messages])

  const handleCopyMessage = (content: string, index: number) => {
    navigator.clipboard.writeText(content).then(() => {
      setCopiedIndex(index)
      setTimeout(() => setCopiedIndex(null), 2000)
    })
  }

  const handleDownloadChat = () => {
    const chatContent = messages.map(msg =>
      `${msg.role.toUpperCase()}: ${msg.content}`
    ).join('\n\n')

    const blob = new Blob([chatContent], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `chat-${new Date().toISOString().split('T')[0]}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  const currentProvider = providers.find(p => p.id === selectedProvider)

  if (!visible) {
    return (
      <Button
        onClick={() => onVisibilityToggle(true)}
        className="fixed top-4 right-4 z-50"
        size="sm"
        variant="secondary"
      >
        <Eye className="w-4 h-4 mr-2" />
        Show Chat
      </Button>
    )
  }

  return (
    <motion.div
      initial={{ opacity: 0, x: 400 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 400 }}
      transition={{ duration: 0.3 }}
      className="fixed top-0 right-0 h-full w-96 bg-black/90 backdrop-blur-md border-l border-white/10 flex flex-col z-40"
    >
      {/* Header */}
      <CardHeader className="flex-shrink-0 pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bot className="w-5 h-5 text-blue-400" />
            <span className="font-semibold">Chat Assistant</span>
          </div>
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onVoiceToggle(!voiceEnabled)}
              className="h-8 w-8 p-0"
            >
              {voiceEnabled ? (
                <Volume2 className="w-4 h-4 text-green-400" />
              ) : (
                <VolumeX className="w-4 h-4" />
              )}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={onToggleCodePreview}
              className="h-8 w-8 p-0"
              title="Toggle Code Preview Panel"
            >
              <Code className="w-4 h-4" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onVisibilityToggle(false)}
              className="h-8 w-8 p-0"
            >
              <EyeOff className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Provider Selection */}
        <div className="space-y-2">
          <div className="flex gap-2">
            <Select
              value={selectedProvider}
              onValueChange={(provider) => {
                const newProvider = providers.find(p => p.id === provider)
                if (newProvider) {
                  onProviderChange(provider, newProvider.models[0])
                }
              }}
            >
              <SelectTrigger className="flex-1 h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {providers.map(provider => (
                  <SelectItem key={provider.id} value={provider.id}>
                    <div className="flex items-center gap-2">
                      <span>{provider.name}</span>
                      {provider.supportsStreaming && (
                        <Badge variant="secondary" className="text-xs">
                          Stream
                        </Badge>
                      )}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {currentProvider && (
            <Select
              value={selectedModel}
              onValueChange={(model) => onProviderChange(selectedProvider, model)}
            >
              <SelectTrigger className="w-full h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {currentProvider.models.map(model => (
                  <SelectItem key={model} value={model}>
                    {model}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            {messages.length} message{messages.length !== 1 ? 's' : ''}
          </span>
          <Button
            size="sm"
            variant="outline"
            onClick={handleDownloadChat}
            className="h-6 px-2 text-xs"
            disabled={messages.length === 0}
          >
            <Download className="w-3 h-3 mr-1" />
            Export
          </Button>
        </div>
      </CardHeader>

      <Separator />

      {/* Messages */}
      <ScrollArea ref={scrollAreaRef} className="flex-1 p-4">
        <div className="space-y-4">
          <AnimatePresence>
            {messages.length === 0 ? (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="text-center text-muted-foreground py-8"
              >
                <Bot className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>Start a conversation</p>
                <p className="text-sm">Your messages will appear here</p>
              </motion.div>
            ) : (
              messages.map((message, index) => (
                <StreamingMessage
                  key={index}
                  content={message.content}
                  isStreaming={streamingMessageIndex === index}
                  role={message.role as "user" | "assistant"}
                  onCopy={() => handleCopyMessage(message.content, index)}
                />
              ))
            )}
          </AnimatePresence>

          {/* Processing Indicator */}
          {isProcessing && streamingMessageIndex === null && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex items-center gap-3 p-4 rounded-lg bg-gray-500/10 border border-gray-500/20"
            >
              <div className="w-8 h-8 rounded-full bg-gray-600 flex items-center justify-center">
                <Bot className="w-4 h-4 text-white" />
              </div>
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" />
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce delay-100" />
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce delay-200" />
              </div>
            </motion.div>
          )}
        </div>
      </ScrollArea>

      {/* Status Bar */}
      <div className="flex-shrink-0 p-2 border-t border-white/10">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {currentProvider?.name} • {selectedModel}
          </span>
          {voiceEnabled && (
            <Badge variant="secondary" className="text-xs">
              Voice On
            </Badge>
          )}
        </div>
      </div>
    </motion.div>
  )
}
