/**
 * SPEC Meta-Prompts Injection System
 * 
 * Strategic, step-specific meta-prompts that are injected on top of the parsed
 * spec plan at each round of the maximalist spec enhancement process.
 * 
 * These prompts are designed to:
 * - Focus each step on a specific aspect of the development process
 * - Maximize quality through targeted optimization directives
 * - Provide additive context beyond what spec-parser.ts generates
 * - Guide the LLM toward more comprehensive implementations
 * 
 * There are multiple specialized chains:
 * - DEFAULT: General full-stack development (10 steps)
 * - FRONTEND: Frontend-focused development
 * - ML_AI: Machine Learning & AI with open-source automation
 * - BACKEND: Backend-focused development
 * - MOBILE: Mobile app development
 * - SECURITY: Security-focused development
 * - DEVOPS: DevOps and infrastructure
 * - DATA: Data engineering and pipelines
 * - API: API design and development
 * - SYSTEM: System architecture and design
 * - WEB3: Blockchain and Web3 development
 */

import type { SpecEnhancementMode, MaximalistConfig } from './maximalist-spec-enhancer';

// ============================================================================
// Meta-Prompt Types
// ============================================================================

export interface MetaPrompt {
  /** Unique identifier for this meta-prompt */
  id: string;
  /** The round number this meta-prompt is designed for (1-10) */
  targetRound: number;
  /** Human-readable title for debugging/logging */
  title: string;
  /** The meta-prompt content to inject */
  content: string;
  /** Whether this prompt should be combined with adjacent prompts */
  combinable: boolean;
}

export interface MetaPromptContext {
  /** Current round number (1-based) */
  roundNumber: number;
  /** Total number of rounds */
  totalRounds: number;
  /** Enhancement mode */
  mode: SpecEnhancementMode;
  /** Previous round outputs for context */
  previousOutputs: string[];
  /** User's original request */
  originalRequest: string;
  /** Current spec being worked on */
  currentSpecGoal: string;
}

/** The domain/specialty chain to use for meta-prompts */
export type MetaPromptChain = 
  | 'default'       // General full-stack (original 10 steps)
  | 'frontend'      // Frontend-focused
  | 'ml_ai'         // Machine Learning & AI
  | 'backend'       // Backend-focused
  | 'mobile'        // Mobile development
  | 'security'      // Security-focused
  | 'devops'        // DevOps & infrastructure
  | 'data'          // Data engineering
  | 'api'           // API design
  | 'system'        // System architecture
  | 'web3';         // Blockchain & Web3

// ============================================================================
// Meta-Prompt Chain Definitions
// ============================================================================

/**
 * DEFAULT Chain - General Full-Stack Development (original)
 */
const DEFAULT_CHAIN: MetaPrompt[] = [
  {
    id: 'default-1-architecture',
    targetRound: 1,
    title: 'Architecture & Tech Stack Planning',
    combinable: true,
    content: `
============================================
# META-PROMPT: ARCHITECTURE & TECH STACK
============================================

Plan the architecture for the optimal design and most modern and robust tech stack 
to carry out the build. Plan integrations with external services, any open source 
projects that this can be built upon or integrated with, and any SDKs or APIs that 
may already be well adapted to handle core functionalities.

WITH EMPHASIS ON:
- maintainability and modularity
- platform support  
- multi-purpose use
- advanced capabilities
- wide-ranging integrations with adaptive layers

Avoid basic or lackluster frameworks. Use modern frameworks:
- Frontend: Next.js, Nuxt, or Remix over basic HTML/React
- Desktop: Tauri over Electron
- Backend: Rust, Go, or Python over Java
- Databases: PostgreSQL, MongoDB over older SQL
`
  },
  {
    id: 'default-2-frontend-foundation',
    targetRound: 2,
    title: 'Frontend Foundation & Core UI',
    combinable: true,
    content: `
============================================
# META-PROMPT: FRONTEND FOUNDATION
============================================

Build the frontend foundation and core UI components:
- Project setup with modern tooling (Vite, Turborepo)
- Core layout components and structure
- Global styles with Tailwind CSS
- Theme system and design tokens
- Responsive design foundation
- Accessibility baseline (ARIA, keyboard navigation)

BUILD WITH:
- Modern component patterns (hooks, context, composition)
- Type-safe component props and TypeScript
- Proper state management architecture
- CSS architecture that scales
`
  },
  {
    id: 'default-3-frontend-interactions',
    targetRound: 3,
    title: 'Frontend Interactions & Visual Polish',
    combinable: true,
    content: `
============================================
# META-PROMPT: FRONTEND INTERACTIONS
============================================

Focus on interactive elements and visual polish:
- Buttons with proper states and animations
- Form elements with validation and feedback
- Loading states and skeletons
- Toast notifications and alerts
- Modal dialogs and popovers
- Interactive charts and data visualization
- Smooth animations (Framer Motion or CSS)
- Hover states and micro-interactions

BUILD WITH modern UI libraries or custom sleek components.
`
  },
  {
    id: 'default-4-frontend-advanced',
    targetRound: 4,
    title: 'Frontend Advanced Features',
    combinable: true,
    content: `
============================================
# META-PROMPT: FRONTEND ADVANCED FEATURES
============================================

Implement advanced frontend features:
- Advanced routing with nested routes
- Data fetching with caching and invalidation
- Real-time updates and WebSocket integration
- Complex forms with multi-step flows
- Drag-and-drop interfaces
- Advanced data tables
- Rich text editors or markdown support
- File upload with drag-drop and progress

PRIORITIZE performance, accessibility, and progressive enhancement.
`
  },
  {
    id: 'default-5-backend-foundation',
    targetRound: 5,
    title: 'Backend Foundation & API Core',
    combinable: true,
    content: `
============================================
# META-PROMPT: BACKEND FOUNDATION
============================================

Build the backend foundation and API core:
- Server setup with modern architecture (Fastify, NestJS)
- API route handlers and middleware
- Database connection and schema design
- Authentication system (JWT, sessions, OAuth)
- Authorization and permission system
- Input validation and sanitization
- Error handling and logging
- API documentation (OpenAPI/Swagger)

PRIORITIZE RESTful or GraphQL API design with proper type safety.
`
  },
  {
    id: 'default-6-backend-advanced',
    targetRound: 6,
    title: 'Backend Advanced & Complex Logic',
    combinable: false,
    content: `
============================================
# META-PROMPT: BACKEND ADVANCED (MID-POINT)
============================================

Implement complex backend logic at the midpoint:

COMPLEX LOGIC:
- Business logic and domain services
- Complex queries and aggregations
- Transaction management
- Background job processing
- Caching strategy (Redis)
- Queue systems

ADVANCED PATTERNS:
- Repository pattern
- Event-driven architecture
- CQRS if applicable
- Proper dependency injection
- Service layer architecture

This is the midpoint - build comprehensively.
`
  },
  {
    id: 'default-7-integrations',
    targetRound: 7,
    title: 'Integrations & External Services',
    combinable: true,
    content: `
============================================
# META-PROMPT: INTEGRATIONS & EXTERNAL SERVICES
============================================

Wire in integrations with external services:
- Third-party API integrations (payment, email, analytics)
- Webhook handlers and event processing
- OAuth provider integrations
- External service clients
- Service-to-service communication

IMPLEMENT WITH:
- Proper error handling for external failures
- Retry logic with exponential backoff
- Circuit breaker patterns
- Proper secret management
- Type-safe client wrappers
`
  },
  {
    id: 'default-8-features',
    targetRound: 8,
    title: 'Features Completion & Enhancement',
    combinable: true,
    content: `
============================================
# META-PROMPT: FEATURES COMPLETION
============================================

Complete remaining features:
- Add missing features from the original spec
- Enhance incomplete implementations
- Add feature flags and configuration
- User preferences and settings
- Dashboard and analytics views
- Reporting and data export
- Search and filtering capabilities

COMPLETE WITH full implementation, no stubs, edge cases handled.
`
  },
  {
    id: 'default-9-testing',
    targetRound: 9,
    title: 'Testing & Quality Assurance',
    combinable: true,
    content: `
============================================
# META-PROMPT: TESTING & QUALITY ASSURANCE
============================================

Implement comprehensive testing:
- Unit tests for critical functions
- Integration tests for API endpoints
- E2E tests for critical user flows
- Test coverage improvement
- Mock and fixture setup

ADD:
- Code linting and formatting
- Type checking enforcement
- Pre-commit hooks
- CI/CD pipeline configuration
`
  },
  {
    id: 'default-10-review-security',
    targetRound: 10,
    title: 'Review, Security & Production Readiness',
    combinable: false,
    content: `
============================================
# META-PROMPT: REVIEW, SECURITY & PRODUCTION
============================================

Final review, security hardening, and production readiness:

SECURITY:
- Input sanitization, XSS, CSRF protection
- SQL injection prevention
- Proper auth checks on all endpoints
- Rate limiting, audit logging
- Security headers (CSP, HSTS)
- Dependency vulnerability scanning

PRODUCTION:
- Environment configuration
- Performance monitoring
- Error tracking integration
- Health check endpoints
- Graceful shutdown handling
- Deployment configuration
`
  }
];

