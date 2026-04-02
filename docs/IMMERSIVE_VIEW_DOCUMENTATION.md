# Immersive View - Complete Documentation

## Overview

**Immersive View** is a sleek, invisible-by-default fullscreen website embedder that provides advanced content isolation, parsing capabilities, and unique digital design experiences.

### Key Features

| Feature | Description |
|---------|-------------|
| **Invisible UX** | UI appears only on interaction/hover |
| **Semi-Glass Controls** | Transparent glassmorphic control bars |
| **7 Display Templates** | Fullscreen, Split, Grid, Focus, Gallery, Terminal, Minimal |
| **Content Parsing** | Extract titles, images, videos, links, text |
| **Sandbox Isolation** | Secure iframe embedding with configurable restrictions |
| **Device Presets** | Desktop, Laptop, Tablet, Mobile views |
| **Zoom Controls** | 50% - 150% zoom with smooth transitions |
| **History & Bookmarks** | Persistent browsing history and saved sites |
| **Auto-Hide UI** | Configurable delay for distraction-free viewing |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Immersive View Component                      │
├─────────────────────────────────────────────────────────────────┤
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                    Main Content Area                       │  │
│  │  ┌─────────────────────────────────────────────────────┐  │  │
│  │  │              Iframe / Parsed Content                 │  │  │
│  │  │              (Template-Based Layout)                 │  │  │
│  │  └─────────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────┘  │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │   Top Bar    │  │  Bottom Bar  │  │   Side Panels        │  │
│  │  (URL Input) │  │  (Controls)  │  │  (History/Settings)  │  │
│  │              │  │              │  │                      │  │
│  │  • Invisible │  │  • Templates │  │  • Recent Sites      │  │
│  │  • On Hover  │  │  • View Mode │  │  • Bookmarks         │  │
│  │  • Glass UX  │  │  • Zoom      │  │  • Preferences       │  │
│  └──────────────┘  └──────────────┘  └──────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      API Endpoints                               │
├─────────────────────────────────────────────────────────────────┤
│  /api/immersive/content/:url  - Fetch & parse website content   │
└─────────────────────────────────────────────────────────────────┘
```

---

## Display Templates

### 1. Full Immersion
```
┌─────────────────────────────────────┐
│                                     │
│           Full Content              │
│           (No Chrome)               │
│                                     │
└─────────────────────────────────────┘
```
- Complete fullscreen experience
- Auto-hide UI
- Focus mode enabled

### 2. Dual View (Split)
```
┌──────────────┬──────────────┐
│              │              │
│   Site A     │   Site B     │
│              │              │
└──────────────┴──────────────┘
```
- Side by side comparison
- Sync scroll option
- Compare mode

### 3. Content Grid
```
┌───────┬───────┬───────┐
│ Card  │ Card  │ Card  │
├───────┼───────┼───────┤
│ Card  │ Card  │ Card  │
└───────┴───────┴───────┘
```
- Extracted content grid
- Image gallery
- Card layout

### 4. Focus Mode
```
┌─────────────────────────────┐
│                             │
│      Clean Typography       │
│      Reader-Friendly        │
│      Text Only Display      │
│                             │
└─────────────────────────────┘
```
- Distraction-free reading
- Clean typography
- Reader mode

### 5. Media Gallery
```
┌─────────────────────────────┐
│    [    Lightbox    ]       │
│   ○ ○ ○ ○ ○ ○ ○ ○           │
│   Thumbnails Row            │
└─────────────────────────────┘
```
- Media-focused display
- Lightbox viewer
- Slideshow mode

### 6. Terminal View
```
┌─────────────────────────────┐
│ > source code view          │
│ > syntax highlighted        │
│ > dev tools enabled         │
└─────────────────────────────┘
```
- Developer-focused display
- Source code view
- Syntax highlighting

### 7. Minimal Frame
```
┌─────────────────────────────┐
│ ┌─────────────────────────┐ │
│ │     Clean Content       │ │
│ │     Thin Border         │ │
│ └─────────────────────────┘ │
└─────────────────────────────┘
```
- Clean bordered view
- Subtle shadow
- Minimal aesthetic

---

## View Modes

| Mode | Icon | Description |
|------|------|-------------|
| **Raw Embed** | Box | Direct iframe embedding |
| **Parsed Content** | Scissors | Extracted elements display |
| **Isolated** | Shield | Sandboxed secure view |
| **Custom Style** | Palette | Styled/transformed display |

---

## Device Presets

| Device | Dimensions | Use Case |
|--------|------------|----------|
| Desktop | 100% × 100% | Full viewport |
| Laptop | 1366 × 768 | Standard laptop |
| Tablet | 768 × 1024 | iPad portrait |
| Mobile | 375 × 667 | iPhone SE |

---

## UI Components

### Top Entry Bar (Invisible by Default)

```tsx
// Appears on hover or when no content loaded
<AnimatePresence>
  {(showControls || !currentUrl) && (
    <motion.div
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      className="absolute top-0 left-0 right-0 z-50"
    >
      {/* Glass Bar with URL Input */}
      <div className="bg-gradient-to-r from-purple-500/10 via-pink-500/10 to-blue-500/10 backdrop-blur-xl">
        {/* URL Input, Quick Actions, Fullscreen Toggle */}
      </div>
    </motion.div>
  )}
