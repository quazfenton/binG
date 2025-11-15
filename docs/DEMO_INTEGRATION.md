# Enhanced Code Integration Demo

This document provides practical examples and demonstrations of the enhanced code integration system in the binG application.

## Quick Start Guide

### 1. Accessing Code Mode

1. Open the binG application
2. Look for the interaction panel at the bottom
3. Click on the "Code" tab (next to "Chat")
4. The interface will switch to enhanced code generation mode

### 2. Basic Code Generation Example

**Prompt:** "Create a simple React todo app"

**Expected Flow:**
```
User Input → Code Service → Mock API → Generated Files
```

**Generated Output:**
- `src/App.jsx` - Main React component
- `src/index.js` - Entry point
- Progress indicators showing 0% → 50% → 100%
- Live preview in Code Preview Panel

### 3. Advanced Example with Context

**Scenario:** User has existing files and wants to extend them

```javascript
// Existing file: src/utils/api.js
const API_BASE = 'https://api.example.com';

export const fetchData = async (endpoint) => {
  // existing code
};
```

**User Request:** "Add authentication to this API utility"

**System Behavior:**
1. Parses existing files using `code-parser.ts`
2. Sends context to enhanced code service
3. Generates updated code with authentication
4. Shows diffs for review
5. Allows selective application of changes

## Code Service API Examples

### Starting a Session

```typescript
import { useCodeService } from '@/contexts/code-service-context';

function MyComponent() {
  const { startSession, state } = useCodeService();
  
  const handleCodeGeneration = async () => {
    try {
      const sessionId = await startSession({
        prompt: "Create a dashboard component with charts",
        selectedFiles: {
          'src/components/Layout.jsx': existingLayoutCode,
          'src/styles/globals.css': existingStyles
        },
        mode: 'hybrid',
        context: {
          messages: conversationHistory
        }
      });
      
      console.log('Session started:', sessionId);
    } catch (error) {
      console.error('Failed to start session:', error);
    }
  };
  
  return (
    <div>
      <button onClick={handleCodeGeneration}>
        Generate Code
      </button>
      {state.isProcessing && (
        <div>Progress: {state.progress}%</div>
      )}
    </div>
  );
}
```

### Monitoring Progress

```typescript
const { state } = useCodeService();

// Real-time updates
useEffect(() => {
  if (state.currentSession) {
    console.log('Session status:', state.currentSession.status);
    console.log('Progress:', state.progress);
    console.log('Pending diffs:', state.pendingDiffs.length);
  }
}, [state.currentSession, state.progress, state.pendingDiffs]);
```

## Parser Examples

### Parsing Code Blocks

```typescript
import { parseCodeBlocksFromMessages } from '@/lib/code-parser';

const messages = [
  {
    id: '1',
    role: 'assistant',
    content: `Here's a React component:

\`\`\`jsx src/components/Button.jsx
import React from 'react';

export default function Button({ children, onClick }) {
  return (
    <button onClick={onClick} className="btn">
      {children}
    </button>
  );
}
\`\`\`

And the styles:

\`\`\`css src/styles/button.css
.btn {
  padding: 12px 24px;
  border: none;
  border-radius: 4px;
  background: #007bff;
  color: white;
  cursor: pointer;
}
\`\`\`
`
  }
];

const result = parseCodeBlocksFromMessages(messages);
console.log('Parsed code blocks:', result.codeBlocks);
console.log('Project structure:', result.projectStructure);
```

**Output:**
```javascript
{
  codeBlocks: [
    {
      language: 'jsx',
      code: 'import React from \'react\';\n\nexport default function Button...',
      filename: 'src/components/Button.jsx',
      index: 0,
      messageId: '1',
      isError: false
    },
    {
      language: 'css',
      code: '.btn {\n  padding: 12px 24px;\n  border: none;\n...',
      filename: 'src/styles/button.css',
      index: 1,
      messageId: '1',
      isError: false
    }
  ],
  projectStructure: {
    name: 'Generated Project',
    files: {
      'src/components/Button.jsx': 'import React from \'react\'...',
      'src/styles/button.css': '.btn {\n  padding: 12px 24px...'
    },
    framework: 'react',
    bundler: undefined,
    packageManager: 'npm'
  }
}
```

## UI Component Examples

### Enhanced InteractionPanel Usage

```typescript
// In ConversationInterface.tsx
const [activeTab, setActiveTab] = useState<"chat" | "code">("chat");