/**
 * FRONTEND Chain - Frontend-focused Development
 */
const FRONTEND_CHAIN: MetaPrompt[] = [
  {
    id: 'frontend-1-setup',
    targetRound: 1,
    title: 'Frontend Project Setup & Tooling',
    combinable: true,
    content: `
============================================
# META-PROMPT: FRONTEND SETUP & TOOLING
============================================

Set up the frontend project with modern tooling:
- Package manager (pnpm, yarn, or npm)
- Build tool (Vite, Turborepo, Next.js App Router)
- TypeScript configuration with strict mode
- Linting (ESLint) and formatting (Prettier)
- Testing framework (Vitest, Playwright)
- Component library setup

USE modern stack: React 18+, TypeScript 5+, Vite, Tailwind CSS
`
  },
  {
    id: 'frontend-2-components',
    targetRound: 2,
    title: 'Core Components Architecture',
    combinable: true,
    content: `
============================================
# META-PROMPT: CORE COMPONENTS ARCHITECTURE
============================================

Build the core component architecture:
- Design system and tokens
- Base components (Button, Input, Card, Modal)
- Layout components (Header, Sidebar, Footer)
- Typography and spacing scales
- Color system and theming
- Responsive breakpoints

FOCUS on reusability, composability, and type safety.
`
  },
  {
    id: 'frontend-3-state',
    targetRound: 3,
    title: 'State Management & Data Flow',
    combinable: true,
    content: `
============================================
# META-PROMPT: STATE MANAGEMENT
============================================

Implement robust state management:
- Global state (Zustand, Jotai, or Redux Toolkit)
- Server state (React Query, SWR)
- Form state (React Hook Form, Zod)
- URL state management
- Local storage persistence
- Optimistic updates

PRIORITIZE performance and DX.
`
  },
  {
    id: 'frontend-4-routing',
    targetRound: 4,
    title: 'Routing & Navigation',
    combinable: true,
    content: `
============================================
# META-PROMPT: ROUTING & NAVIGATION
============================================

Implement advanced routing:
- Nested routes and layouts
- Route guards and authentication
- Lazy loading and code splitting
- Dynamic routes and interceptors
- Breadcrumbs and navigation state
- Deep linking support

USE React Router v7 or Next.js App Router patterns.
`
  },
  {
    id: 'frontend-5-forms',
    targetRound: 5,
    title: 'Forms & User Input',
    combinable: true,
    content: `
============================================
# META-PROMPT: FORMS & USER INPUT
============================================

Build comprehensive form handling:
- Complex form validation (Zod, Yup)
- Multi-step wizards
- File upload with progress
- Rich text input
- Date/time pickers
- Auto-save functionality
- Accessible form components

ENSURE accessibility (ARIA, keyboard navigation).
`
  },
  {
    id: 'frontend-6-visuals',
    targetRound: 6,
    title: 'Visual Design & Animations',
    combinable: false,
    content: `
============================================
# META-PROMPT: VISUAL DESIGN (MID-POINT)
============================================

Implement advanced visual design and animations:

ANIMATIONS:
- Page transitions and route animations
- Micro-interactions and hover effects
- Loading skeletons and spinners
- Chart animations
- Scroll-triggered animations (Framer Motion)

VISUALS:
- Complex data visualization (D3, Recharts, Visx)
- Custom Canvas/WebGL graphics
- Image optimization and lazy loading
- Dark/light mode with system preference

This is the midpoint - make it visually stunning.
`
  },
  {
    id: 'frontend-7-realtime',
    targetRound: 7,
    title: 'Real-time & Collaboration',
    combinable: true,
    content: `
============================================
# META-PROMPT: REAL-TIME & COLLABORATION
============================================

Implement real-time features:
- WebSocket integration
- Live updates and notifications
- Collaborative editing (CRDTs, Yjs)
- Presence indicators
- Typing indicators
- Real-time comments and reactions

BUILD with Socket.io, Supabase, or Firebase.
`
  },
  {
    id: 'frontend-8-performance',
    targetRound: 8,
    title: 'Performance Optimization',
    combinable: true,
    content: `
============================================
# META-PROMPT: PERFORMANCE OPTIMIZATION
============================================

Optimize performance:
- Bundle analysis and code splitting
- Image optimization (next/image, Cloudinary)
- Virtual scrolling for large lists
- Memoization and lazy loading
- Service worker for offline support
- Core Web Vitals optimization
- Lighthouse score > 90

PROFILE and measure performance continuously.
`
  },
  {
    id: 'frontend-9-testing',
    targetRound: 9,
    title: 'Testing & Quality',
    combinable: true,
    content: `
============================================
# META-PROMPT: FRONTEND TESTING
============================================

Comprehensive frontend testing:
- Unit tests (Vitest, Jest)
- Component testing (React Testing Library)
- E2E tests (Playwright, Cypress)
- Visual regression testing (Chromatic)
- Accessibility testing (axe-core)
- Performance benchmarking

ACHIEVE > 80% code coverage on critical paths.
`
  },
  {
    id: 'frontend-10-production',
    targetRound: 10,
    title: 'Production & Deployment',
    combinable: false,
    content: `
============================================
# META-PROMPT: PRODUCTION & DEPLOYMENT
============================================

Final production readiness:

DEPLOYMENT:
- CI/CD pipeline (GitHub Actions, Vercel)
- Environment configuration
- Feature flags
- Error monitoring (Sentry)
- Analytics integration
- SEO optimization

ACCESSIBILITY:
- WCAG 2.1 AA compliance
- Screen reader testing
- Keyboard navigation
- Color contrast ratios

Bundle size < 200KB gzipped.
`
  }
];

/**
 * ML_AI Chain - Machine Learning & AI with Open Source
 */
const ML_AI_CHAIN: MetaPrompt[] = [
  {
    id: 'ml-1-ml-stack',
    targetRound: 1,
    title: 'ML Stack & Environment Setup',
    combinable: true,
    content: `
============================================
# META-PROMPT: ML STACK & ENVIRONMENT
============================================

Set up the ML/AI development environment:

CORE TOOLS:
- Python 3.10+ with virtual environments
- PyTorch 2.0+ or TensorFlow 2.15+
- Hugging Face Transformers
- CUDA 12+ for GPU acceleration

ML OPS:
- MLflow for experiment tracking
- Weights & Biases for logging
- DVC for data version control
- Prefect or Airflow for pipelines

USE latest stable versions of all libraries.
`
  },
  {
    id: 'ml-2-data-pipeline',
    targetRound: 2,
    title: 'Data Pipeline & Preprocessing',
    combinable: true,
    content: `
============================================
# META-PROMPT: DATA PIPELINE
============================================

Build robust data pipelines:

DATA PROCESSING:
- ETL pipelines with Pandas/Polars
- Data cleaning and normalization
- Feature engineering
- Data augmentation
- Handling missing values and outliers

STORAGE:
- Arrow/Parquet for efficient storage
- Feature store setup (Feast, Tecton)
- Data lake architecture

ENSURE reproducibility with seed handling.
`
  },
  {
    id: 'ml-3-model-architecture',
    targetRound: 3,
    title: 'Model Architecture Design',
    combinable: true,
    content: `
============================================
# META-PROMPT: MODEL ARCHITECTURE
============================================

Design the model architecture:

ARCHITECTURE CHOICES:
- Transformer-based models (BERT, GPT, T5)
- Vision models (ViT, SAM, Stable Diffusion)
- Multi-modal architectures
- Custom layers and attention mechanisms

TRANSFER LEARNING:
- Fine-tuning pre-trained models
- LoRA and QLoRA for efficient fine-tuning
- PEFT methods
- Model merging techniques

USE Hugging Face Hub for pre-trained models.
`
  },
  {
    id: 'ml-4-training',
    targetRound: 4,
    title: 'Training Pipeline & Optimization',
    combinable: true,
    content: `
============================================
# META-PROMPT: TRAINING PIPELINE
============================================

Implement efficient training:

TRAINING:
- Distributed training (DDP, FSDP)
- Mixed precision training (AMP)
- Gradient accumulation
- Learning rate scheduling
- Early stopping and checkpoints

OPTIMIZATION:
- Hyperparameter tuning (Optuna, Ray Tune)
- Model pruning and quantization
- Knowledge distillation
- ONNX export for inference

LOG everything with MLflow or W&B.
`
  },
  {
    id: 'ml-5-evaluation',
    targetRound: 5,
    title: 'Model Evaluation & Metrics',
    combinable: true,
    content: `
============================================
# META-PROMPT: MODEL EVALUATION
============================================

Comprehensive model evaluation:

METRICS:
- Classification: Accuracy, F1, AUC, Precision/Recall
- Generation: BLEU, ROUGE, METEOR, PERPLEXITY
- Embedding: Cosine similarity, recall@k
- Custom domain-specific metrics

EVALUATION:
- Cross-validation
- Confusion matrix analysis
- Error analysis
- Bias and fairness evaluation
- Human evaluation framework
`
  },
  {
    id: 'ml-6-inference',
    targetRound: 6,
    title: 'Inference & Serving (MID-POINT)',
    combinable: false,
    content: `
============================================
# META-PROMPT: INFERENCE (MID-POINT)
============================================

Build production inference system:

SERVING:
- TorchServe, Triton Inference Server
- FastAPI endpoint with async inference
- Batch inference optimization
- Streaming responses for LLMs

OPTIMIZATION:
- Model quantization (GPTQ, AWQ, INT8)
- ONNX Runtime optimization
- CUDA graphs
- KV cache optimization for LLMs

This is the midpoint - optimize for latency and throughput.
`
  },
  {
    id: 'ml-7-rag',
    targetRound: 7,
    title: 'RAG & Vector Database',
    combinable: true,
    content: `
============================================
# META-PROMPT: RAG & VECTOR SEARCH
============================================

Implement Retrieval-Augmented Generation:

VECTOR STORE:
- Pinecone, Weaviate, Milvus, or Qdrant
- Embedding generation (OpenAI, Cohere, local)
- Approximate nearest neighbors
- Hybrid search (dense + sparse)

RAG PIPELINE:
- Document chunking strategies
- Query processing and rewriting
- Context compression
- Multi-step reasoning
- Citation and source tracking
`
  },
  {
    id: 'ml-8-agents',
    targetRound: 8,
    title: 'AI Agents & Automation',
    combinable: true,
    content: `
============================================
# META-PROMPT: AI AGENTS & AUTOMATION
============================================

Build autonomous AI agents:

AGENT ARCHITECTURE:
- ReAct, Toolformer patterns
- Replanner and executor
- Memory and context management
- Multi-agent collaboration

TOOLS:
- Function calling and tool use
- Code execution (sandboxed)
- Web search and browsing
- API integrations

USE LangChain, AutoGen, or custom implementation.
`
  },
  {
    id: 'ml-9-monitoring',
    targetRound: 9,
    title: 'MLOps & Monitoring',
    combinable: true,
    content: `
============================================
# META-PROMPT: MLOPS & MONITORING
============================================

Implement MLOps and monitoring:

MLOPS:
- Model registry and versioning
- CI/CD for ML (MLflow, Kubeflow)
- A/B testing and canary deployments
- Feature store integration
- Automated retraining pipelines

MONITORING:
- Data drift detection
- Model performance degradation
- Latency and throughput metrics
- Cost tracking for API calls
- Alerting on anomalies
`
  },
  {
    id: 'ml-10-production',
    targetRound: 10,
    title: 'Production & Safety',
    combinable: false,
    content: `
============================================
# META-PROMPT: PRODUCTION & SAFETY
============================================

Final production readiness with safety focus:

SAFETY:
- Input/output validation
- Prompt injection prevention
- Rate limiting and abuse detection
- Content filtering
- Hallucination detection
- Explainability and transparency

PRODUCTION:
- Auto-scaling based on load
- Fallback strategies
- Rollback capabilities
- Comprehensive logging
- Cost optimization

ENSURE responsible AI practices.
`
  }
];

