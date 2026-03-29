# Zine Flow Engine - Complete Documentation

## Overview

**Zine Flow Engine** is an avant-garde, boundary-breaking multi-purpose display system that reimagines content delivery as an artistic, dynamic experience. It breaks conventional UI boundaries to create floating, rotating, and animated content elements from multiple sources.

### Philosophy

> "Uncontained UI events displayed free from conventional boundaries - an artistic experiment in dynamic content delivery."

### Key Features

| Feature | Description |
|---------|-------------|
| **Unbounded Display** | Content floats freely without conventional UI borders |
| **Multi-Source Input** | RSS, webhooks, APIs, OAuth integrations, manual input |
| **20+ Artistic Templates** | Floating, rotating, spiral, wave, orbit, neon, brutalist, etc. |
| **Auto-Rotation** | Templates automatically rotate for dynamic visual interest |
| **Content Deduplication** | Intelligent hash-based deduplication prevents repeats |
| **Flying Animations** | Content elements float, bounce, and drift across screen |
| **Color Schemes** | 6 curated themes: neon, sunset, ocean, forest, monochrome, chalkboard |
| **Integration Hooks** | Discord, Twitter, GitHub, Notion OAuth connections |
| **Notification System** | Fade-in notifications and drop-in text displays |
| **Invisible Background** | Content can appear as invisible chalkboard text |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Zine Flow Engine                              │
├─────────────────────────────────────────────────────────────────┤
│  ┌───────────────────────────────────────────────────────────┐  │
│  │              Free-Floating Content Canvas                  │  │
│  │  ┌─────┐     ┌──────────┐    ┌────┐                       │  │
│  │  │Item │  ┌──┤  Item    ├────┤Item│──┐                    │  │
│  │  │ 1   │  │  │   2      │    │ 3   │  │                    │  │
│  │  └─────┘  │  └──────────┘    └────┘  │                    │  │
│  │           │                          │                    │  │
│  │     ┌─────┴─────┐              ┌─────┴────┐               │  │
│  │     │  Item 4   │              │  Item 5  │               │  │
│  │     └───────────┘              └──────────┘               │  │
│  └───────────────────────────────────────────────────────────┘  │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │   Content    │  │   Template   │  │   Integration        │  │
│  │   Sources    │  │   Engine     │  │   Manager            │  │
│  │              │  │              │  │                      │  │
│  │  • RSS       │  │  • 20+       │  │  • OAuth             │  │
│  │  • Webhook   │  │  • Rotation  │  │  • Webhook           │  │
│  │  • API       │  │  • Animation │  │  • API               │  │
│  │  • Manual    │  │  • Blending  │  │  • Cron              │  │
│  └──────────────┘  └──────────────┘  └──────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      API Endpoints                               │
├─────────────────────────────────────────────────────────────────┤
│  /api/zine/rss/:url        - Parse RSS feeds                    │
│  /api/zine/webhook         - Handle webhook events              │
│  /api/zine/integration/:id - Fetch integration data             │
└─────────────────────────────────────────────────────────────────┘
```

---

## Display Templates (20+)

### Motion-Based Templates

| Template | Description | Best For |
|----------|-------------|----------|
| **floating** | Items drift freely with physics | Ambient displays |
| **rotating** | Items rotate at random angles | Dynamic layouts |
| **spiral** | Items arrange in spiral pattern | Artistic presentations |
| **wave** | Items flow in wave pattern | Music/audio content |
| **orbit** | Items orbit around center | Hub-and-spoke content |
| **scatter** | Random positions with movement | Chaotic/creative displays |

### Style-Based Templates

| Template | Description | Visual Style |
|----------|-------------|--------------|
| **neon** | Glowing borders, cyber aesthetic | Cyan/pink glow |
| **chalkboard** | Chalk-like text on dark background | Educational |
| **typewriter** | Monospace, retro typing effect | Code/text |
| **brutalist** | Bold borders, raw aesthetic | Statement pieces |
| **glassmorphic** | Frosted glass, blur effects | Modern UI |
| **minimal** | Clean, no decorations | Professional |
| **maximal** | Full decorations, borders | Rich content |

### Layout Templates

| Template | Description | Use Case |
|----------|-------------|----------|
| **grid** | Organized grid layout | Structured content |
| **stream** | Vertical flow | News feeds |
| **cluster** | Grouped by similarity | Related items |
| **random** | Completely random | Surprise element |
| **organic** | Natural, flowing | Creative content |
| **retro** | Vintage styling | Nostalgic displays |
| **futuristic** | Sci-fi aesthetic | Tech content |

---

## Color Schemes

### Neon
```
Primary:   #00f0ff (Cyan)
Secondary: #ff00ff (Magenta)
Accent:    #ffff00 (Yellow)
Background: rgba(0, 0, 0, 0.9)
Text:      #ffffff
```

### Sunset
```
Primary:   #ff6b6b (Coral)
Secondary: #feca57 (Orange)
Accent:    #ff9ff3 (Pink)
Background: rgba(20, 10, 30, 0.95)
Text:      #ffffff
```

### Ocean
```
Primary:   #00d2d3 (Turquoise)
Secondary: #54a0ff (Blue)
Accent:    #5f27cd (Purple)
Background: rgba(0, 20, 40, 0.95)
Text:      #ffffff
```

### Forest
```
Primary:   #10ac84 (Green)
Secondary: #1dd1a1 (Light Green)
Accent:    #feca57 (Yellow)
Background: rgba(10, 30, 20, 0.95)
Text:      #ffffff
```

### Monochrome
```
Primary:   #ffffff (White)
Secondary: #888888 (Gray)
Accent:    #444444 (Dark Gray)
Background: rgba(0, 0, 0, 0.95)
Text:      #ffffff
```

### Chalkboard
```
Primary:   #ffffff (White)
Secondary: #ffff00 (Yellow)
Accent:    #ff6b6b (Red)
Background: rgba(20, 40, 30, 0.98)
Text:      #f0f0f0
```

---

## Content Sources

### 1. RSS Feeds

```typescript
// Add RSS feed via settings
await fetch('/api/zine/rss?url=' + encodeURIComponent(feedUrl));

