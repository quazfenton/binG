# Zine Engine - Unbounded Display Automation System

## Overview

The Zine Engine is an avant-garde, boundary-breaking content display system that handles multiple data sources with artistic, zine-like layouts and floating UI elements. It's designed to be an experimental, unconventional display system that breaks free from traditional UI constraints.

## Features

### 🎨 Visual Features
- **Unbounded Display**: No conventional borders or containers
- **Floating Elements**: Content floats freely across the screen
- **Artistic Layouts**: 10+ layout styles (floating, scattered, spiral, wave, etc.)
- **Dynamic Animations**: 9+ animation styles (fade-in, fly-in, typewriter, glitch, etc.)
- **Auto-Rotation**: Templates automatically cycle for variety
- **Responsive Design**: Adapts to any screen size

### 📡 Data Sources
- **RSS Feeds**: Parse and display RSS/Atom feeds
- **Webhooks**: Receive real-time data from external services
- **REST APIs**: Fetch from any JSON API
- **OAuth Platforms**: Discord, Twitter, Slack, Telegram, GitHub
- **WebSocket**: Real-time streaming data
- **File Sources**: Local or remote file content
- **Cron Jobs**: Scheduled content updates
- **Manual Input**: Direct content injection

### 🔧 Configuration
- **Admin Panel**: Full configuration interface
- **Template System**: Create and customize display templates
- **Import/Export**: Save and load configurations
- **Live Preview**: Debug mode shows content metadata

## Installation

```typescript
import {
  ZineEngine,
  ZineAdminPanel,
  createDataSource,
  DEFAULT_TEMPLATES,
} from "@/components/zine-engine";
```

## Quick Start

### Basic Usage

```tsx
import { ZineEngine } from "@/components/zine-engine";

function App() {
  return (
    <ZineEngine
      dataSources={[
        createDataSource.rss("https://example.com/feed.xml"),
        createDataSource.webhook(),
      ]}
      enableNotifications
      debug
    />
  );
}
```

### With Admin Panel

```tsx
import { ZineEngine, ZineAdminPanel } from "@/components/zine-engine";

function App() {
  const [config, setConfig] = useState(null);

  return (
    <>
      <ZineEngine
        dataSources={config?.dataSources || []}
        templates={config?.templates || DEFAULT_TEMPLATES}
        settings={config?.settings || {}}
      />
      
      <ZineAdminPanel onConfigChange={setConfig} />
    </>
  );
}
```

## API Reference

### ZineEngine Component

#### Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `dataSources` | `DataSource[]` | `[]` | Data sources to fetch content from |
| `templates` | `ZineTemplate[]` | `DEFAULT_TEMPLATES` | Templates to cycle through |
| `autoRotateTemplates` | `boolean` | `true` | Enable auto-rotation of templates |
| `rotationInterval` | `number` | `30000` | Template rotation interval (ms) |
| `maxItems` | `number` | `10` | Maximum concurrent displayed items |
| `enableNotifications` | `boolean` | `true` | Enable toast notifications |
| `renderContent` | `function` | `undefined` | Custom content renderer |
| `onContentClick` | `function` | `undefined` | Content click handler |
| `debug` | `boolean` | `false` | Enable debug overlay |
| `className` | `string` | `""` | Container CSS class |

### Data Sources

#### RSS Feed

```typescript
import { createDataSource } from "@/components/zine-engine";

const rssSource = createDataSource.rss(
  "https://example.com/feed.xml",
  "My RSS Feed",
  60000 // Refresh every 60 seconds
);
```

#### Webhook

```typescript
const webhookSource = createDataSource.webhook("your-secret-key");

// POST to /api/zine/webhook with:
{
  "content": {
    "type": "text",
    "title": "Breaking News",
    "body": "Something happened!",
    "priority": 8
  }
}
```

#### Discord

```typescript
const discordSource = createDataSource.discord(
  "your-bot-token",
  "channel-id"
);
```

#### Twitter

```typescript
const twitterSource = createDataSource.twitter("your-access-token");
```

#### Slack

