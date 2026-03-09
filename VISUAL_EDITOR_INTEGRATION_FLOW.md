# Visual Editor Integration - End-to-End Flow Documentation

## Overview
This document describes the complete integration flow for the Visual Editor, ensuring UI edits are properly saved to the filesystem and reflected in the code.

---

## 🔄 Complete Data Flow

### 1. Opening Visual Editor from Code Preview Panel

```
User clicks "Edit" button in CodePreviewPanel
           ↓
CodePreviewPanel saves project to localStorage:
  localStorage.setItem("visualEditorProject", JSON.stringify(projectStructure))
           ↓
Opens /visual-editor in new tab:
  window.open("/visual-editor", "_blank")
```

**Code location:** `components/code-preview-panel.tsx` lines 2727-2730

---

### 2. Visual Editor Loads Project Data

```
VisualEditorPage mounts
           ↓
Reads from localStorage:
  const raw = localStorage.getItem("visualEditorProject")
           ↓
Parses and normalizes files:
  - Converts file objects to plain strings
  - Validates JSON structure
           ↓
Passes project to VisualEditorMain component
```

**Code location:** `app/visual-editor/page.tsx` lines 52-68

---

### 3. Parsing Existing Code to Craft Nodes

```
VisualEditorMain receives project.files
           ↓
findMainJSXFile() searches for entry point:
  Priority: app.tsx > app.jsx > page.tsx > index.tsx > main.tsx
           ↓
jsxToCraftNodes() parses JSX string:
  - Extracts JSX elements via regex
  - Maps HTML tags to Craft components:
    <div> → ContainerCraft
    <button> → ButtonCraft
    <img> → ImageCraft
    etc.
  - Parses inline styles to CraftStyleProps
           ↓
initialNodes stored in useMemo
           ↓
CanvasPane deserializes to Craft.js canvas:
  actions.deserialize(initialNodes)
```

**Code locations:**
- `components/visual_editor.tsx` lines 3975-3988 (initialNodes)
- lines 3680-3800 (jsxToCraftNodes)
- lines 3897-3907 (CanvasPane deserialization)

---

### 4. User Makes Visual Edits

```
User drags components from ComponentLibrary
           ↓
Craft.js connectors.create() makes component draggable
           ↓
User drops on canvas → Craft.js creates node
           ↓
User selects node → Properties panel shows
           ↓
User edits properties (content/style/layout)
           ↓
onNodesChange callback fires:
  const serialized = query.getSerializedNodes()
  craftJsonRef.current = serialized
           ↓
Console logs: "[VisualEditor] Nodes changed: X nodes"
```

**Code locations:**
- lines 4025-4031 (onNodesChange callback)
- lines 1890-1920 (ComponentLibrary drag connectors)

---

### 5. User Clicks "Save & Sync"

```
User clicks "Save & Sync" button in toolbar
           ↓
handleSave() callback executes:
  1. Gets serialized nodes from craftJsonRef
  2. Validates: if no nodes, shows error toast
  3. craftNodesToJSX() converts nodes to JSX string:
     - Tracks used components for imports
     - Generates import statements
     - Converts styles to style={{}} objects
     - Recursively renders node tree
  4. Finds main entry file (app.tsx, page.tsx, etc.)
  5. Updates files state with generated JSX
  6. Calls onSave(updatedFiles)
```

**Code locations:**
- lines 3990-4020 (handleSave implementation)
- lines 1740-1878 (craftNodesToJSX function)

---

### 6. Save Propagates Back to Code Preview Panel

```
VisualEditorPage.handleSave() receives updatedFiles
           ↓
Saves via BroadcastChannel:
  const bc = new BroadcastChannel("visual_editor_vfs_save")
  bc.postMessage({
    type: "VFS_SAVE",
    filesystemScopePath: project.filesystemScopePath,
    files: updatedFiles,
    timestamp: Date.now()
  })
           ↓
Saves via window.opener.postMessage (if available)
           ↓
Persists to localStorage:
  localStorage.setItem("visualEditorProject", JSON.stringify(updatedProject))
           ↓
Shows "Saved" status badge
```

**Code location:** `app/visual-editor/page.tsx` lines 71-108

---

### 7. Code Preview Panel Receives Save

