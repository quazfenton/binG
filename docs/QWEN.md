# binG - Agentic Compute Workspace

## Project Overview

**binG** is a full-stack agentic AI workspace that combines AI conversation with real code execution, voice interaction, and multi-agent orchestration. Built with Next.js 15, it provides an intelligent development environment where AI agents can plan, execute, and verify tasks in isolated sandbox environments.

### Core Capabilities

- **Multi-Agent Orchestration**: Coordinates multiple AI agents (Planner, Executor, Critic) for complex tasks
- **Code Execution**: Runs generated code in isolated Linux sandboxes (Daytona, Blaxel, Fly.io Sprites, Runloop)
- **Vercel AI SDK Integration**: Native tool calling with streaming support and self-healing agents
- **Plan-Act-Verify Workflow**: Structured agent execution with discovery, planning, editing, and verification phases
- **Voice & Audio**: Livekit rooms, neural TTS (ElevenLabs/Cartesia), speech recognition
- **Image Generation**: Multi-provider support (Mistral FLUX, Replicate SDXL) with fallback chains
- **Terminal Access**: Full xterm.js terminal with fish-like autocomplete and persistent sessions
- **Tool Integration**: 800+ tools via Composio, Nango, Smithery, and Arcade

### Technology Stack

| Layer | Technologies |
|-------|--------------|
| **Frontend** | React 19, Next.js 15, TypeScript, Tailwind CSS, Radix UI, Framer Motion |
| **Backend** | Next.js API Routes, Fastify, WebSocket server |
| **AI/ML** | Vercel AI SDK, LangChain, LangGraph, Mastra, OpenAI, Anthropic, Google, Mistral |
| **Database** | PostgreSQL (primary), SQLite (local), Redis (caching/queues) |
| **Sandbox** | Daytona, Blaxel, Fly.io Sprites, Runloop, Microsandbox (Docker) |
| **Voice** | Livekit, ElevenLabs, Cartesia |
| **Storage** | MinIO (S3-compatible), local filesystem, OPFS |
| **Monitoring** | Prometheus, Grafana, LangSmith |

## Project Structure

```
binG/
├── app/                    # Next.js app directory
│   ├── (main)/            # Main application routes
│   ├── api/               # API routes
│   ├── auth/              # Authentication routes
│   ├── layout.tsx         # Root layout
│   └── globals.css        # Global styles
├── components/            # React components
│   ├── agent/             # Agent UI components
│   ├── terminal/          # Terminal components
│   ├── ui/                # Base UI components
│   └── settings/          # Settings components
├── lib/                   # Core library modules
│   ├── agent/             # Agent services & execution
│   ├── ai-sdk/            # Vercel AI SDK integration
│   ├── sandbox/           # Sandbox providers & orchestration
│   ├── orchestra/         # Agent orchestration
│   ├── tools/             # Tool implementations
│   ├── voice/             # Voice services
│   ├── image-generation/  # Image generation providers
│   ├── mcp/               # Model Context Protocol
│   └── security/          # Security & validation
├── services/              # Background services
│   ├── mcp-server/        # MCP tool server
│   ├── sandbox-pool/      # Sandbox warm pool
│   └── scheduler/         # Task scheduling
├── worker/                # Agent workers
├── test/                  # Test files
├── __tests__/             # Component tests
├── tests/e2e/             # E2E tests (Playwright)
├── docs/                  # Documentation
├── scripts/               # Utility scripts
└── config/                # Configuration files
```

## Building and Running

### Prerequisites

- **Node.js**: 20.x or higher
- **pnpm**: 9.x or higher (`npm install -g pnpm`)
- **Python**: 3.13+ (for Fast Agent MCP)
- **Docker**: 20.10+ (for sandbox providers)
- **Git**: For repository management

### Installation

```bash
# Clone repository
git clone https://github.com/quazfenton/binG.git
cd binG

# Install dependencies
pnpm install

# Copy environment template
cp env.example .env.local

# Edit .env.local with your API keys
```

### Development Mode

```bash
# Start Next.js development server
pnpm dev

# Start WebSocket server (for terminal)
pnpm dev:ws

# Standard dev mode
pnpm dev:standard

# OpenCode dev mode
pnpm dev:opencode
```

### Production Build

```bash
# Build application
pnpm build

# Start production server
pnpm start

# Start production WebSocket server
pnpm start:ws
```

### Docker Deployment

```bash
# Start all services
docker-compose up -d

# View logs
docker-compose logs -f

# Stop services
docker-compose down
```

### Database Migrations

```bash
# Run database migrations
pnpm migrate

# Initialize backend
pnpm backend:init
```

## Testing

### Run Tests

```bash
# Run all tests (Vitest)
pnpm test

# Run tests in watch mode
pnpm test:watch

# Run with coverage
pnpm test:coverage

# Run E2E tests (Playwright)
pnpm test:e2e

# Run sandbox provider tests
pnpm test:sandbox

# Run stateful agent tests
pnpm test:stateful-agent

# View HTML report
npx playwright show-report
```

### Test Coverage

- **E2E Tests**: 80+ Playwright tests for major workflows
- **Component Tests**: 20+ React component tests
- **Contract Tests**: 27+ API schema validation tests
- **Total**: 349+ tests across 43+ test files

## Key Configuration Files

