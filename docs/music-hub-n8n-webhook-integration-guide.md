---
id: music-hub-n8n-webhook-integration-guide
title: Music Hub - n8n Webhook Integration Guide
aliases:
  - MUSIC_HUB_N8N_INTEGRATION
  - MUSIC_HUB_N8N_INTEGRATION.md
  - music-hub-n8n-webhook-integration-guide
  - music-hub-n8n-webhook-integration-guide.md
tags:
  - guide
layer: core
summary: "# Music Hub - n8n Webhook Integration Guide\r\n\r\n## Overview\r\n\r\nThe Music Hub tab is a semifuturistic YouTube playlist wrapper that abstracts away YouTube branding into a digital underground experience. It features:\r\n\r\n- **Large 1280x720 video player** with smooth transitions\r\n- **Advanced preloading*"
anchors:
  - Overview
  - Architecture
  - API Endpoints
  - 1. Get Playlist
  - 2. Update Playlist (Webhook)
  - 3. Real-time Webhook Events
  - n8n Workflow Setup
  - 'Workflow 1: YouTube Channel Monitor'
  - 'Workflow 2: Playlist Sync'
  - Webhook Payload Examples
  - New Album Release
  - Album Update
  - Remove Album
  - Environment Variables
  - Playlist JSON Structure
  - Features
  - 1. Large Video Player (1280x720)
  - 2. Advanced Preloading
  - 3. Multiple Fallback Mechanisms
  - 4. Real-time Updates
  - 5. Visualizer Modes
  - Usage in binG
  - Troubleshooting
  - Video Won't Load
  - Webhook Not Receiving Data
  - Playlist Not Updating
  - Security Considerations
  - Future Enhancements
  - Support
---
# Music Hub - n8n Webhook Integration Guide

## Overview

The Music Hub tab is a semifuturistic YouTube playlist wrapper that abstracts away YouTube branding into a digital underground experience. It features:

- **Large 1280x720 video player** with smooth transitions
- **Advanced preloading** for next song
- **Dynamic playlist updates** via n8n webhooks
- **Multiple fallback mechanisms** for reliable playback
- **JSON-based playlist management**

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   n8n Workflow  │────▶│  Webhook Endpoint│────▶│  Playlist JSON  │
│  (YouTube RSS)  │     │  /api/music-hub  │     │  (data folder)  │
└─────────────────┘     └──────────────────┘     └─────────────────┘
                               │
                               ▼
                        ┌──────────────────┐
                        │  Music Hub Tab   │
                        │  (Real-time UI)  │
                        └──────────────────┘
```

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

### 2. Update Playlist (Webhook)
```http
POST /api/music-hub/playlist
Content-Type: application/json
X-Webhook-Secret: your-secret-key (optional)
```

**Actions:**
- `add_album` - Add new album
- `remove_album` - Remove album
- `update_album` - Update album metadata
- `replace_playlist` - Replace entire playlist
- `sync_playlist` - Sync from YouTube URL

### 3. Real-time Webhook Events
```http
POST /api/music-hub/webhook
Content-Type: application/json
X-Webhook-Secret: your-secret-key (optional)
```

**Event Types:**
- `new_album` - New album release
- `album_update` - Update existing album
- `album_remove` - Remove album
- `song_add` - Add song to album
- `playlist_sync` - Full playlist sync
- `refresh_metadata` - Refresh all metadata

## n8n Workflow Setup

### Workflow 1: YouTube Channel Monitor

```json
{
  "name": "YouTube New Releases Monitor",
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
      "name": "YouTube RSS Feed",
      "type": "n8n-nodes-base.rssFeedRead",
      "parameters": {
        "url": "={{ $json.channelUrl }}",
        "options": { "limit": 10 }
      }
    },
    {
      "name": "Filter New Videos",
      "type": "n8n-nodes-base.filter",
      "parameters": {
        "conditions": {
          "dateTime": { "field": "pubDate", "operation": "lastHour" }
        }
      }
    },
    {
      "name": "Extract Playlist Info",
      "type": "n8n-nodes-base.code",
      "parameters": {
        "jsCode": "return items.map(item => ({\n  title: item.json.title,\n  videoId: item.json.link.split('v=')[1],\n  published: item.json.pubDate\n}));"
      }
    },
    {
      "name": "Send to Music Hub",
      "type": "n8n-nodes-base.httpRequest",
      "parameters": {
        "method": "POST",
        "url": "https://your-bing-instance.com/api/music-hub/webhook",
        "body": {
          "event": "auto_update",
          "type": "new_album",
          "data": {
            "title": "={{ $json.title }}",
            "videoId": "={{ $json.videoId }}",
            "releaseDate": "={{ $json.published }}"
          },
          "source": "n8n"
        },
        "headerParameters": {
          "headers": [
            { "name": "x-webhook-secret", "value": "your-secret-key" }
          ]
        }
      }
    }
  ]
}
```

### Workflow 2: Playlist Sync

```json
{
  "name": "YouTube Playlist Sync",
  "nodes": [
    {
      "name": "Manual Trigger",
      "type": "n8n-nodes-base.manualTrigger"
    },
    {
      "name": "YouTube Playlist",
      "type": "n8n-nodes-base.youtube",
      "parameters": {
        "operation": "playlistItems",
        "playlistId": "YOUR_PLAYLIST_ID",
        "limit": 50
      }
    },
    {
      "name": "Format Albums",
      "type": "n8n-nodes-base.code",
      "parameters": {
        "jsCode": "const albums = items.map(item => ({\n  id: item.json.resourceId.videoId,\n  title: item.json.snippet.title,\n  videoId: item.json.resourceId.videoId,\n  thumbnailUrl: item.json.snippet.thumbnails.high.url\n}));\nreturn [{ json: { albums } }];"
      }
    },
    {
      "name": "Update Music Hub",
      "type": "n8n-nodes-base.httpRequest",
      "parameters": {
        "method": "POST",
        "url": "https://your-bing-instance.com/api/music-hub/playlist",
        "body": {
          "action": "replace_playlist",
          "playlist": {
            "albums": "={{ $json.albums }}",
            "autoUpdate": true
          }
        }
      }
    }
  ]
}
```

## Webhook Payload Examples

### New Album Release
```json
{
  "event": "new_release_detected",
  "type": "new_album",
  "data": {
    "id": "album-2026-03-29",
    "title": "Midnight Dreams",
    "artist": "Neural Collective",
    "releaseDate": "2026-03-29",
    "playlistUrl": "https://www.youtube.com/playlist?list=PLxxx",
    "coverUrl": "https://i.ytimg.com/vi/xxx/maxresdefault.jpg",
    "isFeatured": true,
    "songs": [
      {
        "id": "song-1",
        "title": "Digital Horizon",
        "videoId": "dQw4w9WgXcQ",
        "duration": 245
      }
    ]
  },
  "timestamp": "2026-03-29T12:00:00Z",
  "source": "n8n-youtube-monitor"
}
```

### Album Update
```json
{
  "event": "metadata_update",
  "type": "album_update",
  "data": {
    "id": "album-2026-03-29",
    "title": "Midnight Dreams (Deluxe)",
    "isFeatured": true
  },
  "timestamp": "2026-03-29T14:00:00Z"
}
```

### Remove Album
```json
{
  "event": "content_removal",
  "type": "album_remove",
  "data": {
    "id": "album-old-123"
  },
  "timestamp": "2026-03-29T15:00:00Z"
}
```

## Environment Variables

Add to `.env.local`:

```env
# Music Hub Webhook Security
MUSIC_HUB_WEBHOOK_SECRET=your-secure-random-string-here

