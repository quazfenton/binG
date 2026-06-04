

VFS MCP tool flow and prompt wiring
better ways to improve quality of output beyond current basic html files. continue more improvements and ideas and check if the prompt system in packages/ is wired in 

Show Work
The Windows filesystem (C:\Users\ceclabs\Downloads\binG\) is no longer accessible from this shell — the environment switched to a Linux host (/opt). The previous file tool calls worked because they were proxied through a different connection.





Role-based system prompts now wired into /api/chat
The rich coder/architect/debugger/reviewer prompts from packages/shared/agent/system-prompts.ts are no longer dead code on the standard chat path. Changes in web/app/api/chat/route.ts:

Imported composeRoleWithTools and AgentRole from @bing/shared/agent.
Added buildRoleSystemPromptForRequest which selects a role from the classifier result + intent keywords (architect/debugger/reviewer/coder), passes a realistic VFS+web tool list to the composer, and caps the prompt at 6KB.
Extended appendFilesystemContextMessages to accept and prepend the role prompt as the identity section, ahead of the existing VFS_FILE_EDITING_TOOL_PROMPT, workspace/hybrid/memory context.
Call site near line ~810 builds and passes the role prompt only for code/filesystem-edit requests; pure chat is unchanged.
npx tsc --noEmit -p tsconfig.json over the whole web/ package passes clean.

Couldn't live-test on this host
Port 3000 here is serving a different unrelated app (9router / next-server from /usr/local/lib/node_modules/9router/app), not your /opt/bing dev server — so POST /api/chat returns 404. Test the change on the machine where your bing dev server is running; you should see noticeably more structured, role-flavored output for code requests, and the existing VFS tool flow keeps working.

