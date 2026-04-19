import { chatLogger } from '@/lib/chat/chat-logger';
import {
  parseFilesystemResponse,
  stripHeredocMarkers,
  type ParsedFilesystemResponse,
  isValidFilePath,
} from '@/lib/chat/file-edit-parser';
import { applyUnifiedDiffToContent } from '@/lib/chat/file-diff-utils';
import { virtualFilesystem } from '@/lib/virtual-filesystem/virtual-filesystem-service';
import { filesystemEditSessionService } from '@/lib/virtual-filesystem/filesystem-edit-session-service';
import { ShadowCommitManager } from '@/lib/orchestra/stateful-agent/commit/shadow-commit';
import { extractSessionIdFromPath, resolveScopedPath as resolveScopeUtil } from '@/lib/virtual-filesystem/scope-utils';
import { emitFilesystemUpdated } from '@/lib/virtual-filesystem/sync/sync-events';
import { extractScopePath } from '@/lib/virtual-filesystem/scope-utils';
import { applySearchReplace } from './chat-helpers';

const PATH_CONTROL_CHARS_RE = /[\r\n\t\0]/;
const PATH_HEREDOC_RE = /(<<<|>>>|===)/;
const PATH_UNSAFE_CHARS_RE = /[<>"'`]/;
const PATH_BAD_START_RE = /^[^\w./]/;
const PATH_TOO_MANY_DOTS_RE = /^\.{3,}/;
const PATH_TRAVERSAL_RE = /(?:^|\/)\.\.(?:\/|$)/;
const PATH_COMMAND_RE = /\b(?:WRITE|PATCH|APPLY_DIFF|DELETE)\b/i;
const PATH_LOOKS_LIKE_CODE_RE = /^(?:hover:|@|:|v-|:bind|@click|@submit)/i;
const PATH_HAS_COLON_RE = /:/;
const PATH_CSS_VALUE_RE = /[\/\\](?:\d*\.\d+|\d+[a-z%]+)$/i;
const PATH_SCSS_VAR_RE = /[\/\\]\$/;

interface FilesystemEditSummary {
  path: string;
  operation: 'write' | 'patch' | 'delete';
  version: number;
  previousVersion: number | null;
  existedBefore: boolean;
  content?: string;
  diff?: string;
  commitId?: string;
  commitMessage?: string;
  message?: string;
}

export interface FilesystemEditResult {
  transactionId: string | null;
  status: 'auto_applied' | 'accepted' | 'denied' | 'reverted_with_conflicts' | 'none';
  applied: FilesystemEditSummary[];
  errors: string[];
  requestedFiles: Array<{ path: string; content: string; language: string; version: number }>;
  scopePath?: string;
  workspaceVersion?: number;
  commitId?: string;
  sessionId?: string;
}

function validateExtractedPath(raw: string, isFolder: boolean = false): string | null {
  const path = (raw || '').trim().replace(/^['"`]|['"`]$/g, '');
  if (!path || path.length > 300) return null;
  if (PATH_CONTROL_CHARS_RE.test(path)) return null;
  if (PATH_HEREDOC_RE.test(path)) return null;
  if (PATH_UNSAFE_CHARS_RE.test(path)) return null;
  if (PATH_BAD_START_RE.test(path)) return null;
  if (PATH_TOO_MANY_DOTS_RE.test(path)) return null;
  if (PATH_TRAVERSAL_RE.test(path)) return null;
  if (PATH_COMMAND_RE.test(path)) return null;
  if (PATH_LOOKS_LIKE_CODE_RE.test(path)) return null;
  if (PATH_HAS_COLON_RE.test(path)) return null;
  if (PATH_CSS_VALUE_RE.test(path)) return null;
  if (PATH_SCSS_VAR_RE.test(path)) return null;
  if (!/^[a-zA-Z0-9._\-\[\]]+(?:\/[a-zA-Z0-9._\-\[\]]+)*\/?$/.test(path)) return null;
  if (!isValidFilePath(path, isFolder)) return null;
  return path;
}

function extractFolderCreateTags(content: string): string[] {
  const folders: string[] = [];
  if (!content.includes('folder_create')) return folders;

  const folderCreateRegex = /<folder_create\s+path\s*=\s*["']([^"']+)["']\s*\/?>/gi;
  let folderCreateMatch: RegExpExecArray | null;
  while ((folderCreateMatch = folderCreateRegex.exec(content)) !== null) {
    const rawPath = folderCreateMatch[1]?.trim();
    if (!rawPath) continue;
    const validPath = validateExtractedPath(rawPath);
    if (validPath) folders.push(validPath);
  }

  return folders;
}

function resolveScopedPath(input: {
  requestedPath: string;
  scopePath: string;
  attachedPaths: string[];
  lastUserMessage: string;
}): string {
  const rawPath = (input.requestedPath || '').trim().replace(/^\/+/, '');
  if (!rawPath) {
    return resolveScopeUtil('', input.scopePath);
  }

  const attachedSet = new Set((input.attachedPaths || []).map((path) => path.replace(/^\/+/, '')));
  if (attachedSet.has(rawPath)) {
    return resolveScopeUtil(rawPath, input.scopePath);
  }

  const escapedPath = rawPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (new RegExp(`\\b${escapedPath}\\b`, 'i').test(input.lastUserMessage || '')) {
    return resolveScopeUtil(rawPath, input.scopePath);
  }

  const baseName = rawPath.split('/').pop() || rawPath;
  const escapedBaseName = baseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (new RegExp(`\\b${escapedBaseName}\\b`, 'i').test(input.lastUserMessage || '')) {
    return resolveScopeUtil(rawPath, input.scopePath);
  }

  if (rawPath.startsWith(`${input.scopePath}/`) || rawPath === input.scopePath) {
    return resolveScopeUtil(rawPath, input.scopePath);
  }

  const normalizedRelative = rawPath.startsWith('project/')
    ? rawPath.slice('project/'.length)
    : rawPath;

  return resolveScopeUtil(normalizedRelative, input.scopePath);
}

export async function applyFilesystemEditsFromResponse(input: {
  ownerId: string;
  conversationId: string;
  requestId: string;
  scopePath: string;
  lastUserMessage: string;
  attachedPaths: string[];
  responseContent: string;
  commands?: {
    request_files?: string[];
    write_diffs?: Array<{ path: string; diff: string }>;
  };
  forceExtract?: boolean;
  preParsedEdits?: ParsedFilesystemResponse;
}): Promise<FilesystemEditResult> {
  const parsedResponse = input.preParsedEdits
    ? input.preParsedEdits
    : parseFilesystemResponse(input.responseContent || '', input.forceExtract ?? false);
  const folderCreateOps = extractFolderCreateTags(input.responseContent || '');

  chatLogger.info('[PARSER] applyFilesystemEditsFromResponse — parse results', {
    writesFound: parsedResponse.writes.length,
    diffsFound: parsedResponse.diffs.length,
    applyDiffsFound: parsedResponse.applyDiffs.length,
    deletesFound: parsedResponse.deletes.length,
    foldersFound: parsedResponse.folders.length,
    forceExtract: input.forceExtract,
    responseContentLength: input.responseContent?.length || 0,
    responsePreview: (input.responseContent || '').slice(0, 200),
  });

  function extractBashFileWrites(content: string): Array<{ path: string; content: string }> {
    const writes: Array<{ path: string; content: string }> = [];
    const echoPattern = /```(?:bash|sh|shell)?\s*\n([\s\S]*?echo\s+["']([^"']*)["']\s*>\s*([^\s\n]+)[\s\S]*?)```/gi;
    const catPattern = /```(?:bash|sh|shell)?\s*\n[\s\S]*?cat\s*>\s*([^\s\n]+)\s*<<\s*['"]?(\w+)['"]?\s*\n([\s\S]*?)\n\s*\2/gi;
    const printfPattern = /```(?:bash|sh|shell)?\s*\n[\s\S]*?printf\s+["']([^"']*)["']\s*>\s*([^\s\n]+)[\s\S]*?```/gi;

    let match: RegExpExecArray | null;
    while ((match = echoPattern.exec(content)) !== null) {
      const validPath = validateExtractedPath(match[3].trim());
      if (validPath) writes.push({ path: validPath, content: match[2] });
    }
    while ((match = catPattern.exec(content)) !== null) {
      const validPath = validateExtractedPath(match[1].trim());
      if (validPath) writes.push({ path: validPath, content: match[3].trim() });
    }
    while ((match = printfPattern.exec(content)) !== null) {
      const validPath = validateExtractedPath(match[2].trim());
      if (validPath) writes.push({ path: validPath, content: match[1] });
    }

    return writes;
  }

  const invalidPathErrors: string[] = [];
  const bashWrites = extractBashFileWrites(input.responseContent || '');

  const combinedWriteEdits = [
    ...parsedResponse.writes.map((edit) => ({ path: edit.path, content: edit.content })),
    ...bashWrites,
  ]
    .map((edit) => ({
      ...edit,
      content: stripHeredocMarkers(edit.content),
    }))
    .filter((edit) => {
      const validPath = validateExtractedPath(edit.path);
      if (!validPath) {
        invalidPathErrors.push(`Invalid path: ${edit.path.substring(0, 100)}`);
        return false;
      }
      edit.path = validPath;
      return true;
    });

  const combinedDiffOperations = [
    ...parsedResponse.diffs,
    ...(input.commands?.write_diffs || []),
  ].filter((op) => {
    const validPath = validateExtractedPath(op.path);
    if (!validPath) {
      invalidPathErrors.push(`Invalid diff path: ${op.path.substring(0, 100)}`);
      return false;
    }
    op.path = validPath;
    return true;
  });

  const applyDiffOperations = parsedResponse.applyDiffs.filter((op) => {
    const validPath = validateExtractedPath(op.path);
    if (!validPath) {
      invalidPathErrors.push(`Invalid apply_diff path: ${op.path.substring(0, 100)}`);
      return false;
    }
    op.path = validPath;
    return true;
  });

  const deleteTargets = parsedResponse.deletes
    .map((p) => {
      const validPath = validateExtractedPath(p);
      if (!validPath) {
        invalidPathErrors.push(`Invalid delete path: ${p.substring(0, 100)}`);
        return null;
      }
      return validPath;
    })
    .filter((p): p is string => !!p);

  const validatedParsedFolders = parsedResponse.folders
    .map((folderPath) => {
      const validPath = validateExtractedPath(folderPath, true);
      if (!validPath) {
        invalidPathErrors.push(`Invalid folder path: ${folderPath.substring(0, 100)}`);
        return null;
      }
      return validPath;
    })
    .filter((p): p is string => !!p);

  const folderCreateTargets = [...new Set([...validatedParsedFolders, ...folderCreateOps])];
  const requestFiles = (input.commands?.request_files || [])
    .map((requestedPath) => {
      const validPath = validateExtractedPath(requestedPath);
      if (!validPath) {
        invalidPathErrors.push(`Invalid requested read path: ${requestedPath.substring(0, 100)}`);
        return null;
      }
      return validPath;
    })
    .filter((p): p is string => !!p);

  const totalRequestedPaths =
    parsedResponse.writes.length +
    parsedResponse.diffs.length +
    parsedResponse.applyDiffs.length +
    parsedResponse.deletes.length;
  const totalValidPaths =
    combinedWriteEdits.length +
    combinedDiffOperations.length +
    applyDiffOperations.length +
    deleteTargets.length;

  if (totalRequestedPaths > 0 && totalValidPaths === 0 && invalidPathErrors.length > 0) {
    return {
      transactionId: null,
      status: 'none',
      applied: [],
      errors: invalidPathErrors,
      requestedFiles: [],
      scopePath: input.scopePath,
      sessionId: extractSessionIdFromPath(input.scopePath) || input.conversationId,
    };
  }

  const hasMutatingOperations =
    combinedWriteEdits.length > 0 ||
    combinedDiffOperations.length > 0 ||
    applyDiffOperations.length > 0 ||
    deleteTargets.length > 0 ||
    folderCreateTargets.length > 0;

  const transaction = hasMutatingOperations
    ? filesystemEditSessionService.createTransaction({
        ownerId: input.ownerId,
        conversationId: input.conversationId,
        requestId: input.requestId,
      })
    : null;

  const result: FilesystemEditResult = {
    transactionId: transaction ? transaction.id : null,
    status: hasMutatingOperations ? 'auto_applied' : 'none',
    applied: [],
    errors: [],
    requestedFiles: [],
    scopePath: input.scopePath,
    sessionId: extractSessionIdFromPath(input.scopePath) || input.conversationId,
  };

  if (transaction) {
    const seenWriteEdits = new Set<string>();
    for (const edit of combinedWriteEdits) {
      const targetPath = resolveScopedPath({
        requestedPath: edit.path,
        scopePath: input.scopePath,
        attachedPaths: input.attachedPaths,
        lastUserMessage: input.lastUserMessage,
      });
      const writeKey = `${targetPath}::${edit.content}`;
      if (seenWriteEdits.has(writeKey)) continue;
      seenWriteEdits.add(writeKey);

      try {
        let previousVersion: number | null = null;
        let previousContent: string | null = null;
        let existedBefore = false;
        try {
          const previousFile = await virtualFilesystem.readFile(input.ownerId, targetPath);
          previousVersion = previousFile.version;
          previousContent = previousFile.content;
          existedBefore = true;
        } catch {}

        const file = await virtualFilesystem.writeFile(input.ownerId, targetPath, edit.content);
        result.applied.push({
          path: file.path,
          operation: 'write',
          version: file.version,
          previousVersion,
          existedBefore,
          content: edit.content,
        });
        filesystemEditSessionService.recordOperation(transaction.id, {
          path: file.path,
          operation: 'write',
          newVersion: file.version,
          previousVersion,
          previousContent,
          existedBefore,
        });
        emitFilesystemUpdated({
          path: file.path,
          paths: [file.path],
          scopePath: extractScopePath(file.path),
          type: existedBefore ? 'update' : 'create',
          sessionId: input.conversationId,
        });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'unknown error';
        const err = `Failed to write ${targetPath}: ${message}`;
        result.errors.push(err);
        filesystemEditSessionService.addError(transaction.id, err);
      }
    }

    const seenDiffKey = new Set<string>();
    for (const diffOperation of combinedDiffOperations) {
      const targetPath = resolveScopedPath({
        requestedPath: diffOperation.path,
        scopePath: input.scopePath,
        attachedPaths: input.attachedPaths,
        lastUserMessage: input.lastUserMessage,
      });
      const diffKey = `${targetPath}::${diffOperation.diff}`;
      if (seenDiffKey.has(diffKey)) continue;
      seenDiffKey.add(diffKey);

      try {
        let currentContent = '';
        let previousVersion: number | null = null;
        let previousContent: string | null = null;
        let existedBefore = false;
        try {
          const existingFile = await virtualFilesystem.readFile(input.ownerId, targetPath);
          currentContent = existingFile.content;
          previousVersion = existingFile.version;
          previousContent = existingFile.content;
          existedBefore = true;
        } catch {}

        const patchedContent = applyUnifiedDiffToContent(currentContent, targetPath, diffOperation.diff);
        if (patchedContent === null) {
          result.errors.push(`Failed to apply unified diff for ${targetPath}: patch could not be applied`);
          continue;
        }

        const file = await virtualFilesystem.writeFile(input.ownerId, targetPath, patchedContent);
        result.applied.push({
          path: file.path,
          operation: 'patch',
          version: file.version,
          previousVersion,
          existedBefore,
          diff: diffOperation.diff,
          content: patchedContent,
        });
        filesystemEditSessionService.recordOperation(transaction.id, {
          path: file.path,
          operation: 'patch',
          newVersion: file.version,
          previousVersion,
          previousContent,
          existedBefore,
        });

        if (existedBefore) {
          emitFilesystemUpdated({
            path: file.path,
            paths: [file.path],
            scopePath: extractScopePath(file.path),
            type: 'update',
            sessionId: input.conversationId,
          });
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'unknown error';
        const err = `Failed to apply diff for ${targetPath}: ${message}`;
        result.errors.push(err);
        filesystemEditSessionService.addError(transaction.id, err);
      }
    }

    const seenApplyDiffKey = new Set<string>();
    for (const diffOp of applyDiffOperations) {
      const targetPath = resolveScopedPath({
        requestedPath: diffOp.path,
        scopePath: input.scopePath,
        attachedPaths: input.attachedPaths,
        lastUserMessage: input.lastUserMessage,
      });
      const diffKey = `${targetPath}::${diffOp.search}::${diffOp.replace}`;
      if (seenApplyDiffKey.has(diffKey)) continue;
      seenApplyDiffKey.add(diffKey);

      try {
        let currentContent = '';
        let previousVersion: number | null = null;
        let previousContent: string | null = null;
        let existedBefore = false;
        try {
          const existingFile = await virtualFilesystem.readFile(input.ownerId, targetPath);
          currentContent = existingFile.content;
          previousVersion = existingFile.version;
          previousContent = existingFile.content;
          existedBefore = true;
        } catch {}

        if (!existedBefore) {
          const file = await virtualFilesystem.writeFile(input.ownerId, targetPath, diffOp.replace);
          result.applied.push({
            path: file.path,
            operation: 'write',
            version: file.version,
            previousVersion: null,
            existedBefore: false,
            content: diffOp.replace,
          });
          filesystemEditSessionService.recordOperation(transaction.id, {
            path: file.path,
            operation: 'write',
            newVersion: file.version,
            previousVersion: null,
            previousContent: null,
            existedBefore: false,
          });
          emitFilesystemUpdated({
            path: file.path,
            paths: [file.path],
            scopePath: extractScopePath(file.path),
            type: 'create',
            sessionId: input.conversationId,
          });
          continue;
        }

        if (!currentContent.includes(diffOp.search)) {
          result.errors.push(`APPLY_DIFF failed for ${targetPath}: search block not found in file.`);
          continue;
        }

        const updatedContent = applySearchReplace(currentContent, diffOp.search, diffOp.replace);
        const file = await virtualFilesystem.writeFile(input.ownerId, targetPath, updatedContent);
        result.applied.push({
          path: file.path,
          operation: 'patch',
          version: file.version,
          previousVersion,
          existedBefore,
          content: updatedContent,
          diff: `<<<\n${diffOp.search}\n===\n${diffOp.replace}\n>>>`,
        });
        filesystemEditSessionService.recordOperation(transaction.id, {
          path: file.path,
          operation: 'patch',
          newVersion: file.version,
          previousVersion,
          previousContent,
          existedBefore,
        });
        emitFilesystemUpdated({
          path: file.path,
          paths: [file.path],
          scopePath: extractScopePath(file.path),
          type: 'update',
          sessionId: input.conversationId,
        });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'unknown error';
        const err = `Failed to apply_diff for ${targetPath}: ${message}`;
        result.errors.push(err);
        filesystemEditSessionService.addError(transaction.id, err);
      }
    }

    const seenDeleteTargets = new Set<string>();
    for (const deletePath of deleteTargets) {
      const normalizedPath = resolveScopedPath({
        requestedPath: deletePath.trim(),
        scopePath: input.scopePath,
        attachedPaths: input.attachedPaths,
        lastUserMessage: input.lastUserMessage,
      });
      if (!normalizedPath || seenDeleteTargets.has(normalizedPath)) continue;
      seenDeleteTargets.add(normalizedPath);

      try {
        let existingVersion: number | null = null;
        let existingContent: string | null = null;
        let existedBefore = false;
        try {
          const existingFile = await virtualFilesystem.readFile(input.ownerId, normalizedPath);
          existingVersion = existingFile.version;
          existingContent = existingFile.content;
          existedBefore = true;
        } catch {}

        if (!existedBefore) continue;

        await virtualFilesystem.deletePath(input.ownerId, normalizedPath);
        result.applied.push({
          path: normalizedPath,
          operation: 'delete',
          version: -1,
          previousVersion: existingVersion,
          existedBefore: true,
        });
        filesystemEditSessionService.recordOperation(transaction.id, {
          path: normalizedPath,
          operation: 'delete',
          newVersion: -1,
          previousVersion: existingVersion,
          previousContent: existingContent,
          existedBefore: true,
        });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'unknown error';
        const err = `Failed to delete ${normalizedPath}: ${message}`;
        result.errors.push(err);
        filesystemEditSessionService.addError(transaction.id, err);
      }
    }

    const seenFolderCreates = new Set<string>();
    for (const folderPath of folderCreateTargets) {
      const normalizedPath = resolveScopedPath({
        requestedPath: folderPath.trim(),
        scopePath: input.scopePath,
        attachedPaths: input.attachedPaths,
        lastUserMessage: input.lastUserMessage,
      });
      if (!normalizedPath || seenFolderCreates.has(normalizedPath)) continue;
      seenFolderCreates.add(normalizedPath);

      try {
        let existedBefore = false;
        try {
          const listing = await virtualFilesystem.listDirectory(input.ownerId, normalizedPath);
          existedBefore = listing.nodes.length > 0;
        } catch {}

        const gitkeepPath = `${normalizedPath}/.gitkeep`;
        try {
          await virtualFilesystem.readFile(input.ownerId, gitkeepPath);
          existedBefore = true;
        } catch {
          await virtualFilesystem.writeFile(input.ownerId, gitkeepPath, '');
        }

        result.applied.push({
          path: normalizedPath,
          operation: 'write',
          version: 1,
          previousVersion: null,
          existedBefore,
        });
        filesystemEditSessionService.recordOperation(transaction.id, {
          path: normalizedPath,
          operation: 'write',
          newVersion: 1,
          previousVersion: null,
          previousContent: null,
          existedBefore,
        });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'unknown error';
        const err = `Failed to create folder ${normalizedPath}: ${message}`;
        result.errors.push(err);
        filesystemEditSessionService.addError(transaction.id, err);
      }
    }

    if (result.applied.length === 0 && result.errors.length === 0) {
      result.status = 'none';
    }

    if (result.applied.length > 0) {
      try {
        const commitManager = new ShadowCommitManager();
        const editTx = transaction ? filesystemEditSessionService.getTransactionSync(transaction.id) : null;
        const recordedOps = editTx?.operations || [];
        const transactions = result.applied.map((op) => {
          const recorded = recordedOps.find((r: any) => r.path === op.path);
          return {
            path: op.path,
            type: (op.operation === 'delete' ? 'DELETE' : op.existedBefore ? 'UPDATE' : 'CREATE') as 'UPDATE' | 'CREATE' | 'DELETE',
            timestamp: Date.now(),
            originalContent: recorded?.previousContent ?? undefined,
            newContent: undefined as string | undefined,
          };
        });

        const vfs: Record<string, string> = {};
        const desktopMode = process.env.DESKTOP_MODE === 'true' || process.env.DESKTOP_LOCAL_EXECUTION === 'true';
        if (!desktopMode) {
          for (const op of result.applied) {
            if (op.operation !== 'delete') {
              try {
                const file = await virtualFilesystem.readFile(input.ownerId, op.path);
                vfs[op.path] = file.content;
                const txn = transactions.find((t) => t.path === op.path);
                if (txn) txn.newContent = file.content;
              } catch {}
            }
          }
        }

        const filesSummary = result.applied.map((op) => `${op.operation} ${op.path}`).join(', ');
        const workspaceVersion = await virtualFilesystem.getWorkspaceVersion(input.ownerId);
        result.workspaceVersion = workspaceVersion;

        const commitResult = await commitManager.commit(vfs, transactions, {
          sessionId: result.sessionId || input.conversationId,
          message: `Auto-commit: ${filesSummary}`,
          author: input.ownerId,
          source: 'chat',
          integration: 'chat',
          workspaceVersion,
        });

        if (commitResult.success) {
          result.commitId = commitResult.commitId;
        }
      } catch (commitError) {
        console.error('[Chat] Auto-commit failed:', commitError);
      }
    }
  }

  const seenRequested = new Set<string>();
  for (const requestedFile of requestFiles) {
    const requestedPath = resolveScopedPath({
      requestedPath: requestedFile,
      scopePath: input.scopePath,
      attachedPaths: input.attachedPaths,
      lastUserMessage: input.lastUserMessage,
    });
    if (seenRequested.has(requestedPath)) continue;
    seenRequested.add(requestedPath);

    try {
      const file = await virtualFilesystem.readFile(input.ownerId, requestedPath);
      result.requestedFiles.push({
        path: file.path,
        content: file.content,
        language: file.language,
        version: file.version,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'unknown error';
      result.errors.push(`Requested read failed for ${requestedPath}: ${message}`);
    }
  }

  chatLogger.info('applyFilesystemEditsFromResponse — final result', {
    applied: result.applied.length,
    appliedPaths: result.applied.map((a) => a.path),
    errors: result.errors.length,
    errorMessages: result.errors.slice(0, 3),
    status: result.status,
  });

  return result;
}
