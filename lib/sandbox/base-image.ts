import type { SandboxHandle } from './providers/sandbox-provider'
import { getSandboxProvider } from './providers'
import { setupCacheVolumes } from './dep-cache'

// ---------------------------------------------------------------------------
// Part 1 – Base Package Manifest
// ---------------------------------------------------------------------------

export interface BasePackageSet {
  name: string
  runtime: 'node' | 'python' | 'system'
  packages: string[]
  installCommand: string
  verifyCommand: string
  optional?: boolean
}

const DEFAULT_PACKAGE_SETS: BasePackageSet[] = [
  {
    name: 'system-tools',
    runtime: 'system',
    packages: ['git', 'curl', 'wget', 'jq', 'tree', 'htop', 'nano', 'vim', 'ripgrep', 'fd-find'],
    installCommand: 'apt-get install -y',
    verifyCommand: 'git --version && curl --version',
  },
  {
    name: 'build-tools',
    runtime: 'system',
    packages: ['build-essential', 'cmake'],
    installCommand: 'apt-get install -y',
    verifyCommand: 'gcc --version && cmake --version',
    optional: true,
  },
  {
    name: 'python-core',
    runtime: 'system',
    packages: ['python3-pip', 'python3-venv'],
    installCommand: 'apt-get install -y',
    verifyCommand: 'python3 --version && pip3 --version',
  },
  {
    name: 'node-core',
    runtime: 'node',
    packages: ['typescript', 'tsx', 'ts-node', 'prettier', 'eslint'],
    installCommand: 'npm install -g',
    verifyCommand: 'tsc --version && prettier --version',
  },
  {
    name: 'node-libs',
    runtime: 'node',
    packages: ['express', 'fastify', 'zod', 'dotenv', 'axios', 'node-fetch', 'lodash', 'uuid'],
    installCommand: 'npm install -g',
    verifyCommand: 'node -e "require(\'express\')"',
  },
  {
    name: 'python-libs',
    runtime: 'python',
    packages: ['requests', 'flask', 'fastapi', 'uvicorn', 'numpy', 'pandas', 'jupyter', 'notebook'],
    installCommand: 'pip install',
    verifyCommand: 'python3 -c "import requests; import flask"',
  },
]

function getEnabledSets(): BasePackageSet[] {
  const envFilter = process.env.SANDBOX_BASE_PACKAGES
  let sets: BasePackageSet[]

  if (envFilter) {
    const allowed = envFilter.split(',').map((s) => s.trim())
    sets = DEFAULT_PACKAGE_SETS.filter((s) => allowed.includes(s.name))
  } else {
    sets = [...DEFAULT_PACKAGE_SETS]
  }

  // Append extra packages from env vars
  const extraNode = process.env.SANDBOX_EXTRA_PACKAGES_NODE
  if (extraNode) {
    sets.push({
      name: 'extra-node',
      runtime: 'node',
      packages: extraNode.split(',').map((p) => p.trim()),
      installCommand: 'npm install -g',
      verifyCommand: 'true',
      optional: true,
    })
  }

  const extraPython = process.env.SANDBOX_EXTRA_PACKAGES_PYTHON
  if (extraPython) {
    sets.push({
      name: 'extra-python',
      runtime: 'python',
      packages: extraPython.split(',').map((p) => p.trim()),
      installCommand: 'pip install',
      verifyCommand: 'true',
      optional: true,
    })
  }

  return sets
}

// ---------------------------------------------------------------------------
// Part 2 – provisionBaseImage
// ---------------------------------------------------------------------------

export interface ProvisionResult {
  installedSets: string[]
  failedSets: string[]
  duration: number
}