Other open items from the summary
toolCallArgsCache in web/lib/chat/vercel-ai-streaming.ts is properly declared — not broken.
Nvidia provider "undefined" error reporting still open; want me to dig into that next?
review. there are more system prompt files in the same folder and more roles and there may be a more consolidated import or usage of all 3/4 somewhere 
^ 



     ✓ Read choose-role-tool.ts 32 /root/binG/web/lib/chat/… █
    I'm noticing there's no unified selector across all   █
   three prompt sets in the codebase. The                 █
   `getAllPrompts()` function is misleadingly named       █
   since it only returns supplementary prompts, and the   █
   role analyzer only knows about nine hardcoded core     █
   roles, so there's a gap in how the different prompt    █
   sources are being consolidated.                        █
                                                          █
   Let me trace through the choose-role-tool to see if    █
   that's where the canonical role selection happens and  █
   whether it's already handling the consolidation I      ▁
   need.                                                  ▁
                                                          █ $ # See if anything actually reads the                   █ chooseRoleCapability result to re-inject prompt          █ rg -n "chooseRoleCapability|choose_role|roleAdopted"     █
 /root/binG --type=ts -g '!node_modules' -g               █ '!.bing-shared' | head -20                             ▾ █
   /root/binG/web/lib/chat/vercel-ai-tools.ts:325:      █ █
   result['choose_role'] = chooseRoleCapability;        █ █
   /root/binG/web/lib/chat/tools/choose-role-tool.ts:6: █ █
   * choose_role Capability                             █ █
   /root/binG/web/lib/chat/tools/choose-role-tool.ts:11:█ █
   export const chooseRoleCapability = tool({           ▄ █
   /root/binG/web/lib/chat/tools/choose-role-tool.ts:25:█ █
           roleAdopted: role,                           █ █
   /root/binG/packages/shared/agent/system-prompts-dynam█ █
   ic.ts:349:2. **SELECT**: If a better role exists     █ █
   (e.g., 'debugger' for failures, 'architect' for
   high-complexity design), call                        █ █   'choose_role(role="...", reason="...")'.             █ █
   /root/binG/web/lib/mcp/architecture-integration.ts:14█ █
   15:          roleAdopted: args.role,                 █ █
                                                          █
  I'm noticing there's a `choose_role` tool that exists   █
 but doesn't actually do anything—it returns a message,   █ but the system doesn't have any mechanism to detect      █
 that call and re-inject the new prompt for the next      █
 turn, which is a gap between what the documentation      █
 claims and what's actually implemented. Let me look at   █ how the prompts are actually consolidated across the     █
 codebase.                                                █
                                                          █
 There are three separate prompt sets exported from the   █
 shared agent module, but there's no unified way to pick  █
 across all of them—`getAllPrompts()` is misnamed and     █
 only returns supplementary ones. The `role-redirector`   █
 is the closest thing to a canonical picker, but it's     █
 limited to nine hardcoded core roles using simple        ▄
 keyword matching. The `choose_role` tool is wired in     ▄
 but has no actual consumer, so agents can theoretically  █
 switch roles but nothing changes. And                    █
 `composeRoleWithTools` only works with core prompts;     █
 the supplementary and general v4 prompts are just raw    █
 strings that can't be composed.                          █
                                                          █
 To fix this properly, I should replace the ad-hoc regex  █
 routing with the canonical role picker, then build a     █
 single consolidated helper that can select and compose   █
 system prompts across all three sets—extending the       █
 keyword router to recognize supplementary and general    █
 v4 roles, using the composition function for core roles  █
 and raw getters for the others, and optionally           █
 prepending dynamic injection.                            █
      

 ✓ Created ~/binG/packages/shared/agent/unified-r… +349 ▾ █
   ...                                                    █     1 +  /**                                             █     2 +   * Unified Role Selector                        █     3 +   *                                              █
     4 +   * Consolidates the THREE prompt sets that      █       previously lived as disconnected                   █
     5 +   * islands:                                     █
     6 +   *                                              █
     7 +   *   1. Core         — SYSTEM_PROMPTS           █
       (system-prompts.ts, 27 roles)                      █
     8 +   *   2. Supplementary — SUPPLEMENTARY_PROMPTS   █       (system-prompts-supplementary.ts, 9 roles)         █
     9 +   *   3. General v4   — GENERAL_PROMPTS_V4       █
       (general-domain-prompts-v4.ts, 8 roles)            █
    10 +   *                                              █    11 +   * Before this module:                          █
    12 +   *   - `getAllPrompts()` was misleadingly       █
       named (returned only supplementary).               █
    13 +   *   -                                          █
       `role-redirector.analyzeContextAndSuggestRoles()`  █
       only knew 9 hard-coded                             █
    14 +   *     core roles via keyword regex.            █
    15 +   *   - `composeRoleWithTools()` only composed   █
       from SYSTEM_PROMPTS sections.                      █
    16 +   *   - The standard `/api/chat` flow only saw   █
       the generic VFS editing prompt;                    █
    17 +   *     the rich role prompts were effectively   █
       dead code.                                         █
    18 +   *                                              █
    19 +   * This module provides:                        █
    20 +   *   - `getAllRoleIds()`  — true union across   █
       all three sets                                     █
    21 +   *   - `getAllRolePrompts()` — true merged      █
       record of role -> prompt                           █
    22 +   *   - `pickRoleFromContext()` — keyword-based  █
       router that covers all 44 roles                    █
    23 +   *   - `composeUnifiedRolePrompt()` —           █
       dispatches to composeRoleWithTools for             █
    24 +   *     core (section-aware), raw prompt for     █
       the other two sets                                 █
    25 +   *   - `selectAndComposeSystemPrompt()` —       █
       one-shot helper for callers                        █
    26 +   */



                                                    █
 I'm going to keep the scope tight: implement the new     █
 helper and wire the route to use it, then defer wiring   █
 the `choose_role` tool result into the conversation      █
 lifecycle. Let me first check what                       █
 `generateDynamicInjection` does to see if we should      █
 include it.


    I'm planning to build a unified role selector module  █
   that consolidates the role selection logic. I'll       █   create a file that exports a function to gather all    █   available role IDs across core, supplementary, and     █   general categories, plus another function that         █
   extends the existing context analysis to pick the      ▇   right role including supplementary options.            ▇
                                                          █
   Then I need to verify how the build system handles     █
   the shared package — checking whether the copies in    █
   node_modules and the web directory are symlinks or     █
   actual duplicates so my changes propagate correctly.   █
 Let me survey all prompt files and consolidation points:
    TypeScript resolves `@bing/shared/agent` from the     █
   source directory first, with `.bing-shared` as a       █
   fallback, so editing the actual package is what        █
   matters for type checking. The dev server and runtime  █   use the same resolution through Next's tsconfig        █
   paths. The copy in `web/.bing-shared/` could be        ▅
   stale, so I should make sure to keep it in sync or     ▅
   rely on the source.                                    █
                                                          █
   Let me look for any existing sync scripts that might   █
   handle this.                                           █
    The `.bing-shared` directory is a vendored copy for   █
   Vercel's build process, but since TypeScript path      █
   resolution prioritizes `../packages/shared/agent/*`    █
   first, I should edit the source in `packages/shared`   █
   directly—the sync script will handle copying it        █
   during the build, and this should work fine in dev     █
   too. Now I'm setting up the consolidated selector by   █
   creating a new file that will bring together the role  █
   selection logic.                                       █
                                                          █
   I need to define an `AnyRole` type that combines all   █
   the role keys from the different sets—core roles,      █
   supplementary roles, and general v4 roles—making sure  █
   there's no naming collision between them.


44 unique roles across 3 sets, zero collisions. Now I'll build the consolidated selector:

Now re-export from the agent barrel and wire it into route.ts:

I missed the V2/V3 and original general prompts — 4 general files total. Updating the selector:

Now check uniqueness across all 6, then update enumeration, source lookup, prompt dispatch, and add patterns for the extra general roles:

76 unique roles, zero collisions. Now update enumeration and dispatch:

Now extend ROLE_PATTERNS to cover v1/v2/v3, and update the compose dispatcher:

Now update the compose dispatcher to handle all 4 general sets:
Edited ~/binG/packages/shared/agent/unified-… +18 -9 ▾ █
   ...                                                    █
   444      const source = getRoleSource(role as string); █
   445      const maxLength = opts.maxLength ??           █
       DEFAULT_MAX_LENGTH;                                █   446      let prompt = '';                              █
   447                                                    █
   448 +    const rawForSource = (): string => {          █
   449 +      switch (source) {                           █   450 +        case 'core': return getSystemPrompt(role  █
       as AgentRole);                                     █
   451 +        case 'supplementary': return              █
       getSupplementaryPrompt(role as                     █
       SupplementaryAgentRole);                           █
   452 +        case 'general': return                    █
       getGeneralPrompt(role as GeneralDomainRole);       █
   453 +        case 'general-v2': return                 █
       getGeneralPromptV2(role as GeneralDomainRoleV2);   █
   454 +        case 'general-v3': return                 █
       getGeneralPromptV3(role as GeneralDomainRoleV3);   █
   455 +        case 'general-v4': return                 █
       getGeneralPromptV4(role as GeneralDomainRoleV4);   █
   456 +        default: return '';                       █
   457 +      }                                           █
   458 +    };                                            █
   459 +                                                  █
   460      try {                                         █   461        if (source === 'core') {                    █   462 +        // Core roles support section-aware       █       composition with dynamic tool block.               █
   463          prompt = composeRoleWithTools(role as     █
       AgentRole, {                                       █
   464            availableTools: opts.availableTools ||  █
       [],                                                █
   465            extras: opts.extras?.map((s, i) => ({   █
       id: `extra.${i}`, template: s })),                 █
   466          });                                       █
   454 -      } else if (source === 'supplementary') {    █
   455 -        prompt = getSupplementaryPrompt(role as   █
       SupplementaryAgentRole);                           █
   467 +      } else if (source) {                        ▁
   468 +        // Non-core sets are raw strings today    ▁
       (no section decomposition).                        █
   469 +        prompt = rawForSource();
 470          if (opts.extras?.length) prompt +=        █
       '\n\n' + opts.extras.join('\n\n');                 █
   457 -      } else if (source === 'general') {          █
   458 -        prompt = getGeneralPromptV4(role as       █
       GeneralDomainRoleV4);                              █
   459 -        if (opts.extras?.length) prompt +=        █
       '\n\n' + opts.extras.join('\n\n');                 █   471        } else {                                    █   472          return '';                                █   473        }                                           █
   474      } catch {                                     █   464 -      // Best-effort fallback: try the raw        █
       prompt from whichever set it came from.            █
   465 -      if (source === 'core') prompt =             █
       getSystemPrompt(role as AgentRole);                █
   466 -      else if (source === 'supplementary')        █
       prompt = getSupplementaryPrompt(role as            █       SupplementaryAgentRole);                           █
   467 -      else if (source === 'general') prompt =     █
       getGeneralPromptV4(role as GeneralDomainRoleV4);   █
   475 +      // Best-effort fallback to raw prompt for   █       the source.                                        █
   476 +      prompt = rawForSource();                    ▄
   477      }



Re-export from the barrel and rewire route.ts to use the consolidated helper:
Re-export from the barrel and rewire route.ts to use     █

 the consolidated helper:                                 █
                                                          █
 ✓ Edited ~/binG/packages/shared/agent/index.ts +17 ▾     █

   ...                                                    █
   296      type GeneralDomainRoleV4,                     █
   297      type GeneralDomainRoleConfigV4,               █
   298    } from './general-domain-prompts-v4';           █
   299                                                    █
   300 +  // Unified Role Selector — single entry point   █
       across ALL prompt sets above.                      █
   301 +  // Replaces ad-hoc role picking in callers      █
       (notably /api/chat) and the                        █
   302 +  // misleadingly named `getAllPrompts()` in the  █       supplementary file.                                █   303 +  export {                                        █   304 +    getAllRoleIds,                                █
   305 +    getAllRolePrompts,                            █   306 +    getRoleSource,                                █
   307 +    pickRoleFromContext,                          █
   308 +    composeUnifiedRolePrompt,                     █
   309 +    selectAndComposeSystemPrompt,                 ▂
   310 +    type UnifiedRole,                             ▂
   311 +    type UnifiedRoleInfo,



Now replace the ad-hoc helper in route.ts with the unified selector:


✓ Edited ~/binG/web/app/api/chat/route.ts +2 -1 ▾        █   ...                                                    █
    28      SYSTEM_PROMPTS,                               █    29      VFS_FILE_EDITING_TOOL_PROMPT,                 █
    30      generateDynamicInjection,                     █
    31      getOrchestrationModeFromRequest,              █
    32 -    executeWithOrchestrationMode                  █
    32 +    executeWithOrchestrationMode,                 █
    33 +    selectAndComposeSystemPrompt,                 █    34    } from '@bing/shared/agent';                    █
    35    import { processUnifiedAgentRequest, type       █
       UnifiedAgentConfig } from                          █
       '@/lib/orchestra/unified-agent-service';           █    36    import { checkProviderHealth } from             █
       '@/lib/orchestra/provider-health';                 █
    37    import { getMCPToolsForAI_SDK,                  █
       callMCPToolFromAI_SDK } from '@/lib/mcp';