/**
 * BACKEND Chain - Backend-focused Development
 */
const BACKEND_CHAIN: MetaPrompt[] = [
  {
    id: 'backend-1-server',
    targetRound: 1,
    title: 'Server Architecture & Setup',
    combinable: true,
    content: `
============================================
# META-PROMPT: SERVER ARCHITECTURE
============================================

Set up robust server architecture:

FRAMEWORKS:
- Fastify, Hono, or NestJS (Node.js)
- FastAPI or Flask (Python)
- Gin or Fiber (Go)
- Actix-web (Rust)

ARCHITECTURE:
- Clean Architecture / Hexagonal
- Dependency injection
- Configuration management
- Graceful startup and shutdown

USE TypeScript throughout for Node.js projects.
`
  },
  {
    id: 'backend-2-database',
    targetRound: 2,
    title: 'Database Design & ORM',
    combinable: true,
    content: `
============================================
# META-PROMPT: DATABASE DESIGN
============================================

Design and implement database layer:

DATABASE:
- PostgreSQL 15+ with proper schema
- Redis for caching and sessions
- Object storage (S3) for files

ORM/QUERY:
- Prisma, Drizzle, or Knex (Node.js)
- SQLAlchemy or SQLModel (Python)
- GORM or sqlx (Go)

DESIGN:
- Proper indexes and constraints
- Migrations strategy
- Soft deletes where appropriate
- Audit trail implementation
`
  },
  {
    id: 'backend-3-auth',
    targetRound: 3,
    title: 'Authentication & Authorization',
    combinable: true,
    content: `
============================================
# META-PROMPT: AUTHENTICATION & AUTHORIZATION
============================================

Implement comprehensive auth:

AUTHENTICATION:
- JWT with refresh tokens
- OAuth 2.0 (Google, GitHub, etc.)
- Session management
- Multi-factor authentication
- Password reset flow
- Account lockout

AUTHORIZATION:
- RBAC (Role-Based Access Control)
- ABAC (Attribute-Based)
- Permission system
- Resource-level permissions
`
  },
  {
    id: 'backend-4-api',
    targetRound: 4,
    title: 'API Design & Documentation',
    combinable: true,
    content: `
============================================
# META-PROMPT: API DESIGN
============================================

Design robust APIs:

DESIGN:
- RESTful or GraphQL
- OpenAPI 3.0 spec
- Versioning strategy
- Consistent response format
- Pagination and filtering

DOCUMENTATION:
- Interactive API docs (Swagger, Redoc)
- API examples and recipes
- Rate limit documentation
- Error code reference

PRIORITIZE developer experience and discoverability.
`
  },
  {
    id: 'backend-5-business',
    targetRound: 5,
    title: 'Business Logic & Services',
    combinable: true,
    content: `
============================================
# META-PROMPT: BUSINESS LOGIC
============================================

Implement business logic layer:

PATTERNS:
- Domain-driven design
- Transaction scripts
- Service layer
- Event-driven architecture
- Saga pattern for distributed transactions

COMPLEXITY:
- Complex validations
- Business rules engine
- Workflow orchestration
- Notification system
- Scheduling and cron jobs

KEEP business logic separate from HTTP layer.
`
  },
  {
    id: 'backend-6-performance',
    targetRound: 6,
    title: 'Performance & Caching (MID-POINT)',
    combinable: false,
    content: `
============================================
# META-PROMPT: PERFORMANCE (MID-POINT)
============================================

Optimize performance at midpoint:

CACHING:
- Redis caching strategy
- Cache invalidation patterns
- Distributed cache
- HTTP caching headers

OPTIMIZATION:
- Query optimization
- N+1 query prevention
- Batch operations
- Connection pooling
- Async processing

This is the midpoint - ensure scalability.
`
  },
  {
    id: 'backend-7-messaging',
    targetRound: 7,
    title: 'Message Queues & Events',
    combinable: true,
    content: `
============================================
# META-PROMPT: MESSAGING & EVENTS
============================================

Implement event-driven architecture:

MESSAGE QUEUES:
- RabbitMQ, Kafka, or Redis Streams
- Publisher/subscriber patterns
- Message durability
- Dead letter queues

EVENTS:
- Event sourcing
- Change Data Capture (CDC)
- Outbox pattern
- Event schema versioning
- Idempotency handling
`
  },
  {
    id: 'backend-8-external',
    targetRound: 8,
    title: 'External Integrations',
    combinable: true,
    content: `
============================================
# META-PROMPT: EXTERNAL INTEGRATIONS
============================================

Integrate with external services:

INTEGRATIONS:
- Payment gateways (Stripe, PayPal)
- Email services (SendGrid, Resend)
- SMS and notifications
- Analytics and monitoring
- Third-party APIs

PATTERNS:
- Circuit breaker
- Retry with backoff
- Webhook handling
- Rate limit compliance
- Secret management (Vault, AWS Secrets)
`
  },
  {
    id: 'backend-9-testing',
    targetRound: 9,
    title: 'Testing & Observability',
    combinable: true,
    content: `
============================================
# META-PROMPT: TESTING & OBSERVABILITY
============================================

Testing and observability:

TESTING:
- Unit tests with high coverage
- Integration tests
- Contract testing
- Load testing (k6)
- Chaos engineering

OBSERVABILITY:
- Structured logging (JSON)
- Distributed tracing (OpenTelemetry)
- Metrics (Prometheus, Grafana)
- Health check endpoints
- Error tracking (Sentry)
`
  },
  {
    id: 'backend-10-production',
    targetRound: 10,
    title: 'Production & Deployment',
    combinable: false,
    content: `
============================================
# META-PROMPT: PRODUCTION & DEPLOYMENT
============================================

Production readiness:

DEPLOYMENT:
- Docker containerization
- Kubernetes orchestration
- Blue-green deployments
- Health checks and readiness probes
- Resource limits

SECURITY:
- Security headers
- Input validation
- SQL injection prevention
- Rate limiting
- Audit logging
- Secret rotation

ENSURE 99.9% uptime SLA.
`
  }
];

/**
 * MOBILE Chain - Mobile App Development
 */