```typescript
const slackSource = createDataSource.slack(
  "your-bot-token",
  "channel-id"
);
```

#### WebSocket

```typescript
const wsSource = createDataSource.websocket("wss://example.com/socket");
```

### Content Types

```typescript
type ContentType = 
  | "text"
  | "image"
  | "video"
  | "audio"
  | "mixed"
  | "interactive"
  | "embed";
```

### Layout Styles

```typescript
type LayoutStyle = 
  | "floating"      // Gentle floating animation
  | "scattered"     // Random positions
  | "spiral"        // Spiral pattern
  | "wave"          // Wave motion
  | "grid-free"     // Loose grid
  | "organic"       // Natural flow
  | "typographic"   // Text-focused
  | "brutalist"     // Bold, raw
  | "minimal"       // Clean, simple
  | "maximal";      // Dense, layered
```

### Animation Styles

```typescript
type AnimationStyle = 
  | "fade-in"       // Simple fade
  | "fly-in"        // Fly from edge
  | "typewriter"    // Type character by character
  | "rotate-in"     // Rotate while appearing
  | "scale-in"      // Scale from zero
  | "blur-in"       // Unblur effect
  | "chalk-write"   // Chalkboard writing
  | "glitch"        // Glitch effect
  | "none";         // Instant appear
```

## Content Structure

```typescript
interface ZineContent {
  id: string;
  type: ContentType;
  title?: string;
  subtitle?: string;
  body?: string;
  media?: string[];
  metadata?: Record<string, any>;
  source?: string;
  createdAt: number;
  expiresAt?: number;
  priority?: number;
  style?: ContentStyle;
  position?: ContentPosition;
  animation?: AnimationStyle;
}
```

### Content Style

```typescript
interface ContentStyle {
  fontFamily?: string;
  fontSize?: string;
  fontWeight?: string;
  color?: string;
  backgroundColor?: string;
  opacity?: number;
  rotation?: number;
  scale?: number;
  letterSpacing?: string;
  lineHeight?: string;
  textAlign?: "left" | "center" | "right" | "justify";
  textTransform?: "none" | "uppercase" | "lowercase" | "capitalize";
  shadow?: string;
  border?: string;
  blendMode?: string;
}
```

### Content Position

```typescript
interface ContentPosition {
  x?: number | string;
  y?: number | string;
  vx?: number; // velocity x
  vy?: number; // velocity y
  fixed?: boolean;
  zone?: "top-left" | "top-right" | "bottom-left" | "bottom-right" | "center" | "random";
}
```

## API Routes

### GET /api/zine/content

Fetch all active content.

**Query Parameters:**
- `type` - Filter by content type
- `source` - Filter by source
- `limit` - Maximum items to return (default: 50)

**Response:**
```json
{
  "contents": [
    {
      "id": "zine-123456",
      "type": "text",
      "title": "Hello World",
      "body": "Content body...",
      "priority": 5,
      "createdAt": 1234567890
    }
  ]
}
```

### POST /api/zine/content

Add new content.

**Body:**
```json
{
  "type": "text",
  "title": "Breaking News",
  "body": "Something happened!",
  "priority": 8,
  "expiresAt": 1234567890
}
```

### DELETE /api/zine/content?id=xxx

Remove content by ID.

### GET /api/zine/config

Get configuration.

### POST /api/zine/config

Save configuration.

### POST /api/zine/webhook

Webhook endpoint for external data.

### GET /api/zine/rss-proxy?url=xxx

CORS proxy for RSS feeds.

## Use Cases

### 1. Live Notification System

```typescript
const zineConfig = {
  dataSources: [
    createDataSource.webhook("secret"),
    createDataSource.discord("token", "channel-id"),
  ],
  templates: [{
    id: "urgent",
    name: "Urgent",
    layout: "typographic",
    styles: {
      fontSize: "48px",
      fontWeight: "900",
      color: "#ff0000",
    },
    animation: "glitch",
  }],
  settings: {
    maxItems: 3,
    enableNotifications: true,
  },
};
```

