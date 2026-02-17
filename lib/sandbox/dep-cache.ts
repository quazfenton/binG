import { createHash } from 'crypto'
import type { SandboxHandle } from './providers/sandbox-provider'

const CACHE_DIR = '/opt/cache'
const NPM_CACHE = `${CACHE_DIR}/npm`
const PIP_CACHE = `${CACHE_DIR}/pip`
const PNPM_STORE = `${CACHE_DIR}/pnpm-store`

interface CacheEntry {
  hash: string
  timestamp: number
}

const lockfileHashes = new Map<string, CacheEntry>()

const LOCKFILE_MAP: Record<string, { manager: string; installCmd: string; cacheFlag: string }> = {
  'package-lock.json': {
    manager: 'npm',
    installCmd: 'npm install',
    cacheFlag: `--prefer-offline --no-audit --cache ${NPM_CACHE}`,
  },
  'pnpm-lock.yaml': {
    manager: 'pnpm',
    installCmd: 'pnpm install',
    cacheFlag: `--store-dir=${PNPM_STORE}`,
  },
  'yarn.lock': {
    manager: 'yarn',
    installCmd: 'yarn install',
    cacheFlag: '--prefer-offline',
  },
  'requirements.txt': {
    manager: 'pip',
    installCmd: 'pip install -r requirements.txt',
    cacheFlag: `--cache-dir=${PIP_CACHE}`,
  },
  'poetry.lock': {
    manager: 'poetry',
    installCmd: 'poetry install',
    cacheFlag: '',
  },
}

export function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

export async function detectAndInstallDeps(
  sandbox: SandboxHandle,
  workspaceDir: string,
): Promise<{ installed: boolean; manager?: string; cached: boolean }> {
  for (const [lockfile, config] of Object.entries(LOCKFILE_MAP)) {
    const result = await sandbox.executeCommand(`cat ${workspaceDir}/${lockfile}`)
    if (!result.success) continue

    const currentHash = hashContent(result.output)
    const cacheKey = `${sandbox.id}:${lockfile}`
    const cached = lockfileHashes.get(cacheKey)

    if (cached && cached.hash === currentHash) {
      return { installed: false, manager: config.manager, cached: true }
    }

    const cmd = config.cacheFlag
      ? `${config.installCmd} ${config.cacheFlag}`
      : config.installCmd

    await sandbox.executeCommand(cmd, workspaceDir)

    lockfileHashes.set(cacheKey, { hash: currentHash, timestamp: Date.now() })

    return { installed: true, manager: config.manager, cached: false }
  }

  return { installed: false, cached: false }
}

export async function setupCacheVolumes(sandbox: SandboxHandle): Promise<void> {
  await sandbox.executeCommand(
    `mkdir -p ${NPM_CACHE} ${PIP_CACHE} ${PNPM_STORE}`,
  )

  await sandbox.executeCommand(`npm config set cache ${NPM_CACHE}`)
}

export function getOptimizedInstallCommand(
  manager: string,
  args?: string,
): string {
  switch (manager) {
    case 'npm':
      return `npm install ${args ?? ''} --prefer-offline --no-audit --cache ${NPM_CACHE}`
    case 'pnpm':
      return `pnpm install ${args ?? ''} --store-dir=${PNPM_STORE}`
    case 'pip':
      return `pip install ${args ?? ''} --cache-dir=${PIP_CACHE}`
    default:
      return `${manager} install ${args ?? ''}`
  }
}
