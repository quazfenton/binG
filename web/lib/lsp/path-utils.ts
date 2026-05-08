export function uriToPath(uri: string): string {
  let p = uri.replace(/^file:\/\/\/?/, '');
  if (process.platform === 'win32') {
    p = p.replace(/\//g, '\\');
    if (/^[a-zA-Z]:/.test(p)) {
      p = p.charAt(0).toUpperCase() + p.slice(1);
    }
  } else {
    p = '/' + p.replace(/\\/g, '/').replace(/\/+/g, '/');
  }
  return p;
}

export function pathToUri(filePath: string): string {
  let p = filePath.replace(/\\/g, '/');
  if (!p.startsWith('/')) p = '/' + p;
  return `file://${p}`;
}

export function normalizeRelativePath(root: string, fullPath: string): string {
  const normalizedRoot = root.replace(/\\/g, '/').toLowerCase();
  const normalizedPath = fullPath.replace(/\\/g, '/').toLowerCase();
  if (normalizedPath.startsWith(normalizedRoot)) {
    return fullPath.slice(root.length).replace(/^[\\\/]/, '');
  }
  return fullPath;
}
