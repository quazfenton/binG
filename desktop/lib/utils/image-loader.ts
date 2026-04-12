/**
 * Custom Next.js image loader for desktop export mode.
 * Falls back to direct URL since Tauri desktop serves static files.
 */
export default function imageLoader({ src }: { src: string }) {
  // For desktop static export, return src as-is
  if (src.startsWith('http://') || src.startsWith('https://')) {
    return src;
  }
  // For relative paths, just return as-is (static asset)
  return src;
}
