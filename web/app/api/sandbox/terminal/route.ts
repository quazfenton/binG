// Re-export the terminal session handlers from the gateway module.
// Next.js App Router requires route.ts to expose API endpoints;
// the actual logic (auth, sandbox creation, PTY lifecycle) lives in gateway.ts.
//
// This fixes the 404 on POST /api/sandbox/terminal reported when the
// terminal panel tried to create a sandbox session after login:
//   "POST /api/sandbox/terminal 404 in 387ms"
//   "No session/sandbox ID for PTY fallback, skipping"

export { POST, DELETE } from './gateway';
