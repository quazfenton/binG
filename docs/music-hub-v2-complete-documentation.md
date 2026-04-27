---
id: music-hub-v2-complete-documentation
title: Music Hub v2 - Complete Documentation
aliases:
  - MUSIC_HUB_V2_DOCUMENTATION
  - MUSIC_HUB_V2_DOCUMENTATION.md
  - music-hub-v2-complete-documentation
  - music-hub-v2-complete-documentation.md
tags:
  - v2
layer: core
summary: "# Music Hub v2 - Complete Documentation\r\n\r\n## Overview\r\n\r\n**Music Hub** is a semifuturistic YouTube playlist wrapper with a digital underground aesthetic that abstracts away YouTube branding. It features advanced resilience, intelligent caching, and multiple fallback mechanisms for reliable playback"
anchors:
  - Overview
  - Key Features
  - Architecture
  - Embed Fallback System
  - Source Priority
  - Retry Logic
  - Error Recovery Flow
  - Caching System
  - Cache Layers
  - Cache Implementation
  - Memory Management
  - API Endpoints
  - 1. Get Playlist
  - 2. Update Playlist
  - 3. Webhook Events (n8n)
  - 4. Proxy Embed (with caching)
  - 5. Clear Embed Cache
  - Playlist JSON Structure
  - n8n Integration
  - 'Workflow: YouTube Channel Monitor'
  - Environment Variables
  - Usage
  - 1. Open Music Hub
  - 2. Playback Controls
  - 3. Visualizer Modes
  - 4. Cache Management
  - Performance Optimization
  - Thumbnail Loading
  - Preloading Strategy
  - Connection Quality Detection
  - Troubleshooting
  - Video Won't Load
  - Cache Issues
  - Webhook Not Working
  - Memory Usage
  - Security Considerations
  - Future Enhancements
  - File Structure
  - Credits
---
# Music Hub v2 - Complete Documentation

## Overview

**Music Hub** is a semifuturistic YouTube playlist wrapper with a digital underground aesthetic that abstracts away YouTube branding. It features advanced resilience, intelligent caching, and multiple fallback mechanisms for reliable playback.

### Key Features

| Feature | Description |
|---------|-------------|
| **Multi-Layer Proxy Fallback** | 4 embed sources with automatic failover |
| **Intelligent Caching** | localStorage + memory cache for thumbnails |
| **Exponential Backoff Retry** | Smart retry logic with increasing delays |
| **Connection Quality Monitoring** | Real-time network status detection |
| **Memory-Efficient Preloading** | LRU eviction for thumbnail cache |
| **Persistent Playback State** | Resume where you left off |
| **Large 1280x720 Player** | Expansive viewing experience |
| **n8n Webhook Integration** | Real-time playlist updates |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Music Hub Component                          │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │   YouTube    │  │   Cached     │  │   Ambient            │  │
│  │   Player     │  │   Thumbnail  │  │   Visualizer         │  │
│  │              │  │              │  │                      │  │
│  │  • 4 Sources │  │  • Memory    │  │  • 4 Modes           │  │
│  │  • Retry     │  │  • Local     │  │  • Canvas-based      │  │
│  │  • Backoff   │  │  • LRU       │  │  • Reactive          │  │
│  └──────────────┘  └──────────────┘  └──────────────────────┘  │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │   Playlist   │  │   Playback   │  │   Cache              │  │
│  │   Manager    │  │   State      │  │   Manager            │  │
│  │              │  │              │  │                      │  │
│  │  • Albums    │  │  • Persistent│  │  • Thumbnails        │  │
│  │  • Songs     │  │  • Resume    │  │  • Metadata          │  │
│  │  • Queue     │  │  • History   │  │  • LRU Eviction      │  │
│  └──────────────┘  └──────────────┘  └──────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      API Endpoints                               │
├─────────────────────────────────────────────────────────────────┤
│  /api/music-hub/playlist    - Get/update playlist               │
│  /api/music-hub/webhook     - Real-time n8n events              │
│  /api/music-hub/embed/:id   - Proxy embed with cache            │
└─────────────────────────────────────────────────────────────────┘
```

---

## Embed Fallback System

### Source Priority

1. **YouTube Direct** (Primary)
   - URL: `https://www.youtube.com/embed/{videoId}`
   - Parameters: autoplay, rel=0, modestbranding=1

