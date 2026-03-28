/**
 * Strip common sandbox/workspace prefixes from a path.
 *
 * This is the single source of truth for prefix stripping. All subsystems
 * (VFS service, preview panel, terminal, OPFS) must use this function
 * instead of duplicating the regex list.
 *
 * Handles prefixes like:
 *   /tmp/workspaces/, /workspace/, /home/<user>/workspace/, /sessions/, project/
 */
export function stripWorkspacePrefixes(rawPath: string): string {
  let path = (rawPath || '')
    .replace(/\\/g, '/')
    .trim();

  // Remove accumulated sandbox / workspace prefixes
  path = path
    .replace(/^(\/tmp\/workspaces\/)+/gi, '')
    .replace(/^(tmp\/workspaces\/)+/gi, '')
    .replace(/^(\/workspace\/)+/gi, '')
    .replace(/^(workspace\/)+/gi, '')
    .replace(/^(\/home\/[^/]+\/workspace\/)+/gi, '')
    .replace(/^(home\/[^/]+\/workspace\/)+/gi, '')
    .replace(/^(\/sessions\/)+/gi, '')
    .replace(/^(sessions\/)+/gi, '');

  // Remove any remaining leading slashes
  path = path.replace(/^\/+/, '');

  return path;
}

export function normalizeScopePath(scopePath?: string): string {
  const path = (scopePath || 'project')
    .replace(/\\/g, '/')
    .trim()
    .replace(/^\/+/, '')
    .replace(/\/+$/, '');

  if (!path || path === 'project') {
    return 'project';
  }

  if (path.startsWith('project/')) {
    return path.replace(/\/{2,}/g, '/').replace(/^(project\/)+/i, 'project/');
  }

  return `project/${path}`.replace(/\/{2,}/g, '/');
}

export function resolveScopedPath(requestedPath: string, scopePath?: string): string {
  const scope = normalizeScopePath(scopePath);
  let raw = (requestedPath || '').replace(/\\/g, '/').trim();
  if (!raw) return scope;

  raw = raw.replace(/^\/+/, '');

  if (raw === scope || raw.startsWith(`${scope}/`)) {
    // Always normalize multiple slashes even for scope-matching paths
    return raw.replace(/\/+/g, '/');
  }

  if (raw.startsWith('project/')) {
    return raw.replace(/\/{2,}/g, '/');
  }

  return `${scope}/${raw}`.replace(/\/{2,}/g, '/');
}

export function extractSessionIdFromPath(scopePath?: string): string | null {
  const normalizedPath = normalizeScopePath(scopePath);
  const match = normalizedPath.match(/^project\/sessions\/([^/]+)/i);
  return match?.[1] || null;
}
