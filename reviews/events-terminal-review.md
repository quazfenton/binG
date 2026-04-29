✅ ALL FINDINGS RESOLVED — No further action needed.
# Codebase Review: Events & Terminal

## Overview
The Events and Terminal modules handle the real-time "nervous system" of binG, managing communication between the agent, the sandbox, and the user interface.

## Key Components

### 1. Event Bus (`web/lib/events/bus.ts`)
The primary gateway for all system events.
- **Dual-Dispatch Architecture**: Persists events to a local SQLite store for audit/replay while simultaneously dispatching to Trigger.dev for durable background processing.
- **Reliability**: Implements `emitEventAndWait`, providing a clean pattern for "Human-in-the-Loop" (HITL) scenarios where the system must wait for external input.
- **Validation**: Uses Zod (`AnyEvent`) to ensure all events conform to strict schemas before they enter the system.

### 2. Enhanced Terminal Manager (`web/lib/terminal/enhanced-terminal-manager.ts`)
A sophisticated manager for interactive sessions.
- **Multi-Modal Integration**: Unifies Terminal, Desktop (GUI), and MCP (Tool) sessions into a single lifecycle.
- **Auto-Resume**: Intelligent handling of network interruptions with a configurable auto-reconnection window.
- **Heuristic Port Detection**: A comprehensive set of regex patterns detect server startups (e.g., "listening on port 3000") and automatically trigger UI preview URL generation.
- **Provider Awareness**: Automatically selects between PTY (interactive) and Command (non-interactive) modes based on the sandbox provider's capabilities.

## Findings

### 1. Robustness of Port Detection
The `ENHANCED_PORT_PATTERNS` are extensive and cover most modern web frameworks. This is a high-signal feature that significantly improves the developer experience by "automating" the discovery of running services.

### 2. Event Persistence Strategy
The "Always Persist to Local" strategy is a strong design choice. It ensures that even if Trigger.dev is unavailable, the system retains a complete audit trail and can potentially "replay" events later.

### 3. Potential for Connection Leaks
While the Terminal Manager includes `disconnectTerminal`, the `autoResumeTimers` and `desktopSessions` are kept in in-memory Maps.
- **Risk**: If `disconnectTerminal` is not called (e.g., during a hard crash of the main server process), these references could persist, though they are cleaned up on restart.
- **Observation**: The `SessionManager` (reviewed previously) does call `disconnectTerminal`, which mitigates this risk.

## Logic Trace: Starting a Web Server
1.  **Agent** executes `npm run dev` in the terminal.
2.  **Terminal Manager** receives the output stream.
3.  **Port Detection Logic** identifies "Local: http://localhost:3000" and extracts port `3000`.
4.  **Terminal Manager** calls `onPortDetected`.
5.  **Event Bus** emits a `PORT_DETECTED` event.
6.  **Frontend** receives the event and displays the "Open Preview" button.

## Recommended Actions

| Action | Priority | Reason |
| :--- | :--- | :--- |
| **Centralize Event Schema** | Medium | Ensure `AnyEvent` schema in `schema.ts` is shared with the `Agent Worker` package to avoid type drift. |
| **Audit Timeout Logic** | Medium | Verify that the `timeout` in `emitEventAndWait` (default 5m) aligns with the average latency of Trigger.dev tasks. |
| **Add Terminal Health Check** | Low | Integrate the `terminal-health-monitor.ts` more tightly into the `EnhancedTerminalManager` to proactively detect stalled PTY processes. |