2. **YouTube Alternative** (Fallback 1)
   - Different parameter set
   - Disables keyboard, fullscreen

3. **YouTube Shorts** (Fallback 2)
   - URL: `https://www.youtube.com/shorts/{videoId}`
   - Works when embed is blocked

4. **Invidious** (Fallback 3)
   - Privacy-focused alternative frontend
   - URL: `https://inv.tux.pizza/embed/{videoId}`

### Retry Logic

```typescript
// Exponential backoff calculation
const getRetryDelay = (attempt: number): number => {
  return Math.min(1000 * Math.pow(2, attempt), 10000); // Max 10s
};

// Retry configuration
const MAX_RETRIES_PER_SOURCE = 3;
const INITIAL_RETRY_DELAY = 1000; // 1 second
const LOAD_TIMEOUT = 15000; // 15 seconds
```

### Error Recovery Flow

```
Video Load Request
        │
        ▼
┌───────────────────┐
│ Try Source 1      │
│ (YouTube Direct)  │
└───────────────────┘
        │
        ├─ Success ──► Play Video
        │
        └─ Failure
              │
              ▼
        ┌───────────────┐
        │ Retry (1s)    │
        └───────────────┘
              │
              ├─ Success ──► Play Video
              │
              └─ Failure (3 attempts)
                    │
                    ▼
              ┌───────────────────┐
              │ Try Source 2      │
              │ (YouTube Alt)     │
              └───────────────────┘
                    │
                    ▼
              (Repeat for all sources)
                    │
                    ▼
              All Failed ──► Show Error + External Link
```

---

## Caching System

### Cache Layers

```
┌─────────────────────────────────────────┐
│     Memory Cache (Map)                  │
│     • Size: 50 thumbnails               │
│     • TTL: Session                      │
│     • LRU Eviction                      │
└─────────────────────────────────────────┘
              │
              │ Miss
              ▼
┌─────────────────────────────────────────┐
│     Persistent Cache (localStorage)     │
│     • Size: Unlimited*                  │
│     • TTL: 7 days (thumbnails)          │
│     • TTL: 24h (metadata)               │
└─────────────────────────────────────────┘
              │
              │ Miss
              ▼
┌─────────────────────────────────────────┐
│     Network Request                     │
│     • Fetch from YouTube                │
│     • Convert to Data URL               │
│     • Store in both caches              │
└─────────────────────────────────────────┘

* Limited by browser storage quota
```

### Cache Implementation

```typescript
// Thumbnail cache (7 days)
const thumbnailCache = new PersistentCache(
  'music_hub_thumb_',
  7 * 24 * 60 * 60 * 1000
);

// Metadata cache (24 hours)
const metadataCache = new PersistentCache(
  'music_hub_meta_',
  24 * 60 * 60 * 1000
);

// Playback state cache (30 days)
const playbackCache = new PersistentCache(
  'music_hub_playback_',
  30 * 24 * 60 * 60 * 1000
);

// Memory cache for active session
const activeThumbnailCache = new Map<string, string>();
const MAX_THUMBNAIL_CACHE_SIZE = 50;
```

### Memory Management

```typescript
// LRU Eviction
if (activeThumbnailCache.size > MAX_THUMBNAIL_CACHE_SIZE) {
  const firstKey = activeThumbnailCache.keys().next().value;
  if (firstKey) {
    activeThumbnailCache.delete(firstKey);
  }
}
```

---

## API Endpoints

### 1. Get Playlist

```http
GET /api/music-hub/playlist
```

**Response:**
```json
{
  "success": true,
  "playlist": {
    "albums": [...],
    "lastUpdated": "2026-03-29T00:00:00.000Z",
    "autoUpdate": true
  }
}
```

### 2. Update Playlist

```http
POST /api/music-hub/playlist
Content-Type: application/json

{
  "action": "add_album",
  "album": {
    "title": "New Album",
    "artist": "Artist Name",
    "playlistUrl": "https://youtube.com/playlist?list=..."
  }
}
```

