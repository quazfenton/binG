# PWA Icon Generation Guide

## Option 1: Automatic Generation (Recommended)

Install sharp and run the generation script:

```bash
npm install sharp
node scripts/generate-pwa-icons.js
```

This will generate all required icon sizes from `public/icons/icon.svg`.

## Option 2: Manual Generation

Use online tools to convert `public/icons/icon.svg` to PNG:

1. **CloudConvert**: https://cloudconvert.com/svg-to-png
2. **Convertio**: https://convertio.co/svg-png/
3. **SVG to PNG Converter**: https://svgtopng.com/

Generate these sizes:
- 72x72
- 96x96
- 128x128
- 144x144
- 152x152
- 180x180 (Apple Touch Icon)
- 192x192
- 384x384
- 512x512

Save them as `icon-{size}x{size}.png` in `public/icons/`

## Option 3: Use Free Icon Generator

1. Visit https://realfavicongenerator.net/
2. Upload `public/icons/icon.svg`
3. Download generated icons
4. Copy to `public/icons/`

## Current Icon Design

The SVG icon (`public/icons/icon.svg`) features:
- Blue-purple gradient background
- Network/brain pattern representing AI
- 6 orbiting nodes connected to center
- Sparkle accents for visual appeal

## Testing PWA

After generating icons:

1. Build and start the app:
   ```bash
   npm run build
   npm start
   ```

2. Open in Chrome/Edge
3. Look for install prompt in address bar
4. Or check DevTools → Application → Manifest

## Troubleshooting

**Icons not showing?**
- Check browser DevTools → Console for 404 errors
- Verify manifest.json is loaded (Application tab in DevTools)
- Clear cache and hard reload (Ctrl+Shift+R)

**Install prompt not appearing?**
- PWA requires HTTPS (or localhost)
- Service worker must be registered
- Manifest must have required fields
- App must be used at least twice, 5+ minutes apart
