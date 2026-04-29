/**
 * Tauri MCP Server — Bridge to the embedded MCP plugin
 *
 * This Node.js MCP server connects to the Tauri MCP bridge WebSocket
 * and exposes desktop UI automation tools to AI agents (Claude, Cursor, etc.)
 *
 * Tools exposed:
 *   - screenshot: Take a screenshot of a window or the full desktop
 *   - get_dom: Extract DOM tree from the Tauri webview
 *   - execute_js: Run JavaScript inside the Tauri webview
 *   - mouse_click / mouse_move / mouse_scroll / mouse_drag
 *   - keyboard_input: Send keystrokes to the focused element
 *   - window_list / window_focus / window_resize / window_position
 *   - local_storage_get / local_storage_set / local_storage_clear
 *   - ipc_list_handlers / ipc_invoke
 *   - ping: Test connectivity
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import WebSocket from "ws";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const BRIDGE_URL = process.env.TAURI_MCP_BRIDGE_URL || "ws://127.0.0.1:3718";
const MODE = process.env.TAURI_MCP_MODE || "desktop";

// ---------------------------------------------------------------------------
// WebSocket connection to the Tauri MCP bridge
// ---------------------------------------------------------------------------

class TauriBridgeClient {
  constructor() {
    this.ws = null;
    this.pendingRequests = new Map();
    this.messageId = 0;
    this.isConnecting = false;
    this.isClosing = false;
    this.reconnectDelay = 1000; // Initial delay: 1 second
    this.maxReconnectDelay = 30000; // Max delay: 30 seconds
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.isConnecting = true;
      this.isClosing = false;
      this.ws = new WebSocket(BRIDGE_URL);
      
      this.ws.on("open", () => {
        this.isConnecting = false;
        this.reconnectDelay = 1000; // Reset delay on successful connect
        console.error("[TauriBridge] Connected to bridge");
        resolve();
      });
      
      this.ws.on("error", (err) => {
        this.isConnecting = false;
        console.error("[TauriBridge] Connection error:", err.message);
        reject(err);
      });
      
      this.ws.on("close", (code, reason) => {
        console.error(`[TauriBridge] Connection closed (code=${code}, reason=${reason || 'none'})`);
        this.isConnecting = false;
        
        // Reject all pending requests since connection is closed
        for (const [id, pending] of this.pendingRequests) {
          pending.reject(new Error(`Bridge disconnected (code=${code})`));
        }
        this.pendingRequests.clear();
        
        // Attempt reconnection unless explicitly closing
        if (!this.isClosing) {
          this.scheduleReconnect();
        }
      });
      
      this.ws.on("message", (data) => this.handleMessage(data.toString()));
    });
  }

  scheduleReconnect() {
    // Don't reconnect if already closing or already connecting
    if (this.isClosing || this.isConnecting) {
      console.error("[TauriBridge] Skipping reconnect (closing=${this.isClosing}, connecting=${this.isConnecting})");
      return;
    }
    
    const delay = this.reconnectDelay;
    console.error(`[TauriBridge] Scheduling reconnect in ${delay}ms (delay will increase up to ${this.maxReconnectDelay}ms)`);
    
    setTimeout(async () => {
      if (this.isClosing) return;
      
      console.error("[TauriBridge] Attempting to reconnect...");
      try {
        await this.connect();
        console.error("[TauriBridge] Reconnected successfully");
      } catch (err) {
        console.error(`[TauriBridge] Reconnection failed: ${err.message}`);
        // Exponential backoff with jitter
        this.reconnectDelay = Math.min(this.reconnectDelay * 2 + Math.random() * 1000, this.maxReconnectDelay);
        this.scheduleReconnect();
      }
    }, delay);
  }

  handleMessage(raw) {
    try {
      const msg = JSON.parse(raw);
      const { id, result, error } = msg;
      const pending = this.pendingRequests.get(id);
      if (pending) {
        this.pendingRequests.delete(id);
        if (error) pending.reject(new Error(error.message || JSON.stringify(error)));
        else pending.resolve(result);
      }
    } catch {
      // ignore parse errors
    }
  }

  async call(method, params = {}) {
    // If not connected, try to connect first
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.error("[TauriBridge] Not connected, attempting to connect...");
      await this.connect();
    }
    
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("Bridge not connected and reconnection failed");
    }
    
    const id = `req-${++this.messageId}`;
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    });
  }

  close() {
    this.isClosing = true;
    this.ws?.close();
    this.ws = null;
  }
}

// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------

const server = new McpServer({
  name: "tauri-mcp-desktop",
  version: "1.0.0",
});

const bridge = new TauriBridgeClient();

// Helper: ensure bridge is connected
async function ensureBridge() {
  if (!bridge) throw new Error("Tauri MCP bridge not initialized");
  return bridge;
}

// ----- Ping ----------------------------------------------------------------

server.tool(
  "ping",
  "Test connectivity to the Tauri MCP bridge",
  {},
  async () => {
    const client = await ensureBridge();
    const result = await client.call("ping");
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

// ----- Screenshot ----------------------------------------------------------

server.tool(
  "screenshot",
  "Take a screenshot of a specific window or the full desktop",
  {
    windowId: z.string().optional().describe("Target window ID (omit for full desktop)"),
    quality: z.number().min(1).max(100).default(80).describe("JPEG quality 1-100"),
  },
  async ({ windowId, quality }) => {
    const client = await ensureBridge();
    const result = await client.call("screenshot", { windowId, quality });
    return {
      content: [
        { type: "text", text: `Screenshot taken: ${result.width}x${result.height}` },
        ...(result.imageBase64 ? [{ type: "image", data: result.imageBase64, mimeType: "image/jpeg" }] : []),
      ],
    };
  }
);

// ----- DOM Access ----------------------------------------------------------

server.tool(
  "get_dom",
  "Extract the DOM tree from the Tauri webview",
  {
    selector: z.string().optional().describe("CSS selector to scope extraction"),
    depth: z.number().default(3).describe("Maximum DOM tree depth"),
  },
  async ({ selector, depth }) => {
    const client = await ensureBridge();
    const result = await client.call("get_dom", { selector, depth });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

// ----- Execute JavaScript --------------------------------------------------

server.tool(
  "execute_js",
  "Execute arbitrary JavaScript inside the Tauri webview",
  {
    script: z.string().describe("JavaScript code to execute"),
  },
  async ({ script }) => {
    const client = await ensureBridge();
    const result = await client.call("execute_js", { script });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

// ----- Mouse ----------------------------------------------------------------

server.tool(
  "mouse_click",
  "Click at a specific position",
  { x: z.number(), y: z.number(), button: z.enum(["left", "right", "middle"]).default("left") },
  async ({ x, y, button }) => {
    const client = await ensureBridge();
    await client.call("mouse_click", { x, y, button });
    return { content: [{ type: "text", text: `Clicked at (${x},${y}) with ${button} button` }] };
  }
);

server.tool(
  "mouse_move",
  "Move the mouse to a position",
  { x: z.number(), y: z.number() },
  async ({ x, y }) => {
    const client = await ensureBridge();
    await client.call("mouse_move", { x, y });
    return { content: [{ type: "text", text: `Moved to (${x},${y})` }] };
  }
);

server.tool(
  "mouse_scroll",
  "Scroll at the current position",
  { deltaX: z.number().default(0), deltaY: z.number().default(-100) },
  async ({ deltaX, deltaY }) => {
    const client = await ensureBridge();
    await client.call("mouse_scroll", { deltaX, deltaY });
    return { content: [{ type: "text", text: `Scrolled (${deltaX},${deltaY})` }] };
  }
);

server.tool(
  "mouse_drag",
  "Drag from one position to another",
  { fromX: z.number(), fromY: z.number(), toX: z.number(), toY: z.number() },
  async ({ fromX, fromY, toX, toY }) => {
    const client = await ensureBridge();
    await client.call("mouse_drag", { fromX, fromY, toX, toY });
    return { content: [{ type: "text", text: `Dragged from (${fromX},${fromY}) to (${toX},${toY})` }] };
  }
);

// ----- Keyboard -------------------------------------------------------------

server.tool(
  "keyboard_input",
  "Send keystrokes to the focused element",
  { text: z.string().describe("Text to type"), modifiers: z.array(z.enum(["Control", "Alt", "Shift", "Meta"])).optional() },
  async ({ text, modifiers }) => {
    const client = await ensureBridge();
    await client.call("keyboard_input", { text, modifiers });
    return { content: [{ type: "text", text: `Typed: "${text}"${modifiers ? ` with [${modifiers.join("+")}]` : ""}` }] };
  }
);

// ----- Window Management ----------------------------------------------------

server.tool(
  "window_list",
  "List all managed windows",
  {},
  async () => {
    const client = await ensureBridge();
    const result = await client.call("window_list");
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "window_focus",
  "Focus a specific window",
  { windowId: z.string() },
  async ({ windowId }) => {
    const client = await ensureBridge();
    await client.call("window_focus", { windowId });
    return { content: [{ type: "text", text: `Focused window ${windowId}` }] };
  }
);

server.tool(
  "window_resize",
  "Resize a specific window",
  { windowId: z.string(), width: z.number(), height: z.number() },
  async ({ windowId, width, height }) => {
    const client = await ensureBridge();
    await client.call("window_resize", { windowId, width, height });
    return { content: [{ type: "text", text: `Resized window ${windowId} to ${width}x${height}` }] };
  }
);

server.tool(
  "window_position",
  "Move a specific window",
  { windowId: z.string(), x: z.number(), y: z.number() },
  async ({ windowId, x, y }) => {
    const client = await ensureBridge();
    await client.call("window_position", { windowId, x, y });
    return { content: [{ type: "text", text: `Moved window ${windowId} to (${x},${y})` }] };
  }
);

// ----- Local Storage --------------------------------------------------------

server.tool(
  "local_storage_get",
  "Get a value from local storage",
  { key: z.string() },
  async ({ key }) => {
    const client = await ensureBridge();
    const result = await client.call("local_storage_get", { key });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "local_storage_set",
  "Set a value in local storage",
  { key: z.string(), value: z.string() },
  async ({ key, value }) => {
    const client = await ensureBridge();
    await client.call("local_storage_set", { key, value });
    return { content: [{ type: "text", text: `Set ${key} = ${value}` }] };
  }
);

server.tool(
  "local_storage_clear",
  "Clear all local storage",
  {},
  async () => {
    const client = await ensureBridge();
    await client.call("local_storage_clear");
    return { content: [{ type: "text", text: "Local storage cleared" }] };
  }
);

// ----- IPC ------------------------------------------------------------------

server.tool(
  "ipc_list_handlers",
  "List all registered IPC handlers",
  {},
  async () => {
    const client = await ensureBridge();
    const result = await client.call("ipc_list_handlers");
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "ipc_invoke",
  "Invoke an IPC command",
  { command: z.string().describe("IPC handler name"), payload: z.record(z.any()).optional() },
  async ({ command, payload }) => {
    const client = await ensureBridge();
    const result = await client.call("ipc_invoke", { command, payload });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

async function main() {
  try {
    console.error(`Connecting to Tauri MCP bridge at ${BRIDGE_URL}...`);
    await bridge.connect();
    console.error("Connected to Tauri MCP bridge");
  } catch (err) {
    console.error(`Failed to connect to Tauri MCP bridge: ${err}`);
    // Continue anyway — tools will fail with clear errors
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Tauri MCP Desktop Server running on stdio");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
