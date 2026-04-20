---
id: figma-integration-guide
title: Figma Integration Guide
aliases:
  - figma-integration
  - figma-integration.md
tags:
  - guide
layer: core
summary: "# Figma Integration Guide\r\n\r\nImport and export designs between Figma and the binG visual editor.\r\n\r\n## Overview\r\n\r\nThe Figma integration allows you to:\r\n- **Connect** your Figma account via OAuth 2.0 with PKCE\r\n- **Browse** your Figma files and components\r\n- **Export** frames as SVG, PNG, or JPG\r\n-"
anchors:
  - Overview
  - Quick Start
  - 1. Open Figma Plugin
  - 2. Connect Your Figma Account
  - 3. Import Designs
  - 4. Use Visual Editor Figma Buttons
  - Setup
  - 1. Create Figma App
  - 2. Configure Environment Variables
  - 3. Restart Development Server
  - Browse Files
  - Export Frames
  - Import to Visual Editor
  - Architecture
  - File Structure
  - OAuth Flow
  - Figma → Craft.js Conversion
  - Style Mapping
  - API Reference
  - GET /api/integrations/figma
  - GET /api/integrations/figma?action=authorize
  - POST /api/integrations/figma
  - Export Nodes
  - Get Components
  - Import to Editor
  - Programmatic Usage
  - Using the Figma API Client
  - Using the Converter
  - Troubleshooting
  - '"Figma not configured" Error'
  - OAuth Callback Fails
  - Token Refresh Fails
  - Import Produces Empty Canvas
  - Security Notes
  - Rate Limiting
  - Resources
---
# Figma Integration Guide

Import and export designs between Figma and the binG visual editor.

## Overview

The Figma integration allows you to:
- **Connect** your Figma account via OAuth 2.0 with PKCE
- **Browse** your Figma files and components
- **Export** frames as SVG, PNG, or JPG
- **Import** Figma designs directly into the visual editor
- **Convert** Figma nodes to Craft.js components automatically

## Quick Start

### 1. Open Figma Plugin

1. Open the **Plugin Marketplace** from the main UI
2. Search for **"Figma"** or browse to the **Design** category
3. Click **Figma Integration** to open the plugin

### 2. Connect Your Figma Account

1. Click **"Connect with Figma"**
2. Authorize the app in the Figma popup
3. You'll be redirected back with access granted

> **Note:** You'll need to configure Figma OAuth credentials first. See [Setup](#setup) below.

### 3. Import Designs

1. Browse your Figma files
2. Select a file to view its node tree
3. Check the frames/nodes you want to import
4. Click **"Import to Editor"**
5. The visual editor will open with your Figma design converted to Craft.js components

### 4. Use Visual Editor Figma Buttons

The visual editor toolbar has dedicated Figma buttons:

- **Figma Icon (center)** - Import from Figma
- **Export Button (right)** - Export current design as JSX

## Setup

### 1. Create Figma App

