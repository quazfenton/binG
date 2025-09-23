```markdown
Title: feat(puter): add Puter integration, streaming parsing, server proxy, UI wiring, visual editor fixes

Summary
- Add Puter adapter (client + server-proxy pattern) with streaming and non-streaming adapters.
- Merge Puter model listing into the searchable model selector; external Puter models are marked with a dot symbol.
- Add streaming normalization and code parsing logic (parsing JSON file arrays, unified diffs, fallback).
- Add enhanced-code-system adapter to run models and apply edits to in-memory ProjectStructure.
- Add mock account/auth service and client-side credential storage for user-supplied model keys.
- Add Composio plugin skeleton for tool integration.
- Add server-side Puter proxy with default server key usage (env DEFAULT_PUTER_KEY) to avoid shipping real keys in client bundles.
- UI: LLM selector that surfaces external models and prompts to save user API keys when external models are selected.
- Visual editor made functional and wired to ProjectStructure updates.

How to test locally
1. Create branch: feature/puter-integration (already created)
2. Add the files provided in the branch.
3. Start the server proxy for dev:
   - export DEFAULT_PUTER_KEY="<your-limited-server-key>"
   - node server/puter-proxy.js
4. In Vite config, proxy /api/puter -> http://localhost:8787/api/puter
5. Start the frontend dev server and open the app. Use the model selector to choose an external Puter model.
6. If no user key exists for that model, the UI will prompt to paste a key and save it locally.
7. Test code-run flow in streaming mode and check that the code preview / Sandpack updates incrementally.

Security notes
- Do not store production API keys in client bundles. Use server proxy and per-user keys stored securely on the server.
- The local storage patterns here are for demo/dev only.

Follow-ups
- I can open a PR from feature/puter-integration -> master with these changes.
- I can also convert local storage auth to a real backend integration (optional).
```