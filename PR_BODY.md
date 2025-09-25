# feat(embed): embed mode for Conversation + /embed routes + plugin upgrades

## Summary
Adds a robust embed mode for the chat UI and dedicated `/embed/*` pages for plugin mini-apps. Upgrades multiple plugins to production‑ready functionality and UI. Enables parent→iframe auth via postMessage.

### New /embed routes
- `/embed/notes`: NoteTakerPlugin
- `/embed/hf-spaces`: HuggingFaceSpacesPlugin
- `/embed/network`: NetworkRequestBuilderPlugin
- `/embed/github`: GitHubExplorerPlugin

## Conversation embed mode
- Detects `embed=1` or if iframed
- Hides provider/model header when embedded
- Disables ad gating in embed mode
- Sends `{ type: 'bing:ready' }` to parent on load
- Listens for `{ type: 'bing:auth', token }` and stores `localStorage('token')`

## Plugin upgrades
- Notes: markdown edit/preview, categories, search, local persistence, export
- Hugging Face Spaces: multi-tab (Image Gen, Spaces iframe, API stub), model controls, init image URL, download results
- GitHub Explorer: repo load, metadata/stats, file tree, view file content, clone link
- Network Request Builder: headers/body builder, response viewer, mock encryption, new Presets tab for common APIs

## Files touched (high-level)
- `components/conversation-interface.tsx`: embed detection, postMessage listener, header visibility
- `app/embed/*`: four new pages wrapping plugins
- `components/plugins/*`: upgraded plugin UIs/logic
- `next.config.mjs`: no change required, API headers permissive for embedding

## Testing
- Open each `/embed/*` route directly and verify functionality
- When embedded in `www.quazfenton.xyz`, verify iframe UX and postMessage auth reception
- Confirm Notes save to localStorage; HF generate works via `/api/image/generate`; GitHub explorer fetches with PAT; Request Builder sends and displays responses

## Rollout notes
- Ensure deployment allows embedding from the main domain (`frame-ancestors` or similar CSP)
- If needed, add CORS exceptions or API proxies for external API tests in Request Builder

## Checklist
- [ ] Verify `/embed` routes reachable in production
- [ ] Confirm Conversation embed behavior in iframe
- [ ] Validate plugin functionality on mobile
- [ ] (Optional) Add lightweight `/embed` layouts with reduced padding if desired
