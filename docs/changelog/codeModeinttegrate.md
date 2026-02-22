code-mode.tsx:

Handles code editing mode with diff operations
Manages file selection and content display
Implements basic diff application logic
Uses a simple messaging format for code editing tasks
code-preview-panel.tsx:

Extracts code blocks from messages
Renders code with syntax highlighting
Handles file downloads and project structure analysis
Provides basic code preview functionality
Enhanced Code System Architecture
EnhancedCodeOrchestrator:

Main orchestrator that coordinates all components
Supports multiple processing modes (streaming, agentic, hybrid, standard)
Manages sessions and workflows
AdvancedFileManager:

Handles sophisticated file operations with diff tracking
Provides approval workflows for changes
Manages file state and synchronization
EnhancedPromptEngine:

Generates advanced prompts for code tasks
Processes code responses with diff generation
Supports multi-step workflows
EnhancedStreamingManager:

Handles real-time streaming of code generation
Manages chunks and progressive updates
Integration Steps
1. Create Integration Module
First, create a new integration module to bridge the enhanced system with the existing UI components:

// /home/admin/000code/binG/lib/enhanced-code-integration.ts

import { EnhancedCodeOrchestrator } from '../enhanced-code-system/enhanced-code-orchestrator';
import { ProjectItem } from '../enhanced-code-system/core/enhanced-prompt-engine';
import { DiffOperation } from '../enhanced-code-system/file-management/advanced-file-manager';

// Singleton orchestrator instance
let orchestratorInstance: EnhancedCodeOrchestrator | null = null;

// Get or create the orchestrator instance
export function getOrchestrator(): EnhancedCodeOrchestrator {
  if (!orchestratorInstance) {
    orchestratorInstance = new EnhancedCodeOrchestrator({
      mode: 'hybrid',
      enableStreaming: true,
      enableAgenticFrameworks: true,
      enableFileManagement: true,
      enableAutoWorkflows: true,
      qualityThreshold: 0.8,
      maxIterations: 3,
      contextOptimization: true,
      
      promptEngineering: {
        depthLevel: 8,
        verbosityLevel: 'verbose',
        includeDocumentation: true,
        includeTestCases: false,
        includeOptimization: true
      },
      
      streamingConfig: {
        chunkSize: 1000,
        maxTokens: 32000,
        enablePartialValidation: true
      }
    });
    
    // Set up global event handlers
    setupGlobalEventHandlers(orchestratorInstance);
  }
  
  return orchestratorInstance;
}

// Convert project files to the format expected by the enhanced system
export function convertProjectFiles(files: { [key: string]: string }): ProjectItem[] {
  return Object.entries(files).map(([path, content]) => {
    const name = path.split('/').pop() || path;
    const language = getLanguageFromPath(path);
    
    return {
      id: path,
      name,
      path,
      content,
      language,
      hasEdits: false,
      lastModified: new Date()
    };
  });
}

// Convert enhanced system diffs to the format expected by the UI
export function convertDiffs(diffs: any[]): { [filePath: string]: DiffOperation[] } {
  const result: { [filePath: string]: DiffOperation[] } = {};
  
  diffs.forEach(diff => {
    const filePath = diff.file_context?.file_name || '';
    if (!filePath) return;
    
    if (!result[filePath]) {
      result[filePath] = [];
    }
    
    diff.diffs.forEach((d: any) => {
      result[filePath].push({
        type: mapOperationType(d.operation),
        lineStart: d.line_range[0],
        lineEnd: d.line_range[1],
        content: d.content,
        originalContent: d.originalContent
      });
    });
  });
  
  return result;
}

// Map operation types between systems
function mapOperationType(operation: string): 'add' | 'remove' | 'modify' {
  switch (operation) {
    case 'insert': return 'add';
    case 'delete': return 'remove';
    case 'replace':
    case 'modify':
    default:
      return 'modify';
  }
}

// Helper to determine language from file path
function getLanguageFromPath(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() || '';
  const langMap: { [key: string]: string } = {
    'js': 'javascript',
    'jsx': 'jsx',
    'ts': 'typescript',
    'tsx': 'tsx',
    'py': 'python',
    'java': 'java',
    'cpp': 'cpp',
    'c': 'c',
    'html': 'html',
    'css': 'css',
    'scss': 'scss',
    'json': 'json',
    'md': 'markdown',
    'yml': 'yaml',
    'yaml': 'yaml',
    'xml': 'xml',
    'php': 'php',
    'rb': 'ruby',
    'go': 'go',
    'rs': 'rust',
    'swift': 'swift',
    'kt': 'kotlin',
    'dart': 'dart',
    'vue': 'vue',
    'svelte': 'svelte'
  };
  
  return langMap[ext] || 'text';
}

