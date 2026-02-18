# Debug: Dual Data Sources in CodePreviewPanel

## Issue
The CodePreviewPanel was not opening because it was missing the `isOpen` prop and had mismatched props.

## Current Implementation (DEBUG MODE)

### Two Data Sources
Currently, the CodePreviewPanel accepts project files from **two sources**:

1. **Parsed from messages** (original approach)
   - Uses `parseCodeBlocksFromMessages(messages)` 
   - Extracts code blocks with filenames from assistant messages
   - Self-contained, no external state needed

2. **Injected via prop** (debug addition)
   - Uses `projectFiles` prop from conversation-interface
   - Allows code service files to be shown even without message parsing
   - Enables debugging of which approach works better

### Code Changes

#### `components/code-preview-panel.tsx`
```typescript
interface CodePreviewPanelProps {
  messages: Message[];
  isOpen: boolean;
  onClose: () => void;
  // DEBUG: Dual data source - to be removed
  projectFiles?: { [key: string]: string };
  // ... commands management
}

// In component:
useEffect(() => {
  if (codeBlocks.length > 0) {
    // Parse from messages (primary)
    const parsedData = parseCodeBlocksFromMessages(messages);
    setProjectStructure(parsedData.projectStructure);
  } else if (projectFiles && Object.keys(projectFiles).length > 0) {
    // DEBUG: Fallback to injected files
    setProjectStructure({ name: 'injected-project', files: projectFiles, ... });
  }
}, [codeBlocks, messages, projectFiles]);
```

#### `components/conversation-interface.tsx`
```tsx
<CodePreviewPanel
  isOpen={showCodePreview}
  messages={messages}
  onClose={() => setShowCodePreview(false)}
  projectFiles={projectFiles}  {/* DEBUG: Added for testing */}
  commandsByFile={commandsByFile}
  // ...
/>
```

## TODO: After Debugging

### Decision Point
Choose ONE approach and remove the other:

**Option A: Keep message parsing only**
- Remove `projectFiles` prop from interface
- Remove fallback useEffect branch
- Remove `projectFiles` from dependency array
- Update conversation-interface to not pass prop

**Option B: Use injected files primarily**
- Make `projectFiles` required (or keep optional with better merging)
- Remove message parsing logic
- Simpler data flow, single source of truth

### Files to Clean Up
1. `components/code-preview-panel.tsx` - Remove dual source logic
2. `components/conversation-interface.tsx` - Remove unused prop if Option A
3. This `removeLaterDebug.md` file

## Testing Checklist
- [ ] Code preview opens when toggle button clicked
- [ ] Code blocks from messages are displayed
- [ ] Files from code service are displayed
- [ ] Both sources work together without conflicts
- [ ] Decide which approach to keep

## Related Issues
- Fixed: Missing `isOpen` prop causing panel to not render
- Fixed: Removed bad condition that closed panel on chat tab switch
- Fixed: Database native module graceful fallback
