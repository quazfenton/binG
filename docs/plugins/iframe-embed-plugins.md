# Iframe Embed Plugins: Glitch & Observable

This document describes the new iframe-based embed plugins added to the binG0 platform.

## New Plugins

### 1. Glitch Projects Embed (`glitch-embed-plugin.tsx`)

**Purpose**: Embed live Glitch projects for collaborative code editing and preview.

**Features**:
- **Live Code Editor**: Full Glitch IDE embedded in iframe
- **Live Preview**: Real-time preview of web applications
- **Split View**: Option to show code, preview, or both simultaneously
- **Pop-out Window**: Open projects in resizable popup windows
- **Direct Links**: Quick access to editor and preview URLs

**Supported URL Formats**:
```
https://glitch.com/edit/#!project:project-name
https://project-name.glitch.me
```

**Embed Modes**:
- **Code Only**: Shows the Glitch editor (600px height)
- **Preview Only**: Shows the live app preview (400px height)
- **Code + Preview**: Split view with both editor and preview (800px height)

**Security**:
- Sandboxed iframe with appropriate permissions
- Allows: scripts, forms, popups, modals, camera, microphone, MIDI, geolocation
- Prevents: top navigation, pointer lock

**Usage**:
1. Navigate to Plugins tab
2. Select "Glitch Projects"
3. Enter Glitch project URL
4. Choose embed mode (code/preview/both)
5. Click "Load Project"

---

### 2. Observable Notebooks Embed (`observable-embed-plugin.tsx`)

**Purpose**: Embed interactive Observable notebooks for data visualization and exploration.

**Features**:
- **Interactive Notebooks**: Full Observable notebook experience
- **Live Data Visualization**: Interactive charts and graphs
- **Author Attribution**: Displays notebook author
- **Pop-out Window**: Open notebooks in resizable popup windows
- **Quick Links**: Direct access to notebook and author profile

**Supported URL Format**:
```
https://observablehq.com/@author/notebook-name
```

**Embed Height**: 700px (optimized for notebook content)

**Security**:
- Sandboxed iframe with appropriate permissions
- Allows: scripts, forms, popups, modals, downloads
- Advanced permissions: accelerometer, camera, geolocation, gyroscope, microphone, MIDI, USB, VR, XR

**Usage**:
1. Navigate to Plugins tab
2. Select "Observable Notebooks"
3. Enter Observable notebook URL
4. Click "Load Notebook"

**Example Notebooks**:
- https://observablehq.com/@d3/learn-d3
- https://observablehq.com/@observablehq/plot-introduction
- https://observablehq.com/@mbostock/shape-chaos

---

## Integration

### Added to Interaction Panel

Both plugins are integrated into the `interaction-panel.tsx` as pop-out plugins:

```typescript
const popOutPlugins: Plugin[] = [
  // ... other plugins
  {
    id: "glitch-embed",
    name: "Glitch Projects",
    description: "Embed Glitch projects for live code editing and preview",
    icon: Code,
    component: GlitchEmbedPlugin,
    category: "code",
    defaultSize: { width: 1100, height: 800 },
    minSize: { width: 800, height: 600 },
  },
  {
    id: "observable-embed",
    name: "Observable Notebooks",
    description: "Embed Observable notebooks for interactive data visualization",
    icon: BarChart3,
    component: ObservableEmbedPlugin,
    category: "data",
    defaultSize: { width: 1100, height: 800 },
    minSize: { width: 800, height: 600 },
  },
];
```

### Plugin Categories

- **Glitch Projects**: Categorized under "code" - appears with other development tools
- **Observable Notebooks**: Categorized under "data" - appears with data visualization tools

### Window Management

Both plugins support:
- **Embedded View**: Display within the Plugins tab
- **Pop-out Window**: Click the external link icon to open in a new resizable window
- **Close Button**: Easy close when done

Pop-out window specifications:
- **Width**: 1100px (Glitch), 1100px (Observable)
- **Height**: 800px (Glitch), 800px (Observable)
- **Position**: Centered on screen
- **Features**: Resizable, scrollable

---