// Set up global event handlers for the orchestrator
function setupGlobalEventHandlers(orchestrator: EnhancedCodeOrchestrator): void {
  orchestrator.on('session_started', (data) => {
    console.log('Enhanced code session started:', data.sessionId);
  });
  
  orchestrator.on('session_completed', (result) => {
    console.log('Enhanced code session completed:', result.sessionId);
  });
  
  orchestrator.on('session_failed', (error) => {
    console.error('Enhanced code session failed:', error);
  });
  
  orchestrator.on('diffs_pending_approval', (data) => {
    console.log('Diffs pending approval:', data.fileId);
  });
  
  orchestrator.on('chunk_processed', (data) => {
    console.log(`Chunk processed: ${data.chunk.sequenceNumber}`);
  });
}
2. Modify code-mode.tsx to Use Enhanced System
Update the code-mode.tsx component to integrate with the enhanced system:

// Add imports at the top
import { getOrchestrator, convertProjectFiles, convertDiffs } from '../lib/enhanced-code-integration';
import { EnhancedCodeOrchestrator } from '../enhanced-code-system/enhanced-code-orchestrator';

// Inside the CodeMode component, add:
const orchestrator = getOrchestrator();
const [activeSession, setActiveSession] = useState<string | null>(null);
const [sessionProgress, setSessionProgress] = useState<number>(0);

// Set up event listeners when component mounts
useEffect(() => {
  orchestrator.on('session_progress', (progress) => {
    setSessionProgress(progress.progress);
  });
  
  orchestrator.on('session_completed', (result) => {
    // Handle completed session
    if (result.sessionId === activeSession) {
      // Process results and update UI
      const convertedDiffs = convertDiffs(result.results.responses);
      setPendingDiffs(convertedDiffs);
      setAwaitingConfirmation(true);
      setActiveSession(null);
    }
  });
  
  return () => {
    // Clean up event listeners
    orchestrator.removeAllListeners('session_progress');
    orchestrator.removeAllListeners('session_completed');
  };
}, [activeSession]);

// Replace the formatCodeModeMessage function with:
const formatCodeModeMessage = (): string => {
  const selectedFilePaths = Array.from(selectedFiles);
  const contextFiles = selectedFilePaths.map(path => ({
    path,
    content: fileContents[path]?.content || ''
  }));

  // Start an enhanced code session instead of just formatting a message
  startEnhancedCodeSession(contextFiles);
  
  // Return a placeholder message for the chat UI
  return JSON.stringify({
    mode: 'code_editing',
    task: prompt,
    using_enhanced_system: true
  });
};

// Add a new function to start the enhanced code session
const startEnhancedCodeSession = async (contextFiles: any[]) => {
  try {
    // Convert files to the format expected by the enhanced system
    const projectItems = convertProjectFiles(
      Object.fromEntries(
        contextFiles.map(file => [file.path, file.content])
      )
    );
    
    // Start a new session
    const sessionId = await orchestrator.startSession({
      task: prompt,
      files: projectItems,
      options: {
        mode: 'hybrid',
        priority: 'high',
        requireApproval: true,
        enableDiffs: true,
        contextHints: rules.split(',').map(r => r.trim()).filter(Boolean)
      }
    });
    
    setActiveSession(sessionId);
    setLastResponse(null);
    
    // Notify the user that processing has started
    onSendMessage(`Starting enhanced code processing for task: ${prompt}`, {
      mode: 'code_editing',
      sessionId
    });
  } catch (error) {
    console.error('Failed to start enhanced code session:', error);
    onSendMessage(`Error starting enhanced code processing: ${error.message}`, {
      mode: 'code_editing',
      error: true
    });
  }
};