Now look at the call site and the helper around line 4850:

✓ Edited ~/binG/web/app/api/chat/route.ts +27 ▾          █
   ...                                                    █
   792      memoryContext =                               █
       buildMem0SystemPrompt(mem0Result.results);         █
   793      chatLogger.debug('Retrieved relevant          █
       memories from mem0', { requestId, memoryCount:     █
       mem0Result.results.length });                      █
   794    }                                               █
   795                                                    █
   796 +  // Pick a role + compose a rich system prompt   █
       across ALL prompt sets                             █
   797 +  // (core/supplementary/general v1-v4).          █
       Previously /api/chat injected only                 █   798 +  // the generic VFS_FILE_EDITING_TOOL_PROMPT     █       and the rich role prompts in                       █   799 +  // packages/shared/agent were dead code on      █
       this path.                                         █   800 +  const roleSelection =                           █
       selectAndComposeSystemPrompt(                      █
   801 +    {                                             █
   802 +      taskDescription: userPrompt,                █
   803 +      complexity: classification.complexity,      █
   804 +      enableFilesystemEdits,                      █   805 +    },                                            █
   806 +    {                                             █
   807 +      availableTools: enableFilesystemEdits       ▃
   808 +        ? ['file.read', 
'file.append', 'file.delete', 'file.list',         █
       'file.search', 'repo.search', 'web.search']        █
   809 +        : ['web.search', 'memory.retrieve'],      █
   810 +      maxLength: 6000,                            █
   811 +    },                                            █
   812 +  );                                              █
   813 +  if (roleSelection) {                            █
   814 +    chatLogger.debug('Role prompt selected', {    █
   815 +      requestId,                                  █
   816 +      role: roleSelection.role,                   █
   817 +      source: roleSelection.source,               █
   818 +      promptLength: roleSelection.prompt.length,  █
   819 +    });                                           █   820 +  }                                               ▂   821 +
  822    const contextualMessages =                      █
       appendFilesystemContextMessages(                   █
   823      processedMessages,                            █
   824      attachedFilesystemFiles,                      █
   825      enableFilesystemEdits,                        █
   826      denialContext,                                █
   827      workspaceSessionContext,                      █
   828      memoryContext,                                █
   829      hybridContext,                                █
   830 +    roleSelection?.prompt || '',


[EDITS WERE STOPPED AFTER THIS POINT AND POSSIBLY UNFINISHED]