// Example feeds:
- https://feeds.feedburner.com/techcrunch
- https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml
- https://www.reddit.com/r/technology/.rss
```

**Response Format:**
```json
{
  "success": true,
  "items": [
    {
      "title": "Article Title",
      "link": "https://...",
      "description": "Article description",
      "pubDate": "2026-03-29T00:00:00Z",
      "categories": ["tech", "ai"]
    }
  ]
}
```

### 2. Webhooks

**Endpoint:** `POST /api/zine/webhook`

**Headers:**
```
Content-Type: application/json
X-Webhook-Secret: your-secret (optional)
```

**Payload:**
```json
{
  "event": "new_content",
  "type": "text",
  "data": {
    "title": "Breaking News",
    "content": "Something happened!",
    "priority": "high",
    "tags": ["breaking", "news"]
  },
  "items": [
    {
      "id": "custom_1",
      "type": "announcement",
      "title": "Update",
      "content": "New feature released",
      "media": [
        {
          "type": "image",
          "url": "https://..."
        }
      ],
      "priority": "normal",
      "tags": ["update"]
    }
  ]
}
```

### 3. API Sources

```typescript
// Add custom API endpoint
await fetch('/api/zine/api', {
  method: 'POST',
  body: JSON.stringify({
    endpoint: 'https://api.example.com/data',
    path: 'results.items', // JSON path to array
    typeMapper: (item) => 'text',
    titleField: 'headline',
    contentField: 'body',
  })
});
```

### 4. OAuth Integrations

**Supported Providers:**
- Discord (messages, announcements)
- Twitter (tweets, mentions)
- GitHub (commits, PRs, issues)
- Notion (page updates)

**Connection Flow:**
1. Click "Connect [Provider]" in settings
2. Complete OAuth popup
3. Content automatically fetches from integration

### 5. Manual Input

```typescript
// Quick add text
addManualContent({
  type: 'text',
  title: 'Welcome',
  content: 'Hello World!',
  priority: 'high',
  tags: ['welcome', 'first'],
});
```

---

## Content Types

| Type | Description | Rendering |
|------|-------------|-----------|
| **text** | Plain text content | Title + body text |
| **message** | Chat/message format | With sender info |
| **announcement** | Important notices | Highlighted styling |
| **blog** | Blog post excerpts | With read more link |
| **notification** | System notifications | Badge + fade-in |
| **image** | Image gallery | Grid of images |
| **video** | Video content | Embedded player |
| **audio** | Audio content | Audio player |
| **embed** | External embeds | iframe display |
| **integration** | OAuth content | Provider branding |
| **data** | Data/charts | Visualization |
| **code** | Code snippets | Syntax highlighted |
| **email** | Email content | Thread view |
| **social** | Social media posts | Platform styling |
| **custom** | Custom rendering | User-defined |

---

## Animations

### Entrance Animations

| Animation | Description |
|-----------|-------------|
| **fade** | Opacity 0→1 |
| **slide** | Slide from right |
| **zoom** | Scale 0→1 |
| **rotate** | Spin into place |
| **bounce** | Bounce from top |
| **float** | Float up gently |
| **typewriter** | Type character by character |
| **glitch** | Glitch effect |
| **pulse** | Pulse while appearing |
| **glow** | Glow effect |
| **shake** | Shake into place |

### Exit Animations

Configured similarly, applied when content is removed or expires.

---

## API Reference

### GET /api/zine/rss

Fetch and parse RSS feed.

**Parameters:**
- `url` (required) - RSS feed URL

**Response:**
```json
{
  "success": true,
  "items": [...],
  "source": "https://...",
  "count": 10
}
```

### GET /api/zine/webhook

Get webhook event logs.

**Response:**
```json
{
  "success": true,
  "events": [...],
  "count": 50
}
```

### POST /api/zine/webhook

Receive webhook events.

**Headers:**
- `X-Webhook-Secret` (optional)

**Body:**
```json
{
  "event": "string",
  "type": "string",
  "data": {},
  "items": []
}
```

### GET /api/zine/integration/:provider

Fetch integration data.

**Parameters:**
- `provider` - discord | twitter | github | notion

**Response:**
```json
{
  "success": true,
  "items": [...],
  "provider": "discord",
  "count": 5
}
```

---

## Usage Guide

### 1. Open Zine Flow

- Click top-left chevron or `Ctrl+Shift+T`
- Select **"Zine Flow"** tab (sparkles icon)

### 2. Add Content Sources

**RSS Feed:**
1. Click Settings (gear icon)
2. Click "Add RSS Feed"
3. Enter feed URL
4. Content appears automatically

**Webhook:**
1. Click "Copy Webhook URL"
2. Configure external service to POST to URL
3. Content appears when webhook fires

**API:**
1. Click "Add API Source"
2. Enter endpoint URL
3. Configure response parsing
4. Content fetches on schedule

**Manual:**
1. Click "Quick Add Text"
2. Enter content
3. Appears immediately

### 3. Customize Display

**Change Template:**
- Click template button in control bar
- Cycles through all 20+ templates
- Or select specific template in settings

**Change Colors:**
- Click color scheme dropdown
- Select from 6 curated themes

**Adjust Settings:**
- Max Items: 5-50 visible items
- Rotation Speed: 5-120 seconds
- Auto-rotate: Enable/disable template cycling

### 4. Manage Content

**Remove Item:**
- Hover over item
- Click X button

**Clear All:**
- Click trash icon in control bar

**Interact:**
- Click item to open source URL (if available)

---

## Advanced Configuration

### Custom Content Styling

```typescript
addManualContent({
  type: 'announcement',
  title: 'Special Event',
  content: 'Something amazing is happening!',
  style: {
    template: 'neon',
    rotation: 15,
    scale: 1.2,
    opacity: 0.9,
    blendMode: 'screen',
    fontFamily: 'monospace',
    fontSize: 16,
    floating: true,
    animation: 'glow',
  },
  position: {
    x: 100,
    y: 200,
    vx: 0.3,
    vy: -0.2,
  },
  priority: 'urgent',
  tags: ['event', 'special'],
  expiresAt: Date.now() + 3600000, // 1 hour
});
```

### Content Filtering

```typescript
const filter: ContentFilter = {
  types: ['text', 'announcement', 'notification'],
  sources: ['rss', 'webhook'],
  tags: ['breaking', 'important'],
  minPriority: 'high',
  dateRange: {
    start: Date.now() - 86400000, // Last 24h
    end: Date.now(),
  },
};
```

### Display Configuration

```typescript
const config: DisplayConfig = {
  id: 'main-display',
  name: 'Main Zine Display',
  active: true,
  filters: { ... },
  style: {
    defaultTemplate: 'floating',
    rotationInterval: 30000,
    maxVisible: 20,
    layout: { type: 'free' },
    colors: COLOR_SCHEMES.neon,
  },
  sources: ['rss', 'webhook', 'api'],
  maxItems: 50,
  dedupWindow: 86400000, // 24h dedup
};
```

---

## Deduplication System

### How It Works

```typescript
// Generate hash from content + source
function generateDedupHash(content: string, source: string): string {
  let hash = 0;
  const str = content + source;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return `hash_${Math.abs(hash)}`;
}