// Modify the applyDiffs function to use the enhanced system when available
const applyDiffs = (diffs: { [filePath: string]: DiffOperation[] }) => {
  if (activeSession) {
    // If we have an active session, use the enhanced system's file manager
    const fileManager = orchestrator.getFileManager();
    
    Object.entries(diffs).forEach(([filePath, operations]) => {
      fileManager.applyDiffs(filePath, operations.map(op => ({
        operation: op.type === 'add' ? 'insert' : op.type === 'remove' ? 'delete' : 'modify',
        lineRange: [op.lineStart, op.lineEnd || op.lineStart],
        content: op.content,
        description: `Applied from UI`,
        confidence: 0.95
      })), { requireApproval: false });
    });
    
    // Update local state
    const updatedContents = { ...fileContents };
    const updatedProjectFiles = { ...projectFiles };
    
    // Get updated file states from the file manager
    Array.from(selectedFiles).forEach(filePath => {
      const fileState = fileManager.getFileState(filePath);
      if (fileState) {
        updatedContents[filePath] = {
          ...updatedContents[filePath],
          content: fileState.content,
          hasEdits: true
        };
        updatedProjectFiles[filePath] = fileState.content;
      }
    });
    
    setFileContents(updatedContents);
    onUpdateFiles(updatedProjectFiles);
    setPendingDiffs({});
    setAwaitingConfirmation(false);
  } else {
    // Fall back to the original implementation for backward compatibility
    const updatedContents = { ...fileContents };
    const updatedProjectFiles = { ...projectFiles };
    
    // Original implementation...
    Object.entries(diffs).forEach(([filePath, operations]) => {
      if (!updatedContents[filePath]) return;
      
      let content = updatedContents[filePath].content;
      const lines = content.split('\n');
      
      // Sort operations by line number (descending) to avoid index shifting
      const sortedOps = [...operations].sort((a, b) => b.lineStart - a.lineStart);
      
      sortedOps.forEach(op => {
        switch (op.type) {
          case 'add':
            lines.splice(op.lineStart, 0, op.content);
            break;
          case 'remove':
            lines.splice(op.lineStart, (op.lineEnd || op.lineStart) - op.lineStart + 1);
            break;
          case 'modify':
            const endLine = op.lineEnd || op.lineStart;
            lines.splice(op.lineStart, endLine - op.lineStart + 1, op.content);
            break;
        }
      });
      
      const newContent = lines.join('\n');
      updatedContents[filePath] = {
        ...updatedContents[filePath],
        content: newContent,
        hasEdits: true
      };
      updatedProjectFiles[filePath] = newContent;
    });
    
    setFileContents(updatedContents);
    onUpdateFiles(updatedProjectFiles);
    setPendingDiffs({});
    setAwaitingConfirmation(false);
  }
};
3. Create a Code Response Processor Service
Create a new service to handle code response processing:

// /home/admin/000code/binG/lib/code-response-processor.ts

import { getOrchestrator, convertProjectFiles } from './enhanced-code-integration';
import type { Message } from '../types/index';

export interface CodeProcessingOptions {
  mode?: 'streaming' | 'agentic' | 'hybrid' | 'standard';
  qualityThreshold?: number;
  maxIterations?: number;
  contextHints?: string[];
  requireApproval?: boolean;
}

export interface CodeProcessingResult {
  sessionId: string;
  files: { [path: string]: string };
  diffs: any[];
  message?: string;
  error?: string;
}

export class CodeResponseProcessor {
  private orchestrator = getOrchestrator();
  
  /**
   * Process a code-related message using the enhanced system
   */
  async processCodeMessage(
    message: Message, 
    projectFiles: { [key: string]: string },
    options: CodeProcessingOptions = {}
  ): Promise<CodeProcessingResult> {
    try {
      // Extract task from message
      const task = this.extractTaskFromMessage(message);
      
      // Convert project files to the format expected by the enhanced system
      const projectItems = convertProjectFiles(projectFiles);
      
      // Start a new session
      const sessionId = await this.orchestrator.startSession({
        task,
        files: projectItems,
        options: {
          mode: options.mode || 'hybrid',
          priority: 'high',
          qualityThreshold: options.qualityThreshold || 0.8,
          requireApproval: options.requireApproval !== undefined ? options.requireApproval : true,
          enableDiffs: true,
          contextHints: options.contextHints || []
        }
      });
      
      // Wait for session completion
      const result = await this.waitForSessionCompletion(sessionId);
      
      // Process and return results
      return {
        sessionId,
        files: this.extractUpdatedFiles(result),
        diffs: result.results.responses,
        message: 'Code processing completed successfully'
      };
    } catch (error) {
      console.error('Error processing code message:', error);
      return {
        sessionId: '',
        files: {},
        diffs: [],
        error: error.message
      };
    }
  }
  