# Optional: YouTube API Key for enhanced metadata
YOUTUBE_API_KEY=AIzaSy...
```

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
  "webhookUrl": "https://your-n8n-instance.com/webhook/music-hub",
  "autoUpdate": true
}
```

## Features

### 1. Large Video Player (1280x720)
- Expansive viewing experience
- Abstract visualizer background
- Smooth transitions between songs
- Multiple quality fallbacks

### 2. Advanced Preloading
- Next song preloads in background
- 3-second head start on transitions
- Progress indicator for preload status
- Reduces buffering between tracks

### 3. Multiple Fallback Mechanisms
- Primary: YouTube iframe API
- Secondary: Direct embed with retry
- Tertiary: External link fallback
- 3 retry attempts with exponential backoff

### 4. Real-time Updates
- WebSocket-ready architecture
- n8n webhook integration
- Automatic playlist refresh
- Event logging for debugging

### 5. Visualizer Modes
- **Ambient Flow**: Smooth color transitions
- **Neural Pulse**: Rhythmic beat detection
- **Data Particles**: Reactive particle system
- **Digital Grid**: Retro futuristic grid

## Usage in binG

1. **Open Top Panel**: Click the chevron icon in top-left or press `Ctrl+Shift+T`
2. **Select Music Hub Tab**: Click the "Music Hub" tab with radio icon
3. **Browse Albums**: View new releases in grid or list mode
4. **Play Music**: Click any album or song to start playback
5. **Toggle Playlist**: Use the layers icon to show/hide playlist panel

## Troubleshooting

### Video Won't Load
1. Check internet connection
2. Verify YouTube isn't blocked
3. Check browser console for errors
4. Try alternative video quality

### Webhook Not Receiving Data
1. Verify webhook URL is correct
2. Check n8n workflow is active
3. Validate webhook secret matches
4. Review webhook logs at `/api/music-hub/webhook`

### Playlist Not Updating
1. Check file permissions on `data/music-hub-playlist.json`
2. Verify JSON structure is valid
3. Check server logs for errors
4. Restart development server

## Security Considerations

1. **Webhook Secret**: Always use a secret in production
2. **Rate Limiting**: Implement rate limiting on webhook endpoint
3. **Input Validation**: All webhook payloads are validated
4. **File Permissions**: Ensure data folder is writable

## Future Enhancements

- [ ] YouTube Data API integration for auto-sync
- [ ] Background job for playlist synchronization
- [ ] Multi-channel monitoring
- [ ] Genre-based filtering
- [ ] User preference learning
- [ ] Collaborative playlists
- [ ] Spotify/Apple Music integration

## Support

For issues or questions:
1. Check webhook logs: `GET /api/music-hub/webhook`
2. Review playlist JSON: `data/music-hub-playlist.json`
3. Inspect browser console for client errors
4. Check server logs for API errors