// Check if seen
const seenHash = seenCache.get(item.dedupHash);
if (seenHash) {
  // Skip duplicate
  return;
}

// Mark as seen
seenCache.set(item.dedupHash, { seen: Date.now() });
```

### Dedup Window

- Default: 24 hours
- Configurable per display
- Automatically expires old hashes

---

## Performance Optimization

### Memory Management

```typescript
// Limit visible items
const [maxVisible, setMaxVisible] = useState(20);

// Limit total cached
setItems(prev => prev.slice(0, maxVisible * 2));

// Cleanup expired
useEffect(() => {
  const interval = setInterval(() => {
    setItems(prev => prev.filter(item => 
      !item.expiresAt || item.expiresAt > Date.now()
    ));
  }, 60000);
  return () => clearInterval(interval);
}, []);
```

### Animation Optimization

```typescript
// Use Framer Motion for GPU acceleration
<motion.div
  initial={{ opacity: 0 }}
  animate={controls}
  exit={{ opacity: 0, scale: 0.8 }}
  transition={{ duration: 0.5 }}
/>

// Cancel animation frames on cleanup
useEffect(() => {
  const animationRef = requestAnimationFrame(animate);
  return () => cancelAnimationFrame(animationRef);
}, []);
```

---

## Integration Examples

### n8n Webhook Workflow

```json
{
  "name": "Content to Zine Flow",
  "nodes": [
    {
      "name": "Trigger",
      "type": "n8n-nodes-base.webhook",
      "parameters": {
        "httpMethod": "POST",
        "path": "zine-update"
      }
    },
    {
      "name": "Format Content",
      "type": "n8n-nodes-base.set",
      "parameters": {
        "values": {
          "event": "new_content",
          "type": "announcement",
          "data": {
            "title": "={{ $json.title }}",
            "content": "={{ $json.content }}",
            "priority": "high"
          }
        }
      }
    },
    {
      "name": "Send to Zine",
      "type": "n8n-nodes-base.httpRequest",
      "parameters": {
        "method": "POST",
        "url": "https://your-bing.com/api/zine/webhook",
        "body": "={{ $json }}"
      }
    }
  ]
}
```

### RSS Auto-Refresh (Cron)

```typescript
// Server-side cron job
const cron = require('node-cron');

