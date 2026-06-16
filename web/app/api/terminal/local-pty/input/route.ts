/**
 * Next.js App Router entry for the local PTY input endpoint.
 *
 * Re-exports the POST handler from the input gateway module.
 *
 * Route:
 *   POST /api/terminal/local-pty/input — Send keystrokes to a PTY session
 */
export { POST } from './gateway';
