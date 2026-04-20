---
id: sdk-opensandbox-examples-playwright-playwright-example
title: Playwright Example
aliases:
  - README
  - README.md
  - playwright-example
  - playwright-example.md
tags: []
layer: example
summary: "# Playwright Example\r\n\r\nAccess web pages in headless mode using Playwright + Chromium in OpenSandbox to scrape title/body snippets.\r\n\r\n## Build the Playwright Sandbox Image\r\n\r\nThe Dockerfile in this directory builds a sandbox image with Playwright and Chromium pre-installed:\r\n\r\n```shell\r\ncd examples"
anchors:
  - Build the Playwright Sandbox Image
  - 'Start OpenSandbox server [local]'
  - Create and Access the Playwright Sandbox
  - References
---
# Playwright Example

Access web pages in headless mode using Playwright + Chromium in OpenSandbox to scrape title/body snippets.

## Build the Playwright Sandbox Image

The Dockerfile in this directory builds a sandbox image with Playwright and Chromium pre-installed:

```shell
cd examples/playwright
docker build -t opensandbox/playwright:latest .
```

This image includes:
- Playwright Python package
- Chromium browser binaries
- Node.js and npm (for Playwright MCP)
- Non-root user (playwright) for security

## Start OpenSandbox server [local]

Pre-pull the Playwright image:

```shell
docker pull sandbox-registry.cn-zhangjiakou.cr.aliyuncs.com/opensandbox/playwright:latest
```

Start the local OpenSandbox server:

```shell
uv pip install opensandbox-server
opensandbox-server init-config ~/.sandbox.toml --example docker
opensandbox-server
```

## Create and Access the Playwright Sandbox

```shell
# Install OpenSandbox package
uv pip install opensandbox

uv run python examples/playwright/main.py
```

The script launches Chromium in headless mode to access the target URL, prints title/body snippets, and saves a full-page screenshot to `/home/playwright/screenshot.png` inside the sandbox. It also downloads the screenshot to the local working directory as `./screenshot.png`. Uses the prebuilt Playwright image by default.

![Playwright screenshot](./screenshot.png)

## References
- [Playwright](https://playwright.dev/)
