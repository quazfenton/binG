"use client";

import type React from "react";
import { useState, useRef } from "react";
import { Button } from '../components/ui/button';
import { Textarea } from '../components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Card, CardContent } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import type { Message, ConversationContext } from '../types';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import {
  Send,
  Plus,
  Sparkles,
  Settings,
  Accessibility,
  HelpCircle,
  History,
  Loader2,
  ImageIcon,
  Square,
  MessageSquare,
  AlertCircle,
  Code,
} from "lucide-react";
import type { LLMProvider } from '../lib/api/llm-providers';

interface InteractionPanelProps {
  onSubmit: (content: string) => void;
  onNewChat: () => void;
  isProcessing: boolean;
  toggleAccessibility: () => void;
  toggleHistory: () => void;
  toggleCodePreview: () => void; // This prop is expected to be a function
  onStopGeneration?: () => void;
  currentProvider?: string;
  currentModel?: string;
  error?: string | null;
  input: string; // Add input prop
  setInput: (value: string) => void; // Add setInput prop
  availableProviders: LLMProvider[];
  onProviderChange: (provider: string, model: string) => void;
}

export default function InteractionPanel({
  onSubmit,
  onNewChat,
  isProcessing,
  toggleAccessibility,
  toggleHistory,
  toggleCodePreview, // Receive the prop
  onStopGeneration,
  currentProvider = "openrouter",
  currentModel = "deepseek/deepseek-r1-0528:free",
  error,
  input, // Destructure input
  setInput, // Destructure setInput
  availableProviders,
  onProviderChange,
}: InteractionPanelProps) {
  const [activeTab, setActiveTab] = useState("chat");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Log the value of toggleCodePreview prop to debug runtime accessibility
  console.log("InteractionPanel: toggleCodePreview prop value:", toggleCodePreview);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim() && !isProcessing) {
      onSubmit(input);
      setInput(""); // Clear input using the passed setInput
    }
  };

  const handleSuggestionClick = (suggestion: string) => {
    if (!isProcessing) {
      onSubmit(suggestion);
    }
  };

  const suggestions = [
    "unique app ideas",
    "code an incredible ux",
    "make an addicting web game",
    "show me sum interesting",
  ];

  const sampleImages = [
    {
      id: 1,
      url: "/placeholder.svg?height=200&width=300",
      title: "Neural Network Visualization",
    },
    {
      id: 2,
      url: "/placeholder.svg?height=200&width=300",
      title: "Data Flow Diagram",
    },
    {
      id: 3,
      url: "/placeholder.svg?height=200&width=300",
      title: "AI Architecture",
    },
    {
      id: 4,
      url: "/placeholder.svg?height=200&width=300",
      title: "3D Interface Concept",
    },
  ];

  return (
    <div className="absolute bottom-0 left-0 right-0 bg-black/60 backdrop-blur-md border-t border-white/10">
      <div className="p-4 max-w-4xl mx-auto">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <div className="flex justify-between items-center mb-4">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 bg-gradient-to-r from-purple-500 to-blue-500 rounded flex items-center justify-center">
                  <Sparkles className="h-3 w-3 text-white" />
                </div>
                <span className="text-sm font-medium text-white/80">
                  ayooo chat
                </span>
              </div>
              <TabsList className="bg-black/40">
                <TabsTrigger value="chat">Chat</TabsTrigger>
                <TabsTrigger value="images">Images</TabsTrigger>
                <TabsTrigger value="help">Help</TabsTrigger>
                <TabsTrigger value="info">Info</TabsTrigger>
              </TabsList>
            </div>

            <div className="flex space-x-2">
              <Button
                variant="outline"
                size="icon"
                onClick={onNewChat}
                title="New Chat"
              >
                <Plus className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={toggleHistory}
                title="Chat History"
              >
                <History className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={toggleAccessibility}
                title="Accessibility Options"
              >
                <Accessibility className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={toggleCodePreview} // Simplified onClick handler
                title="Code Preview"
              >
                <Code className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <TabsContent value="chat" className="m-0">
            {/* Provider Status and Selection */}
            <div className="flex items-center justify-between mb-3 text-xs text-white/60">
              <div className="flex items-center gap-2">
                <Select
                  value={`${currentProvider}:${currentModel}`}
                  onValueChange={(value) => {
                    const [provider, model] = value.split(":");
                    onProviderChange(provider, model);
                  }}
                >
                  <SelectTrigger className="w-[280px] bg-black/40 border-white/20">
                    <SelectValue placeholder="Select a model" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableProviders.map((provider) => (
                      <SelectGroup key={provider.id}>
                        <SelectLabel>{provider.name}</SelectLabel>
                        {provider.models.map((model) => (
                          <SelectItem key={model} value={`${provider.id}:${model}`}>
                            {model}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {isProcessing && (
                <div className="flex items-center gap-2">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  <span>Generating...</span>
                </div>
              )}
            </div>

            {/* Error Display */}
            {error && (
              <div className="flex items-center gap-2 mb-3 p-2 bg-red-500/10 border border-red-500/20 rounded text-red-400 text-xs">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {/* Suggestions */}
            <div className="flex flex-wrap gap-2 mb-4">
              {suggestions.map((suggestion, index) => (
                <Button
                  key={index}
                  variant="secondary"
                  size="sm"
                  className="text-xs bg-black/20 hover:bg-black/40 transition-all duration-200"
                  onClick={() => handleSuggestionClick(suggestion)}
                  disabled={isProcessing}
                >
                  {suggestion}
                </Button>
              ))}
            </div>

            <form onSubmit={handleSubmit} className="flex space-x-2">
              <div className="relative flex-1">
                <Textarea
                  ref={textareaRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)} // Use the passed setInput
                  placeholder="Type your message..."
                  className="min-h-[60px] bg-black/40 border-white/20 pr-12 resize-none"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSubmit(e);
                    }
                  }}
                  disabled={isProcessing}
                />
                <div className="absolute right-3 top-3">
                  <Sparkles className="h-4 w-4 text-purple-400" />
                </div>
              </div>
              {isProcessing && onStopGeneration ? (
                <Button
                  type="button"
                  variant="destructive"
                  className="self-end min-w-[80px]"
                  onClick={onStopGeneration}
                >
                  <Square className="h-4 w-4 mr-2" />
                  Stop
                </Button>
              ) : (
                <Button
                  type="submit"
                  className="self-end min-w-[80px]"
                  disabled={isProcessing || !input.trim()}
                >
                  {isProcessing ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <>
                      <Send className="h-4 w-4 mr-2" />
                      Send
                    </>
                  )}
                </Button>
              )}
            </form>
          </TabsContent>

          <TabsContent value="images" className="m-0">
            <div className="max-h-64 overflow-y-auto space-y-3">
              {sampleImages.map((image) => (
                <div
                  key={image.id}
                  className="flex items-center gap-3 p-3 bg-black/20 rounded-lg hover:bg-black/30 transition-colors"
                >
                  <img
                    src={image.url || "/placeholder.svg"}
                    alt={image.title}
                    className="w-16 h-12 object-cover rounded"
                  />
                  <div className="flex-1">
                    <h4 className="text-sm font-medium text-white">
                      {image.title}
                    </h4>
                    <p className="text-xs text-white/60">
                      Click to use in conversation
                    </p>
                  </div>
                  <Button size="sm" variant="ghost">
                    <ImageIcon className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="help" className="m-0">
            <Card className="bg-black/40 border-white/10">
              <CardContent className="pt-6">
                <div className="space-y-4">
                  <div className="flex items-start gap-3">
                    <HelpCircle className="h-5 w-5 text-purple-400 mt-0.5" />
                    <div>
                      <h3 className="font-medium">Navigation</h3>
                      <p className="text-sm text-white/70">
                        Click and drag to rotate the view. Scroll to zoom
                        in/out.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3">
                    <HelpCircle className="h-5 w-5 text-purple-400 mt-0.5" />
                    <div>
                      <h3 className="font-medium">Interaction</h3>
                      <p className="text-sm text-white/70">
                        Click on message nodes to expand and view their content.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3">
                    <HelpCircle className="h-5 w-5 text-purple-400 mt-0.5" />
                    <div>
                      <h3 className="font-medium">Chat History</h3>
                      <p className="text-sm text-white/70">
                        Use the + button for new chats and history button to
                        view past conversations.
                      </p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="info" className="m-0">
            <Card className="bg-black/40 border-white/10">
              <CardContent className="pt-6">
                <div className="space-y-4">
                  <div className="flex items-start gap-3">
                    <Sparkles className="h-5 w-5 text-yellow-400 mt-0.5" />
                    <div>
                      <h3 className="font-medium">About ayooo chat</h3>
                      <p className="text-sm text-white/70">
                        A revolutionary 3D spatial interface for AI interactions
                        that breaks traditional chat paradigms.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3">
                  <Settings className="h-5 w-5 text-blue-400 mt-0.5" />
                  <div>
                    <h3 className="font-medium">Current Mood</h3>
                    <div className="flex items-center gap-2 mt-1">
                      <Badge variant="secondary" className="bg-black/40">
                        N/A
                      </Badge>
                      <span className="text-xs text-white/60">
                        Interface adapts to conversation tone
                      </span>
                    </div>
                  </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
