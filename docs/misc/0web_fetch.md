
    web_search / web_fetch Production Readiness Analysis

    ❌ BROKEN: web.search capability

    Problem: The nullclaw provider (primary provider for web.search) calls nullclawIntegration.searchWeb(args.query) at
     bootstrap-nullclaw.ts:100, but `searchWeb` method does not exist on the NullclawIntegration class. This will throw
     a runtime error: nullclawIntegration.searchWeb is not a function.

    Providers registered: Only nullclaw and mcp-search. Neither mcp-search has a registered bootstrap either.

    ⚠️ PARTIALLY WORKING: web.fetch capability

    Problem: web.fetch lists ['native', 'nullclaw'] as provider priority, but:
     - `native` provider: No bootstrap file registers a native web.fetch implementation
     - `nullclaw`: Has browseUrl which could work, but no explicit fetch handler registered

    What Actually Works

    The only working path is the direct Vercel AI SDK `web_fetch` tool used in enhanced-llm-service.ts (lines 969-977)
    where it injects a hint to the model to use web_fetch when URLs are detected. This uses the AI SDK's built-in tool,
     not the capability system.

    Fixes Needed

     1. Add `searchWeb` method to nullclaw-integration or remove the broken nullclaw web.search registration
     2. Add native web.fetch provider that uses fetch() to retrieve URL content
     3. Or remove web.search/web.fetch from capability definitions if they're not meant to work yet