/**
 * Enhanced Code System API Route
 *
 * Backend endpoint that manages the EnhancedCodeOrchestrator and handles
 * all code generation requests from the frontend code service.
 */

import { NextRequest, NextResponse } from "next/server";
// import { EnhancedCodeOrchestrator } from '../../../enhanced-code-system/enhanced-code-orchestrator';
// import type { Message } from '../../../types/index';

// Session storage (in production, use Redis or database)
const activeSessions = new Map<
  string,
  {
    // orchestrator: EnhancedCodeOrchestrator;
    status: "pending" | "processing" | "completed" | "error";
    progress: number;
    files: { [key: string]: string };
    pendingDiffs: { path: string; diff: string }[];
    error?: string;
    createdAt: Date;
    updatedAt: Date;
  }
>();

// Generate unique session ID
function generateSessionId(): string {
  return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

export async function POST(request: NextRequest) {
  try {
    // Validate content type
    const contentType = request.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      return NextResponse.json(
        { 
          error: "Content-Type must be application/json",
          received: contentType
        },
        { status: 400 }
      );
    }

    let body: any;
    try {
      body = await request.json();
    } catch (parseError) {
      return NextResponse.json(
        { 
          error: "Invalid JSON in request body",
          details: parseError instanceof Error ? parseError.message : 'JSON parse error'
        },
        { status: 400 }
      );
    }

    // Validate action field
    const { action } = body;
    if (!action || typeof action !== 'string') {
      return NextResponse.json(
        { 
          error: "Action is required and must be a string",
          received: {
            action: action,
            type: typeof action
          }
        },
        { status: 400 }
      );
    }

    switch (action) {
      case "start_session":
        return handleStartSession(body);

      case "get_session_status":
        return handleGetSessionStatus(body);

      case "apply_diffs":
        return handleApplyDiffs(body);

      case "cancel_session":
        return handleCancelSession(body);

      default:
        return NextResponse.json(
          { 
            error: "Invalid action",
            received: action,
            validActions: ["start_session", "get_session_status", "apply_diffs", "cancel_session"]
          },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error("API Error:", error);
    return NextResponse.json(
      { 
        error: "Internal server error",
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 },
    );
  }
}

async function handleStartSession(body: any) {
  try {
    // Validate request body structure
    if (!body || typeof body !== 'object') {
      return NextResponse.json(
        { error: "Invalid request body" },
        { status: 400 },
      );
    }

    const {
      prompt,
      selectedFiles = {},
      rules = [],
      mode = "hybrid",
      context = {},
    } = body;

    // Enhanced validation with detailed error messages
    if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
      return NextResponse.json(
        { 
          error: "Prompt is required and must be a non-empty string",
          received: {
            prompt: prompt,
            type: typeof prompt,
            length: typeof prompt === 'string' ? prompt.length : 'N/A'
          }
        },
        { status: 400 },
      );
    }

    // Validate selectedFiles format
    if (selectedFiles && typeof selectedFiles !== 'object') {
      return NextResponse.json(
        { 
          error: "selectedFiles must be an object",
          received: {
            selectedFiles: selectedFiles,
            type: typeof selectedFiles
          }
        },
        { status: 400 },
      );
    }

    // Validate rules format
    if (rules && !Array.isArray(rules)) {
      return NextResponse.json(
        { 
          error: "rules must be an array",
          received: {
            rules: rules,
            type: typeof rules
          }
        },
        { status: 400 },
      );
    }

    // Validate mode
    const validModes = ["streaming", "agentic", "hybrid", "standard"];
    if (mode && !validModes.includes(mode)) {
      return NextResponse.json(
        { 
          error: "Invalid mode",
          received: mode,
          validModes: validModes
        },
        { status: 400 },
      );
    }

    const sessionId = generateSessionId();

    // Create session record (mock implementation)
    const session = {
      // orchestrator,
      status: "pending" as const,
      progress: 0,
      files: selectedFiles,
      pendingDiffs: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    activeSessions.set(sessionId, session);

    // Start processing asynchronously
    processSessionAsync(sessionId, prompt, selectedFiles, rules, context);

    return NextResponse.json({
      success: true,
      sessionId,
    });
  } catch (error) {
    console.error("Error starting session:", error);
    return NextResponse.json(
      { error: "Failed to start session" },
      { status: 500 },
    );
  }
}

async function handleGetSessionStatus(body: any) {
  try {
    const { sessionId } = body;

    if (!sessionId || typeof sessionId !== 'string' || sessionId.trim().length === 0) {
      return NextResponse.json(
        { 
          error: "Session ID is required and must be a non-empty string",
          received: {
            sessionId: sessionId,
            type: typeof sessionId
          }
        },
        { status: 400 },
      );
    }

    const session = activeSessions.get(sessionId);

    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      session: {
        id: sessionId,
        status: session.status,
        progress: session.progress,
        files: session.files,
        pendingDiffs: session.pendingDiffs,
        error: session.error,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
      },
    });
  } catch (error) {
    console.error("Error getting session status:", error);
    return NextResponse.json(
      { error: "Failed to get session status" },
      { status: 500 },
    );
  }
}

