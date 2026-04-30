# Codebase Review: Platform Abstractions

## Overview
The `packages/platform` directory provides a set of unified abstractions for core OS and browser features. These abstractions enable the application to run seamlessly across Web and Desktop (Tauri) environments by shielding the business logic from environment-specific APIs.

## Key Components

### 1. Secrets Management (`secrets/`)
- **Web**: Uses IndexedDB with AES-GCM encryption. Includes a PBKDF2-derived key with a random salt and hardcoded pepper. While not perfectly secure against XSS, it's a significant improvement over plain `localStorage`.
- **Desktop**: Leverages Tauri's bridge to access OS-native keychains (macOS Keychain, Windows Credential Manager, Linux libsecret).
- **Fallback Logic**: Implements an opt-in fallback to web storage if the desktop keychain is unavailable, preventing silent data leakage to insecure backends.

### 2. File & Data Storage (`storage/` & `fs/`)
- **UI Storage**: Unifies `localStorage` and Tauri's `AppData` JSON storage. Includes quota handling for browsers and path sanitization for desktop to prevent traversal attacks.
- **Filesystem**: (Reviewed previously) Bridges Tauri's `plugin-fs` and the browser's `File API`.

### 3. Native OS Features (`clipboard.ts`, `notifications.ts`, `shell/`)
- **Clipboard**: Unifies the browser's `navigator.clipboard` with Tauri's plugin, adding support for file path copying in desktop mode.
- **Notifications**: Bridges browser notifications and native OS notifications via Tauri. Includes permission request logic and fallback mechanisms.
- **Shell**: Provides server-side shell detection and workspace validation for Node.js/Desktop environments.

## Findings

### 1. Robust Security Posture
The `SecretsAdapter` implementation is particularly impressive. The explicit categorization of errors (`TAURI_UNAVAILABLE` vs `TAURI_ERROR`) and the requirement for an environment variable (`DESKTOP_SECRETS_ALLOW_WEB_FALLBACK`) to enable insecure fallbacks shows a high level of security awareness.

### 2. Defensive Migration Path
The `WebSecrets` implementation includes a migration path from legacy XOR-obfuscated values in `localStorage`. This ensures that existing user data is transparently upgraded to the more secure AES-GCM IndexedDB storage.

### 3. Lazy Initialization for Bundle Efficiency
Most adapters (Secrets, Storage, Clipboard) use dynamic imports and lazy initialization. This prevents Tauri-specific libraries from being included in the web bundle, keeping the frontend lightweight and compatible with non-Tauri browsers.

## Logic Trace: Storing an API Key
1.  **Caller** calls `secrets.set('openai-key', 'sk-...')`.
2.  **Proxy** resolves the correct implementation based on `isDesktopMode()`.
3.  **Desktop Path**: 
    - Rust-side `set_secret` command is invoked.
    - Rust uses the `keyring` crate to store the value in the OS keychain.
4.  **Web Path**:
    - Salt is retrieved/generated from IndexedDB `meta` store.
    - AES key is derived via PBKDF2.
    - Value is encrypted with AES-GCM and stored in IndexedDB `secrets` store.

## Recommended Actions

| Action | Priority | Reason |
| :--- | :--- | :--- |
| **Audit Shell Escape** | High | Ensure that `getShellCommand` fallbacks are not susceptible to PATH manipulation if run in a shared server environment. |
| **Storage Event Sync** | Medium | Implement cross-tab synchronization for `WebStorage` using the `storage` event to ensure UI consistency across multiple open browser tabs. |
| **Image Notifications** | Low | Extend the `notify` abstraction to support image payloads for desktop notifications, which is a native feature of macOS and Windows. |
| **Centralize Client Types** | Low | Consolidate `ApiFetchOptions` and `ApiResponse` into a shared types package used by both the `platform` and `web` packages. |