### 3. Webhook Events (n8n)

```http
POST /api/music-hub/webhook
Content-Type: application/json
X-Webhook-Secret: your-secret (optional)

{
  "event": "new_release_detected",
  "type": "new_album",
  "data": {
    "title": "Album Title",
    "artist": "Artist",
    "videoId": "youtube-video-id",
    "playlistUrl": "https://..."
  },
  "source": "n8n"
}
```

### 4. Proxy Embed (with caching)

```http
GET /api/music-hub/embed/{videoId}?autoplay=1&cache=true
```

**Response Headers:**
```
Content-Type: text/html
Cache-Control: public, max-age=3600
X-Cache: HIT  (or MISS)
X-Source: youtube-direct
```

### 5. Clear Embed Cache

```http
DELETE /api/music-hub/embed/{videoId}
DELETE /api/music-hub/embed/all  (clear all)
```

---

## Playlist JSON Structure

```json
{
  "albums": [
    {
      "id": "album-unique-id",
      "title": "Album Title",
      "artist": "Artist Name",
      "releaseDate": "2026-03-29",
      "playlistUrl": "https://youtube.com/playlist?list=...",
      "playlistId": "PL...",
      "coverUrl": "https://...",
      "isNew": true,
      "isFeatured": false,
      "songs": [
        {
          "id": "song-unique-id",
          "title": "Song Title",
          "artist": "Artist Name",
          "album": "Album Title",
          "videoId": "youtube-video-id",
          "duration": 245,
          "thumbnailUrl": "https://img.youtube.com/vi/ID/maxresdefault.jpg",
          "liked": false,
          "played": false
        }
      ]
    }
  ],
  "lastUpdated": "2026-03-29T00:00:00.000Z",
  "webhookUrl": "",
  "autoUpdate": true
}
```

---

## n8n Integration

### Workflow: YouTube Channel Monitor

```json
{
  "name": "YouTube New Releases → Music Hub",
  "nodes": [
    {
      "name": "Schedule Trigger",
      "type": "n8n-nodes-base.scheduleTrigger",
      "parameters": {
        "rule": {
          "interval": [{ "field": "minutes", "minutesInterval": 30 }]
        }
      }
    },
    {
      "name": "RSS Feed Read",
      "type": "n8n-nodes-base.rssFeedRead",
      "parameters": {
        "url": "https://www.youtube.com/feeds/videos.xml?channelId=CHANNEL_ID"
      }
    },
    {
      "name": "Filter Recent",
      "type": "n8n-nodes-base.filter",
      "parameters": {
        "conditions": {
          "dateTime": { "field": "pubDate", "operation": "lastHour" }
        }
      }
    },
    {
      "name": "HTTP Request",
      "type": "n8n-nodes-base.httpRequest",
      "parameters": {
        "method": "POST",
        "url": "https://your-bing.com/api/music-hub/webhook",
        "body": {
          "event": "auto_update",
          "type": "new_album",
          "data": {
            "title": "={{ $json.title }}",
            "videoId": "={{ $json.guid.split(':')[2] }}",
            "releaseDate": "={{ $json.pubDate }}"
          }
        }
      }
    }
  ]
}
```

---

## Environment Variables

```env
# Music Hub Webhook Security
MUSIC_HUB_WEBHOOK_SECRET=your-secure-random-string

# Optional: YouTube API for metadata
YOUTUBE_API_KEY=AIzaSy...

# Optional: Alternative Invidious instances
INVIDIOUS_INSTANCES=inv.tux.pizza,yewtu.be,vid.puffyan.us
```

---

## Usage

### 1. Open Music Hub

- Click top-left chevron icon or press `Ctrl+Shift+T`
- Select **"Music Hub"** tab (radio icon)

### 2. Playback Controls

| Control | Action |
|---------|--------|
| Play/Pause | Toggle playback |
| Skip Forward/Back | Next/previous track |
| Shuffle | Random track order |
| Repeat | Off / All / One |
| Volume | Adjust 0-100% |

### 3. Visualizer Modes

- **Ambient Flow**: Smooth color transitions
- **Neural Pulse**: Rhythmic beat detection
- **Data Particles**: Reactive particle system
- **Digital Grid**: Retro futuristic grid