export async function provisionBaseImage(sandbox: SandboxHandle): Promise<ProvisionResult> {
  const start = Date.now()
  const installedSets: string[] = []
  const failedSets: string[] = []

  const sets = getEnabledSets()

  // Group by runtime so we can order: system → node → python
  const systemSets = sets.filter((s) => s.runtime === 'system')
  const nodeSets = sets.filter((s) => s.runtime === 'node')
  const pythonSets = sets.filter((s) => s.runtime === 'python')

  // Run apt-get update once if there are any system packages
  if (systemSets.length > 0) {
    await sandbox.executeCommand('apt-get update -qq', undefined, 120)
  }

  const ordered = [...systemSets, ...nodeSets, ...pythonSets]

  for (const set of ordered) {
    const cmd = `${set.installCommand} ${set.packages.join(' ')}`
    const result = await sandbox.executeCommand(cmd, undefined, 300)

    if (result.success) {
      installedSets.push(set.name)
    } else {
      if (set.optional) {
        console.warn(`[base-image] Optional set "${set.name}" failed: ${result.output.slice(0, 200)}`)
        failedSets.push(set.name)
      } else {
        console.error(`[base-image] Required set "${set.name}" failed: ${result.output.slice(0, 200)}`)
        failedSets.push(set.name)
      }
    }
  }

  // Clean up apt caches
  if (systemSets.length > 0) {
    await sandbox.executeCommand('apt-get clean && rm -rf /var/lib/apt/lists/*', undefined, 60)
  }

  // Ensure npm/pip globals are accessible for all users
  await sandbox.executeCommand(
    'npm config set prefix /usr/local 2>/dev/null; echo "/usr/local/lib/python3/dist-packages" > /etc/python3-pathfix 2>/dev/null || true',
  )

  return { installedSets, failedSets, duration: Date.now() - start }
}

// ---------------------------------------------------------------------------
// Part 3 – WarmPool
// ---------------------------------------------------------------------------

interface PoolEntry {
  handle: SandboxHandle
  provisionedAt: number
}

export class WarmPool {
  private poolSize: number
  private refillThreshold: number
  private pool: PoolEntry[] = []
  private provisioningCount = 0
  private started = false
  private totalCreated = 0

  constructor(options?: { poolSize?: number; refillThreshold?: number }) {
    this.poolSize = options?.poolSize
      ?? parseInt(process.env.SANDBOX_WARM_POOL_SIZE ?? '2', 10)
    this.refillThreshold = options?.refillThreshold ?? 1
  }

  async acquire(userId: string): Promise<SandboxHandle> {
    // Lazy start: begin filling the pool on first acquire
    if (!this.started) {
      this.started = true
      this.refillPool()
    }

    // Try to take a pre-provisioned sandbox
    const entry = this.pool.shift()
    if (entry) {
      this.totalCreated++
      this.maybeRefill()
      return entry.handle
    }

    // Pool empty — create and provision on demand
    const handle = await this.createAndProvision()
    this.totalCreated++
    this.maybeRefill()
    return handle
  }

  release(_sandboxId: string): void {
    // Sandboxes are not returned to the pool; mark as destroyed.
    // Actual destruction is handled by the caller / SandboxService.
  }

  getStatus(): { available: number; provisioning: number; total: number } {
    return {
      available: this.pool.length,
      provisioning: this.provisioningCount,
      total: this.totalCreated,
    }
  }

  // ---- internal helpers ---------------------------------------------------

  private maybeRefill(): void {
    if (this.pool.length < this.refillThreshold) {
      this.refillPool()
    }
  }

  private refillPool(): void {
    const needed = this.poolSize - this.pool.length - this.provisioningCount
    for (let i = 0; i < needed; i++) {
      this.provisionOne()
    }
  }

  private provisionOne(): void {
    this.provisioningCount++
    this.createAndProvision()
      .then((handle) => {
        this.pool.push({ handle, provisionedAt: Date.now() })
      })
      .catch((err) => {
        console.error('[warm-pool] Failed to provision sandbox:', err)
      })
      .finally(() => {
        this.provisioningCount--
      })
  }

  private async createAndProvision(): Promise<SandboxHandle> {
    const provider = getSandboxProvider()
    const handle = await provider.createSandbox({
      language: 'typescript',
      autoStopInterval: 60,
      resources: { cpu: 2, memory: 4 },
      envVars: { TERM: 'xterm-256color', LANG: 'en_US.UTF-8' },
    })

    await setupCacheVolumes(handle)
    if (process.env.SANDBOX_PRELOAD_PACKAGES !== 'false') {
      await provisionBaseImage(handle)
    }
    return handle
  }
}

export const warmPool = new WarmPool()
