/**
 * Desktop Entry Point
 *
 * Initializes Tauri-specific features before Next.js hydration.
 * This file is imported by the desktop app wrapper.
 */

import { isTauriRuntime } from '@bing/platform';

if (isTauriRuntime()) {
  console.log('[Desktop] Running in Tauri shell');

  // Set desktop environment variables
  if (typeof process !== 'undefined' && process.env) {
    process.env.DESKTOP_MODE = 'true';
    process.env.DESKTOP_LOCAL_EXECUTION = 'true';
  }

  // Initialize Tauri-specific features here
  // e.g., register custom commands, setup native integrations
}

// Re-export platform for convenience
export * from '@bing/platform';
