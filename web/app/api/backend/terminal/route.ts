/**
 * WebSocket Terminal Endpoint
 * Provides xterm.js-compatible WebSocket terminal access
 * URL: ws://localhost:8080/sandboxes/{sandboxId}/terminal
 */

// This endpoint is handled by the WebSocketTerminalServer
// which runs on a separate port (default: 8080)
//
// To connect from the frontend:
// const ws = new WebSocket(`ws://localhost:8080/sandboxes/${sandboxId}/terminal`);
//
// The WebSocketTerminalServer is initialized in /api/backend/route.ts
// and runs independently of Next.js HTTP routes.
//
// For Next.js WebSocket support, you would need to use a custom server
// or deploy the WebSocket server separately.

// Runtime configuration
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return new Response(
    JSON.stringify({
      message: 'WebSocket terminal endpoint',
      documentation: 'Connect via WebSocket: ws://localhost:8080/sandboxes/{sandboxId}/terminal',
      example: `
        const ws = new WebSocket('ws://localhost:8080/sandboxes/abc123/terminal');
        
        ws.onopen = () => {
          console.log('Connected to terminal');
        };
        
        ws.onmessage = (event) => {
          // Display terminal output
          terminal.write(event.data);
        };
        
        ws.send('ls -la\\n'); // Send command
      `,
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  );
}
