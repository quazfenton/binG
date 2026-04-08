# Local PTY (Web Mode)

Real PTY terminal access on the server via `node-pty` — no sandbox providers needed.

Users get a **real shell** on the server with full terminal capabilities: colors, interactive apps (vim, nano, htop), tab completion, and proper signal handling (Ctrl+C, Ctrl+Z).

---

## Quick Start

```bash
# 1. Install node-pty (requires Python + build tools)
cd web && npm install node-pty

# 2. Enable local PTY (dev mode)
echo 'ENABLE_LOCAL_PTY=localhost' >> .env.local

# 3. Restart Next.js
npm run dev
```

Open the terminal panel — it will auto-connect to the server's real shell.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  Browser (xterm.js)                                          │
│  ┌─────────┐  POST /api/terminal/local-pty/input  ┌────────┐ │
│  │  Input  │ ─────────────────────────────────────►│  PTY   │ │
│  └─────────┘                                       │  Proc  │ │
│  ┌─────────┐  GET /api/terminal/local-pty?sid=...  ┌────────┐ │
│  │  Output │ ◄─────────────────────────────────────│  SSE   │ │
│  └─────────┘                                       └────────┘ │
└──────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────┐
│  Next.js Server (Node.js)                                    │
│                                                              │
│  route.ts:  POST → node-pty.spawn()  →  store in sessions    │
│  route.ts:  GET  → ReadableStream SSE  →  poll output queue  │
│  input.ts:  POST → session.pty.write(data)                   │
│  resize.ts: POST → session.pty.resize(cols, rows)            │
└──────────────────────────────────────────────────────────────┘
```

### Flow

1. **Terminal opens** → TerminalPanel checks `isWebLocalPtyAvailable()`
2. **Session created** → `POST /api/terminal/local-pty` spawns node-pty process
3. **SSE connects** → `GET /api/terminal/local-pty?sessionId=...` streams output
4. **User types** → `POST /api/terminal/local-pty/input` writes keystrokes
5. **Terminal resizes** → `POST /api/terminal/local-pty/resize` updates dimensions
6. **Session cleanup** → Auto-cleanup after 30 min or on terminal close

---

## Isolation Modes

Controlled by `ENABLE_LOCAL_PTY` environment variable.

### `off` (Production Default)

Local PTY is completely disabled. Users fall back to sandbox providers (Daytona, E2B, etc.).

```bash
ENABLE_LOCAL_PTY=off
```

### `localhost`

Only available when the request originates from `localhost`, `127.0.0.1`, or `::1`. Safe for local development.

```bash
ENABLE_LOCAL_PTY=localhost
```

**Use case**: Developer running the app locally, wants a real shell without sandbox overhead.

### `unshare` (Linux Only — Recommended for Linux Servers)

Each PTY session runs inside isolated Linux namespaces using `unshare(1)`:

- **User namespace** — process maps to root inside, unprivileged outside
- **Mount namespace** — isolated filesystem view
- **PID namespace** — can't see or signal other host processes
- **New `/proc`** — only shows processes inside the namespace

```bash
ENABLE_LOCAL_PTY=unshare
```

**Isolation diagram:**

```
┌── Server (host) ───────────────────────────────────┐
│                                                    │
│  ┌─ User A: unshare --user --mount --pid ──────┐  │
│  │  /bin/bash (root in namespace, nobody outside)│  │
│  │  Can only see own processes                   │  │
│  └──────────────────────────────────────────────┘  │
│                                                    │
│  ┌─ User B: unshare --user --mount --pid ──────┐  │
│  │  /bin/bash (root in namespace, nobody outside)│  │
│  │  Can only see own processes                   │  │
│  └──────────────────────────────────────────────┘  │
│                                                    │
│  No cross-user access. No network isolation.        │
└────────────────────────────────────────────────────┘
```

**Requirements:**
- Linux kernel 3.8+
- `kernel.unprivileged_userns_clone=1` (enabled by default on most modern distros)
- `util-linux` package (provides `unshare` command)

**Check if available:**
```bash
# Check kernel support
cat /proc/sys/kernel/unprivileged_userns_clone  # should be 1 or file not exist
# Check unshare is installed
which unshare
# Test it works
unshare --user --map-root-user echo "works"
```

### `docker`

Each session gets its own Docker container with full isolation:

- **Isolated filesystem** — clean `node:20-slim` image
- **No network** — `--network none` prevents outbound connections
- **Memory limit** — `--memory 512m` (configurable)
- **CPU limit** — `--cpus 1` (configurable)
- **Auto-remove** — `--rm` cleans up on exit

```bash
ENABLE_LOCAL_PTY=docker
LOCAL_PTY_DOCKER_IMAGE=node:20-slim    # or your custom image
LOCAL_PTY_DOCKER_MEMORY=512m
LOCAL_PTY_DOCKER_CPU=1
```

**Isolation diagram:**

```
┌── Server (host) ───────────────────────────────────────────┐
│                                                            │
│  ┌─ Container A ────────────────────────────────┐         │
│  │  /bin/bash                                    │         │
│  │  Filesystem: node:20-slim                     │         │
│  │  Network: none                                │         │
│  │  Memory: 512MB, CPU: 1 core                  │         │
│  └──────────────────────────────────────────────┘         │
│                                                            │
│  ┌─ Container B ────────────────────────────────┐         │
│  │  /bin/bash                                    │         │
│  │  Filesystem: node:20-slim                     │         │
│  │  Network: none                                │         │
│  │  Memory: 512MB, CPU: 1 core                  │         │
│  └──────────────────────────────────────────────┘         │
│                                                            │
│  Full isolation. No cross-container access.                 │
└────────────────────────────────────────────────────────────┘
```

**Requirements:**
- Docker installed and running
- Node process has permission to run `docker` commands
- Custom image (optional): build with `web/Dockerfile.local-pty`

```bash
docker build -t local-pty-base -f web/Dockerfile.local-pty .
# Then set: LOCAL_PTY_DOCKER_IMAGE=local-pty-base
```

### `on` (Dev Only — No Isolation)

Direct spawn on the server with no isolation. All users share the same OS user, filesystem, and process table.

```bash
ENABLE_LOCAL_PTY=on
```

**⚠️ WARNING**: Never use this in production or multi-user environments. Users can read each other's files, see processes, and access environment variables.

---

## Security

### Environment Variable Sanitization

Secret environment variables are **automatically stripped** from PTY sessions:

- Any variable containing: `SECRET`, `KEY`, `TOKEN`, `PASSWORD`, `PASS`, `CREDENTIAL`, `AUTH`, `API_KEY`, `PRIVATE`, `SIGNING`

This prevents users from running `env` or `cat /proc/1/environ` to steal server secrets.

### Session Ownership

Every PTY session is bound to the authenticated user who created it:

- Other users cannot connect to, write to, or listen on another user's session
- Auth is verified on every API call (POST input, POST resize, GET SSE)
- Anonymous sessions are isolated by session ID

### Rate Limits

| Limit | Value | Purpose |
|-------|-------|---------|
| Max sessions per user | 5 | Prevent resource exhaustion |
| Max input per write | 16 KB | Prevent buffer flooding |
| Max terminal columns | 500 | Prevent abuse |
| Max terminal rows | 200 | Prevent abuse |
| Session max age | 30 minutes | Auto-cleanup stale sessions |
| Cleanup interval | 5 minutes | Background garbage collection |

### Process Cleanup

Sessions are cleaned up automatically:

- **On exit**: PTY process exit triggers immediate cleanup
- **On timeout**: Sessions older than 30 minutes are killed
- **On disconnect**: SSE client disconnect kills the PTY
- **On server shutdown**: `SIGTERM` handler cleans all sessions
- **Docker containers**: Auto-removed via `--rm` flag
- **Unshare processes**: Killed via process group (`kill -9 -PGID`)

---

## API Reference

### `POST /api/terminal/local-pty` — Create Session

**Request:**
```json
{
  "cols": 80,
  "rows": 24,
  "cwd": "/workspace",
  "shell": "/bin/bash"
}
```

**Response (success):**
```json
{
  "sessionId": "abc-123-...",
  "mode": "docker"
}
```

**Response (disabled):**
```json
{
  "error": "Local PTY is disabled. Use sandbox providers for terminal access.",
  "mode": "sandbox",
  "hint": "Set ENABLE_LOCAL_PTY=localhost to enable for local development"
}
```

**Query mode (check availability):**
```json
{ "checkOnly": true }
```
```json
{ "available": true, "mode": "docker" }
```

### `GET /api/terminal/local-pty?sessionId=...` — SSE Output Stream

Server-sent events stream. Message types:

| Type | Data | Description |
|------|------|-------------|
| `connected` | `{ sessionId }` | Stream is ready |
| `pty` | `"output text"` | Terminal output (raw bytes) |
| `disconnected` | `{ exitCode: 0 }` | PTY exited |

### `POST /api/terminal/local-pty/input` — Send Keystrokes

```json
{
  "sessionId": "abc-123-...",
  "data": "ls -la\n"
}
```

### `POST /api/terminal/local-pty/resize` — Resize Terminal

```json
{
  "sessionId": "abc-123-...",
  "cols": 120,
  "rows": 30
}
```

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ENABLE_LOCAL_PTY` | `off` (prod) / `on` (dev) | Isolation mode |
| `LOCAL_PTY_DOCKER_IMAGE` | `node:20-slim` | Docker image for isolation mode |
| `LOCAL_PTY_DOCKER_MEMORY` | `512m` | Memory limit per container |
| `LOCAL_PTY_DOCKER_CPU` | `1` | CPU cores per container |
| `NEXT_PUBLIC_TERMINAL_CONNECTION_TIMEOUT_MS` | `30000` | Sandbox connection timeout |

