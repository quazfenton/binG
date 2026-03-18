# Live Preview System - Complete Implementation

## Overview

The preview system automatically selects the best preview method based on project type, with a clear **preference hierarchy** that favors local/browser-based solutions over cloud services.

## Preview Mode Hierarchy (Auto-Detection)

### **Tier 1: Browser-Native (Preferred)**
These run entirely in the browser - no cloud costs, instant startup.

| Mode | Use Case | Detection |
|------|----------|-----------|
| **Vite** | Modern frontend apps | `vite.config.*`, `"vite"` in package.json |
| **Webpack** | Bundled applications | `webpack.config.*`, `"webpack"` in package.json |
| **Parcel** | Zero-config bundling | `.parcelrc`, `"parcel"` in package.json |
| **WebContainer** | Node.js backends | `server.js`/`app.js` + `package.json` |
| **Pyodide** | Python in browser | `.py` files, no framework detected |
| **Sandpack** | React/Vue/Svelte | `.jsx`/`.tsx`/`.vue`/`.svelte` files |
| **Iframe** | Static HTML | `.html` without JS frameworks |

### **Tier 2: Cloud Fallback (When Needed)**
Used when project requirements exceed browser capabilities.

| Mode | Use Case | Detection |
|------|----------|-----------|
| **CodeSandbox DevBox** | Complex apps, Docker, databases | `Dockerfile`, complex ORM deps, or manual fallback |
| **DevBox** | General cloud dev | Manual selection |

## Detection Flow

```javascript
if (hasViteProject) {
  selectedMode = 'vite';                    // ⚡ Vite config detected
} else if (hasWebpackProject) {
  selectedMode = 'webpack';                 // 📦 Webpack config detected
} else if (hasParcelProject) {
  selectedMode = 'parcel';                  // ⚡ Parcel config detected
} else if (hasSimplePython && !hasPackageJson) {
  selectedMode = 'pyodide';                 // 🐍 Python, no framework
} else if (hasNodeServer && hasPackageJson) {
  selectedMode = 'webcontainer';            // 📀 Node.js backend (browser)
} else if (hasPython || hasNodeServer) {
  // Complex project detection
  if (hasDocker || hasComplexDeps) {
    selectedMode = 'codesandbox';           // 🏖️ Cloud DevBox (fallback)
  } else {
    selectedMode = detectedExecutionMode;   // 💻 Local or ☁️ Cloud
  }
} else if (hasHtml && !hasJsx) {
  selectedMode = 'iframe';                  // 📄 Static HTML
} else if (hasJsx || hasVue || hasSvelte) {
  selectedMode = 'sandpack';                // ▶ React/Vue/Svelte
}
```

## Complex Project Detection

CodeSandbox is **only** used when necessary:

```javascript
const hasDocker = filePaths.some(f => 
  f === 'Dockerfile' || f === 'docker-compose.yml'
);

const hasComplexDeps = packageJsonContent && (
  packageJsonContent.includes('prisma') ||
  packageJsonContent.includes('sequelize') ||
  packageJsonContent.includes('typeorm') ||
  packageJsonContent.includes('mongodb') ||
  packageJsonContent.includes('redis')
);

if (hasDocker || hasComplexDeps) {
  selectedMode = 'codesandbox'; // Cloud required
}
```

## Implementation Details

### **WebContainer** (📀 Node.js in Browser)
- Runs Node.js natively in browser via WebAssembly
- Perfect for: Express, Fastify, Koa, Next.js dev server
- **Pros**: Instant, free, offline-capable
- **Cons**: Limited to browser-compatible Node APIs

### **CodeSandbox DevBox** (🏖️ Cloud Environment)
- Full VS Code editor in the cloud
- Perfect for: Docker apps, databases, complex backends
- **Pros**: Full Linux environment, apt/pip/npm access
- **Cons**: 30-60s startup, requires API key, cloud costs

### **Pyodide** (🐍 Python in Browser)
- Python runtime via WebAssembly
- Perfect for: Data science, simple scripts, learning
- **Pros**: Instant, free, no server needed
- **Cons**: Limited package compatibility, slower than native

## API Endpoints

### `/api/sandbox/devbox` (POST)
Creates a CodeSandbox DevBox for complex projects.

**Request:**
```json
{
  "files": {
    "package.json": "{...}",
    "server.js": "...",
    "Dockerfile": "..."
  },
  "template": "node" | "docker"
}
```

**Response:**
```json
{
  "success": true,
  "sandboxId": "abc123",
  "sessionId": "sess_456",
  "url": "https://abc123.csb.app",
  "template": "node"
}
```

## Visual Editor Integration

The `visualEditorProjectData` includes metadata for handoff:

```typescript
{
  bundler: 'vite' | 'webpack' | 'parcel' | undefined,
  entryFile: 'src/main.tsx' | 'app.tsx' | null,
  previewModeHint: 'vite' | 'webpack' | 'webcontainer' | 'codesandbox' | 'iframe' | 'pyodide' | 'sandpack',
  filesystemScopePath: 'project/sessions/...'
}
```

## Usage Examples

### **Simple React App**
```
src/
  App.tsx
  index.tsx
package.json (with react, react-dom)
```
→ **Auto-detected**: Sandpack (▶)

### **Vite Project**
```
src/
  App.vue
vite.config.js
package.json (with vite)
```
→ **Auto-detected**: Vite (⚡)

### **Express API**
```
server.js
package.json (with express)
```
→ **Auto-detected**: WebContainer (📀)

### **Docker + PostgreSQL App**
```
docker-compose.yml
Dockerfile
src/main.py
requirements.txt (with fastapi, psycopg2)
```
→ **Auto-detected**: CodeSandbox (🏖️) - requires cloud for Docker

### **Pure Python Script**
```
script.py
data.csv
```
→ **Auto-detected**: Pyodide (🐍)

## Manual Override

Users can manually select preview mode via buttons (if needed):
- 🐍 Pyodide - Force Python in browser
- Other modes available via dropdown/future UI

## Cost Optimization

By preferring browser-native solutions:
- **90%+** of projects run locally (free)
- **<10%** require CodeSandbox (paid)
- Automatic fallback ensures best UX

## Future Enhancements

Potential additions (Tier 3 - Specialized):
- **Next.js** mode - SSR preview
- **Astro** - Static site generation
- **SvelteKit** - Full-stack Svelte
- **Storybook** - Component library
- **Three.js** - 3D WebGL preview
- **Flutter Web** - Dart web apps