1. Go to [Figma Developers](https://www.figma.com/developers/apps)
2. Click **Create new app**
3. Select **OAuth2** as the authentication type
4. Configure the following settings:

| Setting | Value |
|---------|-------|
| **Redirect URL** | `http://localhost:3000/api/integrations/figma/callback` (development) |
| **Scopes** | `file_read`, `file_comments:read` |

5. Copy your **Client ID** and **Client Secret**

### 2. Configure Environment Variables

Add the following to your `.env.local` file:

```env
# Figma OAuth
FIGMA_CLIENT_ID=your_figma_client_id_here
FIGMA_CLIENT_SECRET=your_figma_client_secret_here

# Optional: Custom redirect URI (must match Figma app settings)
#FIGMA_REDIRECT_URI=http://localhost:3000/api/integrations/figma/callback
```

### 3. Restart Development Server

```bash
pnpm dev
```

### Browse Files

- View all Figma files you have access to
- Search files by name
- Switch between grid and list views
- See file thumbnails and last modified dates

### Export Frames

1. Select a file to view its node tree
2. Check the frames/nodes you want to export
3. Choose export format (SVG, PNG, JPG)
4. Select scale (0.5x, 1x, 2x, 3x)
5. Click **"Export"** to download images

### Import to Visual Editor

1. Select frames/nodes from the file tree
2. Click **"Import to Editor"**
3. The visual editor will open with your Figma design converted to Craft.js components

## Architecture

### File Structure

```
lib/figma/
├── types.ts        # TypeScript types for Figma API
├── config.ts       # OAuth configuration
├── oauth.ts        # PKCE OAuth utilities
├── api.ts          # Figma REST API client
├── converter.ts    # Figma → Craft.js converter
└── index.ts        # Module exports

app/api/integrations/figma/
├── route.ts        # Main API endpoint
└── callback/
    └── route.ts    # OAuth callback handler

components/plugins/
└── figma-embed-plugin.tsx  # Plugin UI component
```

### OAuth Flow

```
┌─────────┐         ┌──────────────┐         ┌────────┐         ┌─────────┐
│  User   │         │  binG Plugin │         │ Figma  │         │  Database │
└────┬────┘         └──────┬───────┘         └───┬────┘         └────┬────┘
     │                     │                      │                   │
     │  1. Click Connect   │                      │                   │
     ├────────────────────>│                      │                   │
     │                     │                      │                   │
     │                     │  2. Generate PKCE    │                   │
     │                     │     code_verifier    │                   │
     │                     │     code_challenge   │                   │
     │                     │                      │                   │
     │  3. Redirect to     │                      │                   │
     │     Figma OAuth      │                      │                   │
     ├────────────────────────────────────────────>│                   │
     │                     │                      │                   │
     │  4. Authorize       │                      │                   │
     ├────────────────────────────────────────────>│                   │
     │                     │                      │                   │
     │  5. Redirect back   │                      │                   │
     │     with code       │                      │                   │
     ├────────────────────>│                      │                   │
     │                     │                      │                   │
     │                     │  6. Exchange code    │                   │
     │                     │     for token        │                   │
     │                     ├─────────────────────>│                   │
     │                     │                      │                   │
     │                     │  7. Return tokens    │                   │
     │                     ├─────────────────────>│                   │
     │                     │                      │                   │
     │                     │  8. Store tokens     │                   │
     │                     ├──────────────────────────────────────────>│
     │                     │                      │                   │
     │  9. Connected!      │                      │                   │
     <─────────────────────┤                      │                   │
     │                     │                      │                   │
```

### Figma → Craft.js Conversion

The converter maps Figma nodes to Craft.js components:

| Figma Node | Craft.js Component | Notes |
|------------|-------------------|-------|
| `FRAME` | `Container` | Auto-layout → flexbox |
| `GROUP` | `Container` | Groups frames together |
| `SECTION` | `Container` | Similar to FRAME |
| `TEXT` | `Text` | Preserves font styles |
| `RECTANGLE` | `Container` | With background/border |
| `IMAGE` | `Image` | Requires export API |
| `COMPONENT` | `Container` | Converted to instance |
| `INSTANCE` | `Container` | Component instance |

#### Style Mapping

| Figma Property | CSS/Tailwind |
|----------------|--------------|
| `layoutMode: 'HORIZONTAL'` | `flex flex-row` |
| `layoutMode: 'VERTICAL'` | `flex flex-col` |
| `primaryAxisAlignItems: 'CENTER'` | `justify-center` |
| `counterAxisAlignItems: 'CENTER'` | `items-center` |
| `itemSpacing` | `gap-{value}` |
| `paddingTop` | `pt-{value}` |
| `cornerRadius` | `rounded-{value}` |
| `fills[0].color` | `background-color` |
| `strokes[0].color` | `border-color` |
| `effects[DROP_SHADOW]` | `box-shadow` |

## API Reference

### GET /api/integrations/figma

List user's Figma files or get file structure.

**Query Parameters:**
- `fileKey` (optional) - Get specific file structure

**Response:**
```json
{
  "success": true,
  "files": [
    {
      "key": "abc123",
      "name": "Design System",
      "thumbnailUrl": "https://...",
      "lastModified": "2024-01-15T10:30:00Z"
    }
  ]
}
```

### GET /api/integrations/figma?action=authorize

Initiate OAuth connection.

**Response:**
```json
{
  "success": true,
  "authUrl": "https://www.figma.com/oauth?...",
  "status": "pending"
}
```

### POST /api/integrations/figma

Perform Figma operations.

**Actions:**

#### Export Nodes
```json
{
  "action": "export",
  "fileKey": "abc123",
  "nodeIds": ["node1", "node2"],
  "format": "svg",
  "scale": 1
}
```

#### Get Components
```json
{
  "action": "components",
  "fileKey": "abc123"
}
```

#### Import to Editor
```json
{
  "action": "import",
  "fileKey": "abc123",
  "nodeIds": ["node1", "node2"]
}
```

## Programmatic Usage

### Using the Figma API Client

```typescript
import { createFigmaApi } from '@/lib/figma/api';

// Create API client with access token
const figma = createFigmaApi(accessToken);

// Get file structure
const fileData = await figma.getFile('fileKey');

// Get components
const components = await figma.getComponents('fileKey');

// Export images
const images = await figma.getImages('fileKey', ['node1', 'node2'], {
  format: 'svg',
  scale: 2,
});
```

### Using the Converter

```typescript
import { convertFigmaToCraft } from '@/lib/figma/converter';

// Convert single Figma node
const result = convertFigmaToCraft(figmaNode, {
  fileKey: 'abc123',
  fileName: 'Design System',
});

// Convert multiple nodes
const multiResult = convertFigmaNodesToCraft([node1, node2], {
  fileKey: 'abc123',
});

// Serialize to JSON for visual editor
const jsonString = JSON.stringify(result, null, 2);
```

## Troubleshooting

### "Figma not configured" Error

Ensure environment variables are set:
```bash
# Check .env.local
cat .env.local | grep FIGMA
```

### OAuth Callback Fails

1. Verify redirect URI matches exactly in Figma app settings
2. Check popup blockers aren't preventing the OAuth window
3. Ensure `NEXT_PUBLIC_APP_URL` is set correctly

### Token Refresh Fails

Tokens are automatically refreshed when expired. If refresh fails:
1. Disconnect and reconnect Figma
2. Check Figma app hasn't been revoked

### Import Produces Empty Canvas

- Ensure selected nodes are visible in Figma
- Check node types are supported (FRAME, TEXT, RECTANGLE)
- Review conversion warnings in console

## Security Notes

- Access tokens are encrypted in the database
- PKCE is used for OAuth flow (RFC 7636)
- Tokens are automatically refreshed before expiration
- Never commit `.env.local` to version control

## Rate Limiting

Figma API limits:
- 30 requests per minute per access token
- Export API has separate limits

The integration handles rate limiting automatically with retries.

## Resources

- [Figma Developers Documentation](https://www.figma.com/developers)
- [Figma REST API Reference](https://www.figma.com/developers/api)
- [OAuth 2.0 Specification](https://www.figma.com/developers/api#oauth2)
- [Craft.js Documentation](https://craft.js.org/)
