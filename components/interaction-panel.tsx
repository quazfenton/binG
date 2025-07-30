"use client";
//fix
import type React from "react";
import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { Button } from '../components/ui/button';
import { Textarea } from '../components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Card, CardContent } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import type { Message, ConversationContext } from '../types';
import { toast } from "sonner";
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
  Palette,
  Music,
  Camera,
  Map,
  Gamepad2,
  Shield,
  Zap,
  Database,
  CheckCircle,
  FileCode,
  Search,
  FolderPlus,
  Hash,
  RefreshCw,
  Package,
  GitBranch,
  Key,
  Cloud,
  Server,
} from "lucide-react";
import type { LLMProvider } from '../lib/api/llm-providers';
import { templateCache, cacheKey } from '../lib/cache';
import MultiModelComparison from './multi-model-comparison';

interface InteractionPanelProps {
  onSubmit: (content: string) => void;
  onNewChat: () => void;
  isProcessing: boolean;
  toggleAccessibility: () => void; // This prop is expected to be a function that toggles accessibility options
  toggleHistory: () => void;
  toggleCodePreview: () => void; // This prop is expected to be a function
  toggleCodeMode?: () => void; // Add code mode toggle
  onStopGeneration?: () => void;
  onRetry?: () => void; // Add retry function prop
  currentProvider?: string;
  currentModel?: string;
  error?: string | null;
  input: string; // Add input prop
  setInput: (value: string) => void; // Add setInput prop
  availableProviders: LLMProvider[];
  onProviderChange: (provider: string, model: string) => void;
  hasCodeBlocks?: boolean; // Add code blocks detection
}