const MOBILE_CHAIN: MetaPrompt[] = [
  {
    id: 'mobile-1-setup',
    targetRound: 1,
    title: 'Mobile Project Setup',
    combinable: true,
    content: `
============================================
# META-PROMPT: MOBILE PROJECT SETUP
============================================

Set up mobile project:

CROSS-PLATFORM:
- React Native with Expo (recommended)
- or Flutter for high performance
- TypeScript throughout

NATIVE:
- iOS: SwiftUI with Swift
- Android: Kotlin with Jetpack Compose

TOOLING:
- Package management
- CI/CD for mobile (Fastlane, Codemagic)
- Code signing setup
- Asset pipeline
`
  },
  {
    id: 'mobile-2-architecture',
    targetRound: 2,
    title: 'Mobile Architecture',
    combinable: true,
    content: `
============================================
# META-PROMPT: MOBILE ARCHITECTURE
============================================

Implement mobile architecture:

PATTERNS:
- Clean Architecture (UI/Domain/Data layers)
- MVVM or MVI
- Repository pattern
- Use cases

STATE MANAGEMENT:
- Redux Toolkit, Zustand, or Bloc
- Async state (React Query, SWR)
- Local persistence (MMKV, Realm)

NAVIGATION:
- React Navigation or Flutter Navigator
- Deep linking
- Tab and drawer navigation
`
  },
  {
    id: 'mobile-3-ui-components',
    targetRound: 3,
    title: 'UI Components & Design System',
    combinable: true,
    content: `
============================================
# META-PROMPT: UI COMPONENTS
============================================

Build design system and components:

COMPONENTS:
- Typography and spacing
- Buttons, inputs, cards
- Lists and grids
- Modals and sheets
- Navigation elements
- Loading states

DESIGN:
- Responsive layouts
- Dark mode support
- Theming
- Animations
- Haptic feedback

FOLLOW platform guidelines (iOS Human Interface, Material Design).
`
  },
  {
    id: 'mobile-4-features',
    targetRound: 4,
    title: 'Core Features Implementation',
    combinable: true,
    content: `
============================================
# META-PROMPT: CORE FEATURES
============================================

Implement core mobile features:

FEATURES:
- User authentication flow
- Profile and settings
- Feed or timeline
- Search functionality
- Notifications (local + push)
- Camera and media capture
- File handling

PERFORMANCE:
- List virtualization
- Image caching
- Lazy loading
- Memory management
`
  },
  {
    id: 'mobile-5-offline',
    targetRound: 5,
    title: 'Offline & Data Sync',
    combinable: true,
    content: `
============================================
# META-PROMPT: OFFLINE & DATA SYNC
============================================

Implement offline-first architecture:

LOCAL STORAGE:
- SQLite (react-native-sqlite-storage)
- or MMKV for key-value
- Realm for complex objects

SYNC:
- Conflict resolution
- Background sync
- Optimistic updates
- Delta sync
- Offline queue

ENSURE data integrity and consistency.
`
  },
  {
    id: 'mobile-6-native',
    targetRound: 6,
    title: 'Native Features (MID-POINT)',
    combinable: false,
    content: `
============================================
# META-PROMPT: NATIVE FEATURES (MID-POINT)
============================================

Integrate native features at midpoint:

NATIVE APIs:
- Location services (GPS)
- Biometric authentication
- Camera and gallery
- Push notifications (APNs, FCM)
- Background tasks
- File system access
- Contacts and calendar

BRIDGE:
- Native modules (TurboModules)
- Native views
- Platform channels

This is the midpoint - leverage native capabilities.
`
  },
  {
    id: 'mobile-7-realtime',
    targetRound: 7,
    title: 'Real-time & Socket',
    combinable: true,
    content: `
============================================
# META-PROMPT: REAL-TIME & SOCKET
============================================

Implement real-time features:

WEBSOCKET:
- Socket.io, native WebSocket
- Connection management
- Reconnection logic
- Heartbeat/ping-pong

REAL-TIME:
- Live updates
- Chat/messaging
- Presence indicators
- Collaborative features
- Real-time notifications

OPTIMIZE for battery and network efficiency.
`
  },
  {
    id: 'mobile-8-performance',
    targetRound: 8,
    title: 'Performance & Optimization',
    combinable: true,
    content: `
============================================
# META-PROMPT: PERFORMANCE OPTIMIZATION
============================================

Optimize performance:

RENDERING:
- React.memo, useMemo, useCallback
- Virtual list optimization
- Frame rate optimization
- Smooth 60fps animations

NETWORK:
- Request batching
- Response compression
- Image optimization
- Prefetching

RELEASE:
- Hermes JavaScript engine
- ProGuard/R8 optimization
- App bundle splitting
`
  },
  {
    id: 'mobile-9-testing',
    targetRound: 9,
    title: 'Testing & QA',
    combinable: true,
    content: `
============================================
# META-PROMPT: MOBILE TESTING
============================================

Comprehensive mobile testing:

TESTING:
- Unit tests (Jest)
- Component tests (Testing Library)
- E2E tests (Detox, Appium)
- Visual regression testing

QA:
- Beta testing (TestFlight, Play Console)
- Crash reporting (Crashlytics, Sentry)
- Performance monitoring
- A/B testing

DEVICE TESTING on multiple OS versions and screen sizes.
`
  },
  {
    id: 'mobile-10-store',
    targetRound: 10,
    title: 'App Store Deployment',
    combinable: false,
    content: `
============================================
# META-PROMPT: APP STORE DEPLOYMENT
============================================

Final deployment to app stores:

iOS:
- App Store Connect
- App Store Optimization
- Privacy policy
- In-app purchases setup

ANDROID:
- Google Play Console
- Play Store optimization
- App signing
- Beta testing tracks

COMPLIANCE:
- Accessibility requirements
- Privacy policies
- Store guidelines compliance
- Age rating

SUBMIT with confidence.
`
  }
];

/**
 * SECURITY Chain - Security-focused Development
 */
const SECURITY_CHAIN: MetaPrompt[] = [
  {
    id: 'security-1-threat',
    targetRound: 1,
    title: 'Threat Modeling & Architecture',
    combinable: true,
    content: `
============================================
# META-PROMPT: THREAT MODELING
============================================

Conduct threat modeling:

THREAT ANALYSIS:
- STRIDE methodology
- Attack tree analysis
- Threat actors identification
- Risk assessment matrix

SECURE ARCHITECTURE:
- Defense in depth
- Zero trust model
- Least privilege principle
- Secure defaults
- Fail secure

DOCUMENT all security requirements upfront.
`
  },
  {
    id: 'security-2-auth',
    targetRound: 2,
    title: 'Authentication & Identity',
    combinable: true,
    content: `
============================================
# META-PROMPT: AUTHENTICATION & IDENTITY
============================================

Implement secure authentication:

AUTHENTICATION:
- Multi-factor authentication (MFA)
- Password policies (complexity, rotation)
- Secure session management
- Token-based auth (JWT, OAuth 2.0)
- Passkeys and WebAuthn

IDENTITY:
- User identity verification
- Role-based access control (RBAC)
- Attribute-based access control (ABAC)
- Identity providers integration

PROTECT against credential stuffing and brute force.
`
  },
  {
    id: 'security-3-input',
    targetRound: 3,
    title: 'Input Validation & Sanitization',
    combinable: true,
    content: `
============================================
# META-PROMPT: INPUT VALIDATION
============================================

Implement robust input validation:

VALIDATION:
- Schema validation (Zod, Yup, Joi)
- Type checking at boundaries
- Length limits
- Format validation
- Whitelist over blacklist

SANITIZATION:
- XSS prevention
- HTML sanitization
- SQL injection prevention
- Command injection prevention
- Path traversal prevention

VALIDATE all input, trust no data.
`
  },
  {
    id: 'security-4-encryption',
    targetRound: 4,
    title: 'Encryption & Key Management',
    combinable: true,
    content: `
============================================
# META-PROMPT: ENCRYPTION
============================================

Implement encryption:

ENCRYPTION:
- Data at rest (AES-256)
- Data in transit (TLS 1.3)
- Field-level encryption
- End-to-end encryption where needed

KEY MANAGEMENT:
- Key rotation strategy
- Hardware security modules (HSM)
- Secrets management (Vault, AWS Secrets)
- Environment-specific keys

NEVER hardcode secrets or keys in source code.
`
  },
  {
    id: 'security-5-api',
    targetRound: 5,
    title: 'API Security',
    combinable: true,
    content: `
============================================
# META-PROMPT: API SECURITY
============================================

Secure all APIs:

API SECURITY:
- Rate limiting and throttling
- API authentication
- Request signing
- Input validation
- Output encoding

PROTECTION:
- DDoS protection
- Web Application Firewall (WAF)
- API gateway security
- GraphQL query depth limiting
- DoS protection

LOG all API access for auditing.
`
  },
  {
    id: 'security-6-monitoring',
    targetRound: 6,
    title: 'Security Monitoring (MID-POINT)',
    combinable: false,
    content: `
============================================
# META-PROMPT: SECURITY MONITORING (MID-POINT)
============================================

Implement security monitoring at midpoint:

MONITORING:
- Security information and event management (SIEM)
- Real-time alerting
- Log aggregation
- Anomaly detection
- Behavior analysis

DETECTION:
- Intrusion detection
- File integrity monitoring
- Malware detection
- Vulnerability scanning
- Penetration testing

This is the midpoint - ensure visibility into threats.
`
  },
  {
    id: 'security-7-incident',
    targetRound: 7,
    title: 'Incident Response',
    combinable: true,
    content: `
============================================
# META-PROMPT: INCIDENT RESPONSE
============================================

Build incident response capability:

RESPONSE PLAN:
- Incident classification
- Escalation procedures
- Communication plan
- Forensic evidence preservation
- Recovery procedures

TOOLS:
- Automated alerting
- Rollback capabilities
- Backup and recovery
- Forensic logging

PRACTICE incident response regularly.
`
  },
  {
    id: 'security-8-compliance',
    targetRound: 8,
    title: 'Compliance & Audit',
    combinable: true,
    content: `
============================================
# META-PROMPT: COMPLIANCE & AUDIT
============================================

Ensure compliance:

COMPLIANCE:
- GDPR, CCPA, HIPAA as applicable
- SOC 2 requirements
- PCI DSS for payments
- Data retention policies

AUDIT:
- Audit logging
- Access reviews
- Vulnerability assessments
- Security posture reviews
- Penetration testing

MAINTAIN audit trail for all sensitive operations.
`
  },
  {
    id: 'security-9-dependencies',
    targetRound: 9,
    title: 'Dependency Security',
    combinable: true,
    content: `
============================================
# META-PROMPT: DEPENDENCY SECURITY
============================================

Secure dependencies:

DEPENDENCY MANAGEMENT:
- Regular updates
- Dependency scanning (Snyk, Dependabot)
- SBOM generation
- License compliance

VULNERABILITIES:
- Known CVE monitoring
- Severity prioritization
- Patch management
- Supply chain security

AUTOMATE vulnerability scanning in CI/CD.
`
  },
  {
    id: 'security-10-hardening',
    targetRound: 10,
    title: 'Production Hardening',
    combinable: false,
    content: `
============================================
# META-PROMPT: PRODUCTION HARDENING
============================================

Final security hardening:

HARDENING:
- Security headers (CSP, HSTS, X-Frame-Options)
- Disable unnecessary services
- Network segmentation
- Resource limits
- Container security

REVIEW:
- Code review for security
- Security testing
- Configuration review
- Access control audit

SECURE every layer - defense in depth.
`
  }
];

