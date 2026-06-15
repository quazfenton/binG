/**
 * Next.js App Router entry for the local PTY resize endpoint.
 *
 * Re-exports the POST handler from the resize gateway module.
 *
 * Route:
 *   POST /api/terminal/local-pty/resize — Resize a PTY session
 */
export { POST } from './gateway';