  /**
   * Extract task description from a message
   */
  private extractTaskFromMessage(message: Message): string {
    try {
      // Try to parse as JSON first
      const parsed = JSON.parse(message.content);
      if (parsed && parsed.task) {
        return parsed.task;
      }
    } catch (e) {
      // Not JSON, extract from text
    }
    
    // Extract from plain text (first paragraph or first 100 chars)
    const firstParagraph = message.content.split('\n\n')[0];
    return firstParagraph.length > 100 
      ? firstParagraph.substring(0, 100) + '...'
      : firstParagraph;
  }
  
  /**
   * Wait for a session to complete
   */
  private waitForSessionCompletion(sessionId: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Session timed out'));
      }, 300000); // 5 minute timeout
      
      const handleCompletion = (result: any) => {
        if (result.sessionId === sessionId) {
          clearTimeout(timeout);
          this.orchestrator.removeListener('session_completed', handleCompletion);
          this.orchestrator.removeListener('session_failed', handleFailure);
          resolve(result);
        }
      };
      
      const handleFailure = (error: any) => {
        if (error.sessionId === sessionId) {
          clearTimeout(timeout);
          this.orchestrator.removeListener('session_completed', handleCompletion);
          this.orchestrator.removeListener('session_failed', handleFailure);
          reject(new Error(error.error));
        }
      };
      
      this.orchestrator.on('session_completed', handleCompletion);
      this.orchestrator.on('session_failed', handleFailure);
    });
  }
  
  /**
   * Extract updated files from session results
   */
  private extractUpdatedFiles(result: any): { [path: string]: string } {
    const files: { [path: string]: string } = {};
    
    // Extract from file states
    if (result.results && result.results.fileStates) {
      result.results.fileStates.forEach((state: any, path: string) => {
        files[path] = state.content;
      });
    }
    
    return files;
  }
}

// Export singleton instance
export const codeProcessor = new CodeResponseProcessor();
4. Modify code-preview-panel.tsx to Use Enhanced System
Update the code-preview-panel.tsx to integrate with the enhanced system for code block extraction and processing:

// Add imports at the top
import { codeProcessor } from '../lib/code-response-processor';
import { getOrchestrator } from '../lib/enhanced-code-integration';

// Inside the component, add:
const orchestrator = getOrchestrator();
const [processingMessage, setProcessingMessage] = useState<string | null>(null);

// Enhance the codeBlocks extraction with the enhanced system
const codeBlocks = useMemo(() => {
  const blocks: CodeBlock[] = [];
  let nonCodeText = '';
  let shellCommands = '';
  const diffs: { path: string; diff: string }[] = [];
  
  // Check if any message has enhanced code system flag
  const hasEnhancedSystem = messages.some(message => {
    try {
      const parsed = JSON.parse(message.content);
      return parsed && parsed.using_enhanced_system === true;
    } catch (e) {
      return false;
    }
  });
  
  // If using enhanced system, use its capabilities
  if (hasEnhancedSystem) {
    // Find the most recent code-related message
    const codeMessage = [...messages].reverse().find(message => {
      try {
        const parsed = JSON.parse(message.content);
        return parsed && (parsed.mode === 'code_editing' || parsed.using_enhanced_system);
      } catch (e) {
        return false;
      }
    });
    
    if (codeMessage) {
      setProcessingMessage('Processing code with enhanced system...');
      
      // Use the enhanced system to process code blocks
      // This would typically be done asynchronously, but for simplicity
      // we're using a synchronous approach in this example
      const fileManager = orchestrator.getFileManager();
      const fileStates = fileManager.getAllFileStates();
      
      fileStates.forEach((state, id) => {
        blocks.push({
          language: state.language,
          code: state.content,
          filename: state.name,
          index: blocks.length,
          messageId: codeMessage.id,
          isError: false
        });
      });
      
      setProcessingMessage(null);
    }
  } else {
    // Original code block extraction logic
    messages.forEach((message) => {
      if (message.role === "assistant") {
        // Existing extraction logic...
      }
    });
  }
  
  // Add metadata
  (blocks as any).nonCodeText = nonCodeText;
  (blocks as any).shellCommands = shellCommands;
  (blocks as any).diffs = diffs;
  
  return blocks;
}, [messages]);