/**
 * DEVOPS Chain - DevOps & Infrastructure
 */
const DEVOPS_CHAIN: MetaPrompt[] = [
  {
    id: 'devops-1-infrastructure',
    targetRound: 1,
    title: 'Infrastructure as Code',
    combinable: true,
    content: `
============================================
# META-PROMPT: INFRASTRUCTURE AS CODE
============================================

Set up infrastructure as code:

TERRAFORM/PULUMI:
- Cloud resources (AWS, GCP, Azure)
- Modular architecture
- State management
- Remote state backend

KUBERNETES:
- Helm charts
- Kustomize
- Operator patterns
- Resource definitions

FOLLOW infrastructure best practices from start.
`
  },
  {
    id: 'devops-2-containers',
    targetRound: 2,
    title: 'Container Orchestration',
    combinable: true,
    content: `
============================================
# META-PROMPT: CONTAINERS
============================================

Implement containerization:

DOCKER:
- Multi-stage builds
- Multi-arch builds
- Security hardening
- Minimal base images
- Build cache optimization

KUBERNETES:
- Pod design
- Services and networking
- Ingress configuration
- ConfigMaps and Secrets
- Resource limits and requests

OPTIMIZE for size and security.
`
  },
  {
    id: 'devops-3-ci',
    targetRound: 3,
    title: 'CI/CD Pipelines',
    combinable: true,
    content: `
============================================
# META-PROMPT: CI/CD
============================================

Build robust CI/CD:

CI PIPELINE:
- GitHub Actions, GitLab CI, or Jenkins
- Automated testing (unit, integration, e2e)
- Security scanning (SAST, DAST, SCA)
- Code quality gates
- Artifact publishing

CD PIPELINE:
- Blue-green deployments
- Canary releases
- Rollback capabilities
- Feature flags
- Progressive delivery
`
  },
  {
    id: 'devops-4-monitoring',
    targetRound: 4,
    title: 'Observability Stack',
    combinable: true,
    content: `
============================================
# META-PROMPT: OBSERVABILITY
============================================

Implement observability:

METRICS:
- Prometheus or Grafana Cloud
- Custom metrics
- Dashboards
- Alerts and SLAs

LOGGING:
- Centralized logging (ELK, Loki)
- Structured JSON logging
- Log correlation
- Retention policies

TRACING:
- Distributed tracing (Jaeger, Tempo)
- OpenTelemetry
- Trace context propagation

OBSERVE everything in production.
`
  },
  {
    id: 'devops-5-gitops',
    targetRound: 5,
    title: 'GitOps & Configuration',
    combinable: true,
    content: `
============================================
# META-PROMPT: GITOPS
============================================

Implement GitOps:

GITOPS:
- ArgoCD or Flux
- Git as source of truth
- Declarative configurations
- Automated sync
- Drift detection

CONFIG MANAGEMENT:
- Environment-specific configs
- Secrets management (external)
- Config versioning
- Hot reload capability

SELF-HEAL infrastructure where possible.
`
  },
  {
    id: 'devops-6-scaling',
    targetRound: 6,
    title: 'Auto-scaling & Performance (MID-POINT)',
    combinable: false,
    content: `
============================================
# META-PROMPT: SCALING (MID-POINT)
============================================

Implement auto-scaling at midpoint:

SCALING:
- Horizontal pod autoscaling
- Vertical scaling
- Cluster autoscaling
- Database read replicas
- CDN configuration

PERFORMANCE:
- Caching strategy (Redis, CDN)
- Load balancing
- Database connection pooling
- Query optimization
- Resource quotas

This is the midpoint - ensure elasticity.
`
  },
  {
    id: 'devops-7-backup',
    targetRound: 7,
    title: 'Backup & Disaster Recovery',
    combinable: true,
    content: `
============================================
# META-PROMPT: BACKUP & RECOVERY
============================================

Implement backup and recovery:

BACKUP:
- Database backups
- File storage backups
- Configuration backups
- Backup verification
- Retention policies

RECOVERY:
- DR strategy
- Recovery time objectives (RTO)
- Recovery point objectives (RPO)
- Failover procedures
- Chaos testing

TEST backups regularly.
`
  },
  {
    id: 'devops-8-security',
    targetRound: 8,
    title: 'Infrastructure Security',
    combinable: true,
    content: `
============================================
# META-PROMPT: INFRASTRUCTURE SECURITY
============================================

Secure infrastructure:

SECURITY:
- Network policies
- RBAC for Kubernetes
- Pod security policies
- Secret encryption
- Image scanning

COMPLIANCE:
- Security benchmarks
- Vulnerability scanning
- Audit logging
- Penetration testing
- SOC 2 compliance

SECURE the foundation.
`
  },
  {
    id: 'devops-9-cost',
    targetRound: 9,
    title: 'Cost Optimization',
    combinable: true,
    content: `
============================================
# META-PROMPT: COST OPTIMIZATION
============================================

Optimize costs:

OPTIMIZATION:
- Right-sizing resources
- Spot/preemptible instances
- Reserved capacity
- Storage lifecycle policies
- Serverless where appropriate

MONITORING:
- Cost dashboards
- Budget alerts
- Resource tagging
- Usage analysis

FINANCIALLY sustainable infrastructure.
`
  },
  {
    id: 'devops-10-resilience',
    targetRound: 10,
    title: 'Production Excellence',
    combinable: false,
    content: `
============================================
# META-PROMPT: PRODUCTION EXCELLENCE
============================================

Final production excellence:

EXCELLENCE:
- 99.9% uptime SLA
- Incident management
- Post-mortem culture
- SLO tracking
- On-call rotation

AUTOMATION:
- Self-service provisioning
- Automated remediation
- Intelligent alerting
- Runbook automation

OPERATIONALIZE with confidence.
`
  }
];

/**
 * DATA Chain - Data Engineering
 */