## Technical Implementation

### Iframe Security

Both plugins use secure iframe sandboxing:

```typescript
// Glitch sandbox attributes
sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
allow="camera; microphone; midi; geolocation; display-capture; encrypted-media; fullscreen"

// Observable sandbox attributes  
sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads"
allow="accelerometer; ambient-light-sensor; camera; encrypted-media; geolocation; gyroscope; microphone; midi; usb; vr; xr-spatial-tracking"
```

### URL Parsing

**Glitch**:
```typescript
const extractProjectName = (url: string): string | null => {
  const urlObj = new URL(url);
  if (!urlObj.hostname.endsWith('.glitch.me') && urlObj.hostname !== 'glitch.com') {
    return null;
  }
  // Extract from hash or subdomain
  // ...
}
```

**Observable**:
```typescript
const extractNotebookInfo = (url: string): { author: string; notebook: string } | null => {
  const urlObj = new URL(url);
  if (!urlObj.hostname.includes('observablehq.com')) {
    return null;
  }
  const pathParts = urlObj.pathname.split('/').filter(Boolean);
  if (pathParts.length >= 2 && pathParts[0].startsWith('@')) {
    return {
      author: pathParts[0].substring(1),
      notebook: pathParts[1],
    };
  }
  return null;
}
```

### Responsive Design

Both plugins adapt to container size:
- **Minimum Width**: 800px
- **Minimum Height**: 600px
- **Default**: 1100px × 800px
- **Fullscreen Capable**: Via pop-out window

---

## Use Cases

### Glitch Projects

1. **Live Coding Demos**: Show real-time code changes during conversations
2. **Collaborative Development**: Multiple users can edit simultaneously
3. **Web App Prototyping**: Quick prototyping of web applications
4. **Educational Content**: Teaching web development with live examples
5. **Code Reviews**: Review and modify code in real-time

### Observable Notebooks

1. **Data Exploration**: Interactive data analysis and visualization
2. **Educational Content**: Learn D3, Plot, and data visualization techniques
3. **Research Sharing**: Share reproducible research with interactive elements
4. **Dashboard Creation**: Build and share interactive dashboards
5. **Data Storytelling**: Create narrative-driven data visualizations

---

## Future Enhancements

### Planned Features

1. **Project Creation**: Create new Glitch projects directly from the plugin
2. **Notebook Forking**: Fork Observable notebooks with one click
3. **Authentication**: Optional login for saving changes
4. **Collaboration**: Real-time collaboration indicators
5. **Export Options**: Export code/visualizations from embedded projects
6. **Custom Themes**: Match plugin theme to application theme
7. **Offline Support**: Cache projects for offline viewing

### Integration Opportunities

1. **AI-Assisted Coding**: Use AI to generate Glitch project code
2. **Data Analysis**: Use AI to create Observable notebooks from datasets
3. **Version Control**: Track project versions and changes
4. **Sharing**: Share embedded projects with conversation participants
5. **Templates**: Pre-built templates for common use cases

---

## Troubleshooting

### Common Issues

**Issue**: "Invalid URL" error
- **Solution**: Ensure URL format matches examples provided
- **Glitch**: Use `https://glitch.com/edit/#!project:name` or `https://name.glitch.me`
- **Observable**: Use `https://observablehq.com/@author/notebook`

**Issue**: Iframe not loading
- **Solution**: Check browser console for CORS or sandbox errors
- **Fix**: Ensure browser allows third-party cookies and iframes

**Issue**: Pop-out window blocked
- **Solution**: Allow popups for the domain in browser settings
- **Alternative**: Use embedded view within the tab

**Issue**: Slow loading
- **Solution**: Check internet connection, try smaller projects first
- **Note**: Large notebooks/projects may take time to initialize

---

## Related Documentation

- [Plugin System Architecture](./plugin-architecture.md)
- [Iframe Security Guidelines](./iframe-security.md)
- [Embed Plugin Development Guide](./embed-plugin-guide.md)
- [Observable API Documentation](https://observablehq.com/developer)
- [Glitch API Documentation](https://docs.glitch.com/)
