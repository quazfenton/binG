/**
 * Next.js App Router entry for the local PTY API.
 *
 * Re-exports the POST (create session) and GET (SSE output stream) handlers
 * from the gateway module. The actual implementation lives in `./gateway`.
 *
 * Routes:
 *   POST /api/terminal/local-pty        — Create PTY session
 *   GET  /api/terminal/local-pty        — SSE output stream
 *   POST /api/terminal/local-pty/input  — Send keystrokes (see ./input/route.ts)
 *   POST /api/terminal/local-pty/resize — Resize terminal (see ./resize/route.ts)
 */
export { POST, GET } from './gateway';