const DATA_CHAIN: MetaPrompt[] = [
  {
    id: 'data-1-architecture',
    targetRound: 1,
    title: 'Data Architecture',
    combinable: true,
    content: `
============================================
# META-PROMPT: DATA ARCHITECTURE
============================================

Design data architecture:

STORAGE:
- Data lake (S3, GCS)
- Data warehouse (Snowflake, BigQuery, Redshift)
- Real-time store (Redis, DynamoDB)
- Feature store

PROCESSING:
- Batch processing (Spark, Airflow)
- Stream processing (Kafka, Flink)
- ETL pipelines

ARCHITECTURE patterns for scalability.
`
  },
  {
    id: 'data-2-pipelines',
    targetRound: 2,
    title: 'Data Pipelines',
    combinable: true,
    content: `
============================================
# META-PROMPT: DATA PIPELINES
============================================

Build robust data pipelines:

PIPELINES:
- DAG-based orchestration (Airflow, Prefect)
- Pipeline scheduling
- Dependency management
- Retry logic
- Error handling

DATA FLOW:
- Source connectors
- Transformation logic
- Quality checks
- Destination writes

TEST data pipelines thoroughly.
`
  },
  {
    id: 'data-3-modeling',
    targetRound: 3,
    title: 'Data Modeling',
    combinable: true,
    content: `
============================================
# META-PROMPT: DATA MODELING
============================================

Implement data modeling:

MODELING:
- Star schema design
- Dimension tables
- Fact tables
- Slowly changing dimensions (SCD)
- Surrogate keys

QUALITY:
- Primary keys
- Foreign keys
- Indexes
- Constraints
- Data quality rules

OPTIMIZE for query performance.
`
  },
  {
    id: 'data-4-transformation',
    targetRound: 4,
    title: 'Data Transformation',
    combinable: true,
    content: `
============================================
# META-PROMPT: DATA TRANSFORMATION
============================================

Implement transformations:

TRANSFORMATIONS:
- SQL-based (dbt)
- Python (Pandas, PySpark)
- Streaming transformations
- Data enrichment
- Aggregation logic

PATTERNS:
- Incremental loads
- Change data capture (CDC)
- Data merging and joining
- Normalization and denormalization

BUILD reusable transformation modules.
`
  },
  {
    id: 'data-5-quality',
    targetRound: 5,
    title: 'Data Quality',
    combinable: true,
    content: `
============================================
# META-PROMPT: DATA QUALITY
============================================

Ensure data quality:

QUALITY CHECKS:
- Schema validation
- Range checks
- Null detection
- Duplicate detection
- Business rule validation

MONITORING:
- Data profiling
- Anomaly detection
- Freshness monitoring
- Lineage tracking

QUALITY gates in pipelines.
`
  },
  {
    id: 'data-6-analytics',
    targetRound: 6,
    title: 'Analytics & Warehousing (MID-POINT)',
    combinable: false,
    content: `
============================================
# META-PROMPT: ANALYTICS (MID-POINT)
============================================

Build analytics at midpoint:

WAREHOUSING:
- Table design and optimization
- Materialized views
- Partitioning and clustering
- Performance tuning

ANALYTICS:
- Dashboard connectivity
- BI tool integration
- SQL-based analytics
- Ad-hoc queries

This is the midpoint - enable insights.
`
  },
  {
    id: 'data-7-streaming',
    targetRound: 7,
    title: 'Real-time Streaming',
    combinable: true,
    content: `
============================================
# META-PROMPT: REAL-TIME STREAMING
============================================

Implement real-time processing:

STREAMING:
- Kafka or similar
- Stream processing (Flink, Spark Streaming)
- Windowing (tumbling, sliding)
- State management

USE CASES:
- Real-time analytics
- Event-driven features
- Live dashboards
- Alerting

LOW latency, high throughput processing.
`
  },
  {
    id: 'data-8-governance',
    targetRound: 8,
    title: 'Data Governance',
    combinable: true,
    content: `
============================================
# META-PROMPT: DATA GOVERNANCE
============================================

Implement data governance:

GOVERNANCE:
- Data catalog
- Metadata management
- Lineage tracking
- Access control
- Data retention policies

COMPLIANCE:
- PII handling
- Data masking
- Audit logging
- GDPR compliance

KNOW your data at all times.
`
  },
  {
    id: 'data-9-ml-ops',
    targetRound: 9,
    title: 'MLOps for Data',
    combinable: true,
    content: `
============================================
# META-PROMPT: DATA ML OPS
============================================

Support ML operations:

FEATURE STORE:
- Feature engineering
- Feature storage
- Feature versioning
- Feature serving

ML PIPELINES:
- Model training pipelines
- Model registry
- Feature importance tracking
- Model monitoring

BRIDGE data engineering and ML.
`
  },
  {
    id: 'data-10-production',
    targetRound: 10,
    title: 'Data Production',
    combinable: false,
    content: `
============================================
# META-PROMPT: DATA PRODUCTION
============================================

Final production readiness:

PRODUCTION:
- Monitoring and alerting
- Performance optimization
- Cost management
- Backup and recovery
- SLAs for data freshness

ENSURE reliable, scalable data infrastructure.
`
  }
];

/**
 * API Chain - API Design & Development
 */
const API_CHAIN: MetaPrompt[] = [
  {
    id: 'api-1-design',
    targetRound: 1,
    title: 'API Design Principles',
    combinable: true,
    content: `
============================================
# META-PROMPT: API DESIGN
============================================

Design robust APIs:

DESIGN PRINCIPLES:
- RESTful or GraphQL
- OpenAPI 3.1 specification
- Consistent naming
- Resource-oriented URLs
- Proper HTTP methods

VERSIONING:
- URL versioning (/v1/)
- Header versioning
- Deprecation strategy

DESIGN for developers first.
`
  },
  {
    id: 'api-2-auth',
    targetRound: 2,
    title: 'API Authentication',
    combinable: true,
    content: `
============================================
# META-PROMPT: API AUTHENTICATION
============================================

Secure APIs:

AUTHENTICATION:
- API keys
- JWT tokens
- OAuth 2.0
- Mutual TLS

AUTHORIZATION:
- Scopes and permissions
- Rate limiting per client
- Quota management
- Access tokens vs refresh tokens

SECURE every endpoint.
`
  },
  {
    id: 'api-3-validation',
    targetRound: 3,
    title: 'Request/Response Validation',
    combinable: true,
    content: `
============================================
# META-PROMPT: API VALIDATION
============================================

Validate requests and responses:

VALIDATION:
- Schema validation
- Type checking
- Required fields
- Format validation
- Custom business rules

ERROR HANDLING:
- Consistent error format
- Proper HTTP status codes
- Error codes and messages
- Validation error details

RESPONSES:
- Pagination
- Filtering
- Field selection
- Content negotiation
`
  },
  {
    id: 'api-4-docs',
    targetRound: 4,
    title: 'API Documentation',
    combinable: true,
    content: `
============================================
# META-PROMPT: API DOCUMENTATION
============================================

Create comprehensive documentation:

DOCS:
- OpenAPI specification
- Interactive docs (Swagger UI, Redoc)
- Code examples (cURL, SDK)
- Authentication guide
- Rate limit documentation

DISCOVERY:
- API explorer
- Schema registry
- Postman collection
- OpenAPI client generation

DOCUMENT like you'd use it yourself.
`
  },
  {
    id: 'api-5-testing',
    targetRound: 5,
    title: 'API Testing',
    combinable: true,
    content: `
============================================
# META-PROMPT: API TESTING
============================================

Test APIs comprehensively:

TESTING:
- Unit tests
- Integration tests
- Contract tests
- E2E tests
- Load testing (k6)

COVERAGE:
- Happy path
- Error cases
- Edge cases
- Security tests
- Performance tests

AUTOMATE API testing in CI/CD.
`
  },
  {
    id: 'api-6-performance',
    targetRound: 6,
    title: 'Performance & Optimization (MID-POINT)',
    combinable: false,
    content: `
============================================
# META-PROMPT: API PERFORMANCE (MID-POINT)
============================================

Optimize API performance:

OPTIMIZATION:
- Response caching
- Compression (gzip, brotli)
- Pagination
- Field filtering
- Database query optimization

SCALING:
- Load balancing
- Horizontal scaling
- Connection pooling
- Async processing

This is the midpoint - ensure speed.
`
  },
  {
    id: 'api-7-versioning',
    targetRound: 7,
    title: 'API Versioning & Evolution',
    combinable: true,
    content: `
============================================
# META-PROMPT: API VERSIONING
============================================

Manage API evolution:

VERSIONING:
- Semantic versioning
- Deprecation timeline
- Migration guides
- Breaking change handling

EVOLUTION:
- Backward compatibility
- Feature flags
- Canary releases
- Response format evolution

GROW APIs without breaking clients.
`
  },
  {
    id: 'api-8-gateway',
    targetRound: 8,
    title: 'API Gateway',
    combinable: true,
    content: `
============================================
# META-PROMPT: API GATEWAY
============================================

Implement API gateway:

GATEWAY:
- Kong, AWS API Gateway, or similar
- Request routing
- Authentication
- Rate limiting
- Request/response transformation

FEATURES:
- Circuit breaker
- Service discovery
- Metrics and logging
- Caching

CENTRALIZE cross-cutting concerns.
`
  },
  {
    id: 'api-9-monitoring',
    targetRound: 9,
    title: 'API Monitoring',
    combinable: true,
    content: `
============================================
# META-PROMPT: API MONITORING
============================================

Monitor APIs:

MONITORING:
- Request metrics
- Latency percentiles
- Error rates
- Throughput

ALERTING:
- SLA violations
- Error spikes
- Latency degradation
- Unusual traffic patterns

OBSERVE API health continuously.
`
  },
  {
    id: 'api-10-production',
    targetRound: 10,
    title: 'Production API',
    combinable: false,
    content: `
============================================
# META-PROMPT: PRODUCTION API
============================================

Final production readiness:

PRODUCTION:
- Rate limiting
- DDoS protection
- Load testing
- Chaos engineering
- Rollback procedures

DOCUMENTATION:
- API reference
- Migration guides
- SDKs and client libraries
- Support channels

SHIP APIs that developers love.
`
  }
];

/**
 * SYSTEM Chain - System Architecture & Design
 */
