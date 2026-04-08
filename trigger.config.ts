/**
 * Trigger.dev Configuration
 *
 * Durable execution for long-running agent tasks, scheduled jobs,
 * and background event processing.
 *
 * When TRIGGER_API_KEY is set and @trigger.dev/sdk/v3 is available,
 * the event system dispatches to Trigger.dev workers instead of
 * local polling.
 *
 * Setup:
 * 1. Create a project at https://cloud.trigger.dev
 * 2. Set TRIGGER_API_KEY in your .env
 * 3. Run `npx trigger.dev@latest deploy`
 *
 * @see https://trigger.dev/docs
 */

import { defineConfig } from "@trigger.dev/sdk/v3";

export default defineConfig({
  project: process.env.TRIGGER_PROJECT_ID || "binG-agent-platform",

  // Directories containing task files — BOTH registered tasks and wrappers
  dirs: [
    "./web/trigger",              // v3 task() definitions (agent-loop, consensus, etc.)
    "./web/lib/events/trigger",   // wrappers + eventWorker scheduled task
  ],

  // Retry configuration
  retries: {
    enabledInDev: true,
    default: {
      maxAttempts: 3,
      factor: 2,
      minTimeoutInMs: 1000,
      maxTimeoutInMs: 60000,
      randomize: true,
    },
  },

  // Build configuration - inject required dependencies
  build: {
    extensions: [
      {
        name: "install-deps",
        onBuild: async (context) => {
          // Install better-sqlite3 for SQLite event store
          context.addStep("npm install better-sqlite3");
        },
      },
    ],
  },

  // Max duration for long-running agent loops (24 hours)
  maxDuration: 86400,
});