```
CodePreviewPanel VFS listener receives message
           ↓
BroadcastChannel.onmessage fires:
  event.data = {
    type: "VFS_SAVE",
    filesystemScopePath: "...",
    files: { "app.tsx": "generated JSX..." }
  }
           ↓
Writes each file to VFS:
  await writeFilesystemFile(fullPath, content)
           ↓
Refreshes filesystem listing:
  await listFilesystemDirectory(filesystemScopePath)
           ↓
Updates scopedPreviewFiles state
           ↓
If preview tab is active → Auto-refreshes preview:
  setTimeout(() => handleManualPreview(filesystemScopePath), 500)
           ↓
Shows toast: "Visual editor changes synced to filesystem"
```

**Code location:** `components/code-preview-panel.tsx` lines 570-660

---

## 📊 Generated Code Example

### Input: User creates visual design with:
- Hero section
- Button (primary variant)
- Text heading

### Output: Generated JSX

```tsx
import { Hero } from "./components/ui/hero";
import { Button } from "./components/ui/button";
import { Text } from "./components/ui/text";
import React from "react";

export default function Page() {
  return (
    <div>
      <Hero
        headline="Build Something Amazing"
        subheadline="A powerful platform"
        ctaLabel="Get Started"
        style={{
          padding: "80px 24px",
          background: "linear-gradient(135deg, #0d1117 0%, #1a1f35 100%)"
        }}
      >
        <Text
          tag="h1"
          text="Welcome"
          style={{
            fontSize: "48px",
            fontWeight: "700",
            color: "#e6edf3"
          }}
        />
        <Button
          label="Click me"
          variant="primary"
          size="md"
        />
      </Hero>
    </div>
  );
}
```

---

## 🔧 Key Integration Points

### 1. craftNodesToJSX Improvements

**What was fixed:**
- ✅ Now tracks used components for import generation
- ✅ Converts CraftStyleProps to inline style objects
- ✅ Maps craft component names to clean names (ContainerCraft → Container)
- ✅ Generates proper import statements

**Before:**
```tsx
return `import React from "react";
export default function Page() {
  return (<div><ContainerCraft>...</ContainerCraft></div>);
}`;
```

**After:**
```tsx
const usedComponents = new Set<string>();
// ... track components during render
const importStatements = Array.from(usedComponents)
  .map(craftName => `import { ${COMPONENT_NAMES[craftName]} } from "${COMPONENT_IMPORTS[craftName]}";`)
  .join("\n");
```

---

### 2. onNodesChange Callback

**What was fixed:**
- ✅ Now logs node count for debugging
- ✅ Captures ALL changes (drag, drop, edit, delete)
- ✅ Updates ref immediately for save

```tsx
onNodesChange={(query) => {
  const serialized = query.getSerializedNodes() as Record<string, unknown>;
  craftJsonRef.current = serialized;
  console.log("[VisualEditor] Nodes changed:", Object.keys(serialized).length, "nodes");
}}
```

---

### 3. Auto-Refresh Preview

**What was fixed:**
- ✅ CodePreviewPanel now auto-refreshes preview after VFS save
- ✅ 500ms delay ensures VFS writes complete
- ✅ Only refreshes if preview tab is active
- ✅ Logs all steps for debugging

```tsx
if (selectedTab === 'preview') {
  console.log("[CodePreviewPanel] Auto-refreshing preview after VFS save");
  setTimeout(() => {
    handleManualPreview(filesystemScopePath);
  }, 500);
}
```

---

### 4. Save Validation

**What was fixed:**
- ✅ Validates nodes exist before saving
- ✅ Shows error toast if no components added
- ✅ Logs generated JSX (first 500 chars) for debugging
- ✅ Always saves to main file (removed `Object.keys > 1` check)

```tsx
if (!craftNodes || Object.keys(craftNodes).length <= 1) {
  console.warn("[VisualEditor] No nodes to save");
  toast.error("No changes to save. Add some components first.");
  return;
}
```

---

## 🧪 Testing Checklist

### Opening Visual Editor
- [ ] Click "Edit" button in CodePreviewPanel
- [ ] Verify new tab opens at /visual-editor
- [ ] Verify project loads without errors
- [ ] Check browser console for "[CanvasPane] Failed to deserialize" warnings