const SYSTEM_CHAIN: MetaPrompt[] = [
  {
    id: 'system-1-requirements',
    targetRound: 1,
    title: 'Requirements & Goals',
    combinable: true,
    content: `
============================================
# META-PROMPT: SYSTEM REQUIREMENTS
============================================

Define system requirements:

FUNCTIONAL:
- Core features
- User stories
- Use cases
- Integration points

NON-FUNCTIONAL:
- Performance targets
- Availability SLA
- Scalability requirements
- Security requirements
- Compliance needs

CAPACITY planning and estimation.
`
  },
  {
    id: 'system-2-architecture',
    targetRound: 2,
    title: 'High-Level Architecture',
    combinable: true,
    content: `
============================================
# META-PROMPT: HIGH-LEVEL ARCHITECTURE
============================================

Design high-level architecture:

STYLE:
- Microservices
- Modular monolith
- Event-driven
- Serverless

COMPONENTS:
- Service boundaries
- Data stores
- External services
- Communication patterns

DIAGRAM the system comprehensively.
`
  },
  {
    id: 'system-3-components',
    targetRound: 3,
    title: 'Component Design',
    combinable: true,
    content: `
============================================
# META-PROMPT: COMPONENT DESIGN
============================================

Design system components:

DESIGN:
- Service interfaces
- Data models
- API contracts
- Event schemas

PATTERNS:
- Repository pattern
- Factory pattern
- Observer pattern
- Strategy pattern

DEFINE component responsibilities clearly.
`
  },
  {
    id: 'system-4-data',
    targetRound: 4,
    title: 'Data Architecture',
    combinable: true,
    content: `
============================================
# META-PROMPT: DATA ARCHITECTURE
============================================

Design data architecture:

STORAGE:
- Relational databases
- NoSQL stores
- Caching layers
- Search infrastructure

PATTERNS:
- CQRS
- Event sourcing
- Saga pattern
- Write-ahead logging

DATA flow and consistency models.
`
  },
  {
    id: 'system-5-resilience',
    targetRound: 5,
    title: 'Resilience Patterns',
    combinable: true,
    content: `
============================================
# META-PROMPT: RESILIENCE PATTERNS
============================================

Implement resilience:

PATTERNS:
- Circuit breaker
- Retry with backoff
- Bulkhead pattern
- Timeout handling
- Graceful degradation

FAULT TOLERANCE:
- Failure isolation
- Fallback strategies
- Health checks
- Self-healing

PLAN for failure from the start.
`
  },
  {
    id: 'system-6-scaling',
    targetRound: 6,
    title: 'Scalability Design (MID-POINT)',
    combinable: false,
    content: `
============================================
# META-PROMPT: SCALABILITY (MID-POINT)
============================================

Design for scalability:

SCALING:
- Horizontal scaling
- Vertical scaling
- Database sharding
- Read replicas
- Caching strategy

PERFORMANCE:
- Load balancing
- CDN usage
- Asynchronous processing
- Batch processing

This is the midpoint - plan for growth.
`
  },
  {
    id: 'system-7-security',
    targetRound: 7,
    title: 'Security Architecture',
    combinable: true,
    content: `
============================================
# META-PROMPT: SECURITY ARCHITECTURE
============================================

Design security:

SECURITY:
- Authentication
- Authorization
- Encryption
- Network security
- Audit logging

COMPLIANCE:
- GDPR, HIPAA, PCI
- Security audits
- Penetration testing
- Vulnerability management

SECURE by design.
`
  },
  {
    id: 'system-8-observability',
    targetRound: 8,
    title: 'Observability Architecture',
    combinable: true,
    content: `
============================================
# META-PROMPT: OBSERVABILITY ARCHITECTURE
============================================

Design observability:

TELEMETRY:
- Metrics
- Logs
- Traces
- Events

INFRASTRUCTURE:
- Metrics backend (Prometheus)
- Log aggregation (ELK, Loki)
- Trace collection (Jaeger)
- Alerting (Alertmanager)

OBSERVE the system in production.
`
  },
  {
    id: 'system-9-deployment',
    targetRound: 9,
    title: 'Deployment Architecture',
    combinable: true,
    content: `
============================================
# META-PROMPT: DEPLOYMENT ARCHITECTURE
============================================

Design deployment:

INFRASTRUCTURE:
- Kubernetes
- Containerization
- Orchestration
- Service mesh

STRATEGY:
- Blue-green
- Canary
- Rolling updates
- Feature flags

AUTOMATE deployments completely.
`
  },
  {
    id: 'system-10-review',
    targetRound: 10,
    title: 'Architecture Review',
    combinable: false,
    content: `
============================================
# META-PROMPT: ARCHITECTURE REVIEW
============================================

Final architecture review:

REVIEW:
- Design review
- Security review
- Performance review
- Cost review
- Risk assessment

DOCUMENTATION:
- Architecture decision records
- System diagrams
- Runbooks
- Post-mortem process

APPROVE and proceed to implementation.
`
  }
];

/**
 * WEB3 Chain - Blockchain & Web3 Development
 */
const WEB3_CHAIN: MetaPrompt[] = [
  {
    id: 'web3-1-protocol',
    targetRound: 1,
    title: 'Protocol Selection',
    combinable: true,
    content: `
============================================
# META-PROMPT: PROTOCOL SELECTION
============================================

Select blockchain protocol:

PROTOCOLS:
- Ethereum (EVM)
- Solana
- Polkadot/Substrate
- Cosmos SDK
- Avalanche

LAYER 2:
- Arbitrum, Optimism
- zkSync, Starknet
- Polygon

FACTORS:
- Scalability
- Security
- Ecosystem
- Developer experience

CHOOSE the right chain for your use case.
`
  },
  {
    id: 'web3-2-contracts',
    targetRound: 2,
    title: 'Smart Contract Development',
    combinable: true,
    content: `
============================================
# META-PROMPT: SMART CONTRACTS
============================================

Develop smart contracts:

FRAMEWORKS:
- Solidity (EVM)
- Rust (Solana, Near, Polkadot)
- Cairo (Starknet)

BEST PRACTICES:
- Reentrancy guards
- Safe math
- Access control
- Upgradeability
- Gas optimization

TEST extensively with Foundry or Hardhat.
`
  },
  {
    id: 'web3-3-security',
    targetRound: 3,
    title: 'Smart Contract Security',
    combinable: true,
    content: `
============================================
# META-PROMPT: CONTRACT SECURITY
============================================

Secure smart contracts:

AUDITS:
- Formal verification where possible
- Static analysis (Slither, Mythril)
- Manual code review
- Third-party audits

COMMON VULNERABILITIES:
- Reentrancy
- Integer overflow
- Access control
- Front-running
- Oracle manipulation

PRIORITIZE security above all.
`
  },
  {
    id: 'web3-4-frontend',
    targetRound: 4,
    title: 'Web3 Frontend Integration',
    combinable: true,
    content: `
============================================
# META-PROMPT: WEB3 FRONTEND
============================================

Integrate with wallets:

WALLETS:
- MetaMask, WalletConnect
- RainbowKit, Wagmi
- Phantom (Solana)

SIGNING:
- Signatures and verification
- Message signing
- Transaction signing
- Session keys

DISPLAY:
- Balance fetching
- Transaction history
- Token transfers
- NFT display
`
  },
  {
    id: 'web3-5-indexing',
    targetRound: 5,
    title: 'Data Indexing & Subgraphs',
    combinable: true,
    content: `
============================================
# META-PROMPT: DATA INDEXING
============================================

Implement data indexing:

INDEXING:
- The Graph (subgraphs)
- SubQuery
- Covalent
- QuickNode

DATA:
- Event listening
- Block processing
- Transaction tracking
- Token balances

QUERY:
- GraphQL APIs
- Custom queries
- Historical data
- Real-time updates
`
  },
  {
    id: 'web3-6-storage',
    targetRound: 6,
    title: 'Decentralized Storage (MID-POINT)',
    combinable: false,
    content: `
============================================
# META-PROMPT: DECENTRALIZED STORAGE (MID-POINT)
============================================

Implement decentralized storage:

STORAGE:
- IPFS and Filecoin
- Arweave
- S3 with encryption
- Ceramic Network

DATA:
- Metadata storage
- Large file handling
- Content addressing
- Pinning services

This is the midpoint - ensure data availability.
`
  },
  {
    id: 'web3-7-defi',
    targetRound: 7,
    title: 'DeFi Integrations',
    combinable: true,
    content: `
============================================
# META-PROMPT: DEFI INTEGRATIONS
============================================

Integrate DeFi protocols:

PROTOCOLS:
- Uniswap (swap)
- Aave (lending)
- Compound
- MakerDAO

INTEGRATIONS:
- Token swaps
- Lending/borrowing
- Staking
- Yield farming
- Cross-chain bridges

ORACLES:
- Chainlink
- Band Protocol
- Price feeds
`
  },
  {
    id: 'web3-8-nft',
    targetRound: 8,
    title: 'NFT Implementation',
    combinable: true,
    content: `
============================================
# META-PROMPT: NFT IMPLEMENTATION
============================================

Implement NFT features:

STANDARDS:
- ERC-721, ERC-1155
- Metaplex (Solana)
- Layer 2 minting

FEATURES:
- Minting
- Transfer
- Royalties
- Metadata
- Batch operations

MARKETPLACE:
- Listing and selling
- Auction mechanisms
- Offers and bids
- Collection management
`
  },
  {
    id: 'web3-9-standards',
    targetRound: 9,
    title: 'Standards & Best Practices',
    combinable: true,
    content: `
============================================
# META-PROMPT: STANDARDS & PRACTICES
============================================

Follow standards and practices:

STANDARDS:
- EIPs where applicable
- Token standards
- Metadata standards
- Wallet standards

PRACTICES:
- Upgradeability patterns
- Proxy patterns
- Diamond standard
- Multi-sig wallets

COMPLIANCE:
- Token classification
- KYC/AML considerations
- Regulatory compliance
`
  },
  {
    id: 'web3-10-production',
    targetRound: 10,
    title: 'Production & Upgradability',
    combinable: false,
    content: `
============================================
# META-PROMPT: PRODUCTION & UPGRADABILITY
============================================

Final production readiness:

PRODUCTION:
- Multi-sig governance
- Timelock controllers
- Emergency stops
- Upgradeability proxies

MONITORING:
- On-chain events
- Gas optimization
- Network congestion
- Price monitoring

LAUNCH with confidence in security.
`
  }
];

