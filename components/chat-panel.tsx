"use client"

import { useState, useEffect, useRef, useCallback, useMemo } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Bot, Copy, Download, User, Volume2, VolumeX, Code as CodeIcon } from "lucide-react"
import ReactMarkdown, { Components } from "react-markdown"
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/cjs/styles/prism'
import { cn } from "@/lib/utils"
import { Message } from "@/types"
import { LLMProvider } from "@/lib/api/llm-providers"
import CodePreviewPanel from "./code-preview-panel"

interface ChatPanelProps {
  messages: Message[]
  isProcessing: boolean
  isStreaming: boolean
  onProviderChange: (provider: string, model: string) => void
  onVoiceToggle: (enabled: boolean) => void
  onRetryMessage?: (messageId: string) => void
  selectedProvider?: string
  selectedModel?: string
  voiceEnabled?: boolean
  onToggleCodePreview?: () => void
  className?: string
}

interface StreamingMessageProps {
  content: string
  isStreaming: boolean
  role: "user" | "assistant"
  onCopy: () => void
}

// Helper function to safely convert content to string
const safeString = (content: any): string => {
  if (content === null || content === undefined) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map(safeString).join('');
  return String(content);
};

function StreamingMessage({ content = '', isStreaming, role, onCopy }: StreamingMessageProps) {
  const [copied, setCopied] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  
  // Ensure content is always a string and properly formatted
  const safeContent = useMemo(() => safeString(content), [content]);
  const hasCodeBlocks = safeContent.includes('```');
  
  const handleCopy = useCallback(() => {
    onCopy();
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [onCopy]);
  
  const toggleShowRaw = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setShowRaw(prev => !prev);
  }, []);

  // Memoize the code block component to prevent unnecessary re-renders
  const CodeBlock = useCallback(({ className, children, ...props }: {
    className?: string;
    children?: React.ReactNode;
    inline?: boolean;
    [key: string]: any;
  }) => {
    const codeContent = safeString(children);
    if (!codeContent) return null;
    
    const match = /language-(\w+)/.exec(className || '');
    const language = match ? match[1] : 'text';
    
    return (
      <div className="relative group">
        <div className="absolute top-2 right-2 flex space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => {
              const code = codeContent.replace(/\n$/, '');
              navigator.clipboard.writeText(code);
            }}
          >
            <Copy className="h-3 w-3" />
            <span className="sr-only">Copy code</span>
          </Button>
        </div>
        <SyntaxHighlighter
          style={oneDark}
          language={language}
          PreTag="div"
          showLineNumbers
          wrapLines
          customStyle={{
            margin: 0,
            borderRadius: '0.375rem',
            backgroundColor: '#1e1e2d',
            fontSize: '0.875rem',
            lineHeight: '1.5',
          }}
          codeTagProps={{
            style: {
              fontFamily: 'var(--font-mono)',
              fontSize: '0.875rem',
              lineHeight: '1.5',
            },
          }}
          {...props}
        >
          {codeContent.replace(/\n$/, '')}
        </SyntaxHighlighter>
      </div>
    );
  }, []);

  // Memoize the inline code component
  const InlineCode = useCallback(({ className, children, ...props }: {
    className?: string;
    children?: React.ReactNode;
    [key: string]: any;
  }) => {
    const codeContent = safeString(children);
    return (
      <code className={className} {...props}>
        {codeContent}
      </code>
    );
  }, []);

  // Memoize the markdown components
  const components: Components = useMemo(() => ({
    code: ({ node, className, children, ...props }: {
      node?: any;
      className?: string;
      children?: React.ReactNode;
      [key: string]: any;
    }) => {
      const isInline = !className?.includes('language-');
      const codeContent = safeString(children);
      
      if (isInline) {
        return <code className={className} {...props}>{codeContent}</code>;
      }
      
      const match = /language-(\w+)/.exec(className || '');
      const language = match ? match[1] : 'text';
      
      return (
        <div className="relative group">
          <div className="absolute top-2 right-2 flex space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => {
                const code = codeContent.replace(/\n$/, '');
                navigator.clipboard.writeText(code);
              }}
            >
              <Copy className="h-3 w-3" />
              <span className="sr-only">Copy code</span>
            </Button>
          </div>
          <SyntaxHighlighter
            style={oneDark}
            language={language}
            PreTag="div"
            showLineNumbers
            wrapLines
            customStyle={{
              margin: 0,
              borderRadius: '0.375rem',
              backgroundColor: '#1e1e2d',
              fontSize: '0.875rem',
              lineHeight: '1.5',
            }}
            codeTagProps={{
              style: {
                fontFamily: 'var(--font-mono)',
                fontSize: '0.875rem',
                lineHeight: '1.5',
              },
            }}
            {...props}
          >
            {codeContent}
          </SyntaxHighlighter>
        </div>
      );
    },
  }), []);
  
  // Add streaming indicator after the content if needed
  const contentWithStreaming = useMemo(() => {
    return (
      <>
        {safeContent}
        {isStreaming && (
          <span className="inline-block w-2 h-4 bg-primary-foreground animate-pulse ml-1" />
        )}
      </>
    );
  }, [safeContent, isStreaming]);

  // Render the markdown with our custom components
  const renderContent = useMemo(() => {
    return (
      <ReactMarkdown components={components}>
        {safeContent}
      </ReactMarkdown>
    );
  }, [components, safeContent]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="relative flex items-start gap-3"
    >
      <div className={cn(
        "w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 mt-1",
        role === "user" ? "bg-blue-500" : "bg-gray-600"
      )}>
        {role === "user" ? (
          <User className="w-4 h-4 text-white" />
        ) : (
          <Bot className="w-4 h-4 text-white" />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="prose prose-invert prose-sm max-w-none">
          {renderContent}
        </div>
      </div>
    </motion.div>
  );
}

export default function ChatPanel({
  messages,
  isProcessing,
  isStreaming,
  onProviderChange,
  onVoiceToggle,
  onRetryMessage,
  selectedProvider = "openrouter",
  selectedModel = "deepseek/deepseek-r1-0528:free",
  voiceEnabled = false,
  onToggleCodePreview,
  className = ''
}: ChatPanelProps) {
  const [isCodePreviewOpen, setIsCodePreviewOpen] = useState(false);
  const [providers, setProviders] = useState<LLMProvider[]>([]);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [streamingMessageIndex, setStreamingMessageIndex] = useState<number | null>(null);
  const [width, setWidth] = useState(384); // Default width 384px (w-96)
  const [isResizing, setIsResizing] = useState(false);
  const [isProviderOpen, setIsProviderOpen] = useState(false);
  const [isModelOpen, setIsModelOpen] = useState(false);
  
  // Get the current provider based on the selected provider ID
  const currentProvider = useMemo(() => {
    return providers.find(provider => provider.id === selectedProvider);
  }, [providers, selectedProvider]);
  
  // Get available models for the current provider
  const availableModels = useMemo(() => {
    return currentProvider?.models || [];
  }, [currentProvider]);
  
  // Handle provider change
  const handleProviderChange = useCallback((value: string) => {
    const provider = providers.find(p => p.id === value);
    if (provider) {
      // Reset to the first model when changing providers
      onProviderChange(value, provider.models[0]);
    }
  }, [onProviderChange, providers]);
  
  // Handle model change
  const handleModelChange = useCallback((value: string) => {
    if (selectedProvider) {
      onProviderChange(selectedProvider, value);
    }
  }, [onProviderChange, selectedProvider]);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  
  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);
  
  const handleCopyCode = useCallback((code: string) => {
    navigator.clipboard.writeText(code);
  }, []);
  
  const handleRetryMessage = useCallback((messageId: string) => {
    if (onRetryMessage) {
      onRetryMessage(messageId);
    }
  }, [onRetryMessage]);
  
  const toggleCodePreview = useCallback(() => {
    setIsCodePreviewOpen(prev => !prev);
    onToggleCodePreview?.();
  }, [onToggleCodePreview]);
  
  // Check if any messages contain code blocks
  const hasCodeMessages = useMemo(() => 
    messages.some(msg => msg.role === 'assistant' && msg.content.includes('```')),
    [messages]
  );
  
  // Initialize with mock providers and fetch real ones if available
  useEffect(() => {
    const mockProviders: LLMProvider[] = [
      {
        id: 'openrouter',
        name: 'OpenRouter',
        models: ['deepseek/deepseek-r1-0528:free', 'openai/gpt-4', 'anthropic/claude-3-opus'],
        supportsStreaming: true,
        maxTokens: 4096,
        description: 'OpenRouter provides access to multiple AI models through a unified API',
      },
      {
        id: 'openai',
        name: 'OpenAI',
        models: ['gpt-4', 'gpt-3.5-turbo'],
        supportsStreaming: true,
        maxTokens: 8192,
        description: 'OpenAI provides cutting-edge language models',
      },
      {
        id: 'anthropic',
        name: 'Anthropic',
        models: ['claude-3-opus', 'claude-3-sonnet'],
        supportsStreaming: true,
        maxTokens: 100000,
        description: 'Anthropic AI models focused on helpful and safe AI interactions',
      },
    ];
    
    // Set mock providers initially
    setProviders(mockProviders);
    
    // Try to fetch real providers
    const fetchProviders = async () => {
      try {
        const response = await fetch('/api/chat');
        const data = await response.json();
        if (data?.success && Array.isArray(data.data?.providers)) {
          setProviders(data.data.providers);
        }
      } catch (error) {
        console.error('Failed to fetch providers:', error);
      }
    };
    
    fetchProviders();
  }, []);
  
  // Handle mouse/touch events for resizing
  const startResizing = (e: React.MouseEvent | React.TouchEvent) => {
    setIsResizing(true);
    e.preventDefault();
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent | TouchEvent) => {
      if (!isResizing) return;
      
      let clientX;
      if (e instanceof MouseEvent) {
        clientX = e.clientX;
      } else if (e.touches && e.touches[0]) {
        clientX = e.touches[0].clientX;
      } else {
        return;
      }
      
      // Calculate new width (window width - pointer position)
      const newWidth = window.innerWidth - clientX;
      
      // Apply constraints (min: 300px, max: 800px)
      if (newWidth < 300) setWidth(300);
      else if (newWidth > 800) setWidth(800);
      else setWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('touchmove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('touchend', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('touchmove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('touchend', handleMouseUp);
    };
  }, [isResizing]);



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

  const handleCopyMessage = useCallback((content: string, index: number) => {
    navigator.clipboard.writeText(content).then(() => {
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex(null), 2000);
    });
  }, []);

  const handleDownloadChat = useCallback(() => {
    const chatContent = messages
      .map(msg => `${msg.role.toUpperCase()}: ${msg.content}`)
      .join('\n\n');

    const blob = new Blob([chatContent], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `chat-${new Date().toISOString().split('T')[0]}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [messages]);



  return (
    <div
      className="fixed md:relative top-auto md:top-0 right-0 bottom-0 md:bottom-auto w-full md:w-auto bg-black/90 backdrop-blur-md border-l border-white/10 flex flex-col z-40"
      style={{
        width: `${width}px`,
        height: 'calc(100% - 5rem)',
      }}
    >
      {/* Provider and Model Selection */}
      <div className="p-3 border-b border-white/10">
        <div className="flex flex-col space-y-3">
          <div className="flex items-center space-x-2">
            <Select 
              value={selectedProvider} 
              onValueChange={handleProviderChange}
              onOpenChange={setIsProviderOpen}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select provider" />
              </SelectTrigger>
              <SelectContent>
                {providers.map((provider) => (
                  <SelectItem key={provider.id} value={provider.id}>
                    <div className="flex items-center">
                      <span className="mr-2">{provider.name}</span>
                      {provider.supportsStreaming && (
                        <Badge variant="outline" className="text-xs">Streaming</Badge>
                      )}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            
            <Select 
              value={selectedModel}
              onValueChange={handleModelChange}
              onOpenChange={setIsModelOpen}
              disabled={!selectedProvider || isProviderOpen}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select model" />
              </SelectTrigger>
              <SelectContent>
                {availableModels.map((model) => (
                  <SelectItem key={model} value={model}>
                    {model}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>
      
      <div className="flex items-center justify-between p-2 border-b border-white/10">
        <div className="flex items-center space-x-2">
          {hasCodeMessages && (
            <Button
              variant={isCodePreviewOpen ? "secondary" : "ghost"}
              size="icon"
              onClick={toggleCodePreview}
              className="relative h-8 w-8"
              aria-label={isCodePreviewOpen ? 'Hide code preview' : 'Show code preview'}
            >
              <CodeIcon className="h-4 w-4" />
              <span className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-primary text-[10px] text-primary-foreground flex items-center justify-center">
                {messages.filter(msg => msg.content.includes('```')).length}
              </span>
            </Button>
          )}

          <Button
            variant="ghost"
            size="icon"
            onClick={() => onVoiceToggle(!voiceEnabled)}
            disabled={isProcessing}
            className="h-8 w-8"
            aria-label={voiceEnabled ? 'Mute voice' : 'Unmute voice'}
          >
            {voiceEnabled ? (
              <Volume2 className="h-4 w-4" />
            ) : (
              <VolumeX className="h-4 w-4" />
            )}
          </Button>
        </div>
        
        <Button
          variant="ghost"
          size="icon"
          onClick={handleDownloadChat}
          className="h-8 w-8"
          aria-label="Download chat"
        >
          <Download className="h-4 w-4" />
        </Button>
      </div>
      <ScrollArea ref={scrollAreaRef} className="flex-1 p-4 pb-16 md:pb-4">
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
    </div>
  )
}