return (
  <InteractionPanel
    activeTab={activeTab}
    onActiveTabChange={setActiveTab}
    onSubmit={handleSubmit} // Routes based on activeTab
    isProcessing={isLoading || codeServiceContext.state.isProcessing}
    error={error?.message || codeServiceContext.state.error}
    // ... other props
  />
);
```

### Code Preview Panel Integration

```typescript
// Automatically updates when code service completes
useEffect(() => {
  if (codeServiceContext.state.lastSessionResult) {
    const { files, diffs } = codeServiceContext.state.lastSessionResult;
    
    // Update project files
    if (files) {
      setProjectFiles(prevFiles => ({ ...prevFiles, ...files }));
    }
    
    // Update pending diffs
    if (diffs) {
      setPendingDiffs(diffs);
    }
  }
}, [codeServiceContext.state.lastSessionResult]);
```

## Real-World Use Cases

### 1. React Component Generation
**Input:** "Create a responsive navbar with dropdown menus"
**Output:** Complete component with styles and TypeScript definitions

### 2. API Integration
**Input:** "Add user authentication to my Express server"
**Context:** Existing server files
**Output:** Updated routes, middleware, and database schemas

### 3. Bug Fixing
**Input:** "Fix the memory leak in this React component"
**Context:** Component with issues
**Output:** Optimized component with proper cleanup

### 4. Feature Addition
**Input:** "Add dark mode support to my Vue app"
**Context:** Existing Vue application
**Output:** Theme system, CSS variables, and toggle functionality

## Testing the Integration

### Manual Testing Steps

1. **Basic Functionality**
   ```
   1. Switch to Code tab
   2. Enter: "Create a hello world React app"
   3. Verify progress bar appears
   4. Check generated files in preview
   5. Test download functionality
   ```

2. **Context Awareness**
   ```
   1. Have some existing code in preview
   2. Request modification: "Add error handling"
   3. Verify context is passed to service
   4. Check generated diffs
   ```

3. **Error Handling**
   ```
   1. Submit invalid request
   2. Verify error display
   3. Test retry functionality
   4. Check session cleanup
   ```

### Automated Testing Examples

```typescript
// Test code parser
describe('Code Parser', () => {
  it('should extract React components correctly', () => {
    const messages = [/* test messages */];
    const result = parseCodeBlocksFromMessages(messages);
    
    expect(result.codeBlocks).toHaveLength(2);
    expect(result.projectStructure.framework).toBe('react');
  });
});

// Test code service
describe('Code Service', () => {
  it('should start session successfully', async () => {
    const sessionId = await codeService.startSession({
      prompt: 'Test prompt',
      selectedFiles: {},
      mode: 'standard'
    });
    
    expect(sessionId).toMatch(/^session_\d+_[a-z0-9]+$/);
  });
});
```

## Common Issues and Solutions

### 1. Session Not Starting
**Problem:** Code service fails to start session
**Solution:** Check browser console for API errors, verify endpoint availability

### 2. No Progress Updates
**Problem:** Progress bar stuck at 0%
**Solution:** Ensure WebSocket/polling is working, check network tab

### 3. Files Not Appearing
**Problem:** Generated files don't show in preview
**Solution:** Verify code parsing logic, check message format

### 4. Context Not Passed
**Problem:** Generated code doesn't consider existing files
**Solution:** Ensure selectedFiles are properly passed to startSession

## Performance Considerations

### 1. Code Parsing Optimization
```typescript
// Use useMemo for expensive parsing
const codeBlocks = useMemo(() => {
  return parseCodeBlocksFromMessages(messages);
}, [messages]);
```

### 2. Session Management
```typescript
// Clean up completed sessions
useEffect(() => {
  const interval = setInterval(() => {
    codeService.clearCompletedSessions();
  }, 5 * 60 * 1000); // Every 5 minutes
  
  return () => clearInterval(interval);
}, []);
```

### 3. Memory Management
```typescript
// Limit number of active sessions
const MAX_SESSIONS = 3;

if (activeSessions.length >= MAX_SESSIONS) {
  // Cancel oldest session
  await codeService.cancelSession(oldestSessionId);
}
```

## Advanced Features (Future)

### 1. Streaming Responses
```typescript
// When implemented
const stream = await codeService.startStreamingSession({
  prompt: "Build a complex application",
  onChunk: (chunk) => {
    // Handle streaming updates
  }
});
```

### 2. Agentic Workflows
```typescript
// When available
await codeService.startSession({
  prompt: "Create a full-stack app",
  mode: 'agentic',
  agenticConfig: {
    frameworks: ['CrewAI'],
    agents: ['architect', 'developer', 'tester']
  }
});
```

## Conclusion

The enhanced code integration system provides a powerful, extensible foundation for advanced code generation. The current implementation with mock responses allows immediate testing and development, while the modular architecture ensures easy expansion with real AI capabilities.

Key benefits:
- ✅ Clean separation of concerns
- ✅ Real-time progress tracking
- ✅ Context-aware generation
- ✅ Error handling and recovery
- ✅ Extensible architecture

Next steps involve implementing the full Enhanced Code Orchestrator and connecting to real AI services for production-quality code generation.