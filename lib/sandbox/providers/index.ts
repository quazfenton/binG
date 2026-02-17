import type { SandboxProvider } from './sandbox-provider'
import { DaytonaProvider } from './daytona-provider'

export type SandboxProviderType = 'daytona' | 'runloop' | 'microsandbox'

let cachedProvider: SandboxProvider | null = null

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
    default:
      throw new Error(`Unknown sandbox provider: ${providerType}`)
  }

  return cachedProvider
}

export { type SandboxProvider, type SandboxHandle, type PtyHandle } from './sandbox-provider'