</AnimatePresence>
```

**Features:**
- URL input with protocol auto-detection
- Quick actions (refresh, bookmark, copy, share, external)
- Fullscreen toggle
- Opacity: 30% (configurable)
- Auto-hide after 3 seconds (configurable)

### Bottom Control Bar

```tsx
// Slides up on hover
<motion.div
  initial={{ opacity: 0, y: 20 }}
  animate={{ opacity: 1, y: 0 }}
  className="absolute bottom-0 left-0 right-0 z-50"
>
  {/* Template Selector, View Mode, Device, Zoom, Settings */}
</motion.div>
```

**Controls:**
- Template selector dropdown
- View mode toggle (4 modes)
- Device preset selector
- Zoom slider (50-150%)
- Sandbox isolation toggle
- Parse content button
- History panel toggle
- Settings panel toggle

### Side Panels

**History Panel (Left):**
- Recent URLs (last 10)
- Bookmarked sites
- Clear history option

**Settings Panel (Right):**
- UI opacity slider
- Auto-hide delay
- Sandbox isolation toggle
- Clear all data

---

## Glass Styles

```typescript
const GLASS_STYLES = {
  light: "bg-white/5 backdrop-blur-xl border-white/10",
  dark: "bg-black/40 backdrop-blur-xl border-white/5",
  gradient: "bg-gradient-to-r from-purple-500/10 via-pink-500/10 to-blue-500/10 backdrop-blur-xl border-white/10",
  crystal: "bg-white/2 backdrop-blur-2xl border-white/20 shadow-2xl",
};
```

---

## API Endpoints

### Fetch & Parse Content

```http
GET /api/immersive/content/:url?parse=true&cache=true
```

**Parameters:**
- `url` - URL-encoded website URL
- `parse` - Whether to parse content (default: false)
- `cache` - Use cached content if available (default: true)

**Response:**
```json
{
  "success": true,
  "cached": false,
  "content": {
    "url": "https://example.com",
    "title": "Example Domain",
    "description": "Example domain description",
    "images": [
      { "src": "https://...", "alt": "Image alt text" }
    ],
    "videos": [
      { "src": "https://...", "type": "youtube" }
    ],
    "links": [
      { "href": "https://...", "text": "Link text" }
    ],
    "text": "Extracted text content...",
    "contentType": "text/html; charset=utf-8",
    "favicon": "https://example.com/favicon.ico"
  }
}
```

### Clear Cache

```http
DELETE /api/immersive/content/:url
DELETE /api/immersive/content/all  (clear all)
```

---

## Usage

### 1. Open Immersive View

- Click top-left chevron or press `Ctrl+Shift+T`
- Select **"Immersive"** tab (aperture icon)

### 2. Load a Website

**Option A - URL Input:**
1. Hover top bar to reveal
2. Enter URL in input field
3. Press Enter or click Zap button

**Option B - Preset Sites:**
- Click any preset site button:
  - Tech News (Hacker News)
  - Documentation (MDN)
  - Video Platform (YouTube)
  - Code Repository (GitHub)
  - Design Inspiration (Dribbble)
  - Data Visualization (Our World in Data)

### 3. Change Display Template

1. Hover bottom bar
2. Click "Template" button
3. Select from 7 templates

### 4. Switch View Mode

1. Hover bottom bar
2. Click view mode icon:
   - Box: Raw embed
   - Scissors: Parsed content
   - Shield: Isolated
   - Palette: Custom style

### 5. Adjust Device View

1. Hover bottom bar
2. Click device icon (Desktop/Laptop/Tablet/Mobile)

### 6. Zoom

1. Hover bottom bar
2. Use zoom slider (50% - 150%)

### 7. Bookmark Site

1. Click star icon in top bar
2. Access from history panel

### 8. Parse Content

1. Load a website
2. Click Wand icon in bottom bar
3. View extracted content in parsed mode

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl/Cmd + F` | Focus URL input |
| `Ctrl/Cmd + D` | Toggle bookmark |
| `Ctrl/Cmd + R` | Refresh |
| `Ctrl/Cmd + H` | Toggle history |
| `Ctrl/Cmd + S` | Toggle settings |
| `Esc` | Hide UI / Exit fullscreen |
| `F11` | Toggle fullscreen |

---

## Configuration