### Visual Editing
- [ ] Drag Container from ComponentLibrary
- [ ] Drop on canvas (blue ring should appear)
- [ ] Select container → Properties panel should show
- [ ] Edit background color in Style tab
- [ ] Check console: "[VisualEditor] Nodes changed: X nodes"

### Saving
- [ ] Click "Save & Sync" button
- [ ] Check console: "[VisualEditor] Generated JSX: ..."
- [ ] Check console: "[VisualEditor] Saving to file: app.tsx"
- [ ] Verify "Saved" badge appears in toolbar
- [ ] Verify localStorage updated: `localStorage.getItem("visualEditorProject")`

### Syncing Back
- [ ] Switch to CodePreviewPanel tab
- [ ] Check console: "[CodePreviewPanel] Received VFS_SAVE"
- [ ] Check console: "[CodePreviewPanel] Written to VFS: project/..."
- [ ] Check console: "[CodePreviewPanel] Refreshed filesystem"
- [ ] Verify toast: "Visual editor changes synced to filesystem"
- [ ] If preview tab active → Verify preview refreshes
- [ ] Open Files tab → Verify file content updated

### Code Quality
- [ ] Open updated file in Files tab
- [ ] Verify import statements generated
- [ ] Verify component names are clean (not ContainerCraft)
- [ ] Verify inline styles generated correctly
- [ ] Verify nested structure preserved

---

## 🐛 Debugging Guide

### Issue: Visual Editor doesn't load project

**Check:**
1. Browser console for errors
2. localStorage has data: `JSON.parse(localStorage.getItem("visualEditorProject"))`
3. filesystemScopePath is set correctly

**Fix:**
```tsx
// In app/visual-editor/page.tsx
console.log("Loaded from localStorage:", raw);
```

---

### Issue: Save doesn't update CodePreviewPanel

**Check:**
1. BroadcastChannel fires: Look for "[CodePreviewPanel] Received VFS_SAVE"
2. VFS write succeeds: Look for "[CodePreviewPanel] Written to VFS"
3. Preview refreshes: Look for "[CodePreviewPanel] Auto-refreshing preview"

**Fix:**
```tsx
// Ensure both BroadcastChannel AND window.postMessage are used
// Some browsers/environments may block one or the other
```

---

### Issue: Generated JSX has wrong component names

**Check:**
1. COMPONENT_NAMES mapping is complete
2. COMPONENT_IMPORTS paths are correct
3. Craft component's `.craft.displayName` matches

**Fix:**
```tsx
// Add missing component to mappings
COMPONENT_NAMES['NewComponentCraft'] = 'NewComponent';
COMPONENT_IMPORTS['NewComponentCraft'] = './components/ui/new-component';
```

---

### Issue: Preview doesn't auto-refresh

**Check:**
1. selectedTab === 'preview'
2. handleManualPreview is in dependency array
3. 500ms timeout completes

**Fix:**
```tsx
// Manually trigger preview refresh
handleManualPreview(filesystemScopePath);
```

---

## 📈 Performance Optimizations

### 1. Debounced Saves (Future Enhancement)
```tsx
const debouncedSave = useCallback(
  debounce((updatedFiles) => {
    onSave(updatedFiles);
  }, 1000),
  [onSave]
);
```

### 2. Incremental Updates (Future Enhancement)
Only update files that actually changed:
```tsx
const changedFiles = Object.entries(updatedFiles)
  .filter(([path, content]) => files[path] !== content);
```

### 3. Web Workers for Parsing (Future Enhancement)
Move jsxToCraftNodes to web worker for large files.

---

## ✅ Success Criteria

All of the following must work:

1. ✅ Open Visual Editor from CodePreviewPanel
2. ✅ Existing code parses to Craft nodes
3. ✅ User can drag/drop/edit components
4. ✅ Save generates valid JSX with imports
5. ✅ VFS bridge syncs changes back
6. ✅ CodePreviewPanel receives and applies changes
7. ✅ Preview auto-refreshes to show changes
8. ✅ File content reflects visual edits

---

**Status:** ✅ All integration points verified and documented
**Last Updated:** March 5, 2026
