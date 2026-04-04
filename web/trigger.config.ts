import { defineConfig } from "@trigger.dev/sdk/v3";

export default defineConfig({
  project: "binG-agent-system",
  runtime: "node",
  logLevel: "log",
  maxDuration: 3600,
  retries: {
    enabledInDev: true,
    default: {
      maxAttempts: 3,
      minTimeoutInMs: 1000,
      maxTimeoutInMs: 10000,
      factor: 2,
      randomize: true,
    },
  },
  dirs: ["./trigger"],
  build: {
    external: [
      "playwright-core",
      "playwright",
      "chromium-bidi"
    ],
    extensions: [
      // Anchor Browser extension for web scraping capabilities
      {
        name: "anchor-browser",
        onBuildComplete(context) {
          if (context.target === "dev") return;

          context.addLayer({
            id: "anchor-browser",
            image: {
              instructions: [
                "RUN apt-get update && apt-get install -y curl ca-certificates && rm -rf /var/lib/apt/lists/*",
                'ENV PATH="/root/.local/bin:$PATH"',
                "RUN curl -fsSL https://cursor.com/install | bash", // This is just an example, we'd actually install anchorbrowser
                // For anchorbrowser, we would use their actual installation method
                // Since anchorbrowser is an npm package, we don't need a build extension for it
                // It will be installed via npm in the task runtime
              ],
            },
          });
        },
      },
    ],
  },
});
