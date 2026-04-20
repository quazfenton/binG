/**
 * Pi SDK - binG Integration
 * 
 * Modular SDK for embedding Pi coding agent capabilities.
 * 
 * Usage:
 * 
 * ### Web Mode (VFS)
 * ```typescript
 * import { createPiSession, PiInMemorySessionManager } from '@/lib/pi';
 * 
 * const session = await createPiSession({
 *   cwd: '/project',
 *   mode: 'vfs',
 *   runMode: 'remote',
 *   remoteUrl: 'http://localhost:3000',
 * });
 * 
 * session.subscribe((event) => {
 *   if (event.type === 'message_update') {
 *     process.stdout.write(event.assistantMessageEvent.delta);
 *   }
 * });
 * 
 * await session.prompt('List files in the project');
 * ```
 * 
 * ### Desktop Mode (CLI)
 * ```typescript
 * import { createPiSession } from '@/lib/pi';
 * 
 * const session = await createPiSession({
 *   cwd: process.cwd(),
 *   mode: 'local',
 *   runMode: 'cli',
 *   provider: 'anthropic',
 *   modelId: 'claude-sonnet-4-20250514',
 *   thinkingLevel: 'medium',
 * });
 * 
 * session.subscribe((event) => {
 *   if (event.type === 'message_update') {
 *     process.stdout.write(event.assistantMessageEvent.delta);
 *   }
 * });
 * 
 * await session.prompt('What files are here?');
 * session.dispose();
 * ```
 */

// Core exports
export { createPiSession } from './pi-types';
export type {
  PiSession,
  PiConfig,
  PiEvent,
  PiState,
  PiModel,
  PiPromptOptions,
  PiImage,
} from './pi-types';

// Filesystem
export {
  createFilesystemAdapter,
  createAutoFilesystemAdapter,
  VfsFilesystemAdapter,
  LocalFilesystemAdapter,
  McpToolsFilesystemAdapter,
  RemoteFilesystemAdapter,
} from './pi-filesystem';
export type { PiFilesystemAdapter, PiDirEntry } from './pi-types';

// CLI Session  
export { createCliPiSession } from './pi-cli-session';

// Remote Session
export { createRemotePiSession } from './pi-remote-session';

// Tools
export { createPiTools, registerPiTools } from './pi-mcp-tools';