// Add a function to process code with the enhanced system
const processCodeWithEnhancedSystem = async (message: Message) => {
  setProcessingMessage('Processing code with enhanced system...');
  
  try {
    // Extract project files from current code blocks
    const projectFiles: { [key: string]: string } = {};
    codeBlocks.forEach(block => {
      if (block.filename) {
        projectFiles[block.filename] = block.code;
      }
    });
    
    // Process the message
    const result = await codeProcessor.processCodeMessage(
      message,
      projectFiles,
      {
        mode: 'hybrid',
        qualityThreshold: 0.8,
        requireApproval: true,
        contextHints: []
      }
    );
    
    // Update UI with results
    if (result.error) {
      console.error('Error processing code:', result.error);
    } else {
      // Update project structure with new files
      const newStructure = {
        ...projectStructure,
        files: {
          ...(projectStructure?.files || {}),
          ...result.files
        }
      };
      setProjectStructure(newStructure);
    }
  } catch (error) {
    console.error('Error in enhanced code processing:', error);
  } finally {
    setProcessingMessage(null);
  }
};
5. Create API Integration for Backend Processing
Create a new API route to handle enhanced code processing on the backend:

// /home/admin/000code/binG/app/api/enhanced-code/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { EnhancedCodeOrchestrator } from '../../../enhanced-code-system/enhanced-code-orchestrator';
import { ProjectItem } from '../../../enhanced-code-system/core/enhanced-prompt-engine';

// Initialize orchestrator
const orchestrator = new EnhancedCodeOrchestrator({
  mode: 'hybrid',
  enableStreaming: true,
  enableAgenticFrameworks: true,
  enableFileManagement: true,
  qualityThreshold: 0.85
});

// Store active sessions
const activeSessions: Map<string, any> = new Map();

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, sessionId, task, files, options } = body;
    
    switch (action) {
      case 'start_session':
        // Start a new code processing session
        const newSessionId = await orchestrator.startSession({
          task,
          files: files.map((file: any) => ({
            id: file.path,
            name: file.path.split('/').pop() || file.path,
            path: file.path,
            content: file.content,
            language: file.language || getLanguageFromPath(file.path),
            hasEdits: false,
            lastModified: new Date()
          })),
          options: options || {}
        });
        
        activeSessions.set(newSessionId, { startTime: Date.now() });
        
        return NextResponse.json({ 
          success: true, 
          sessionId: newSessionId 
        });
        
      case 'get_session_status':
        // Get status of an existing session
        const status = orchestrator.getSessionStatus(sessionId);
        
        if (!status) {
          return NextResponse.json({ 
            success: false, 
            error: 'Session not found' 
          }, { status: 404 });
        }
        
        return NextResponse.json({ 
          success: true, 
          status 
        });
        
      case 'get_session_results':
        // Get results of a completed session
        const results = orchestrator.getSessionResults(sessionId);
        
        if (!results) {
          return NextResponse.json({ 
            success: false, 
            error: 'Results not found' 
          }, { status: 404 });
        }
        
        return NextResponse.json({ 
          success: true, 
          results 
        });
        
      case 'apply_diffs':
        // Apply diffs to files
        const fileManager = orchestrator.getFileManager();
        const { fileId, diffs, approval } = body;
        
        await fileManager.handleUserApproval(fileId, diffs, approval);
        
        return NextResponse.json({ 
          success: true, 
          message: 'Diffs applied successfully' 
        });
        
      default:
        return NextResponse.json({ 
          success: false, 
          error: 'Unknown action' 
        }, { status: 400 });
    }
  } catch (error) {
    console.error('Enhanced code API error:', error);
    return NextResponse.json({ 
      success: false, 
      error: error.message 
    }, { status: 500 });
  }
}

// Helper to determine language from file path
function getLanguageFromPath(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() || '';
  const langMap: { [key: string]: string } = {
    'js': 'javascript',
    'jsx': 'jsx',
    'ts': 'typescript',
    'tsx': 'tsx',
    'py': 'python',
    // ... other mappings
  };
  
  return langMap[ext] || 'text';
}
6. Create a Context Provider for Enhanced Code System
Create a context provider to make the enhanced code system available throughout the application:

// /home/admin/000code/binG/contexts/enhanced-code-context.tsx

import React, { createContext, useContext, useState, useEffect } from 'react';
import { getOrchestrator } from '../lib/enhanced-code-integration';
import { EnhancedCodeOrchestrator } from '../enhanced-code-system/enhanced-code-orchestrator';

