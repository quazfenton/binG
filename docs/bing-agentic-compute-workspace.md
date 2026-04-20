---
id: bing-agentic-compute-workspace
title: "\U0001F680 binG - Agentic Compute Workspace"
aliases:
  - README
  - README.md
  - bing-agentic-compute-workspace
  - bing-agentic-compute-workspace.md
tags:
  - agent
  - spawn
layer: core
summary: "![CodeRabbit Pull Request Reviews](https://img.shields.io/coderabbit/prs/github/quazfenton/binG?utm_source=oss&utm_medium=github&utm_campaign=quazfenton%2FbinG&labelColor=171717&color=FF570A&link=https%3A%2F%2Fcoderabbit.ai&label=CodeRabbit+Reviews)\r\n\r\n# \U0001F680 binG - Agentic Compute Workspace\r\n\r\n**An i"
anchors:
  - "\U0001F3AF What Makes binG Different?"
  - ✨ Core Features
  - "\U0001F916 Agentic Capabilities"
  - "\U0001F9E0 Advanced AI Agent (NEW - Vercel AI SDK Integration)"
  - "\U0001F4BB Development Environment"
  - "\U0001F399️ Voice & Audio"
  - "\U0001F512 Security & Isolation"
  - "\U0001F3A8 User Experience"
  - "\U0001F5BC️ Image Generation (NEW)"
  - "\U0001F9EA Comprehensive Testing (NEW)"
  - "\U0001F3D7️ Architecture Overview"
  - "\U0001F680 Quick Start"
  - 'Option 1: Local Development'
  - 'Option 2: Docker Deployment (Recommended for Production)'
  - 'Option 3: One-Click Deploy'
  - ⚙️ Configuration
  - Required Environment Variables
  - Optional Optimizations
  - "\U0001F433 Docker Deployment Guide"
  - Prerequisites
  - 'Step 1: Clone and Configure'
  - 'Step 2: Start Services'
  - 'Step 3: Access Application'
  - 'Step 4: Production Hardening'
  - Docker Troubleshooting
  - "\U0001F4CA Performance Benchmarks"
  - Optimization Tips
  - "\U0001F510 Security Best Practices"
  - Production Checklist
  - API Key Management
  - "\U0001F6E0️ Advanced Usage"
  - Custom Sandbox Images
  - Multi-Agent Orchestration
  - Voice Customization
  - "\U0001F195 New Features (Latest Release)"
  - Sandbox Providers
  - Advanced Features
  - "\U0001F4DA Documentation"
  - AI Agent & Vercel AI SDK
  - Core Features
  - Advanced Features
  - "\U0001F91D Contributing"
  - Development Setup
  - "\U0001F9EA Testing"
  - Run Tests
  - Test Coverage
  - "\U0001F4DA Documentation"
  - "\U0001F4C4 License"
  - "\U0001F64F Acknowledgments"
  - "\U0001F4EC Support"
relations:
  - type: related
    id: spawn-containerized-ai-coding-agents
    title: Containerized AI Coding Agents
    path: spawn/containerized-ai-coding-agents.md
    confidence: 0.307
    classified_score: 0.249
    auto_generated: true
    generator: apply-classified-suggestions