---

## Client-Side Usage

```typescript
import {
  isWebLocalPtyAvailable,
  getWebLocalPtyMode,
  createWebLocalPty,
  type WebLocalPtyInstance,
} from '@/lib/terminal/web-local-pty';

// Check availability
const available = await isWebLocalPtyAvailable();
const mode = await getWebLocalPtyMode(); // 'docker', 'unshare', 'direct', etc.

// Create session
const pty = await createWebLocalPty({
  cols: 120,
  rows: 30,
  cwd: '/workspace',
  shell: '/bin/zsh',
});

if (pty) {
  // Stream output to xterm.js
  pty.onOutput((data) => terminal.write(data));

  // Send keystrokes
  terminal.onData((data) => pty.writeInput(data));

  // Handle resize
  terminal.onResize(({ cols, rows }) => pty.resize(cols, rows));

  // Handle close
  pty.onClose(() => {
    terminal.writeln('\r\n\x1b[31m[PTY session closed]\x1b[0m');
  });

  // Close when done
  await pty.close();
}
```

---

## Troubleshooting

### `node-pty not installed`

```bash
cd web && npm install node-pty
# May require Python and build tools:
# npm install --build-from-source node-pty
```

### `unshare command not found`

```bash
# Install util-linux
apt-get install util-linux    # Debian/Ubuntu
yum install util-linux-ng     # RHEL/CentOS
```

