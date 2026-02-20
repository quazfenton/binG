import type { SandboxProvider } from './sandbox-provider'
import { DaytonaProvider } from './daytona-provider'

export type SandboxProviderType = 'daytona' | 'runloop' | 'microsandbox' | 'e2b'

let cachedProvider: SandboxProvider | null = null
let cachedE2BProvider: any = null
let cachedE2BDesktopProvider: any = null

export function getSandboxProvider(type?: SandboxProviderType): SandboxProvider {
  const providerType = type ?? (process.env.SANDBOX_PROVIDER as SandboxProviderType) ?? 'daytona'

  if (cachedProvider && cachedProvider.name === providerType) {
    return cachedProvider
  }

  switch (providerType) {
    case 'daytona':
      cachedProvider = new DaytonaProvider()
      break
    case 'runloop': {
      const { RunloopProvider } = require('./runloop-provider')
      cachedProvider = new RunloopProvider()
      break
    }
    case 'microsandbox': {
      const { MicrosandboxProvider } = require('./microsandbox-provider')
      cachedProvider = new MicrosandboxProvider()
      break
    }
    case 'e2b':
      // Lazy load E2B provider with error handling
      try {
        const { E2BProvider } = require('./e2b-provider')
        cachedProvider = new E2BProvider()
      } catch (error: any) {
        console.error('[SandboxProvider] Failed to load E2B provider:', error.message)
        throw new Error(`E2B provider not available: ${error.message}`)
      }
      break
    default:
      throw new Error(`Unknown sandbox provider: ${providerType}`)
  }

  return cachedProvider
}

/**
 * Get E2B provider (lazy loaded)
 */
export function getE2BProvider(): any {
  if (cachedE2BProvider) return cachedE2BProvider
  
  try {
    const { e2bProvider } = require('./e2b-provider')
    cachedE2BProvider = e2bProvider
    return cachedE2BProvider
  } catch (error: any) {
    console.error('[SandboxProvider] Failed to load E2B provider:', error.message)
    return null
  }
}

/**
 * Get E2B Desktop provider (lazy loaded)
 */
export function getE2BDesktopProvider(): any {
  if (cachedE2BDesktopProvider) return cachedE2BDesktopProvider
  
  try {
    const { e2bDesktopProvider } = require('./e2b-desktop-provider')
    cachedE2BDesktopProvider = e2bDesktopProvider
    return cachedE2BDesktopProvider
  } catch (error: any) {
    console.error('[SandboxProvider] Failed to load E2B Desktop provider:', error.message)
    return null
  }
}

export { type SandboxProvider, type SandboxHandle, type PtyHandle } from './sandbox-provider'

// Re-export with lazy loading wrappers
export function getProviderExports() {
  return {
    get e2bProvider() { return getE2BProvider() },
    get e2bDesktopProvider() { return getE2BDesktopProvider() },
  }
}

// Desktop/Computer Use exports (lazy loaded)
export async function getComputerUseTools() {
  try {
    const { computerUseTools } = await import('./computer-use-tools')
    return computerUseTools
  } catch (error: any) {
    console.error('[SandboxProvider] Failed to load computer use tools:', error.message)
    return []
  }
}

export async function getToolCallToAction() {
  try {
    const { toolCallToAction } = await import('./computer-use-tools')
    return toolCallToAction
  } catch (error: any) {
    console.error('[SandboxProvider] Failed to load toolCallToAction:', error.message)
    return null
  }
}

export async function getComputerUseSystemPrompt() {
  try {
    const { getComputerUseSystemPrompt } = await import('./computer-use-tools')
    return getComputerUseSystemPrompt
  } catch (error: any) {
    console.error('[SandboxProvider] Failed to load getComputerUseSystemPrompt:', error.message)
    return () => ''
  }
}

