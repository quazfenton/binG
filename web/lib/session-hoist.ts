/**
 * Session Folder Hoisting
 *
 * ⚠️  SERVER-ONLY — do not import from client components.
 * This module dynamically imports virtual-filesystem-service which pulls in
 * Node.js built-ins (node:path, node:events, etc.) that break client webpack.
 *
 * Server-only module — extracted from session-naming.ts to prevent Node.js
 * built-in modules (node:path, node:events, node:crypto, etc.) from being
 * pulled into the client-side webpack bundle through the dynamic import chain:
 *
 *   conversation-interface.tsx → session-naming.ts → (dynamic import)
 *     virtual-filesystem-service → node:* builtins
 *
 * Only `hoistSessionFolder` needs VFS access; the other session-naming exports
 * are pure and safe for client use.
 *
 * @module session-hoist
 */

import { sessionNameExists, registerSessionName, unregisterSessionName } from './session-naming';

const logger = {
  info: (msg: string) => console.info(`[SessionHoist] ${msg}`),
  warn: (msg: string, err?: unknown) => console.warn(`[SessionHoist] ${msg}`, err),
};

/**
 * Post-write session folder hoisting.
 *
 * After the LLM writes its first batch of files, check if all files are
 * inside a single top-level subfolder within the session root. If so,
 * "hoist" that subfolder to become the session root by renaming the session.
 *
 * Example: Session "001" contains only "001/my-app/src/..." and "001/my-app/package.json"
 * → Rename session from "001" to "my-app" and move files up one level.
 *
 * This prevents unnecessary nesting like project/sessions/001/my-app/...
 * when the LLM created a single project folder.
 *
 * @param userId - The VFS user/owner ID
 * @param sessionId - The current session ID (e.g. "001")
 * @returns The new session ID if hoisted, or the original if not
 */
export async function hoistSessionFolder(
  userId: string,
  sessionId: string,
): Promise<string> {
  try {
    const basePath = `project/sessions/${sessionId}`;

    // Dynamically import VFS to keep this module tree out of client bundles
    const { virtualFilesystem } = await import('@/lib/virtual-filesystem/virtual-filesystem-service');

    // List top-level contents of the session folder
    const listing = await virtualFilesystem.listDirectory(userId, basePath);
    const nodes = listing.nodes || [];

    // Only hoist if there's exactly 1 directory and 0 files at the top level
    const dirs = nodes.filter((n: any) => n.type === 'directory');
    const files = nodes.filter((n: any) => n.type === 'file');

    if (dirs.length !== 1 || files.length !== 0) {
      return sessionId; // Multiple dirs or files at root — don't hoist
    }

    const singleDir = dirs[0];
    const folderName = singleDir.name;

    // Don't hoist if the folder name is generic/numeric (already a session name)
    if (/^\d{3}$/.test(folderName) || folderName === '.keep') {
      return sessionId;
    }

    // Don't hoist if the session is already named (not a numeric default)
    if (!/^\d{3}$/.test(sessionId)) {
      return sessionId; // Already has a custom name
    }

    // Check if target name already exists
    const targetExists = await sessionNameExists(folderName);
    if (targetExists) {
      logger.info(`Hoist skipped: target name "${folderName}" already exists`);
      return sessionId;
    }

    // Hoist: read all files from the subfolder and rewrite them one level up
    const subPath = `${basePath}/${folderName}`;
    const workspace = await virtualFilesystem.exportWorkspace(userId);
    const filesToMove = workspace.files.filter((f: any) =>
      f.path.startsWith(`${subPath}/`)
    );

    if (filesToMove.length === 0) {
      return sessionId; // Empty folder — don't hoist
    }

    // Create new session folder with the LLM's chosen name
    const newBasePath = `project/sessions/${folderName}`;
    const writeFailures: string[] = [];
    for (const file of filesToMove) {
      const relativePath = file.path.slice(subPath.length + 1);
      const newPath = `${newBasePath}/${relativePath}`;
      try {
        await virtualFilesystem.writeFile(userId, newPath, file.content, file.language);
      } catch (err: any) {
        logger.warn(`Hoist: failed to write ${file.path} → ${newPath}: ${err.message}`);
        writeFailures.push(file.path);
      }
    }

    // Only clean up old files if all writes succeeded
    if (writeFailures.length > 0) {
      logger.warn(`Hoist aborted: ${writeFailures.length} files failed to write. Skipping cleanup.`);
      return sessionId;
    }

    // Clean up old session folder (delete all files)
    for (const file of filesToMove) {
      try {
        await virtualFilesystem.deletePath(userId, file.path);
      } catch { /* best effort cleanup */ }
    }

    // Register the new name and unregister the old
    registerSessionName(folderName);
    unregisterSessionName(sessionId);

    logger.info(`Session hoisted: ${sessionId} → ${folderName} (${filesToMove.length} files moved)`);
    return folderName;
  } catch (error: any) {
    logger.warn(`Session hoist failed: ${error.message}`);
    return sessionId; // Fall back to original
  }
}
