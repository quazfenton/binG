"use client";

import type React from "react";
import { useState, useRef, useCallback, useEffect, useMemo } from "react";
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
  GripHorizontal,
  Maximize2,
  Minimize2,
  Brain,
  FileText,
  Calculator,
  Globe,
  Database,
  Palette,
  Music,
  Camera,
  Map,
  Gamepad2,
} from "lucide-react";
import type { LLMProvider } from '../lib/api/llm-providers';

interface InteractionPanelProps {
  onSubmit: (content: string) => void;
  onNewChat: () => void;
  isProcessing: boolean;
  toggleAccessibility: () => void; // This prop is expected to be a function that toggles accessibility options
  toggleHistory: () => void;
  toggleCodePreview: () => void; // This prop is expected to be a function
  onStopGeneration?: () => void;
  onRetry?: () => void; // Add retry function prop
  currentProvider?: string;
  currentModel?: string;
  error?: string | null;
  input: string; // Add input prop
  setInput: (value: string) => void; // Add setInput prop
  availableProviders: LLMProvider[];
  onProviderChange: (provider: string, model: string) => void;
  onRotateProvider?: () => void; // Add rotate provider function
  hasCodeBlocks?: boolean; // Add code blocks detection
}

export default function InteractionPanel({
  onSubmit,
  onNewChat,
  isProcessing,
  toggleAccessibility, // Receive the prop
  toggleHistory,
  toggleCodePreview, // Receive the prop
  onStopGeneration,
  onRetry,
  currentProvider = "openrouter",
  currentModel = "deepseek/deepseek-r1-0528:free",
  error,
  input, // Destructure input
  setInput, // Destructure setInput
  availableProviders,
  onProviderChange,
  onRotateProvider,
  hasCodeBlocks = false,
}: InteractionPanelProps) {
  const [activeTab, setActiveTab] = useState("chat");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  
  // Draggable panel state
  const [panelHeight, setPanelHeight] = useState(250); // Default height
  const [panelWidth, setPanelWidth] = useState(800);
  const [isDragging, setIsDragging] = useState(false);
  const [isDraggingSide, setIsDraggingSide] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [isAttachedToEdge, setIsAttachedToEdge] = useState(false);

  // Plugin modules with randomization
  const pluginModules = useMemo(() => {
    const modules = [
      {
        id: 'ai-tutor',
        name: 'AI Tutor',
        description: 'Interactive learning assistant with step-by-step explanations',
        icon: Brain,
        color: 'text-purple-400',
        action: () => setInput('Act as an expert tutor. Break down complex topics into digestible steps with examples and practice questions. Topic: ')
      },
      {
        id: 'code-reviewer',
        name: 'Code Reviewer',
        description: 'Professional code review with best practices and optimizations',
        icon: Code,
        color: 'text-blue-400',
        action: () => setInput('Review this code for best practices, performance, security, and maintainability. Provide specific suggestions:\n\n```\n// Paste your code here\n```')
      },
      {
        id: 'document-analyzer',
        name: 'Document Analyzer',
        description: 'Analyze and summarize documents, extract key insights',
        icon: FileText,
        color: 'text-green-400',
        action: () => setInput('Analyze this document and provide: 1) Executive summary 2) Key points 3) Action items 4) Questions for clarification:\n\n')
      },
      {
        id: 'math-solver',
        name: 'Math Solver',
        description: 'Step-by-step mathematical problem solving with visualizations',
        icon: Calculator,
        color: 'text-orange-400',
        action: () => setInput('Solve this mathematical problem step-by-step with clear explanations and visual representations where helpful:\n\n')
      },
      {
        id: 'research-assistant',
        name: 'Research Assistant',
        description: 'Comprehensive research with sources, analysis, and citations',
        icon: Globe,
        color: 'text-cyan-400',
        action: () => setInput('Research this topic comprehensively. Provide: 1) Overview 2) Key findings 3) Different perspectives 4) Recent developments 5) Reliable sources. Topic: ')
      },
      {
        id: 'data-analyst',
        name: 'Data Analyst',
        description: 'Analyze datasets, create visualizations, and extract insights',
        icon: Database,
        color: 'text-indigo-400',
        action: () => setInput('Analyze this data and provide insights, trends, and visualizations. Include statistical analysis and actionable recommendations:\n\n')
      },
      {
        id: 'creative-writer',
        name: 'Creative Writer',
        description: 'Generate creative content, stories, and marketing copy',
        icon: Palette,
        color: 'text-pink-400',
        action: () => setInput('Create engaging creative content. Specify the type (story, blog post, marketing copy, etc.) and key requirements:\n\nContent type: \nTone: \nAudience: \nKey points: ')
      },
      {
        id: 'music-composer',
        name: 'Music Composer',
        description: 'Generate musical compositions, lyrics, and audio concepts',
        icon: Music,
        color: 'text-yellow-400',
        action: () => setInput('Help me create music. Provide chord progressions, melody ideas, lyrics, or composition structure for:\n\nGenre: \nMood: \nInstruments: \nTheme: ')
      },
      {
        id: 'image-prompter',
        name: 'Image Prompter',
        description: 'Generate detailed prompts for AI image generation',
        icon: Camera,
        color: 'text-red-400',
        action: () => setInput('Create a detailed image generation prompt for: \n\nSubject: \nStyle: \nLighting: \nComposition: \nMood: ')
      },
      {
        id: 'travel-planner',
        name: 'Travel Planner',
        description: 'Plan trips with itineraries, recommendations, and logistics',
        icon: Map,
        color: 'text-emerald-400',
        action: () => setInput('Plan a detailed travel itinerary including: 1) Daily schedule 2) Accommodations 3) Transportation 4) Activities 5) Budget estimates 6) Local tips\n\nDestination: \nDuration: \nBudget: \nInterests: ')
      },
      {
        id: 'game-designer',
        name: 'Game Designer',
        description: 'Design games, mechanics, narratives, and interactive experiences',
        icon: Gamepad2,
        color: 'text-violet-400',
        action: () => setInput('Design a game concept including: 1) Core mechanics 2) Player objectives 3) Progression system 4) Art style 5) Target audience\n\nGame type: \nPlatform: \nTheme: ')
      },
      {
        id: 'business-strategist',
        name: 'Business Strategist',
        description: 'Business analysis, strategy development, and market insights',
        icon: Sparkles,
        color: 'text-amber-400',
        action: () => setInput('Provide strategic business analysis including: 1) Market analysis 2) Competitive landscape 3) SWOT analysis 4) Growth opportunities 5) Action plan\n\nBusiness/Industry: ')
      }
    ];

    // Randomize order using the same approach as template suggestions
    return [...modules].sort(() => Math.random() - 0.5);
  }, [setInput]);
  const dragStartY = useRef(0);
  const dragStartHeight = useRef(0);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(0);

  // Drag handlers for resizing panel
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    setIsDragging(true);
    dragStartY.current = e.clientY;
    dragStartHeight.current = panelHeight;
    e.preventDefault();
  }, [panelHeight]);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging) return;
    
    const deltaY = dragStartY.current - e.clientY;
    const newHeight = Math.max(100, dragStartHeight.current + deltaY);
    setPanelHeight(newHeight);
  }, [isDragging]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging, handleMouseMove, handleMouseUp]);

  // Side drag handlers
  const handleSideMouseDown = useCallback((e: React.MouseEvent) => {
    setIsDraggingSide(true);
    dragStartX.current = e.clientX;
    dragStartWidth.current = panelWidth;
    e.preventDefault();
  }, [panelWidth]);

  const handleSideMouseMove = useCallback((e: MouseEvent) => {
    if (!isDraggingSide) return;
    
    const deltaX = e.clientX - dragStartX.current;
    const newWidth = Math.max(400, Math.min(1200, dragStartWidth.current + deltaX));
    setPanelWidth(newWidth);
    
    // Check if close to edge for attachment
    const windowWidth = window.innerWidth;
    if (newWidth >= windowWidth * 0.9) {
      setIsAttachedToEdge(true);
      setPanelWidth(windowWidth);
    } else {
      setIsAttachedToEdge(false);
    }
  }, [isDraggingSide]);

  const handleSideMouseUp = useCallback(() => {
    setIsDraggingSide(false);
  }, []);

  useEffect(() => {
    if (isDraggingSide) {
      document.addEventListener('mousemove', handleSideMouseMove);
      document.addEventListener('mouseup', handleSideMouseUp);
      return () => {
        document.removeEventListener('mousemove', handleSideMouseMove);
        document.removeEventListener('mouseup', handleSideMouseUp);
      };
    }
  }, [isDraggingSide, handleSideMouseMove, handleSideMouseUp]);

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

  const chatSuggestions = useMemo(() => {
    const suggestions = [
      "unique app ideas",
      "code a basic web app", 
      "make an addicting web game",
      "show me sum interesting",
      "explain quantum computing simply",
      "create a business plan",
      "write a short story",
      "design a logo concept",
      "plan a workout routine",
      "suggest healthy recipes",
      "debug this error",
      "optimize my workflow"
    ];
    
    // Randomize order and return first 4
    return [...suggestions].sort(() => Math.random() - 0.5).slice(0, 4);
  }, []);

  const codeSuggestions = [
    "Create a React component with TypeScript",
    "Build a REST API with Node.js and Express",
    "Design a responsive CSS layout with Flexbox",
    "Implement authentication with JWT tokens",
    "Create a database schema for an e-commerce app",
    "Build a real-time chat application with WebSockets",
    "Optimize performance for a large dataset",
    "Set up CI/CD pipeline with GitHub Actions"
  ];

  const allCodePromptTemplates = [
    {
      title: "Component Creation",
      template: "Create a [framework] component that [functionality]. Include:\n- TypeScript types\n- Props interface\n- Error handling\n- Unit tests\n- Documentation"
    },
    {
      title: "API Development", 
      template: "Build a [language] API for [purpose] with:\n- RESTful endpoints\n- Input validation\n- Error handling\n- Authentication\n- Database integration\n- API documentation"
    },
    {
      title: "Full Stack App",
      template: "Create a full-stack [type] application with:\n- Frontend: [frontend-tech]\n- Backend: [backend-tech]\n- Database: [database]\n- Authentication\n- Responsive design\n- Deployment configuration"
    },
    {
      title: "Code Review",
      template: "Review this code for:\n- Performance optimizations\n- Security vulnerabilities\n- Best practices\n- Code quality\n- Potential bugs\n- Refactoring suggestions\n\n[paste your code here]"
    },
    {
      title: "Database Design",
      template: "Design a database schema for [application type] with:\n- Entity relationships\n- Primary/Foreign keys\n- Indexes for performance\n- Data validation rules\n- Migration scripts\n- Sample queries"
    },
    {
      title: "Testing Strategy",
      template: "Create a comprehensive testing strategy for [project] including:\n- Unit tests\n- Integration tests\n- E2E tests\n- Performance tests\n- Test data setup\n- CI/CD integration"
    },
    {
      title: "Performance Optimization",
      template: "Optimize [application/code] for better performance:\n- Identify bottlenecks\n- Memory usage optimization\n- Database query optimization\n- Caching strategies\n- Load balancing\n- Monitoring setup"
    },
    {
      title: "Security Implementation",
      template: "Implement security measures for [application] including:\n- Authentication & Authorization\n- Input validation & sanitization\n- SQL injection prevention\n- XSS protection\n- CSRF protection\n- Security headers"
    },
    {
      title: "Microservices Architecture",
      template: "Design a microservices architecture for [system] with:\n- Service boundaries\n- Communication patterns\n- Data consistency\n- Service discovery\n- Load balancing\n- Monitoring & logging"
    },
    {
      title: "Mobile App Development",
      template: "Create a [platform] mobile app for [purpose] with:\n- Native/Cross-platform approach\n- UI/UX design\n- State management\n- API integration\n- Offline functionality\n- App store deployment"
    },
    {
      title: "DevOps Pipeline",
      template: "Set up a DevOps pipeline for [project] including:\n- Version control workflow\n- Automated testing\n- Build automation\n- Deployment strategies\n- Infrastructure as Code\n- Monitoring & alerting"
    }
  ];

  // Function to get random templates
  const getRandomTemplates = (count: number = 4) => {
    const shuffled = [...allCodePromptTemplates].sort(() => 0.5 - Math.random());
    return shuffled.slice(0, count);
  };

  // Get random templates on component mount and when activeTab changes
  const [displayedTemplates, setDisplayedTemplates] = useState(() => getRandomTemplates());

  // Refresh templates when switching to code tab
  useEffect(() => {
    if (activeTab === 'code') {
      setDisplayedTemplates(getRandomTemplates());
    }
  }, [activeTab]);

  const sampleImages = [
    {
      id: 1,
      url: "/placeholder.svg?height=200&width=300",
      title: "Neural Network Latent Visualization",
    },
    {
      id: 2,
      url: "/placeholder.svg?height=200&width=300",
      title: "Data Flow Diagram",
    },
    {
      id: 3,
      url: "/placeholder.svg?height=200&width=300",
      title: "AI Agent Architecture",
    },
    {
      id: 4,
      url: "/placeholder.svg?height=200&width=300",
      title: "Interface Concept",
    },
  ];

  return (
    <div 
      className={`absolute bottom-0 bg-black/60 backdrop-blur-md border-t border-white/10 transition-all duration-200 ${
        isAttachedToEdge ? 'left-0 right-0' : 'left-1/2 transform -translate-x-1/2'
      }`}
      style={{ 
        height: isMinimized ? '60px' : `${panelHeight}px`,
        width: isAttachedToEdge ? '100%' : `${panelWidth}px`,
        transform: isDragging || isDraggingSide ? 'none' : isAttachedToEdge ? undefined : 'translateX(-50%)'
      }}
    >
      {/* Top Drag Handle */}
      <div 
        className={`absolute top-0 left-0 right-0 h-1 bg-white/20 cursor-ns-resize hover:bg-white/30 transition-all duration-200 ${isDragging ? 'bg-white/40' : ''}`}
        onMouseDown={handleMouseDown}
      />
      
      {/* Side Drag Handles */}
      {!isAttachedToEdge && (
        <>
          <div 
            className={`absolute top-0 left-0 bottom-0 w-1 bg-white/20 cursor-ew-resize hover:bg-white/30 transition-all duration-200 ${isDraggingSide ? 'bg-white/40' : ''}`}
            onMouseDown={handleSideMouseDown}
          />
          <div 
            className={`absolute top-0 right-0 bottom-0 w-1 bg-white/20 cursor-ew-resize hover:bg-white/30 transition-all duration-200 ${isDraggingSide ? 'bg-white/40' : ''}`}
            onMouseDown={handleSideMouseDown}
          />
        </>
      )}
      
      <div className="p-4 max-w-4xl mx-auto h-full overflow-hidden">
        {/* Minimize/Maximize Controls */}
        <div className="absolute top-2 right-4 flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setIsMinimized(!isMinimized)}
            className="w-6 h-6 p-0 text-gray-400 hover:text-white"
          >
            {isMinimized ? <Maximize2 className="w-3 h-3" /> : <Minimize2 className="w-3 h-3" />}
          </Button>
          <div className="flex items-center gap-1">
            <GripHorizontal className="w-4 h-4 text-gray-500" />
          </div>
        </div>
        {!isMinimized && (
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <div className="flex justify-between items-center mb-4">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <div className="">
                  <Sparkles className="h-3 w-3 text-white" />
                </div>
                <span className="text-sm font-medium text-white/80">
                 compute
                </span>
              </div>
              <TabsList className="bg-black/40">
                <TabsTrigger value="chat">
                  <MessageSquare className="h-4 w-4 mr-2" />
                  Chat
                </TabsTrigger>
                <TabsTrigger value="code">
                  <Code className="h-4 w-4 mr-2" />
                  Code
                </TabsTrigger>
                <TabsTrigger value="images">
                  <ImageIcon className="h-4 w-4 mr-2" />
                  Images
                </TabsTrigger>
                <TabsTrigger value="plugins">
                  <Zap className="h-4 w-4 mr-2" />
                  Plugins
                </TabsTrigger>
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
                onClick={toggleAccessibility} // Call the passed prop
                title="Accessibility Options"
              >
                <Accessibility className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={toggleCodePreview} // Simplified onClick handler
                title="Code Preview"
                className={hasCodeBlocks ? "ring-2 ring-white/30 shadow-lg shadow-white/20 animate-pulse" : ""}
              >
                <Code className={`h-4 w-4 ${hasCodeBlocks ? "text-white" : ""}`} />
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
              <div className="flex items-center justify-between gap-2 mb-3 p-2 bg-red-500/10 border border-red-500/20 rounded text-red-400 text-xs">
                <div className="flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  <span>{error}</span>
                </div>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => onRetry ? onRetry() : onSubmit(input)}
                  className="ml-2"
                >
                  Retry
                </Button>
              </div>
            )}

            {/* Suggestions */}
            <div className="flex flex-wrap gap-2 mb-4">
              {chatSuggestions.map((suggestion, index) => (
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
                <button
                  type="button"
                  onClick={() => {
                    const enhancePrompt = `Please enhance and improve this message to be more clear, detailed, and effective:\n\n"${input}"\n\nProvide an enhanced version that is:
- More specific and detailed
- Better structured
- More engaging
- Clearer in intent
- Professional yet conversational`;
                    setInput(enhancePrompt);
                  }}
                  className="absolute right-3 top-3 p-1 rounded hover:bg-white/10 transition-colors"
                  title="Enhance this message"
                  disabled={!input.trim() || isProcessing}
                >
                  <Sparkles className={`h-4 w-4 ${input.trim() && !isProcessing ? 'text-purple-400 hover:text-purple-300' : 'text-gray-500'}`} />
                </button>
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

          <TabsContent value="code" className="m-0">
            {/* Code Mode Header */}
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Code className="h-4 w-4 text-blue-400" />
                <span className="text-sm font-medium text-white">Code Assistant</span>
              </div>
              <Badge variant="outline" className="text-xs">
                Enhanced Prompting
              </Badge>
            </div>

            {/* Quick Templates */}
            <div className="mb-4">
              <h4 className="text-xs font-medium text-white/80 mb-2">Quick Templates</h4>
              <div className="grid grid-cols-2 gap-2">
                {displayedTemplates.map((template, index) => (
                  <Button
                    key={index}
                    variant="outline"
                    size="sm"
                    className="text-xs bg-black/20 hover:bg-black/40 border-white/20 text-left justify-start h-auto p-2"
                    onClick={() => setInput(template.template)}
                    disabled={isProcessing}
                  >
                    <div>
                      <div className="font-medium">{template.title}</div>
                      <div className="text-xs text-white/60 mt-1 line-clamp-2">
                        {template.template.split('\n')[0]}
                      </div>
                    </div>
                  </Button>
                ))}
              </div>
            </div>

            {/* Code Suggestions */}
            <div className="mb-4">
              <h4 className="text-xs font-medium text-white/80 mb-2">Popular Requests</h4>
              <div className="flex flex-wrap gap-2">
                {codeSuggestions.slice(0, 4).map((suggestion, index) => (
                  <Button
                    key={index}
                    variant="secondary"
                    size="sm"
                    className="text-xs bg-blue-500/10 hover:bg-blue-500/20 border-blue-500/20 transition-all duration-200"
                    onClick={() => handleSuggestionClick(suggestion)}
                    disabled={isProcessing}
                  >
                    {suggestion}
                  </Button>
                ))}
              </div>
            </div>

            {/* Enhanced Code Input */}
            <form onSubmit={handleSubmit} className="space-y-3">
              <div className="relative">
                <Textarea
                  ref={textareaRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Describe your coding task in detail. Be specific about:\n• Framework/language preferences\n• Required features and functionality\n• Performance or security requirements\n• Testing and documentation needs"
                  className="min-h-[120px] bg-black/40 border-white/20 pr-12 resize-none text-sm"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                      e.preventDefault();
                      handleSubmit(e);
                    }
                  }}
                  disabled={isProcessing}
                />
                <button
                  type="button"
                  onClick={() => {
                    const enhancePrompt = `Please enhance and improve this coding request to be more detailed and specific:\n\n"${input}"\n\nProvide an enhanced version that includes:
- Specific framework/language requirements
- Detailed feature specifications
- Performance and security considerations
- Code structure and architecture preferences
- Testing and documentation requirements`;
                    setInput(enhancePrompt);
                  }}
                  className="absolute right-3 top-3 p-1 rounded hover:bg-white/10 transition-colors"
                  title="Enhance this coding request"
                  disabled={!input.trim() || isProcessing}
                >
                  <Code className={`h-4 w-4 ${input.trim() && !isProcessing ? 'text-blue-400 hover:text-blue-300' : 'text-gray-500'}`} />
                </button>
              </div>
              
              <div className="flex items-center justify-between">
                <div className="text-xs text-white/60">
                  Tip: Use Ctrl+Enter to submit, Enter for new line
                </div>
                {isProcessing && onStopGeneration ? (
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    onClick={onStopGeneration}
                  >
                    <Square className="h-4 w-4 mr-2" />
                    Stop
                  </Button>
                ) : (
                  <Button
                    type="submit"
                    size="sm"
                    className="bg-blue-600 hover:bg-blue-700"
                    disabled={isProcessing || !input.trim()}
                  >
                    {isProcessing ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    ) : (
                      <Code className="h-4 w-4 mr-2" />
                    )}
                    {isProcessing ? "Generating..." : "Generate Code"}
                  </Button>
                )}
              </div>
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

          <TabsContent value="plugins" className="m-0">
            <Card className="bg-black/40 border-white/10">
              <CardContent className="pt-6">
                <div className="space-y-3">
                  <div className="text-center mb-4">
                    <h3 className="font-medium text-white mb-2">Advanced AI Modules</h3>
                    <p className="text-xs text-white/60">Click any plugin to load its specialized prompt</p>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-3 max-h-80 overflow-y-auto">
                    {pluginModules.map((plugin) => {
                      const IconComponent = plugin.icon;
                      return (
                        <button
                          key={plugin.id}
                          onClick={plugin.action}
                          className="flex flex-col items-center gap-2 p-3 bg-black/30 hover:bg-black/50 border border-white/10 hover:border-white/20 rounded-lg transition-all duration-200 text-left group"
                        >
                          <div className="flex items-center gap-2 w-full">
                            <IconComponent className={`h-4 w-4 ${plugin.color} group-hover:scale-110 transition-transform`} />
                            <span className="font-medium text-sm text-white truncate">{plugin.name}</span>
                          </div>
                          <p className="text-xs text-white/60 line-clamp-2 w-full">{plugin.description}</p>
                        </button>
                      );
                    })}
                  </div>
                  
                  <div className="mt-4 pt-3 border-t border-white/10">
                    <div className="flex items-center gap-2 mb-2">
                      <Settings className="h-4 w-4 text-green-400" />
                      <span className="text-sm font-medium">Quick Shortcuts</span>
                    </div>
                    <div className="grid grid-cols-2 gap-1 text-xs text-white/60">
                      <div><kbd className="bg-black/40 px-1 rounded">Ctrl+Enter</kbd> Submit</div>
                      <div><kbd className="bg-black/40 px-1 rounded">Shift+Enter</kbd> New line</div>
                      <div><kbd className="bg-black/40 px-1 rounded">Ctrl+K</kbd> Focus input</div>
                      <div><kbd className="bg-black/40 px-1 rounded">Esc</kbd> Clear input</div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
        )}
      </div>
    </div>
  );
}