### UI Opacity

Adjust control bar transparency:
```typescript
const [uiOpacity, setUiOpacity] = useState(0.3); // 30%
// Range: 0.1 - 1.0
```

### Auto-Hide Delay

Configure how long controls stay visible:
```typescript
const [autoHideDelay, setAutoHideDelay] = useState(3000); // 3 seconds
// Range: 1000 - 10000ms
```

### Sandbox Isolation

Toggle iframe security restrictions:
```typescript
const [isIsolated, setIsIsolated] = useState(true);

// Isolated: allow-same-origin allow-scripts allow-forms allow-popups allow-presentation
// Non-isolated: + allow-popups-to-escape-sandbox
```

---

## Content Parsing

### Extraction Process

```typescript
// 1. Fetch HTML
const response = await fetch(url);
const html = await response.text();

// 2. Extract title
const title = extractTitle(html);

// 3. Extract description
const description = extractDescription(html);

// 4. Extract images (max 50)
const images = extractImages(html, url);

// 5. Extract videos (max 20)
const videos = extractVideos(html, url);

// 6. Extract links (max 100)
const links = extractLinks(html, url);

// 7. Extract text (max 5000 chars)
const text = extractText(html);

// 8. Extract favicon
const favicon = extractFavicon(html, url);
```

### Parsed Content Display

When view mode is set to "Parsed":
- Title displayed prominently
- Description shown below
- Images in grid layout
- Videos as embeddable players
- Links as clickable cards
- Text in readable format

---

## Persistence

### LocalStorage Keys

```typescript
localStorage.setItem("immersive_history", JSON.stringify(history));
localStorage.setItem("immersive_bookmarks", JSON.stringify(bookmarks));
```

### Data Structure

```typescript
interface EmbedConfig {
  url: string;
  title?: string;
  favicon?: string;
  timestamp: number;
}

// History: Last 50 URLs
// Bookmarks: Unlimited (practically)
```

---

## Security Considerations

### Iframe Sandbox

When isolation enabled:
```html
sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-presentation"
```

**Restrictions:**
- No top-level navigation
- No popups to escape sandbox
- No pointer lock
- No fullscreen without user gesture

### CORS Handling

- Proxy API handles cross-origin requests
- User-Agent rotation
- Proper referrer policy

### Content Security

- Input URL validation
- Protocol enforcement (http/https only)
- XSS prevention via sandbox

---

## Performance Optimization

### Lazy Loading

```typescript
// Iframe loads only when URL set
{currentUrl ? renderIframe : <EmptyState />}

// Lazy attribute on iframe
loading="lazy"
```

### Cached Parsing

```typescript
// 1 hour TTL
const CACHE_TTL = 60 * 60 * 1000;

// Max 500 entries
const MAX_CACHE_SIZE = 500;

// LRU eviction
entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
```

### Smooth Animations

```typescript
// Framer Motion for all transitions
<motion.div
  initial={{ opacity: 0, y: 20 }}
  animate={{ opacity: 1, y: 0 }}
  exit={{ opacity: 0, y: 20 }}
  transition={{ duration: 0.2 }}
/>
```

---

## Troubleshooting

### Site Won't Load

1. **Check if site allows embedding** - Some sites send X-Frame-Options: DENY
2. **Try external link** - Click "Open External" button
3. **Use parsed mode** - Content may still be extractable

### Controls Not Appearing

1. **Move mouse** - Triggers hover detection
2. **Check opacity setting** - May be set too low
3. **Increase auto-hide delay** - In settings panel

### Parsing Returns Empty

1. **Site may block scraping** - Some sites require JavaScript
2. **Check network tab** - Verify API response
3. **Clear cache** - Cached empty result may exist

### Bookmarks Not Saving

1. **Check localStorage quota** - Browser may limit storage
2. **Clear old history** - Free up space
3. **Verify permissions** - Browser may block storage

---

## Future Enhancements

- [ ] Multi-tab browsing within immersive view
- [ ] Sync scroll for split view
- [ ] Custom CSS injection for styled mode
- [ ] Screenshot capture
- [ ] PDF export of parsed content
- [ ] Reading time estimate
- [ ] Text-to-speech for parsed content
- [ ] Collaborative viewing (multi-user)
- [ ] Annotation/highlighting tools
- [ ] AI summary generation

---

## File Structure

```
binG/
├── components/plugins/immersive-view.tsx    # Main component
├── app/api/immersive/
│   └── content/[url]/route.ts               # Content proxy API
├── data/
│   └── immersive-content-cache.json         # Parsed content cache
└── docs/IMMERSIVE_VIEW_DOCUMENTATION.md     # This file
```

---

## Credits

Built with:
- Next.js 15
- React 19
- Framer Motion
- Tailwind CSS
- Lucide Icons
- Sonner (toasts)