### `unshare: unshare failed: Operation not permitted`

```bash
# Enable unprivileged user namespaces
sudo sysctl kernel.unprivileged_userns_clone=1
# Make persistent
echo 'kernel.unprivileged_userns_clone=1' | sudo tee /etc/sysctl.d/99-userns.conf
```

### `docker: command not found`

```bash
# Install Docker
curl -fsSL https://get.docker.com | sh
# Or ensure Docker is in PATH
export PATH=$PATH:/usr/bin
```

### `Failed to start Docker container`

```bash
# Check Docker is running
docker ps

# Check user has permissions
sudo usermod -aG docker $USER
# Or run Next.js as a user in the docker group
```

### Terminal shows no output

1. Check `ENABLE_LOCAL_PTY` is not set to `off`
2. Check server logs for `[Local PTY]` messages
3. Verify `node-pty` is installed: `node -e "require('node-pty')"`
4. Check SSE connection in browser DevTools Network tab

### SSE connection timeout

The SSE stream has a 10-second connection timeout. If PTY creation is slow:

1. Check Docker image pulls aren't timing out
2. Check `unshare` permissions
3. Try `ENABLE_LOCAL_PTY=on` (dev mode) to isolate the issue

---

## File Structure

```
web/
├── app/api/terminal/local-pty/
│   ├── route.ts          # Session creation + SSE output stream
│   ├── input/
│   │   └── route.ts      # Send keystrokes to PTY
│   └── resize/
│       └── route.ts      # Resize PTY dimensions
├── lib/terminal/
│   └── web-local-pty.ts  # Client-side PTY wrapper
├── components/terminal/
│   └── TerminalPanel.tsx # Terminal UI (integrates web local PTY)
└── Dockerfile.local-pty  # Docker image for isolation mode

env.example               # Environment variable documentation
```
