/**
 * OpenCode SDK Direct Integration
 * 
 * Provides direct access to OpenCode server APIs without LLM provider layer.
 * 8-10x faster than going through chat route for file operations.
 * 
 * @module opencode
 * 
 * @example
 * ```typescript
 * import {
 *   createOpencodeFileService,
 *   createOpencodeSessionManager,
 *   createOpencodeEventStream,
 *   createOpencodeCapabilityProvider,
 * } from '@/lib/opencode'
 * 
 * // Initialize services
 * const fileService = createOpencodeFileService()
 * const sessionManager = createOpencodeSessionManager()
 * const eventStream = createOpencodeEventStream()
 * const capabilityProvider = createOpencodeCapabilityProvider()
 * 
 * // Read file directly (50ms vs 500ms via chat)
 * const content = await fileService.readFile('src/index.ts')
 * 
 * // Create session
 * const session = await sessionManager.createSession('Refactor auth')
 * 
 * // Subscribe to events
 * eventStream.subscribe({
 *   onTextChunk: (text) => console.log('Stream:', text),
 *   onToolCall: (tool, args) => console.log('Tool:', tool, args),
 * })
 * 
 * // Execute via capability system
 * const result = await capabilityProvider.execute('file.read', { path: 'src/index.ts' }, context)
 * ```
 */

// File Service
export {
  OpencodeFileService,
  createOpencodeFileService,
  type OpencodeFileServiceConfig,
  type FileSearchResult,
  type TextSearchResult,
  type FileStatus,
} from './opencode-file-service'

// Session Manager
export {
  OpencodeSessionManager,
  createOpencodeSessionManager,
  type OpencodeSessionManagerConfig,
  type Session,
  type Message,
  type PromptOptions,
} from './opencode-session-manager'

// Event Stream
export {
  OpencodeEventStream,
  createOpencodeEventStream,
  type OpencodeEventStreamConfig,
  type OpencodeEvent,
  type OpencodeEventHandler,
  type EventType,
} from './opencode-event-stream'

// Capability Provider (integrates with lib/tools/capabilities.ts)
export {
  OpencodeCapabilityProvider,
  createOpencodeCapabilityProvider,
  type OpencodeCapabilityProviderConfig,
} from './opencode-capability-provider'

// Binary Detection
export {
  findOpencodeBinary,
  findOpencodeBinarySync,
  resetBinaryCacheForTesting,
  type FindBinaryOptions,
} from './find-opencode-binary'
