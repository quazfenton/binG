# Monaco VFS Editor

A full-featured Monaco-style code editor for editing Virtual File System (VFS) files with support for terminal commands, file explorer integration, and persistent saves.

## Features

- **1920x720 default size** - Auto-fills available screen space
- **Responsive positioning** - Adapts to other panel borders
- **Multi-file tabs** - Edit multiple files simultaneously
- **Syntax highlighting** - 100+ languages supported
- **Diff view** - Compare changes with original
- **Persistent saves** - Integrated with VFS API
- **Terminal integration** - `xdg-open`, `gedit`, `vim`, `nano`, `code`, `cat`, `head`, `tail`
- **File explorer integration** - Right-click to open files
- **Auto-save** - Configurable interval
- **Keyboard shortcuts** - Ctrl+S (save), Ctrl+W (close tab), Escape (close editor)

## Usage

### Basic

```tsx
import { MonacoVFSEditor } from "@/components/monaco-vfs-editor";

<MonacoVFSEditor
  initialFilePath="project/src/index.ts"
  filesystemScopePath="project"
  ownerId="user-123"
  onClose={() => setShowEditor(false)}
  onSave={(path, content) => console.log("Saved:", path)}
/>
```

### With Terminal Integration

```tsx
import { MonacoVFSEditor, executeTerminalCommand } from "@/components/monaco-vfs-editor";

function TerminalWithEditor() {
  const [showEditor, setShowEditor] = useState(false);
  const [editorFile, setEditorFile] = useState("");

  const handleTerminalCommand = async (commandLine: string) => {
    const result = await executeTerminalCommand(commandLine, {
      currentPath: "/project",
      onOpenFile: (event) => {
        setEditorFile(event.filePath);
        setShowEditor(true);
      },
      onOutput: (output) => console.log(output),
    });

    return result;
  };

  return (
    <>
      <Terminal onCommand={handleTerminalCommand} />
      {showEditor && (
        <MonacoVFSEditor
          initialFilePath={editorFile}
          onClose={() => setShowEditor(false)}
        />
      )}
    </>
  );
}
```

### With File Explorer

```tsx
import { MonacoVFSEditor } from "@/components/monaco-vfs-editor";

function FileExplorer() {
  const [showEditor, setShowEditor] = useState(false);
  const [selectedFile, setSelectedFile] = useState("");

  const handleFileClick = (filePath: string) => {
    setSelectedFile(filePath);
    setShowEditor(true);
  };

  return (
    <>
      <FileExplorer onFileClick={handleFileClick} />
      {showEditor && (
        <MonacoVFSEditor
          initialFilePath={selectedFile}
          onClose={() => setShowEditor(false)}
          onSave={(path, content) => {
            // Refresh file list
            refreshFiles();
          }}
        />
      )}
    </>
  );
}
```

## Terminal Commands

| Command | Description | Example |
|---------|-------------|---------|
| `xdg-open <file>` | Open file in editor | `xdg-open src/index.ts` |
| `gedit <file>` | Open in GNOME editor | `gedit README.md` |
| `edit <file>` | Open in editor | `edit config.json` |
| `code <file>` | Open in VS Code style | `code app.tsx` |
| `vim <file>` | Open in Vim style | `vim main.go` |
| `nano <file>` | Open in Nano style | `nano .env` |
| `cat <file>` | Display file content | `cat package.json` |
| `head <file>` | Display first lines | `head -n 20 large.log` |
| `tail <file>` | Display last lines | `tail -n 50 server.log` |

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `initialFilePath` | `string` | `""` | File path to open on mount |
| `initialContent` | `string` | `""` | Initial content (if not from VFS) |
| `filesystemScopePath` | `string` | `"project"` | VFS scope path |
| `ownerId` | `string` | `undefined` | Owner ID for VFS operations |
| `onClose` | `() => void` | `undefined` | Called when editor closes |
| `onSave` | `(path, content) => void` | `undefined` | Called when file is saved |
| `onOpenFile` | `(event) => void` | `undefined` | Called when file open requested |
| `enableDiffView` | `boolean` | `false` | Enable diff view mode |
| `originalContent` | `string` | `undefined` | Original content for diff |
| `readOnly` | `boolean` | `false` | Read-only mode |
| `autoSaveInterval` | `number` | `0` | Auto-save interval (ms) |
| `defaultWidth` | `number` | `1920` | Default width |
| `defaultHeight` | `number` | `720` | Default height |
| `position` | `"center" \| "right" \| "bottom" \| "fullscreen"` | `"center"` | Initial position |
| `zIndex` | `number` | `10000` | Z-index layer |

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+S` / `Cmd+S` | Save file |
| `Ctrl+W` / `Cmd+W` | Close current tab |
| `Escape` | Close editor |
| `Ctrl+F` / `Cmd+F` | Search in file |

## Supported Languages

The editor supports syntax highlighting for 100+ languages including:

- **Web**: TypeScript, JavaScript, JSX, HTML, CSS, SCSS, Vue, Svelte
- **Systems**: Rust, Go, C, C++, Java, C#, Swift, Kotlin
- **Scripting**: Python, Ruby, PHP, Perl, Lua, Shell, PowerShell
- **Data**: JSON, YAML, XML, SQL, GraphQL, TOML
- **Config**: Dockerfile, Makefile, INI, Properties
- **Functional**: Haskell, OCaml, Scala, Clojure, Elixir, Erlang
- **And many more...**

## VFS Integration

The editor integrates with the existing VFS system:

```typescript
// File save emits filesystem update event
emitFilesystemUpdated({
  path: filePath,
  type: "update",
  source: "monaco-editor",
  scopePath: filesystemScopePath,
});

// Other components can listen for updates
onFilesystemUpdated((event) => {
  if (event.source === "monaco-editor") {
    refreshFileList();
  }
});
```

## Examples

### Multi-File Editing

```tsx
<MonacoVFSEditor
  initialFilePath="project/src/index.ts"
  onOpenFile={(event) => {
    // Open additional files in tabs
    console.log("Opening:", event.filePath);
  }}
/>
```

### Diff View

```tsx
<MonacoVFSEditor
  initialFilePath="project/src/app.ts"
  enableDiffView
  originalContent={originalAppContent}
/>
```

### Auto-Save

```tsx
<MonacoVFSEditor
  initialFilePath="project/notes.md"
  autoSaveInterval={30000} // Save every 30 seconds
  onSave={(path, content) => {
    console.log("Auto-saved:", path);
  }}
/>
```

### Read-Only View

```tsx
<MonacoVFSEditor
  initialFilePath="project/LICENSE"
  readOnly
  enableDiffView
/>
```

## Styling

The editor uses Tailwind CSS with glassmorphic design:

- Dark theme with backdrop blur
- Semi-transparent panels
- Custom scrollbars
- Syntax highlighting colors
- Minimap (optional)

## Performance

- Lazy loading for large files
- Virtualized line rendering
- Efficient diff calculation
- Debounced auto-save
- Cross-tab synchronization via BroadcastChannel

## Accessibility

- Keyboard navigation
- Screen reader support
- High contrast mode compatible
- Focus management
- ARIA labels

## Browser Support

- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+

## License

MIT
