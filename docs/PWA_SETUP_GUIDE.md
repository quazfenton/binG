# PWA Setup Guide - binG0

**Version:** 3.0 (Manual Service Worker)  
**Last Updated:** February 26, 2026

---

## 📱 What's Included

Your app now has full PWA (Progressive Web App) support with a manual service worker:

| Feature | Status |
|---------|--------|
| App Manifest | ✅ `public/manifest.json` |
| Service Worker | ✅ `public/sw.js` (manual) |
| Install Prompt | ✅ `components/pwa-install-prompt.tsx` |
| Offline Page | ✅ `app/offline/page.tsx` |
| App Icons | ✅ `public/icons/` (generated) |
| React Hook | ✅ `hooks/use-service-worker.ts` |

---

## 🚀 Quick Start

### Step 1: Generate App Icons

```bash
# Install sharp (image processing library)
pnpm install sharp

# Generate all icon sizes
node scripts/generate-pwa-icons.js
```

**Alternative:** See `public/icons/README.md` for manual icon generation options.

### Step 2: Test Locally

```bash
pnpm run build
pnpm start
```

Open `http://localhost:3000` in Chrome/Edge.

---

## 🔧 Configuration

### Service Worker

Located at `public/sw.js`:
- Caches static assets (JS, CSS, images)
- Network-first for API requests
- Offline fallback to `/offline` page

### Manifest

Located at `public/manifest.json`:
- App name: "binG0 - AI Assistant"
- Theme: Dark (#0a0a0a)
- Display: Standalone
- Icons: All sizes included

### Install Prompt

Component: `components/pwa-install-prompt.tsx`
- Shows after 3 seconds on first visit
- Dismisses for 30 days if user clicks "Later"
- Shows update available when new version ready

---

## 📲 Installing the App

### Desktop (Chrome/Edge)

1. Visit the app URL
2. Look for install icon (⊕) in address bar
3. Click "Install"
4. App opens in standalone window

### Mobile (Android Chrome)

1. Visit the app URL
2. Tap menu (⋮) → "Install app"
3. Or wait for install prompt banner
4. App appears on home screen

### Mobile (iOS Safari)

1. Visit the app URL
2. Tap Share button
3. Scroll to "Add to Home Screen"
4. Tap "Add" in top right

---

## 🧪 Testing PWA

### Chrome DevTools

1. Open DevTools (F12)
2. Go to **Application** tab
3. Check sections:
   - **Manifest**: Should show all app details
   - **Service Workers**: Should show active worker
   - **Cache Storage**: Should show cached assets

### Lighthouse Audit

1. Open DevTools → Lighthouse
2. Select "Progressive Web App"
3. Run audit
4. Should score 90-100

### Test Offline Mode

1. Open app in browser
2. Open DevTools → Network tab
3. Select "Offline"
4. Refresh page
5. Should see offline page

---

## 📁 File Structure

```
binG/
├── public/
│   ├── manifest.json          # PWA manifest
│   ├── sw.js                  # Service worker
│   └── icons/
│       ├── icon.svg           # Source SVG icon
│       └── *.png              # Generated icons
├── app/
│   ├── layout.tsx             # Updated with PWA meta tags
│   └── offline/
│       └── page.tsx           # Offline fallback page
├── components/
│   └── pwa-install-prompt.tsx # Install/update banner
├── hooks/
│   └── use-service-worker.ts  # Service worker React hook
└── scripts/
    └── generate-pwa-icons.js  # Icon generation script
```

---

## ✅ Checklist

- [ ] Generate icons: `pnpm install sharp && node scripts/generate-pwa-icons.js`
- [ ] Test on desktop Chrome/Edge
- [ ] Test on Android Chrome
- [ ] Test on iOS Safari
- [ ] Run Lighthouse audit
- [ ] Test offline mode
- [ ] Test install prompt
- [ ] Deploy to production
- [ ] Test on production URL

---

**Note:** This manual approach is used because `next-pwa` has compatibility issues with Next.js 15.