cron.schedule('*/30 * * * *', async () => {
  // Every 30 minutes
  const feeds = [
    'https://feeds.feedburner.com/techcrunch',
    'https://rss.nytimes.com/services/xml/rss/nyt/Technology.xml',
  ];

  for (const feed of feeds) {
    await fetch(`https://your-bing.com/api/zine/rss?url=${encodeURIComponent(feed)}`);
  }
});
```

---

## Troubleshooting

### Content Not Appearing

1. **Check source connectivity** - Verify RSS/API URLs are accessible
2. **Check deduplication** - Content may be filtered as duplicate
3. **Check filters** - Content may not match display filters
4. **Check max items** - May have reached item limit

### Animations Not Working

1. **Check browser support** - Ensure WebGL/CSS animations supported
2. **Reduce max items** - Too many items can slow animations
3. **Disable auto-rotate** - May be performance issue

### Webhook Not Receiving

1. **Check URL** - Verify webhook URL is correct
2. **Check secret** - If configured, secret must match
3. **Check rate limits** - May have exceeded 30 req/min
4. **Check logs** - View webhook logs in settings

---

## Future Enhancements

- [ ] Real-time collaboration (multi-user cursors)
- [ ] AI content summarization
- [ ] Voice-controlled content addition
- [ ] AR/VR display modes
- [ ] Interactive content elements
- [ ] Custom template builder
- [ ] Export/import configurations
- [ ] Scheduled content displays
- [ ] Content playlists
- [ ] Analytics dashboard

---

## File Structure

```
binG/
├── components/plugins/zine-flow-engine.tsx    # Main component
├── app/api/zine/
│   └── [...route]/route.ts                    # API handlers
├── data/
│   ├── zine-flow-data.json                    # Display configs
│   └── zine-webhook-log.json                  # Webhook logs
└── docs/ZINE_FLOW_DOCUMENTATION.md            # This file
```

---

## Credits

Built with:
- Next.js 15
- React 19
- Framer Motion (animations)
- Tailwind CSS
- Lucide Icons
- Sonner (toasts)

Inspired by:
- Brutalist web design
- Kinetic typography
- Data visualization art
- Experimental UI patterns
- Digital zine culture