export default function InteractionPanel({
  onSubmit,
  onNewChat,
  isProcessing,
  toggleAccessibility, // Receive the prop
  toggleHistory,
  toggleCodePreview, // Receive the prop
  toggleCodeMode, // Add code mode toggle
  onStopGeneration,
  onRetry,
  currentProvider = "openrouter",
  currentModel = "deepseek/deepseek-r1-0528:free",
  error,
  input, // Destructure input
  setInput, // Destructure setInput
  availableProviders,
  onProviderChange,
  hasCodeBlocks = false,
}: InteractionPanelProps) {
  const [activeTab, setActiveTab] = useState("chat");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Panel state
  const [panelHeight, setPanelHeight] = useState(350); // Default height
  const [isDragging, setIsDragging] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);

  // Advanced Code Mode State
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const [projectStructure, setProjectStructure] = useState<any[]>([]);
  const [pendingDiffs, setPendingDiffs] = useState<any[]>([]);
  const [showFileSelector, setShowFileSelector] = useState(false);
  const [codeMode, setCodeMode] = useState<'basic' | 'advanced'>('basic');
  const [showMultiModelComparison, setShowMultiModelComparison] = useState(false);

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
        id: 'multi-model-compare',
        name: 'Multi-Model Compare',
        description: 'Compare responses from multiple AI models simultaneously',
        icon: Zap,
        color: 'text-yellow-400',
        action: () => setShowMultiModelComparison(true)
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
      },
      {
        id: 'api-designer',
        name: 'API Designer',
        description: 'Design RESTful APIs, GraphQL schemas, and API documentation',
        icon: Globe,
        color: 'text-teal-400',
        action: () => setInput('Design a comprehensive API including: 1) Endpoint structure 2) Request/response schemas 3) Authentication methods 4) Error handling 5) Rate limiting 6) Documentation\n\nAPI Purpose: \nData Models: \nAuthentication Type: ')
      },
      {
        id: 'security-auditor',
        name: 'Security Auditor',
        description: 'Security analysis, vulnerability assessment, and best practices',
        icon: Settings,
        color: 'text-red-500',
        action: () => setInput('Perform security analysis including: 1) Vulnerability assessment 2) Security best practices 3) Compliance requirements 4) Risk mitigation strategies 5) Security implementation guide\n\nSystem/Application: \nSecurity Level Required: \nCompliance Standards: ')
      },
      {
        id: 'performance-optimizer',
        name: 'Performance Optimizer',
        description: 'Code optimization, performance analysis, and bottleneck identification',
        icon: Zap,
        color: 'text-yellow-500',
        action: () => setInput('Analyze and optimize performance including: 1) Code profiling 2) Bottleneck identification 3) Optimization strategies 4) Caching solutions 5) Monitoring recommendations\n\nCode/System: \nPerformance Goals: \nCurrent Issues: ')
      },
      {
        id: 'devops-engineer',
        name: 'DevOps Engineer',
        description: 'CI/CD pipelines, infrastructure as code, and deployment strategies',
        icon: Settings,
        color: 'text-blue-500',
        action: () => setInput('Design DevOps solution including: 1) CI/CD pipeline 2) Infrastructure as Code 3) Deployment strategies 4) Monitoring & logging 5) Scaling solutions\n\nTech Stack: \nCloud Provider: \nDeployment Requirements: ')
      },
      {
        id: 'ux-designer',
        name: 'UX Designer',
        description: 'User experience design, wireframes, and usability analysis',
        icon: Palette,
        color: 'text-purple-500',
        action: () => setInput('Create UX design including: 1) User journey mapping 2) Wireframes & mockups 3) Usability principles 4) Accessibility guidelines 5) Design system recommendations\n\nTarget Users: \nPlatform: \nKey Features: ')
      },
      {
        id: 'database-architect',
        name: 'Database Architect',
        description: 'Design database schemas, optimize queries, and data modeling',
        icon: Database,
        color: 'text-green-500',
        action: () => setInput('Design database architecture including: 1) Entity relationship diagram 2) Table schemas with constraints 3) Indexing strategy 4) Query optimization 5) Migration scripts\n\nData Requirements: \nExpected Scale: \nDatabase Type: ')
      },
      {
        id: 'test-engineer',
        name: 'Test Engineer',
        description: 'Create comprehensive test suites, automation, and QA strategies',
        icon: CheckCircle,
        color: 'text-emerald-500',
        action: () => setInput('Create testing strategy including: 1) Unit test cases 2) Integration tests 3) E2E test scenarios 4) Test automation setup 5) Performance testing\n\nApplication Type: \nTesting Framework: \nCoverage Goals: ')
      },
      {
        id: 'ai-trainer',
        name: 'AI/ML Engineer',
        description: 'Machine learning models, data pipelines, and AI solutions',
        icon: Brain,
        color: 'text-cyan-500',
        action: () => setInput('Design AI/ML solution including: 1) Data preprocessing pipeline 2) Model architecture 3) Training strategy 4) Evaluation metrics 5) Deployment plan\n\nProblem Type: \nData Available: \nPerformance Requirements: ')
      },
      {
        id: 'code-generator',
        name: 'Code Generator',
        description: 'Generate complete applications with multiple files',
        icon: FileCode,
        color: 'text-blue-400',
        action: () => setInput('Generate a complete application with the following structure:\n\n```\nProject Structure:\n- Frontend (React/Vue/Angular)\n- Backend (Node.js/Python/Go)\n- Database schema\n- API endpoints\n- Configuration files\n- Documentation\n```\n\nApplication Type: \nTech Stack: \nFeatures Required: ')
      },
      {
        id: 'file-analyzer',
        name: 'File Analyzer',
        description: 'Analyze and optimize existing code files',
        icon: Search,
        color: 'text-orange-500',
        action: () => setInput('Analyze the provided code and generate:\n\n1. **Code Quality Report**\n   - Performance bottlenecks\n   - Security vulnerabilities\n   - Best practice violations\n\n2. **Optimization Suggestions**\n   - Refactoring opportunities\n   - Performance improvements\n   - Memory optimization\n\n3. **Enhanced Version**\n   - Optimized code with comments\n   - Unit tests\n   - Documentation\n\nPaste your code below:\n```\n\n```')
      },
      {
        id: 'project-scaffolder',
        name: 'Project Scaffolder',
        description: 'Create complete project templates with best practices',
        icon: FolderPlus,
        color: 'text-green-400',
        action: () => setInput('Create a complete project scaffold including:\n\n📁 **Project Structure**\n- Organized folder hierarchy\n- Configuration files\n- Environment setup\n\n🔧 **Development Tools**\n- Build scripts\n- Linting configuration\n- Testing setup\n\n📚 **Documentation**\n- README with setup instructions\n- API documentation\n- Contributing guidelines\n\nProject Type: \nFramework: \nDeployment Target: ')
      },
      {
        id: 'regex-builder',
        name: 'Regex Builder',
        description: 'Build and test complex regular expressions',
        icon: Hash,
        color: 'text-yellow-500',
        action: () => setInput('Create a regex pattern for:\n\n**Pattern Requirements:**\n- What you want to match\n- What you want to exclude\n- Specific format requirements\n\n**Output will include:**\n- Regex pattern with explanation\n- Test cases with examples\n- Code snippets for different languages\n- Alternative approaches\n\nDescribe what you want to match: ')
      },
      {
        id: 'data-transformer',
        name: 'Data Transformer',
        description: 'Convert data between formats (JSON, CSV, XML, etc.)',
        icon: RefreshCw,
        color: 'text-purple-400',
        action: () => setInput('Transform data between formats:\n\n**Supported Formats:**\n- JSON ↔ CSV ↔ XML ↔ YAML\n- Database schemas\n- API responses\n- Configuration files\n\n**Features:**\n- Format validation\n- Structure optimization\n- Data cleaning\n- Schema generation\n\nSource Format: \nTarget Format: \nPaste your data:\n```\n\n```')
      },
      {
        id: 'docker-composer',
        name: 'Docker Composer',
        description: 'Generate Docker configurations and compose files',
        icon: Package,
        color: 'text-blue-600',
        action: () => setInput('Generate Docker configuration:\n\n🐳 **Docker Setup**\n- Multi-stage Dockerfile\n- Docker Compose with services\n- Environment configuration\n- Volume and network setup\n\n📦 **Services to Include**\n- Application containers\n- Database services\n- Caching layers\n- Reverse proxy\n\n🔧 **Production Ready**\n- Health checks\n- Resource limits\n- Security best practices\n- Logging configuration\n\nApplication Stack: \nServices Needed: \nEnvironment: ')
      },
      {
        id: 'git-workflow',
        name: 'Git Workflow',
        description: 'Generate Git hooks, workflows, and automation scripts',
        icon: GitBranch,
        color: 'text-orange-600',
        action: () => setInput('Create Git workflow automation:\n\n🌿 **Branch Strategy**\n- Branching model (GitFlow/GitHub Flow)\n- Branch protection rules\n- Merge strategies\n\n🔄 **CI/CD Pipeline**\n- GitHub Actions / GitLab CI\n- Automated testing\n- Deployment workflows\n\n🪝 **Git Hooks**\n- Pre-commit hooks\n- Commit message validation\n- Code quality checks\n\n📋 **Templates**\n- PR/MR templates\n- Issue templates\n- Contributing guidelines\n\nRepository Type: \nCI/CD Platform: \nTeam Size: ')
      },
      {
        id: 'env-manager',
        name: 'Environment Manager',
        description: 'Generate environment configurations and secrets management',
        icon: Key,
        color: 'text-indigo-500',
        action: () => setInput('Setup environment management:\n\n🔐 **Environment Variables**\n- Development, staging, production configs\n- Secret management strategy\n- Environment validation\n\n🛡️ **Security**\n- API key rotation\n- Encrypted secrets\n- Access control\n\n📁 **Configuration Files**\n- .env templates\n- Docker environment files\n- Kubernetes secrets\n- Cloud provider configs\n\n🔄 **Deployment**\n- Environment promotion\n- Configuration drift detection\n- Rollback strategies\n\nDeployment Platform: \nSecrets to Manage: \nEnvironments Needed: ')
      },
      {
        id: 'huggingface-spaces',
        name: 'HF Spaces ImageGen',
        description: 'Embed Hugging Face Spaces image generation models',
        icon: ImageIcon,
        color: 'text-yellow-400',
        action: () => setInput('Generate images using Hugging Face Spaces:\n\n🎨 **Available Models:**\n- DALL-E Mini/Mega\n- Stable Diffusion variants\n- Midjourney-style models\n- Artistic style transfer\n- Face generation models\n\n⚡ **Zero GPU Hosting:**\n- Free GPU access\n- Instant model loading\n- No setup required\n- Community models\n\n🖼️ **Image Generation:**\n- Text-to-image\n- Image-to-image\n- Style transfer\n- Upscaling\n- Inpainting\n\n**Prompt:** Describe the image you want to generate\n**Style:** (realistic, artistic, cartoon, etc.)\n**Dimensions:** (512x512, 1024x1024, etc.)\n\nDescribe your image: ')
      },
      {
        id: 'github-explorer',
        name: 'GitHub Explorer',
        description: 'Browse trending repos with retro game-like interface',
        icon: GitBranch,
        color: 'text-green-400',
        action: () => setInput('🕹️ **GITHUB ARCADE** 🕹️\n\n```\n┌─────────────────────────────────────┐\n│  🎮 SELECT TRENDING REPOSITORY 🎮   │\n├─────────────────────────────────────┤\n│ [A] 🔥 React 19 - Latest Features  │\n│ [B] ⚡ Vite 5.0 - Lightning Fast   │\n│ [C] 🤖 LangChain - AI Chains       │\n│ [D] 🎨 Tailwind CSS - Utility CSS  │\n│ [E] 📦 Next.js 14 - Full Stack     │\n│ [F] 🔧 TypeScript - Type Safety    │\n│ [G] 🚀 Astro - Static Site Gen     │\n│ [H] 💾 Prisma - Database ORM       │\n└─────────────────────────────────────┘\n```\n\n🎯 **MISSION:** Select a repository to:\n- 📋 Auto-fetch README.md\n- 📦 Parse package.json\n- 🔍 Extract main scripts\n- 📝 Generate project analysis\n- 🛠️ Suggest improvements\n\n**Enter your choice (A-H) or specify a custom repo:**\nRepository: ')
      },
      {
        id: 'cloud-storage',
        name: 'Cloud Storage 5GB',
        description: 'Setup cloud storage with 5GB free tier',
        icon: Cloud,
        color: 'text-blue-400',
        action: () => setInput('☁️ **CLOUD STORAGE SETUP** (5GB Free)\n\n🗄️ **Storage Providers:**\n- Google Cloud Storage\n- AWS S3\n- Azure Blob Storage\n- DigitalOcean Spaces\n- Cloudflare R2\n\n📦 **Implementation Features:**\n- File upload/download API\n- Automatic backup system\n- CDN integration\n- Image optimization\n- Version control\n- Access permissions\n\n🔧 **Self-Hosting Option:**\n- MinIO server setup\n- Docker containerization\n- SSL/TLS encryption\n- Backup strategies\n\n**ENABLE_CLOUD_STORAGE = true** (set to false to disable)\n\nPreferred Provider: \nUse Case: \nSecurity Requirements: ')
      },
      {
        id: 'vps-deployment',
        name: 'VPS Deployment',
        description: 'Deploy applications to VPS with automated setup',
        icon: Server,
        color: 'text-purple-400',
        action: () => setInput('🖥️ **VPS DEPLOYMENT SYSTEM**\n\n🚀 **VPS Providers:**\n- DigitalOcean Droplets\n- Linode\n- Vultr\n- Hetzner Cloud\n- Google Compute Engine\n\n⚙️ **Automated Setup:**\n- Server provisioning\n- Docker installation\n- Nginx reverse proxy\n- SSL certificate (Let\'s Encrypt)\n- Firewall configuration\n- Monitoring setup\n\n🔄 **CI/CD Pipeline:**\n- GitHub Actions integration\n- Automated deployments\n- Health checks\n- Rollback capabilities\n- Log aggregation\n\n**ENABLE_VPS_DEPLOYMENT = true** (set to false to disable)\n\nApplication Type: \nTraffic Expected: \nBudget Range: ')
      }
    ];

    // Randomize order using the same approach as template suggestions
    return [...modules].sort(() => Math.random() - 0.5);
  }, [setInput]);
  const dragStartY = useRef(0);
  const dragStartHeight = useRef(0);

  // Simplified drag handlers for vertical resizing only
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    setIsDragging(true);
    dragStartY.current = e.clientY;
    dragStartHeight.current = panelHeight;
    e.preventDefault();
  }, [panelHeight]);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging) return;

    const deltaY = dragStartY.current - e.clientY;
    const newHeight = Math.max(200, Math.min(800, dragStartHeight.current + deltaY));
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

  // Function to get random templates with caching
  const getRandomTemplates = (count: number = 4) => {
    const cacheKeyStr = cacheKey.codeTemplate('all', `random_${count}`);
    
    // Try to get from cache first
    const cached = templateCache.get<typeof allCodePromptTemplates>(cacheKeyStr);
    if (cached) {
      return cached;
    }
    
    // Generate new random templates
    const shuffled = [...allCodePromptTemplates].sort(() => 0.5 - Math.random());
    const result = shuffled.slice(0, count);
    
    // Cache for 10 minutes
    templateCache.set(cacheKeyStr, result, 10 * 60 * 1000);
    
    return result;
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
      className={`fixed bg-black/60 backdrop-blur-md border border-white/10 transition-all duration-200 z-50 left-0 right-0 bottom-0 border-t`}
      style={{
        height: isMinimized
          ? '60px'
          : `${panelHeight}px`
      }}
    >
      {/* Drag Handle - Only vertical resizing */}
      <div
        className={`absolute top-0 left-0 right-0 h-1 bg-white/20 hover:bg-white/30 cursor-ns-resize transition-all duration-200 ${isDragging ? 'bg-white/40' : ''}`}
        onMouseDown={handleMouseDown}
      />

      <div className="p-4 h-full overflow-hidden max-w-4xl mx-auto flex flex-col">
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
          <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-col flex-1 overflow-hidden">
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

            <TabsContent value="chat" className="m-0 flex-1 flex flex-col overflow-hidden">
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

              <form onSubmit={handleSubmit} className="flex space-x-2 mt-auto">
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

            <TabsContent value="code" className="m-0 flex-1 flex flex-col overflow-hidden">
              {/* Code Mode Header */}
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Code className="h-4 w-4 text-blue-400" />
                  <span className="text-sm font-medium text-white">Code Assistant</span>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant={codeMode === 'advanced' ? 'default' : 'outline'}
                    onClick={() => setCodeMode(codeMode === 'basic' ? 'advanced' : 'basic')}
                    className="text-xs"
                  >
                    {codeMode === 'advanced' ? '🔧 Advanced' : '📝 Basic'}
                  </Button>
                  <Badge variant="outline" className="text-xs">
                    {codeMode === 'advanced' ? 'IDE Mode' : 'Enhanced Prompting'}
                  </Badge>
                </div>
              </div>

              {/* Advanced Code Mode - File Selector */}
              {codeMode === 'advanced' && (
                <div className="mb-4 p-3 bg-black/30 rounded-lg border border-white/10">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-xs font-medium text-white/80">Project Files</h4>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setShowFileSelector(!showFileSelector)}
                        className="text-xs"
                      >
                        {showFileSelector ? 'Hide' : 'Select Files'}
                      </Button>
                      {toggleCodeMode && (
                        <Button
                          size="sm"
                          variant="default"
                          onClick={toggleCodeMode}
                          className="text-xs bg-blue-600 hover:bg-blue-700"
                        >
                          🚀 IDE Mode
                        </Button>
                      )}
                    </div>
                  </div>

                  {showFileSelector && (
                    <div className="space-y-2 max-h-32 overflow-y-auto">
                      {['src/components/App.tsx', 'src/utils/helpers.ts', 'package.json', 'README.md', 'src/styles/globals.css'].map((file) => (
                        <label key={file} className="flex items-center gap-2 text-xs cursor-pointer hover:bg-white/5 p-1 rounded">
                          <input
                            type="checkbox"
                            checked={selectedFiles.includes(file)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedFiles([...selectedFiles, file]);
                              } else {
                                setSelectedFiles(selectedFiles.filter(f => f !== file));
                              }
                            }}
                            className="rounded"
                          />
                          <span className="text-white/70">{file}</span>
                        </label>
                      ))}
                    </div>
                  )}

                  {selectedFiles.length > 0 && (
                    <div className="mt-2 text-xs text-green-400">
                      ✓ {selectedFiles.length} file(s) selected for context
                    </div>
                  )}
                </div>
              )}

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
                {codeMode === 'advanced' && (
                  <div className="bg-black/20 rounded-lg p-3 border border-white/10 mb-3">
                    <h4 className="text-xs font-medium text-white/80 mb-2">IDE Command Schema</h4>
                    <div className="text-xs text-white/60 space-y-1">
                      <div><code className="bg-white/10 px-1 rounded">@read_file(path)</code> - Request file content</div>
                      <div><code className="bg-white/10 px-1 rounded">@write_diff(file, changes)</code> - Apply changes</div>
                      <div><code className="bg-white/10 px-1 rounded">@list_project</code> - Show project structure</div>
                      <div><code className="bg-white/10 px-1 rounded">@analyze_code(file)</code> - Code analysis</div>
                    </div>
                  </div>
                )}

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

            <TabsContent value="images" className="m-0 flex-1 flex flex-col overflow-hidden">
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

            <TabsContent value="plugins" className="m-0 flex-1 flex flex-col overflow-hidden">
              <Card className="bg-black/40 border-white/10">
                <CardContent className="pt-6">
                  <div className="space-y-3">
                    <div className="text-center mb-4">
                      <h3 className="font-medium text-white mb-2">Advanced AI Modules</h3>
                      <p className="text-xs text-white/60">Click any plugin to load its specialized prompt and switch to chat</p>
                    </div>

                    <div className="grid grid-cols-2 gap-3 max-h-80 overflow-y-auto">
                      {pluginModules.map((plugin) => {
                        const IconComponent = plugin.icon;
                        return (
                          <button
                            key={plugin.id}
                            onClick={() => {
                              plugin.action();
                              setActiveTab('chat'); // Switch to chat tab to show the input
                              toast.success(`${plugin.name} plugin activated! Check the chat input.`);
                            }}
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

      {/* Multi-Model Comparison Modal */}
      <MultiModelComparison
        isOpen={showMultiModelComparison}
        onClose={() => setShowMultiModelComparison(false)}
        availableProviders={availableProviders}
        currentProvider={currentProvider}
        currentModel={currentModel}
      />
    </div>
  );
}
