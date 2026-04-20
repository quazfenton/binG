---
id: web.browse
name: Browse URL
version: 1.0.0
description: "Fetch and parse web pages. Supports JavaScript rendering, CSS-selector extraction, screenshot capture, and interaction (click, type). Primary tool for web research and content extraction."
category: web
source: core
runtime:
  type: native
  providerPriority:
    - nullclaw
    - mcp-browser
    - puppeteer
triggers:
  - browse
  - fetch
  - scrape
  - url
  - website
  - webpage
  - open url
  - visit
actions:
  - name: browse_url
    description: "Fetches and parses web page content. Can extract specific elements, capture screenshots, or interact with the page."
    paramsSchema:
      type: object
      properties:
        url:
          type: string
          description: "URL to browse"
        action:
          type: string
          enum:
            - fetch
            - extract
            - click
            - screenshot
          default: fetch
        selector:
          type: string
          description: "CSS selector for content extraction or interaction target"
        waitFor:
          type: string
          description: "CSS selector to wait for before returning (for JS-heavy pages)"
        input:
          type: string
          description: "Text to type into the selected element (for click + type interactions)"
      required:
        - url
    returns:
      type: object
      properties:
        success:
          type: boolean
        content:
          type: string
        title:
          type: string
        url:
          type: string
        screenshot:
          type: string
    timeoutMs: 30000
permissions:
  allowedHosts: []
  requiredScopes:
    - web:browse
tags:
  - web
  - browse
  - scrape
  - fetch
  - http
  - url
  - browser
metadata:
  latency: medium
  cost: medium
  reliability: 0.95
enabled: true
---

# Browse URL

This power allows the agent to fetch and parse web pages using a headless browser. It supports multiple modes of operation from simple content fetching to full-page interaction.

## Usage

Use the `browse_url` action to fetch web page content.

**Parameters:**
- `url` (string, required): The URL of the web page to browse.
- `action` (enum, optional, default: 'fetch'): The browsing action:
  - `fetch` — Return the full page text content (no JS rendering needed for static pages)
  - `extract` — Extract specific elements using a CSS `selector`
  - `click` — Click an element identified by `selector`, optionally `input` text first
  - `screenshot` — Capture a screenshot and return it as base64
- `selector` (string, optional): A CSS selector to target specific elements for extraction or interaction.
- `waitFor` (string, optional): A CSS selector to wait for before returning — useful for JS-heavy pages that load content dynamically.
- `input` (string, optional): Text to type into the selected element before clicking (for form interactions).

**Returns:**
- `success` (boolean): Whether the operation was successful.
- `content` (string, optional): The fetched content of the page or extracted element text.
- `title` (string, optional): The title of the web page.
- `url` (string): The final URL after any redirects.
- `screenshot` (string, optional): Base64 encoded screenshot if the `screenshot` action was used.

## Behavior

1. For `fetch`, the page is loaded and the textual content is extracted (similar to `document.body.innerText`).
2. For `extract`, only the content matching the CSS `selector` is returned.
3. For `click`, the element matching `selector` is clicked. If `input` is provided, the text is typed into the element first.
4. For `screenshot`, a full-page screenshot is captured and returned as a base64 PNG.
5. If `waitFor` is specified, the browser waits until an element matching that selector appears before proceeding.

## Examples

```bash
# Fetch a page
browse_url({ url: 'https://example.com' })

# Extract all links from a page
browse_url({ url: 'https://news.ycombinator.com', action: 'extract', selector: 'a.titlelink' })

# Take a screenshot
browse_url({ url: 'https://example.com', action: 'screenshot' })

# Fill and submit a search form
browse_url({ url: 'https://google.com', action: 'click', selector: 'input[name=q]', input: 'binG AI assistant' })
```

## Security Notes

- URLs are validated against the `allowedHosts` list when configured.
- JavaScript execution is sandboxed in the headless browser.
- No cookies or authentication state is carried between requests unless explicitly configured.