---
![CodeRabbit Pull Request Reviews](https://img.shields.io/coderabbit/prs/github/quazfenton/binG?utm_source=oss&utm_medium=github&utm_campaign=quazfenton%2FbinG&labelColor=171717&color=FF570A&link=https%3A%2F%2Fcoderabbit.ai&label=CodeRabbit+Reviews)

# 🚀 binG - Agentic Compute Workspace

**An intelligent workspace where AI agents, code execution, and human collaboration converge.**

binG is not just another chat interface—it's a **full-stack agentic workspace** that combines AI conversation with real code execution, voice interaction, and multi-agent orchestration. Build, test, and deploy applications with AI assistance in an isolated, secure sandbox environment.

![binG Workspace](https://via.placeholder.com/)

---

## 🎯 What Makes binG Different?

| Traditional Chat | binG Workspace |
|-----------------|----------------|
| Text-only responses | **Executable code + live terminal** |
| Static conversations | **Persistent sandbox sessions** |
| No environment access | **Full Linux sandbox (Daytona/Runloop)** |
| Single AI model | **Multi-provider orchestration** |
| Browser TTS only | **Livekit + Neural TTS (ElevenLabs/Cartesia)** |

---

## ✨ Core Features

### 🤖 Agentic Capabilities
- **Multi-Agent Orchestration**: Coordinate multiple AI agents for complex tasks
- **Vercel AI SDK Integration**: Native tool calling with streaming support
- **Self-Healing Agents**: Automatic error recovery with intelligent retry logic
- **Tool Integration**: 800+ tools via Composio + Nango (GitHub, Slack, Notion, etc.)
- **Code Execution**: Run generated code in isolated sandboxes
- **Terminal Access**: Full xterm.js terminal with fish-like autocomplete
- **Persistent Sessions**: Sandboxes persist across page reloads
- **Plan-Act-Verify Workflow**: Structured agent execution with validation
- **Multi-Provider Fallback**: Automatic failover (OpenAI → Anthropic → Google)

### 🧠 Advanced AI Agent (NEW - Vercel AI SDK Integration)
- **Plan-Act-Verify Workflow**: Discovery → Planning → Editing → Verification phases
- **Self-Healing**: Automatic retry on errors (syntax, logic, transient failures)
- **Syntax Verification**: Real-time validation for TypeScript, JSON, YAML, Python, Shell
- **Streaming Responses**: Real-time token streaming with tool call visibility
- **Human-in-the-Loop**: Approval workflow for sensitive operations
- **Checkpointing**: Save/restore agent state (Redis or in-memory)
- **Tool Executor**: Centralized tool execution with metrics and logging
- **Nango Integrations**: GitHub, Slack, Notion tools with rate limiting
- **Multi-Provider Fallback**: OpenAI → Anthropic → Google (automatic failover)
- **Human-in-the-Loop (HITL)**: Approval required for sensitive operations
- **Checkpoint/Resume**: Pause and resume long-running tasks
- **Type-Safe Tools**: Zod-validated AI SDK tools with surgical ApplyDiff

### 💻 Development Environment
- **Isolated Sandboxes**: Each user gets a dedicated Linux environment
- **Multiple Sandbox Providers**: Daytona, Runloop, **Blaxel** (ultra-fast), **Fly.io Sprites** (persistent VMs)
- **Pre-installed Packages**: Node.js, Python, Git, build tools ready to use
- **Persistent Cache**: Shared package cache (2-3x faster sandbox creation)
- **Split Terminal View**: Multiple terminals side-by-side
- **Command History**: Intelligent autocomplete and history navigation
- **Tar-Pipe Sync**: 10x faster file sync for large projects (Sprites)
- **SSHFS Mount**: Mount remote sandbox filesystem locally (Sprites)

### 🎙️ Voice & Audio
- **Neural TTS**: ElevenLabs & Cartesia integration (human-quality voices)
- **Livekit Rooms**: Multi-user voice channels for collaboration
- **Speech Recognition**: Real-time transcription with Web Speech API
- **Auto-Speak**: AI responses automatically spoken when enabled
- **Voice Commands**: Hands-free operation support

### 🔒 Security & Isolation
- **Per-User Sandboxes**: Complete isolation between users
- **Ephemeral Environments**: Sandboxes auto-destroy after inactivity
- **No Host Access**: Sandboxes cannot access host filesystem
- **Resource Limits**: CPU/memory quotas prevent abuse
- **Rate Limiting**: Configurable rate limits prevent abuse
- **Audit Logging**: All commands logged for compliance
- **Checkpoint System**: Save/restore sandbox state (Sprites)

### 🎨 User Experience
- **Instant Terminal UI**: Terminal opens instantly, sandbox connects lazily
- **Friendly Loading**: Progressive disclosure hides initialization time
- **Smart Fallbacks**: Graceful degradation when services unavailable
- **Responsive Design**: Works on desktop, tablet, and mobile
- **Dark Theme**: Easy on the eyes for extended sessions

### 🖼️ Image Generation (NEW)
- **Multi-Provider Support**: Mistral AI (FLUX1.1 Ultra), Replicate (SDXL, Flux)
- **ComfyUI-Style Controls**: Aspect ratio, quality presets, style selection
- **Virtual Filesystem**: Save/generated images to workspace
- **Fallback Chain**: Automatic provider failover (Mistral → Replicate)
- **Quota Management**: Monthly usage tracking and limits

### 🧪 Comprehensive Testing (NEW)
- **E2E Tests**: 80+ Playwright tests for all major workflows
- **Component Tests**: 20+ React component tests
- **Contract Tests**: 27+ API schema validation tests
- **Visual Regression**: 15+ screenshot baseline tests
- **Performance Tests**: 25+ benchmark tests with optimization recommendations
- **Total Coverage**: 349+ tests across 43+ test files

---

## 🏗️ Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     binG Workspace                          │
├─────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │   Chat UI    │  │   Terminal   │  │  Code Panel  │     │
│  │  (React)     │  │  (xterm.js)  │  │  (Monaco)    │     │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘     │
│         │                 │                 │              │
│         └─────────────────┴─────────────────┘              │
│                           │                                │
│                  ┌────────▼────────┐                       │
│                  │  API Routes     │                       │
│                  │  (Next.js)      │                       │
│                  └────────┬────────┘                       │
│                           │                                │
│         ┌─────────────────┼─────────────────┐             │
│         │                 │                 │              │
│  ┌──────▼──────┐  ┌──────▼──────┐  ┌──────▼──────┐       │
│  │ LLM Providers│  │  Sandboxes  │  │   Livekit   │       │
│  │ (OpenRouter,│  │  (Daytona,  │  │   (Voice    │       │
│  │  Google,    │  │   Runloop)  │  │   Rooms)    │       │
│  │  Mistral)   │  │             │  │             │       │
│  └─────────────┘  └─────────────┘  └─────────────┘       │
└─────────────────────────────────────────────────────────────┘
```

---

## 🚀 Quick Start

### Option 1: Local Development

```bash
# Clone repository
git clone https://github.com/quazfenton/binG.git
cd binG

# Install dependencies
pnpm install

# Copy environment template
cp env.example .env.local

# Edit .env.local with your API keys (see Configuration section)
nano .env.local

# Optional: Install advanced sandbox providers
pnpm add -O @blaxel/sdk @blaxel/core @fly/sprites @modelcontextprotocol/sdk

# Optional: Install image generation providers
pnpm add -O @mistralai/mistralai replicate

# Optional: Install SSHFS for local filesystem mount (macOS)
brew install macfuse sshfs

# Optional: Install Playwright for E2E testing
pnpm add -D @playwright/test @axe-core/playwright
npx playwright install

# Start development server
pnpm dev

# Run tests (recommended before committing)
pnpm test

# Open browser
open http://localhost:3000
```

### Option 2: Docker Deployment (Recommended for Production)

```bash
# Build and run with Docker Compose
docker-compose up -d

# View logs
docker-compose logs -f

# Stop services
docker-compose down
```

### Option 3: One-Click Deploy

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new)
[![Deploy to Railway](https://railway.app/button.svg)](https://railway.app)

---

## ⚙️ Configuration

### Required Environment Variables

```env
# At least ONE LLM provider must be configured
OPENROUTER_API_KEY=sk-or-...        # Recommended (access to 100+ models)
GOOGLE_API_KEY=...                   # Google Gemini
ANTHROPIC_API_KEY=sk-ant-...         # Claude
MISTRAL_API_KEY=...                  # Mistral AI
GITHUB_MODELS_API_KEY=...            # GitHub Models (via Azure)

# Sandbox Provider (for code execution)
SANDBOX_PROVIDER=daytona             # or 'runloop', 'blaxel', 'sprites'
DAYTONA_API_KEY=...                  # Get from https://daytona.io
# RUNLOOP_API_KEY=...               # Alternative to Daytona

# Blaxel Sandbox (Optional - Ultra-fast resume <25ms)
BLAXEL_API_KEY=...                   # Get from https://console.blaxel.ai
BLAXEL_WORKSPACE=...

# Fly.io Sprites (Optional - Persistent VMs with checkpoints)
SPRITES_TOKEN=...                    # Get from https://sprites.dev/account

# Voice Features (Optional)
LIVEKIT_API_KEY=...
LIVEKIT_API_SECRET=...
NEXT_PUBLIC_LIVEKIT_URL=wss://...

# Neural TTS (Optional - enhances voice quality)
ELEVENLABS_API_KEY=...              # Human-quality voices
CARTESIA_API_KEY=...                 # Ultra-low latency TTS

# Tool Integration (Optional)
COMPOSIO_API_KEY=...                 # 800+ tool integrations
```

### Optional Optimizations

```env
# Persistent Cache (2-3x faster sandbox creation)
SANDBOX_PERSISTENT_CACHE=true
SANDBOX_CACHE_VOLUME_NAME=global-package-cache
SANDBOX_CACHE_SIZE=2GB

# Warm Pool (instant sandbox availability)
SANDBOX_WARM_POOL=true
SANDBOX_WARM_POOL_SIZE=2

# Rate Limiting (prevent abuse)
SANDBOX_RATE_LIMITING_ENABLED=true
SANDBOX_RATE_LIMIT_COMMANDS_MAX=100
SANDBOX_RATE_LIMIT_FILE_OPS_MAX=50

# Sprites Advanced Features
SPRITES_ENABLE_TAR_PIPE_SYNC=true     # 10x faster file sync
SPRITES_ENABLE_SSHFS=true             # Mount filesystem locally
SPRITES_CHECKPOINT_AUTO_CREATE=true   # Auto-save before dangerous ops

# Blaxel MCP Server (for AI assistants)
BLAXEL_MCP_ENABLED=true

# Logging
LOG_LEVEL=info                       # silent | error | warn | info | debug
```

---

## 🐳 Docker Deployment Guide

### Prerequisites
- Docker 20.10+
- Docker Compose 2.0+
- 4GB RAM minimum (8GB recommended)
- 20GB disk space

### Step 1: Clone and Configure

```bash
git clone https://github.com/quazfenton/binG.git
cd binG
cp .env.example .env
```

Edit `.env` with your API keys (see Configuration section above).

### Step 2: Start Services

```bash
# Build and start all services
docker-compose up -d

# Check status
docker-compose ps

# View logs
docker-compose logs -f app
```

### Step 3: Access Application

Open `http://localhost:3000` in your browser.

### Step 4: Production Hardening

For production deployments:

1. **Change default ports:**
   ```yaml
   # docker-compose.yml
   ports:
     - "8080:3000"  # Change to your preferred port
   ```

2. **Add SSL/TLS:**
   ```bash
   # Use a reverse proxy like Caddy or Nginx
   docker run -d \
     -p 443:443 \
     -v /path/to/certs:/certs \
     caddy caddy reverse-proxy --from your-domain.com --to binG:3000
   ```

3. **Set up monitoring:**
   ```bash
   # Add Prometheus/Grafana for metrics
   docker-compose -f docker-compose.monitoring.yml up -d
   ```

4. **Configure backups:**
   ```bash
   # Backup persistent volumes
   docker run --rm \
     -v bing_database:/data \
     -v $(pwd)/backups:/backups \
     alpine tar czf /backups/database-$(date +%Y%m%d).tar.gz /data
   ```

### Docker Troubleshooting

**Issue: Container won't start**
```bash
# Check logs
docker-compose logs app

# Rebuild container
docker-compose build --no-cache app
docker-compose up -d
```

**Issue: Sandbox creation fails**
```bash
# Verify Daytona API key
docker-compose exec app curl -H "Authorization: Bearer $DAYTONA_API_KEY" \
  https://api.daytona.io/health

# Check sandbox provider status
docker-compose logs | grep -i sandbox
```

**Issue: High memory usage**
```bash
# Limit container memory
# docker-compose.yml
services:
  app:
    deploy:
      resources:
        limits:
          memory: 2G
```

---

## 📊 Performance Benchmarks

| Scenario | Without Cache | With Persistent Cache |
|----------|--------------|----------------------|
| First sandbox | 10 min | 10 min |
| Subsequent | 10 min | **2-3 min** |
| Bandwidth/user | 1.2 GB | **100 MB** |
| Storage | 1.5 GB/sandbox | **2 GB shared** |

### Optimization Tips

1. **Enable persistent cache** for teams >5 users
2. **Use warm pool** for instant availability
3. **Choose regional sandbox provider** for lower latency
4. **Set LOG_LEVEL=warn** in production (reduces I/O)

---

## 🔐 Security Best Practices

### Production Checklist

- [ ] Change default JWT_SECRET to cryptographically secure value
- [ ] Enable HTTPS/TLS for all traffic
- [ ] Set up firewall rules (only expose necessary ports)
- [ ] Configure rate limiting (prevent abuse)
- [ ] Enable audit logging (compliance)
- [ ] Set up monitoring/alerting (detect anomalies)
- [ ] Regular security updates (patch dependencies)
- [ ] Backup database daily (disaster recovery)

### API Key Management

**Never commit API keys to version control!**

```bash
# Use environment variables or secrets manager
export OPENROUTER_API_KEY="sk-or-..."

# Or use Docker secrets
docker secret create openrouter_key .env_openrouter
```

---

## 🛠️ Advanced Usage

### Custom Sandbox Images

Create a custom Daytona image with pre-installed packages:

```dockerfile
# Dockerfile.sandbox
FROM daytona/typescript:latest

RUN npm install -g typescript ts-node prettier eslint
RUN pip install requests flask fastapi numpy pandas

LABEL com.daytona.image="custom-typescript-full"
```

Build and push:
```bash
docker build -t your-registry/custom-typescript -f Dockerfile.sandbox .
docker push your-registry/custom-typescript
```

Configure in `.env`:
```env
SANDBOX_CUSTOM_IMAGE=your-registry/custom-typescript
```

### Multi-Agent Orchestration

Coordinate multiple AI agents for complex tasks:

```typescript
// Example: Code review workflow
const agents = [
  { role: 'reviewer', model: 'claude-3-5-sonnet' },
  { role: 'tester', model: 'gpt-4o' },
  { role: 'documenter', model: 'gemini-2.5-pro' },
];

// Each agent handles their specialty
```

### Voice Customization

Configure neural TTS voices:

```env
# ElevenLabs voices
ELEVENLABS_VOICE_ID=EXAVITQu4vr4xnSDxMaL  # "Sarah" - Professional
ELEVENLABS_STABILITY=0.5
ELEVENLABS_SIMILARITY_BOOST=0.75

# Cartesia voices
CARTESIA_VOICE_ID=692530db-220c-4789-9917-79a844212011
CARTESIA_MODEL=sonic-english
```

---

## 🆕 New Features (Latest Release)

### Sandbox Providers

**Blaxel** - Ultra-fast cloud sandboxes
- Resume time: <25ms from standby
- Auto scale-to-zero (free when idle)
- Persistent volumes support
- VPC networking for enterprise
- **Best for**: Fast iteration, stateless batch processing

**Fly.io Sprites** - Persistent VMs with full Linux environment
- True persistence (ext4 filesystem)
- Hardware isolation (dedicated microVM)
- Checkpoint system (save/restore state)
- Auto-hibernation (<500ms wake)
- SSHFS mount (local filesystem access)
- **Best for**: Long-lived dev environments, CI/CD runners

### Advanced Features

**Tar-Pipe Sync** - 10x faster file synchronization
- Compressed tar stream to sandbox
- Ideal for large projects (10+ files)
- Reduces data transfer by 60%
- Available for Sprites provider

**SSHFS Mount** - Mount sandbox filesystem locally
- Real-time sync between local and remote
- Edit with your favorite local IDE
- Available for Sprites provider
- Requires: `brew install macfuse sshfs` (macOS) or `apt-get install sshfs` (Linux)

**Checkpoint System** - Save and restore sandbox state
- Auto-create before dangerous operations
- Manual checkpoints on demand
- Retention policies (max count, max age)
- Available for Sprites provider

**MCP Server** - Expose sandbox to AI assistants
- Model Context Protocol integration
- Works with Cursor, Claude Desktop, etc.
- Tools: execute_command, write_file, read_file, list_directory
- Available for Blaxel provider

**Rate Limiting** - Prevent abuse and manage resources
- Per-user or per-IP limits
- Configurable per operation type
- Automatic cleanup of expired entries
- Express middleware integration

---

## 📚 Documentation

### AI Agent & Vercel AI SDK
- **[Vercel AI SDK Features](docs/VERCEL_AI_SDK_FEATURES.md)** - Complete guide to AI agent, self-healing, and tool integration
- **[Implementation Review](VERCEL_AI_SDK_INTEGRATION_REVIEW.md)** - Detailed code review and architecture
- **[Test Report](TEST_REPORT.md)** - Test coverage documentation (209 tests)

### Core Features
- **[Sandbox Caching Guide](docs/SANDBOX_CACHING_GUIDE.md)** - Optimize sandbox creation speed
- **[Hiding Creation Time](docs/HIDING_SANDBOX_CREATION_TIME.md)** - UX improvements for perceived performance
- **[Voice Service Improvements](docs/VOICE_SERVICE_IMPROVEMENTS.md)** - Neural TTS integration guide
- **[Database Migrations](docs/DATABASE_MIGRATIONS.md)** - Schema management and migrations
- **[Technical Improvements](docs/TECHNICAL_IMPROVEMENTS_SUMMARY.md)** - Recent enhancements summary

### Advanced Features
- **[Advanced Features Guide](docs/ADVANCED_FEATURES_IMPLEMENTATION.md)** - SSHFS, MCP Server, Rate Limiting
- **[Sprites Integration](docs/sdk/BLAXEL_SPRITES_USAGE_GUIDE.md)** - Blaxel & Sprites usage guide
- **[Environment Variables Audit](docs/ENV_VARIABLES_AUDIT_COMPLETE.md)** - Complete env vars reference
- **[Missing Packages Report](MISSING_PACKAGES_REPORT.md)** - Package dependencies guide
- **[API Endpoints](docs/API_ENDPOINTS_COMPLETE.md)** - All 95+ API endpoints
- **[Implementation Status](docs/sdk/IMPLEMENTATION_STATUS_AUDIT.md)** - Current implementation status
- **[Test Summary](docs/sdk/TEST_IMPLEMENTATION_SUMMARY.md)** - Test coverage report (124 tests)

---

## 🤝 Contributing

We welcome contributions! 

### Development Setup

```bash
# Fork and clone
git clone https://github.com/YOUR_USERNAME/binG.git
cd binG

# Install dependencies
pnpm install

# Create feature branch
git checkout -b feature/your-feature

# Make changes and test
pnpm dev
pnpm test

# Commit and push
git commit -m "feat: add your feature"
git push origin feature/your-feature
```

For major changes, please open an issue first to discuss what you would like to change.

---

## 🧪 Testing

### Run Tests

```bash
# Run all tests
pnpm test

# Run E2E tests (Playwright)
npx playwright test

# Run unit tests (Vitest)
npx vitest run

# Run component tests
npx vitest run __tests__/components/

# Run visual regression tests
npx playwright test tests/e2e/visual-regression.test.ts

# Run performance tests with recommendations
npx playwright test tests/e2e/performance-advanced.test.ts

# View HTML report
npx playwright show-report
```

### Test Coverage

- **E2E Tests**: 80+ tests for all major workflows
- **Component Tests**: 20+ React component tests
- **Contract Tests**: 27+ API schema validation tests
- **Visual Regression**: 15+ screenshot baseline tests
- **Performance Tests**: 25+ benchmark tests
- **Total**: 349+ tests across 43+ test files

See [Test Coverage Report](tests/COMPREHENSIVE_TEST_REPORT.md) for details.

---

## 📚 Documentation

- **[API Endpoints](docs/API_ENDPOINTS_COMPLETE.md)** - Complete API reference (100+ endpoints)
- **[New API Features](docs/API_NEW_FEATURES.md)** - Latest API additions from this session
- **[E2E Testing Guide](tests/e2e/README.md)** - Playwright test setup and usage
- **[Implementation Plans](docs/sdk/IMPLEMENTATION_PLANS_INDEX.md)** - Technical implementation details
- **[Mistral Agent Guide](docs/sdk/MISTRAL_AGENT_SANDBOX_IMPLEMENTATION_PLAN.md)** - Mistral integration
- **[Sprites Enhancement](docs/sdk/SPRITES_ENHANCEMENT_PLAN.md)** - Sprites provider features
- **[Images Tab Guide](docs/sdk/IMAGE_GENERATION_GUIDE.md)** - Image generation setup

---

## 📄 License

MIT License - See [LICENSE](LICENSE) file for details.

---

## 🙏 Acknowledgments

- [Daytona](https://daytona.io) - Sandbox infrastructure
- [Livekit](https://livekit.io) - Voice/video infrastructure
- [ElevenLabs](https://elevenlabs.io) - Neural TTS
- [Cartesia](https://cartesia.ai) - Ultra-low latency TTS
- [Composio](https://composio.dev) - Tool integrations
- [OpenRouter](https://openrouter.ai) - Multi-model access

---

## 📬 Support

- **Issues**: https://github.com/quazfenton/binG/issues
- **Discussions**: https://github.com/quazfenton/binG/discussions

---

**Built with ❤️ by the binG Team**

*Last Updated: December 2024*  
*Version: 2.0.0*
