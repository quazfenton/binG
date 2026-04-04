# binG Mobile

React Native mobile app for binG AI assistant.

## Quick Start

```bash
# Install dependencies
pnpm install

# Start development server
pnpm dev:mobile

# Or run directly
cd mobile && pnpm dev
```

## Platform Support

- **iOS**: Requires macOS + Xcode
- **Android**: Windows/macOS/Linux + Android Studio
- **Web**: Any platform (runs in browser)

## Building

```bash
# Export for web
pnpm build:mobile

# Build for Android (requires EAS CLI)
pnpm --filter mobile build:android

# Build for iOS (requires macOS)
pnpm --filter mobile build:ios
```

## Architecture

- **Expo SDK 52** - Latest stable Expo
- **Expo Router** - File-based routing
- **React Native 0.76** - Compatible with React 19
- **@bing/platform** - Shared platform abstractions
- **@bing/shared** - Shared hooks/contexts

## Structure

```
mobile/
├── app/              # Expo Router screens
│   ├── _layout.tsx   # Root layout
│   └── index.tsx     # Home screen
├── components/       # Mobile UI components
├── lib/              # Mobile-specific utilities
├── assets/           # Images, fonts, icons
├── app.json          # Expo config
├── eas.json          # EAS Build config
└── package.json      # Dependencies
```