interface EnhancedCodeContextType {
  orchestrator: EnhancedCodeOrchestrator;
  activeSessions: Map<string, any>;
  sessionProgress: Map<string, number>;
  startSession: (task: string, files: any[], options?: any) => Promise<string>;
  getSessionStatus: (sessionId: string) => any;
  applyDiffs: (fileId: string, diffs: any[], approval: 'apply' | 'dismiss') => Promise<void>;
}

const EnhancedCodeContext = createContext<EnhancedCodeContextType | null>(null);

export function EnhancedCodeProvider({ children }: { children: React.ReactNode }) {
  const orchestrator = getOrchestrator();
  const [activeSessions, setActiveSessions] = useState<Map<string, any>>(new Map());
  const [sessionProgress, setSessionProgress] = useState<Map<string, number>>(new Map());
  
  useEffect(() => {
    // Set up event listeners
    orchestrator.on('session_started', (data) => {
      setActiveSessions(prev => {
        const updated = new Map(prev);
        updated.set(data.sessionId, { startTime: Date.now() });
        return updated;
      });
    });
    
    orchestrator.on('session_progress', (progress) => {
      setSessionProgress(prev => {
        const updated = new Map(prev);
        updated.set(progress.sessionId, progress.progress);
        return updated;
      });
    });
    
    orchestrator.on('session_completed', (result) => {
      setActiveSessions(prev => {
        const updated = new Map(prev);
        updated.delete(result.sessionId);
        return updated;
      });
    });
    
    orchestrator.on('session_failed', (error) => {
      setActiveSessions(prev => {
        const updated = new Map(prev);
        updated.delete(error.sessionId);
        return updated;
      });
    });
    
    return () => {
      // Clean up event listeners
      orchestrator.removeAllListeners();
    };
  }, []);
  
  const startSession = async (task: string, files: any[], options?: any): Promise<string> => {
    return await orchestrator.startSession({
      task,
      files,
      options: options || {}
    });
  };
  
  const getSessionStatus = (sessionId: string): any => {
    return orchestrator.getSessionStatus(sessionId);
  };
  
  const applyDiffs = async (fileId: string, diffs: any[], approval: 'apply' | 'dismiss'): Promise<void> => {
    const fileManager = orchestrator.getFileManager();
    await fileManager.handleUserApproval(fileId, diffs, approval);
  };
  
  return (
    <EnhancedCodeContext.Provider value={{
      orchestrator,
      activeSessions,
      sessionProgress,
      startSession,
      getSessionStatus,
      applyDiffs
    }}>
      {children}
    </EnhancedCodeContext.Provider>
  );
}

export function useEnhancedCode() {
  const context = useContext(EnhancedCodeContext);
  if (!context) {
    throw new Error('useEnhancedCode must be used within an EnhancedCodeProvider');
  }
  return context;
}
7. Update Main Application to Include the Provider
Update the main application component to include the enhanced code provider:

Expand
// /home/admin/000code/binG/app/layout.tsx

import { EnhancedCodeProvider } from '../contexts/enhanced-code-context';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <EnhancedCodeProvider>
          {children}
        </EnhancedCodeProvider>
      </body>
    </html>
  );
}
Implementation Considerations
Backward Compatibility: The integration maintains backward compatibility with the existing code handling mechanisms while adding enhanced capabilities.

Progressive Enhancement: The system can be gradually adopted, starting with basic integration and expanding to more advanced features.







integrate the `enhanced-code-system` into the binG application. The goal is to create a robust, modular architecture for handling all code generation and editing tasks, replacing the existing ad-hoc implementations.

The integration will be triggered automatically when the "Code" tab is active in the `InteractionPanel`, making the new system the default backend for all code-related requests.

----------------------
STEPS

## Phase 1: Refactor and Centralize Existing Logic

### Step 1.1: Create a Reusable Code Parsing Module

**Objective:** Decouple code block parsing from the `code-preview-panel.tsx` component to improve modularity and reusability, as requested.

