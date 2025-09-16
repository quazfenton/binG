/**
 * Interaction Panel Code Mode Hook
 * 
 * Provides code mode functionality specifically for the interaction panel,
 * integrating with the enhanced code orchestrator and managing code prompts.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { useCodeModeIntegration } from './use-code-mode-integration';
import { CodeModeFile } from '../lib/services/code-mode-integration';

export interface CodeModeState {
  mode: 'basic' | 'advanced';
  selectedFiles: string[];
  attachedFiles: Record<string, { content: string; version: number }>;
  projectStructure: string[];
  isProcessing: boolean;
  error: string | null;
  sessionActive: boolean;
}

export interface CodeModeActions {
  setMode: (mode: 'basic' | 'advanced') => void;
  toggleFileSelection: (filePath: string) => void;
  setSelectedFiles: (files: string[]) => void;
  attachFile: (filePath: string, content: string) => void;
  removeAttachedFile: (filePath: string) => void;
  processCodePrompt: (prompt: string, context?: any) => Promise<string>;
  clearError: () => void;
  resetSession: () => void;
}

export interface CodePromptContext {
  selectedFiles?: string[];
  attachedFiles?: Record<string, { content: string; version: number }>;
  mode?: 'basic' | 'advanced';
  rules?: string;
  schema?: any;
}

export function useInteractionCodeMode() {
  // Integration hook
  const [integrationState, integrationActions] = useCodeModeIntegration({
    autoCleanup: true,
    enableRealTimeUpdates: true,
  });

  // Local state
  const [state, setState] = useState<CodeModeState>({
    mode: 'basic',
    selectedFiles: [],
    attachedFiles: {},
    projectStructure: [
      'src/components/App.tsx',
      'src/utils/helpers.ts',
      'package.json',
      'README.md',
      'src/styles/globals.css',
      'src/hooks/use-api.ts',
      'src/lib/utils.ts',
      'src/types/index.ts',
      'tailwind.config.js',
      'next.config.js',
    ],
    isProcessing: false,
    error: null,
    sessionActive: false,
  });

  const sessionInitialized = useRef(false);

  // Sync with integration state
  useEffect(() => {
    setState(prev => ({
      ...prev,
      isProcessing: integrationState.isProcessing,
      error: integrationState.error,
      sessionActive: !!integrationState.currentSession,
    }));
  }, [integrationState]);

  // Initialize session when files are attached
  useEffect(() => {
    const hasAttachedFiles = Object.keys(state.attachedFiles).length > 0;
    
    if (hasAttachedFiles && !sessionInitialized.current && !integrationState.currentSession) {
      initializeSession();
    }
  }, [state.attachedFiles, integrationState.currentSession]);

  const initializeSession = useCallback(async () => {
    if (sessionInitialized.current) return;

    try {
      const files: CodeModeFile[] = Object.entries(state.attachedFiles).map(([path, fileData]) => ({
        id: `file_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        name: path.split('/').pop() || path,
        path,
        content: fileData.content,
        language: getLanguageFromPath(path),
        hasEdits: false,
        lastModified: new Date(),
      }));

      if (files.length > 0) {
        await integrationActions.createSession(files);
        sessionInitialized.current = true;
      }
    } catch (error) {
      console.error('Failed to initialize code mode session:', error);
    }
  }, [state.attachedFiles, integrationActions]);

  // Actions
  const setMode = useCallback((mode: 'basic' | 'advanced') => {
    setState(prev => ({ ...prev, mode }));
  }, []);

  const toggleFileSelection = useCallback((filePath: string) => {
    setState(prev => ({
      ...prev,
      selectedFiles: prev.selectedFiles.includes(filePath)
        ? prev.selectedFiles.filter(f => f !== filePath)
        : [...prev.selectedFiles, filePath]
    }));
  }, []);

  const setSelectedFiles = useCallback((files: string[]) => {
    setState(prev => ({ ...prev, selectedFiles: files }));
  }, []);

  const attachFile = useCallback((filePath: string, content: string) => {
    setState(prev => ({
      ...prev,
      attachedFiles: {
        ...prev.attachedFiles,
        [filePath]: {
          content,
          version: (prev.attachedFiles[filePath]?.version || 0) + 1,
        }
      }
    }));
  }, []);

  const removeAttachedFile = useCallback((filePath: string) => {
    setState(prev => {
      const newAttachedFiles = { ...prev.attachedFiles };
      delete newAttachedFiles[filePath];
      return {
        ...prev,
        attachedFiles: newAttachedFiles,
        selectedFiles: prev.selectedFiles.filter(f => f !== filePath),
      };
    });
  }, []);

  const processCodePrompt = useCallback(async (
    prompt: string, 
    context?: CodePromptContext
  ): Promise<string> => {
    if (!integrationState.currentSession) {
      // Initialize session if not exists
      await initializeSession();
      if (!integrationState.currentSession) {
        throw new Error('Failed to initialize code mode session');
      }
    }

    try {
      // Determine which files to use based on mode and context
      const filesToUse = context?.selectedFiles || state.selectedFiles;
      const effectiveMode = context?.mode || state.mode;

      let enhancedPrompt = prompt;

      // Enhance prompt based on mode
      if (effectiveMode === 'advanced') {
        enhancedPrompt = enhanceAdvancedPrompt(prompt, {
          selectedFiles: filesToUse,
          attachedFiles: context?.attachedFiles || state.attachedFiles,
          rules: context?.rules,
          schema: context?.schema,
        });
      } else {
        enhancedPrompt = enhanceBasicPrompt(prompt, {
          selectedFiles: filesToUse,
        });
      }

      // Execute the code task
      const response = await integrationActions.executeCodeTask(
        enhancedPrompt,
        context?.rules,
        filesToUse.length > 0 ? filesToUse : undefined
      );

      // Return formatted response for chat
      return formatResponseForChat(response, effectiveMode);

    } catch (error) {
      console.error('Failed to process code prompt:', error);
      throw error;
    }
  }, [integrationState.currentSession, integrationActions, state, initializeSession]);

  const clearError = useCallback(() => {
    integrationActions.clearError();
    setState(prev => ({ ...prev, error: null }));
  }, [integrationActions]);

  const resetSession = useCallback(async () => {
    if (integrationState.currentSession) {
      await integrationActions.cancelSession();
    }
    sessionInitialized.current = false;
    setState(prev => ({
      ...prev,
      selectedFiles: [],
      attachedFiles: {},
      sessionActive: false,
    }));
  }, [integrationState.currentSession, integrationActions]);

  const actions: CodeModeActions = {
    setMode,
    toggleFileSelection,
    setSelectedFiles,
    attachFile,
    removeAttachedFile,
    processCodePrompt,
    clearError,
    resetSession,
  };

  return [state, actions] as const;
}

// Helper functions

function getLanguageFromPath(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase();
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
  return langMap[ext || ''] || 'text';
}

function enhanceAdvancedPrompt(
  prompt: string, 
  context: {
    selectedFiles: string[];
    attachedFiles: Record<string, { content: string; version: number }>;
    rules?: string;
    schema?: any;
  }
): string {
  const { selectedFiles, attachedFiles, rules, schema } = context;

  let enhanced = `# Advanced Code Mode Request

## Task Description
${prompt}

## Context Files
${selectedFiles.length > 0 ? selectedFiles.map(file => `- ${file}`).join('\n') : 'No files selected'}

## Available Commands
- @read_file(path) - Request file content
- @write_diff(file, changes) - Apply changes with diff format
- @list_project - Show project structure
- @analyze_code(file) - Perform code analysis
- @create_file(path, content) - Create new file
- @delete_file(path) - Remove file

## File Contents
`;

  // Add file contents for selected files
  selectedFiles.forEach(filePath => {
    if (attachedFiles[filePath]) {
      enhanced += `\n### ${filePath}\n\`\`\`\n${attachedFiles[filePath].content}\n\`\`\`\n`;
    }
  });

  if (rules) {
    enhanced += `\n## Additional Rules\n${rules}\n`;
  }

  if (schema) {
    enhanced += `\n## Response Schema\n\`\`\`json\n${JSON.stringify(schema, null, 2)}\n\`\`\`\n`;
  }

  enhanced += `\n## Instructions
Please provide a comprehensive solution that:
1. Analyzes the provided code and context
2. Implements the requested changes using appropriate commands
3. Ensures code quality and best practices
4. Provides clear explanations for changes made
5. Suggests any additional improvements or considerations

Use the enhanced code orchestrator capabilities for optimal results.`;

  return enhanced;
}

function enhanceBasicPrompt(
  prompt: string,
  context: {
    selectedFiles: string[];
  }
): string {
  const { selectedFiles } = context;

  let enhanced = `# Code Assistant Request

${prompt}

## Context
`;

  if (selectedFiles.length > 0) {
    enhanced += `Working with files: ${selectedFiles.join(', ')}\n`;
  } else {
    enhanced += `General code assistance request\n`;
  }

  enhanced += `
## Requirements
Please provide:
1. Clear, well-commented code solutions
2. Best practices and optimization suggestions
3. Error handling and edge case considerations
4. Testing recommendations where applicable
5. Documentation for complex implementations

Focus on creating production-ready, maintainable code.`;

  return enhanced;
}

function formatResponseForChat(response: any, mode: 'basic' | 'advanced'): string {
  if (!response) {
    return 'No response received from code mode integration.';
  }

  if (response.type === 'error') {
    return `❌ **Code Mode Error**\n\n${response.message}`;
  }

  if (response.type === 'diff_preview') {
    let formatted = `✅ **Code Changes Generated**\n\n`;
    
    if (response.message) {
      formatted += `${response.message}\n\n`;
    }

    if (response.diffs && Object.keys(response.diffs).length > 0) {
      formatted += `**Files to be modified:**\n`;
      Object.keys(response.diffs).forEach(filePath => {
        const diffCount = response.diffs[filePath].length;
        formatted += `- ${filePath} (${diffCount} change${diffCount !== 1 ? 's' : ''})\n`;
      });
      
      formatted += `\n💡 **Next Steps:**\n`;
      formatted += `1. Review the proposed changes in the Code Mode panel\n`;
      formatted += `2. Click "Apply Changes" to implement the modifications\n`;
      formatted += `3. Test the updated code to ensure it works as expected\n`;
    }

    return formatted;
  }

  if (response.type === 'confirmation') {
    return `✅ **${response.message || 'Operation completed successfully'}**`;
  }

  // Default formatting
  return `**Code Mode Response**\n\n${response.message || JSON.stringify(response, null, 2)}`;
}

export default useInteractionCodeMode;