### 2. Social Media Aggregator

```typescript
const zineConfig = {
  dataSources: [
    createDataSource.twitter("token"),
    createDataSource.slack("token", "channel"),
    createDataSource.rss("https://blog.example.com/feed"),
  ],
  templates: DEFAULT_TEMPLATES,
  settings: {
    autoRotateTemplates: true,
    rotationInterval: 20000,
    maxItems: 15,
  },
};
```

### 3. Art Installation Display

```typescript
const zineConfig = {
  dataSources: [
    createDataSource.websocket("wss://sensor-data.example.com"),
  ],
  templates: [{
    id: "artistic",
    name: "Artistic",
    layout: "spiral",
    styles: {
      fontFamily: "Georgia",
      fontSize: "24px",
      color: "rgba(255, 200, 255, 0.8)",
      blendMode: "screen",
    },
    animation: "rotate-in",
    transitionDuration: 15000,
  }],
  settings: {
    maxItems: 20,
    enableNotifications: false,
  },
};
```

### 4. Dashboard Status Board

```typescript
const zineConfig = {
  dataSources: [
    createDataSource.rss("https://status.example.com/rss"),
    createDataSource.github("token"),
  ],
  templates: [{
    id: "dashboard",
    name: "Dashboard",
    layout: "grid-free",
    styles: {
      fontFamily: "monospace",
      fontSize: "14px",
      color: "#00ff00",
      backgroundColor: "rgba(0, 0, 0, 0.8)",
    },
    animation: "fade-in",
  }],
  settings: {
    maxItems: 10,
    rotationInterval: 60000,
  },
};
```

## Advanced Features

### Custom Content Renderer

```tsx
<ZineEngine
  renderContent={(content) => (
    <div className="custom-render">
      <h1>{content.title}</h1>
      <p>{content.body}</p>
      {content.media?.map(url => (
        <img key={url} src={url} alt="" />
      ))}
    </div>
  )}
/>
```

### Content Click Handler

```tsx
<ZineEngine
  onContentClick={(content) => {
    window.open(content.metadata?.link, "_blank");
  }}
/>
```

### WebSocket Integration

```typescript
import { WebSocketDataSource } from "@/components/zine-engine";

const ws = new WebSocketDataSource(
  "wss://example.com/socket",
  (content) => {
    // Content received, will be displayed automatically
    console.log("New content:", content);
  }
);

ws.connect();
```

## Security Considerations

1. **URL Validation**: All external URLs are validated to prevent SSRF attacks
2. **CORS Proxy**: RSS proxy includes hostname blocking for internal networks
3. **Signature Verification**: Webhooks support HMAC signature verification
4. **Token Storage**: OAuth tokens should be stored securely (use environment variables)
5. **Content Sanitization**: HTML content is stripped to prevent XSS

## Performance Tips

1. **Limit Max Items**: Keep `maxItems` reasonable (10-20) for best performance
2. **Use Expiration**: Set `expiresAt` for content to auto-cleanup
3. **Throttle Refresh**: Don't set refresh intervals too low (>5000ms recommended)
4. **Lazy Load Media**: Use thumbnail images and lazy load full resolution

## Troubleshooting

### Content Not Appearing

1. Check data source is enabled
2. Verify refresh interval has passed
3. Check browser console for errors
4. Enable debug mode to see content metadata

### RSS Feed Not Loading

1. Ensure feed URL is accessible
2. Check CORS proxy is working
3. Verify feed format is valid RSS/Atom

### WebSocket Not Connecting

1. Check WebSocket URL is correct
2. Verify server is running
3. Check browser console for connection errors

## Contributing

When adding new features:

1. Follow existing patterns
2. Add TypeScript types
3. Include error handling
4. Test with multiple data sources
5. Update documentation

## License

MIT

## Related Documentation

- [Panel Implementations](./PANEL_IMPLEMENTATIONS.md)
- [Integration Summary](./INTEGRATION_SUMMARY.md)
- [Security Audit](./COMPREHENSIVE_SECURITY_AUDIT.md)