1.  **Create a new file:** `/home/admin/000code/binG/lib/code-parser.ts`.
2.  **Migrate Logic:** Move the code block extraction and filename parsing logic (functions like `extractFilenameFromContext`, `generateSmartFilename`, `cleanFilename`, and the `useMemo` hook that generates `codeBlocks`) from `code-preview-panel.tsx` into this new file.
3.  **Export a Core Function:** Expose a primary function, `parseCodeBlocksFromMessages`, from the new module.
4.  **Refactor `code-preview-panel.tsx`:** Update the component to import and use `parseCodeBlocksFromMessages`. This will significantly simplify the component's own logic, making it primarily a rendering component.

### Step 1.2: Establish a Central Code Service

**Objective:** Create a single, authoritative service to manage all interactions with the `enhanced-code-system`, abstracting its complexity from the UI components.

1.  **Create a new file:** `/home/admin/000code/binG/lib/code-service.ts`.
2.  **Implement the Service:** This service will be a client-side singleton that:
    *   Communicates with a new backend API route (`/api/code`).
    *   Exposes a clean interface for starting sessions, getting status, and applying diffs (e.g., `codeService.startSession(...)`).
    *   Acts as an event emitter to notify the UI of progress, completion, or errors.
    *   Abstracts away the direct management of the `EnhancedCodeOrchestrator`.

---

## Phase 2: Backend Integration

### Step 2.1: Create the Backend API Route

**Objective:** Create the server-side endpoint that the `code-service` will communicate with.

1.  **Create a new API route:** `/home/admin/000code/binG/app/api/code/route.ts`.
2.  **Implement the Handler:** This route will:
    *   Instantiate and manage the `EnhancedCodeOrchestrator` on the server.
    *   Handle `POST` requests with an `action` field (e.g., `start_session`, `get_session_status`).
    *   Manage active sessions in a server-side map.
    *   Return session IDs, status, and results in a structured JSON format.

---

## Phase 3: Frontend Integration

### Step 3.1: Integrate the Code Service into the Main Conversation Flow

**Objective:** Make the application aware of the "Code" mode and route requests to the appropriate service.

1.  **Lift State:** The `activeTab` state from `interaction-panel.tsx` needs to be lifted up to the parent `conversation-interface.tsx` component (or managed via a context provider).
2.  **Conditional Submission Logic:** In `conversation-interface.tsx`, modify the `handleSubmit` function.
    *   If `activeTab` is "chat", it will use the existing `useChat` hook.
    *   If `activeTab` is "code", it will call the new `codeService.startSession`.
3.  **Handle Service Responses:** When the `codeService` emits a `completion` event, the `conversation-interface.tsx` will receive the results (new file content, diffs) and update its state, which will then flow down to `code-preview-panel.tsx` for rendering.

### Step 3.2: Refactor `interaction-panel.tsx` (Code Tab)

**Objective:** Replace the redundant, "lesser quality" implementation in the "Code" tab with the new, centralized service.

1.  **Remove Old Logic:** Delete the existing `handleSubmit` logic for the "Code" tab that manually constructs a prompt with file context and rules.
2.  **Integrate Code Service:** The `handleSubmit` function for the "Code" tab will now directly call `codeService.startSession`, passing the user's prompt, selected files, and any rules.
3.  **Handle State Updates:** The component will listen to events from the `codeService` (or a context provider) to show progress and display pending diffs returned by the `EnhancedCodeOrchestrator`. The `onAcceptPendingDiffs` function will be simplified to just call the service to approve the changes.

---

## Phase 4: Finalization and Cleanup

### Step 4.1: Create a Context Provider for Code Services (Recommended)

**Objective:** Provide a clean way to access the `codeService` and related state from any component without prop drilling.

1.  **Create Context:** Create a new file `/home/admin/000code/binG/contexts/code-service-context.tsx`.
2.  **Implement Provider:** The provider will instantiate the `codeService` singleton, manage state for code operations (e.g., `isProcessing`, `pendingDiffs`), and subscribe to service events to update its state.
3.  **Wrap Application:** Wrap the main application layout or `conversation-interface.tsx` with this provider.
4.  **Use Hook:** Components can then use a `useCodeService()` hook to access the service and its state.

### Step 4.2: Deprecation and Cleanup

**Objective:** Remove old, redundant code to finalize the refactor.

1.  **Remove Old Logic:** In `interaction-panel.tsx`, completely remove the old prompt-building logic for the "Code" tab.
2.  **Simplify `code-preview-panel.tsx`:** Ensure all non-rendering logic has been moved out to the new `code-parser.ts` module.
3.  **Review and Delete:** Check for any other helper functions or state related to the old code handling system that can now be safely deleted.