// ============================================================================
// Chain Registry
// ============================================================================

export const META_PROMPT_CHAINS: Record<MetaPromptChain, MetaPrompt[]> = {
  default: DEFAULT_CHAIN,
  frontend: FRONTEND_CHAIN,
  ml_ai: ML_AI_CHAIN,
  backend: BACKEND_CHAIN,
  mobile: MOBILE_CHAIN,
  security: SECURITY_CHAIN,
  devops: DEVOPS_CHAIN,
  data: DATA_CHAIN,
  api: API_CHAIN,
  system: SYSTEM_CHAIN,
  web3: WEB3_CHAIN
};

/**
 * Auto-detect which chain to use based on user request keywords
 */
export function detectMetaPromptChain(request: string): MetaPromptChain {
  const lower = request.toLowerCase();
  
  // Check for explicit chain indicators
  if (
    lower.includes('machine learning') || 
    lower.includes('ml ') || 
    lower.includes('ai ') ||
    lower.includes('neural') ||
    lower.includes('llm') ||
    lower.includes('model training') ||
    lower.includes('deep learning') ||
    lower.includes('transformer') ||
    lower.includes('rag') ||
    lower.includes('vector database')
  ) {
    return 'ml_ai';
  }
  
  if (
    lower.includes('mobile') ||
    lower.includes('ios') ||
    lower.includes('android') ||
    lower.includes('react native') ||
    lower.includes('flutter') ||
    lower.includes('swiftui') ||
    lower.includes('kotlin')
  ) {
    return 'mobile';
  }
  
  if (
    lower.includes('penetration') ||
    lower.includes('vulnerability') ||
    lower.includes('encryption') ||
    lower.includes('cybersecurity') ||
    lower.includes('secure') ||
    lower.includes('audit')
  ) {
    return 'security';
  }
  
  if (
    lower.includes('devops') ||
    lower.includes('infrastructure') ||
    lower.includes('kubernetes') ||
    lower.includes('docker') ||
    lower.includes('ci/cd') ||
    lower.includes('terraform') ||
    lower.includes('deployment') ||
    lower.includes('observability')
  ) {
    return 'devops';
  }
  
  if (
    lower.includes('data') ||
    lower.includes('pipeline') ||
    lower.includes('etl') ||
    lower.includes('warehouse') ||
    lower.includes('analytics') ||
    lower.includes('big data') ||
    lower.includes('spark')
  ) {
    return 'data';
  }
  
  if (
    lower.includes('blockchain') ||
    lower.includes('web3') ||
    lower.includes('smart contract') ||
    lower.includes('solidity') ||
    lower.includes('crypto') ||
    lower.includes('nft') ||
    lower.includes('defi') ||
    lower.includes('token')
  ) {
    return 'web3';
  }
  
  if (
    lower.includes('backend') ||
    lower.includes('server') ||
    lower.includes('database') ||
    lower.includes('orm') ||
    lower.includes('postgres') ||
    lower.includes('redis')
  ) {
    return 'backend';
  }
  
  if (
    lower.includes('api') ||
    lower.includes('rest') ||
    lower.includes('graphql') ||
    lower.includes('endpoint') ||
    lower.includes('webhook')
  ) {
    return 'api';
  }
  
  if (
    lower.includes('system') ||
    lower.includes('architecture') ||
    lower.includes('scalability') ||
    lower.includes('design pattern') ||
    lower.includes('microservice')
  ) {
    return 'system';
  }
  
  if (
    lower.includes('frontend') ||
    lower.includes('ui ') ||
    lower.includes('react') ||
    lower.includes('vue') ||
    lower.includes('component') ||
    lower.includes('design')
  ) {
    return 'frontend';
  }
  
  // Default to general chain
  return 'default';
}

// ============================================================================
// Meta-Prompt Selection & Injection
// ============================================================================

/**
 * Get the appropriate meta-prompt for a given round from a specific chain
 */
export function getMetaPromptForRound(
  roundNumber: number, 
  totalRounds: number,
  chain: MetaPromptChain = 'default'
): MetaPrompt | null {
  const promptChain = META_PROMPT_CHAINS[chain] || META_PROMPT_CHAINS.default;
  
  // Map the current round to the closest meta-prompt
  const targetRound = Math.min(roundNumber, 10);
  
  const prompt = promptChain.find(p => p.targetRound === targetRound);
  
  if (!prompt) {
    return promptChain[promptChain.length - 1];
  }
  
  return prompt;
}

/**
 * Get meta-prompt for round using default chain
 */
export function getMetaPromptForRoundDefault(roundNumber: number, totalRounds: number): MetaPrompt | null {
  return getMetaPromptForRound(roundNumber, totalRounds, 'default');
}

/**
 * Get all available chains
 */
export function getAvailableChains(): MetaPromptChain[] {
  return Object.keys(META_PROMPT_CHAINS) as MetaPromptChain[];
}

/**
 * Get human-readable chain name
 */
export function getChainDisplayName(chain: MetaPromptChain): string {
  const names: Record<MetaPromptChain, string> = {
    default: 'Full-Stack Development',
    frontend: 'Frontend Development',
    ml_ai: 'Machine Learning & AI',
    backend: 'Backend Development',
    mobile: 'Mobile Development',
    security: 'Security Engineering',
    devops: 'DevOps & Infrastructure',
    data: 'Data Engineering',
    api: 'API Design',
    system: 'System Architecture',
    web3: 'Blockchain & Web3'
  };
  return names[chain] || chain;
}

/**
 * Get combined prompts for a round (for smoother transitions)
 */
export function getCombinedPrompts(
  roundNumber: number, 
  totalRounds: number,
  chain: MetaPromptChain = 'default'
): MetaPrompt[] {
  const prompts: MetaPrompt[] = [];
  const prompt = getMetaPromptForRound(roundNumber, totalRounds, chain);
  
  if (prompt) {
    prompts.push(prompt);
  }
  
  return prompts;
}

/**
 * Inject meta-prompt into a refinement prompt
 */
export function injectMetaPrompt(
  basePrompt: string,
  context: MetaPromptContext,
  chain: MetaPromptChain = 'default'
): string {
  const metaPrompt = getMetaPromptForRound(context.roundNumber, context.totalRounds, chain);
  
  if (!metaPrompt) {
    return basePrompt;
  }
  
  const injectPoint = basePrompt.indexOf('============================================\n# CURRENT FOCUS AREA');
  
  if (injectPoint === -1) {
    return `${metaPrompt.content}\n\n${basePrompt}`;
  }
  
  const before = basePrompt.substring(0, injectPoint);
  const after = basePrompt.substring(injectPoint);
  
  return `${before}\n${metaPrompt.content}\n\n${after}`;
}

/**
 * Get meta-prompt context summary for logging
 */
export function getMetaPromptContextSummary(
  context: MetaPromptContext,
  chain: MetaPromptChain = 'default'
): string {
  const prompt = getMetaPromptForRound(context.roundNumber, context.totalRounds, chain);
  
  if (!prompt) return 'No meta-prompt available';
  
  return `[Round ${context.roundNumber}/${context.totalRounds}] ${prompt.title}`;
}

// ============================================================================
// Legacy export for backward compatibility
// ============================================================================

// For backward compatibility - use default chain
export const META_PROMPTS = DEFAULT_CHAIN;
export { DEFAULT_CHAIN };

// ============================================================================
// Integration with Maximalist Config
// ============================================================================

export interface MetaPromptConfig {
  /** Enable meta-prompt injection */
  enabled: boolean;
  /** Meta-prompt chain to use */
  chain?: MetaPromptChain;
  /** Custom meta-prompts (replaces default) */
  customPrompts?: MetaPrompt[];
  /** Inject at which round to start (1-based) */
  startRound?: number;
}

export const DEFAULT_META_PROMPT_CONFIG: MetaPromptConfig = {
  enabled: true,
  chain: 'default',
  startRound: 1
};

/**
 * Merge meta-prompt configuration
 */
export function getEffectiveMetaPromptConfig(
  userConfig?: Partial<MetaPromptConfig>
): MetaPromptConfig {
  return {
    ...DEFAULT_META_PROMPT_CONFIG,
    ...userConfig
  };
}