| File | Purpose |
|------|---------|
| `package.json` | Node.js dependencies and scripts |
| `pyproject.toml` | Python Fast Agent configuration |
| `next.config.mjs` | Next.js configuration |
| `tsconfig.json` | TypeScript configuration |
| `docker-compose.yml` | Docker services orchestration |
| `env.example` | Environment variables template |
| `vitest.config.ts` | Vitest test configuration |
| `mcp.config.json` | MCP server configuration |
| `fastagent.config.yaml` | Fast Agent configuration |

## Required Environment Variables

### LLM Providers (at least one required)

```env
OPENROUTER_API_KEY=sk-or-...        # Recommended (100+ models)
GOOGLE_API_KEY=...                   # Google Gemini
ANTHROPIC_API_KEY=sk-ant-...         # Claude
MISTRAL_API_KEY=...                  # Mistral AI
```

### Sandbox Provider

```env
SANDBOX_PROVIDER=daytona             # daytona | runloop | blaxel | sprites
DAYTONA_API_KEY=...                  # Get from daytona.io
BLAXEL_API_KEY=...                   # Get from console.blaxel.ai
```

### Database & Storage

```env
DATABASE_URL=postgresql://...        # PostgreSQL connection
REDIS_URL=redis://localhost:6379     # Redis connection
ENCRYPTION_KEY=...                   # 64-char hex key for encryption
```

### Voice Features (Optional)

```env
LIVEKIT_API_KEY=...
LIVEKIT_API_SECRET=...
NEXT_PUBLIC_LIVEKIT_URL=wss://...
ELEVENLABS_API_KEY=...
CARTESIA_API_KEY=...
```

## Development Conventions

### Code Style

- **TypeScript**: Strict mode enabled with path aliases (`@/*`)
- **ESLint**: Custom configuration with React and Prettier rules
- **Formatting**: Prettier with Tailwind CSS plugin
- **Naming**: camelCase for variables/functions, PascalCase for components/types

### Architecture Patterns

- **Component Structure**: React functional components with hooks
- **State Management**: React Context + custom hooks
- **API Routes**: Next.js App Router API routes
- **Error Handling**: Try-catch with structured error responses
- **Logging**: Pino logger with configurable levels

### Testing Practices

- **Unit Tests**: Vitest for isolated component testing
- **E2E Tests**: Playwright for full workflow testing
- **Test Files**: Co-located with source or in `__tests__/`
- **Naming**: `*.test.ts` for test files

### Git Workflow

- **Branch Naming**: `feature/xxx`, `fix/xxx`, `docs/xxx`
- **Commit Messages**: Conventional Commits format
- **Pull Requests**: Required for main branch merges

## Key Features Implementation

### Agent System

- **Location**: `lib/orchestra/`, `lib/agent/`, `lib/ai-sdk/`
- **Workflow**: Plan → Act → Verify with self-healing
- **Tools**: Vercel AI SDK tools with Zod validation

### Sandbox System

- **Location**: `lib/sandbox/`
- **Providers**: Daytona, Blaxel, Sprites, Runloop, Microsandbox
- **Features**: Warm pool, persistent cache, rate limiting

### Terminal

- **Location**: `lib/terminal/`, `components/terminal/`
- **Technology**: xterm.js with WebSocket backend
- **Features**: Split view, command history, fish-like autocomplete

### Voice

- **Location**: `lib/voice/`, `hooks/use-voice-input.ts`
- **Technology**: Livekit + Web Speech API
- **Features**: Neural TTS, speech recognition, voice commands

## API Endpoints

Key API routes are located in `app/api/`:

- `/api/chat` - Chat completions
- `/api/sandbox/*` - Sandbox operations
- `/api/terminal/*` - Terminal WebSocket handling
- `/api/voice/*` - Voice room management
- `/api/image/*` - Image generation
- `/api/auth/*` - Authentication endpoints

## Documentation

- **[README.md](README.md)** - Main project documentation
- **[ARCHITECTURE_IMPROVEMENTS_STATUS.md](ARCHITECTURE_IMPROVEMENTS_STATUS.md)** - Implementation status
- **[docs/](docs/)** - Feature documentation
- **[tests/e2e/README.md](tests/e2e/README.md)** - E2E testing guide

## Common Commands

```bash
# Development
pnpm dev                    # Start dev server
pnpm dev:ws                # Start WebSocket server
pnpm lint                  # Run ESLint

# Testing
pnpm test                  # Run all tests
pnpm test:e2e              # Run E2E tests
pnpm test:coverage         # Run with coverage

# Database
pnpm migrate               # Run migrations
pnpm backup                # Backup database

# Docker
docker-compose up -d       # Start services
docker-compose logs -f     # View logs
docker-compose down        # Stop services
```

## Troubleshooting

### Sandbox Creation Fails

1. Verify API key is valid
2. Check sandbox provider status
3. Review logs: `docker-compose logs | grep -i sandbox`

### High Memory Usage

1. Enable persistent cache
2. Reduce warm pool size
3. Set memory limits in docker-compose.yml

### WebSocket Connection Issues

1. Ensure WEBSOCKET_PORT differs from PORT
2. Check firewall rules
3. Verify LIVEKIT_URL is accessible

## Security Considerations

- **API Keys**: Never commit to version control
- **Docker Socket**: Critical security risk - use socket proxy in production
- **Rate Limiting**: Enabled by default for all endpoints
- **Audit Logging**: All commands logged for compliance
- **Sandbox Isolation**: Per-user sandboxes with resource limits
