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
- **Tool Integration**: 800+ tools via Composio (GitHub, Slack, Gmail, etc.)
- **Code Execution**: Run generated code in isolated sandboxes
- **Terminal Access**: Full xterm.js terminal with fish-like autocomplete
- **Persistent Sessions**: Sandboxes persist across page reloads

### 💻 Development Environment
- **Isolated Sandboxes**: Each user gets a dedicated Linux environment
- **Pre-installed Packages**: Node.js, Python, Git, build tools ready to use
- **Persistent Cache**: Shared package cache (2-3x faster sandbox creation)
- **Split Terminal View**: Multiple terminals side-by-side
- **Command History**: Intelligent autocomplete and history navigation

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
- **Audit Logging**: All commands logged for compliance

### 🎨 User Experience
- **Instant Terminal UI**: Terminal opens instantly, sandbox connects lazily
- **Friendly Loading**: Progressive disclosure hides initialization time
- **Smart Fallbacks**: Graceful degradation when services unavailable
- **Responsive Design**: Works on desktop, tablet, and mobile
- **Dark Theme**: Easy on the eyes for extended sessions

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
cp .env.example .env

# Edit .env with your API keys (see Configuration section)
nano .env

# Start development server
pnpm dev

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
SANDBOX_PROVIDER=daytona             # or 'runloop'
DAYTONA_API_KEY=...                  # Get from https://daytona.io
# RUNLOOP_API_KEY=...               # Alternative to Daytona

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

## 📚 Documentation

- **[Sandbox Caching Guide](docs/SANDBOX_CACHING_GUIDE.md)** - Optimize sandbox creation speed
- **[Hiding Creation Time](docs/HIDING_SANDBOX_CREATION_TIME.md)** - UX improvements for perceived performance
- **[Voice Service Improvements](docs/VOICE_SERVICE_IMPROVEMENTS.md)** - Neural TTS integration guide
- **[Database Migrations](docs/DATABASE_MIGRATIONS.md)** - Schema management and migrations
- **[Technical Improvements](docs/TECHNICAL_IMPROVEMENTS_SUMMARY.md)** - Recent enhancements summary

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