async function handleApplyDiffs(body: any) {
  try {
    const { sessionId, diffPaths } = body;

    if (!sessionId || typeof sessionId !== 'string' || sessionId.trim().length === 0) {
      return NextResponse.json(
        { 
          error: "Session ID is required and must be a non-empty string",
          received: {
            sessionId: sessionId,
            type: typeof sessionId
          }
        },
        { status: 400 },
      );
    }

    if (diffPaths && !Array.isArray(diffPaths)) {
      return NextResponse.json(
        { 
          error: "diffPaths must be an array if provided",
          received: {
            diffPaths: diffPaths,
            type: typeof diffPaths
          }
        },
        { status: 400 },
      );
    }

    const session = activeSessions.get(sessionId);

    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    // Apply the diffs using the orchestrator
    const diffsToApply = diffPaths
      ? session.pendingDiffs.filter((diff) => diffPaths.includes(diff.path))
      : session.pendingDiffs;

    // Here we would integrate with the file management system
    // For now, we'll simulate the application
    for (const diff of diffsToApply) {
      // Apply diff to session.files
      // This is a placeholder - in the real implementation,
      // we'd use the AdvancedFileManager to apply patches
      console.log(`Applying diff for ${diff.path}`);
    }

    // Remove applied diffs
    session.pendingDiffs = session.pendingDiffs.filter(
      (diff) => !diffsToApply.some((applied) => applied.path === diff.path),
    );

    session.updatedAt = new Date();

    return NextResponse.json({
      success: true,
      appliedCount: diffsToApply.length,
    });
  } catch (error) {
    console.error("Error applying diffs:", error);
    return NextResponse.json(
      { error: "Failed to apply diffs" },
      { status: 500 },
    );
  }
}

async function handleCancelSession(body: any) {
  try {
    const { sessionId } = body;

    if (!sessionId || typeof sessionId !== 'string' || sessionId.trim().length === 0) {
      return NextResponse.json(
        { 
          error: "Session ID is required and must be a non-empty string",
          received: {
            sessionId: sessionId,
            type: typeof sessionId
          }
        },
        { status: 400 },
      );
    }

    const session = activeSessions.get(sessionId);

    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    // Cancel the orchestrator processing
    // This would depend on the orchestrator having a cancel method
    session.status = "error";
    session.error = "Cancelled by user";
    session.updatedAt = new Date();

    // Remove from active sessions after a delay to allow status check
    setTimeout(() => {
      activeSessions.delete(sessionId);
    }, 5000);

    return NextResponse.json({
      success: true,
    });
  } catch (error) {
    console.error("Error canceling session:", error);
    return NextResponse.json(
      { error: "Failed to cancel session" },
      { status: 500 },
    );
  }
}

async function processSessionAsync(
  sessionId: string,
  prompt: string,
  selectedFiles: { [key: string]: string },
  rules: string[],
  context: any,
) {
  const session = activeSessions.get(sessionId);
  if (!session) return;

  try {
    session.status = "processing";
    session.progress = 10;
    session.updatedAt = new Date();

    // Mock processing delay
    await new Promise((resolve) => setTimeout(resolve, 1000));
    session.progress = 50;
    session.updatedAt = new Date();

    await new Promise((resolve) => setTimeout(resolve, 1000));
    session.progress = 80;
    session.updatedAt = new Date();

    // Mock response generation
    const mockFiles: { [key: string]: string } = {};

    // Generate a simple response based on the prompt
    if (prompt.toLowerCase().includes("react")) {
      mockFiles["src/App.jsx"] = `import React from 'react';

function App() {
  return (
    <div className="App">
      <h1>Generated React App</h1>
      <p>This is a mock response based on your request: ${prompt.substring(0, 100)}...</p>
    </div>
  );
}

export default App;`;

      mockFiles["src/index.js"] = `import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);`;
    } else {
      mockFiles["index.html"] = `<!DOCTYPE html>
<html>
<head>
    <title>Generated Code</title>
</head>
<body>
    <h1>Mock Generated Content</h1>
    <p>Based on prompt: ${prompt.substring(0, 100)}...</p>
</body>
</html>`;
    }

    session.files = { ...session.files, ...mockFiles };

    // Mock diff generation
    session.pendingDiffs = [
      {
        path: Object.keys(mockFiles)[0] || "index.html",
        diff: `+ // Generated based on: ${prompt.substring(0, 50)}...`,
      },
    ];

    session.progress = 100;
    session.status = "completed";
    session.updatedAt = new Date();
  } catch (error) {
    console.error(`Error processing session ${sessionId}:`, error);
    session.status = "error";
    session.error = error instanceof Error ? error.message : "Unknown error";
    session.updatedAt = new Date();
  }
}

// Cleanup old sessions periodically
setInterval(
  () => {
    const now = new Date();
    const maxAge = 30 * 60 * 1000; // 30 minutes

    for (const [sessionId, session] of activeSessions.entries()) {
      if (now.getTime() - session.createdAt.getTime() > maxAge) {
        activeSessions.delete(sessionId);
      }
    }
  },
  5 * 60 * 1000,
); // Run every 5 minutes