### 4. Cache Management

- View cache stats in playlist info panel
- Clear cache with trash icon in header
- Automatic LRU eviction prevents memory bloat

---

## Performance Optimization

### Thumbnail Loading

```typescript
// 1. Check memory cache (fastest)
const memoryCached = activeThumbnailCache.get(videoId);

// 2. Check localStorage (fast)
const persistentCached = thumbnailCache.get(videoId);

// 3. Fetch and cache (slow)
const img = new Image();
img.onload = () => {
  // Convert to data URL
  const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
  // Store in both caches
  activeThumbnailCache.set(videoId, dataUrl);
  thumbnailCache.set(videoId, dataUrl);
};
```

### Preloading Strategy

```typescript
// Preload next video when current starts playing
useEffect(() => {
  if (currentSongIndex < currentAlbum.songs.length - 1) {
    const nextSong = currentAlbum.songs[currentSongIndex + 1];
    
    // Preload thumbnail
    const img = new Image();
    img.src = nextSong.thumbnailUrl;
    
    // Show preload progress
    setTimeout(() => setPreloadProgress(100), 3000);
  }
}, [currentSongIndex]);
```

### Connection Quality Detection

```typescript
const updateConnectionQuality = () => {
  const connection = (navigator as any).connection;
  if (connection) {
    const effectiveType = connection.effectiveType;
    if (effectiveType === '4g' || effectiveType === 'wifi') {
      setConnectionQuality('good');
    } else if (effectiveType === '3g') {
      setConnectionQuality('fair');
    } else {
      setConnectionQuality('poor');
    }
  }
};
```

---

## Troubleshooting

### Video Won't Load

1. **Check connection quality indicator** (top-right of player)
2. **Wait for automatic retry** (exponential backoff)
3. **Manual retry** - Click "Retry All" button
4. **Open external link** - Fallback to YouTube directly

### Cache Issues

1. **Clear cache** - Click trash icon in header
2. **Check localStorage quota** - Browser may limit storage
3. **Disable cache** - Add `?cache=false` to URL

### Webhook Not Working

1. **Verify webhook URL** in n8n
2. **Check secret matches** `MUSIC_HUB_WEBHOOK_SECRET`
3. **Review webhook logs**: `GET /api/music-hub/webhook`
4. **Test with curl**:
   ```bash
   curl -X POST http://localhost:3000/api/music-hub/webhook \
     -H "Content-Type: application/json" \
     -d '{"event":"test","type":"new_album","data":{"title":"Test"}}'
   ```

### Memory Usage

1. **Monitor cache stats** in playlist info panel
2. **Automatic LRU eviction** prevents unbounded growth
3. **Clear cache manually** if needed

---

## Security Considerations

1. **Webhook Authentication**: Use `MUSIC_HUB_WEBHOOK_SECRET` in production
2. **CSP Headers**: Iframe sandbox restricts script execution
3. **Input Validation**: All webhook payloads validated
4. **Rate Limiting**: Consider adding rate limits to webhook endpoint
5. **CORS**: Embed proxy validates origin headers

---

## Future Enhancements

- [ ] YouTube Data API integration for auto-sync
- [ ] Background job for playlist synchronization
- [ ] Multi-channel monitoring
- [ ] Genre-based filtering
- [ ] User preference learning
- [ ] Collaborative playlists
- [ ] Spotify/Apple Music integration
- [ ] Audio fingerprinting for duplicate detection
- [ ] Smart preload based on listening patterns
- [ ] Offline mode with IndexedDB

---

## File Structure

```
binG/
├── components/plugins/music-hub-tab.tsx    # Main component
├── app/api/music-hub/
│   ├── playlist/route.ts                   # Playlist CRUD
│   ├── webhook/route.ts                    # n8n webhook handler
│   └── embed/[videoId]/route.ts            # Embed proxy with cache
├── data/
│   ├── music-hub-playlist.json             # Playlist data
│   └── music-hub-embed-cache.json          # Embed cache
└── docs/MUSIC_HUB_V2_DOCUMENTATION.md      # This file
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
