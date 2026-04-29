context modes (toggled via contextMode):
"diff" — snapshots files before/after each iteration, injects only what changed. Best for large projects, minimal token waste.
"read" — inlines all current file contents each iteration. Most accurate, higher token cost.
"tree" — tree only, no file content. Lightest weight, LLM infers what to build next.

IMPLEMENTED in: /root/bing/web/lib/virtual-filesystem/smart-context.ts
- SmartContextOptions.contextMode: 'diff' | 'read' | 'tree'
- SmartContextResult.contextMode, diffCount
- generateUnifiedDiffs(before, after) — LCS-based unified diff generator
- captureFileSnapshot(userId, filePaths) — snapshot specific files
- captureFullSnapshot(userId) — snapshot all VFS files

Also exported from hybrid-retrieval.ts which re-exports smart-context.

---

INTEGRATED: Progressive Build Mode in Unified Agent Service
File: /root/bing/web/lib/orchestra/unified-agent-service.ts

Mode: 'v1-progressive-build' — added to UnifiedAgentConfig.mode union and UnifiedAgentResult.mode union.

New config field: progressiveBuild?: { maxIterations, contextMode, enableReflection, timeBudgetMS, completionIndicator }

How to activate:
1. Explicit: Set mode: 'v1-progressive-build' in UnifiedAgentConfig
2. Via env: Set AGENT_EXECUTION_ENGINE=progressive-build (add to determineMode routing)
3. From chat route: Pass mode: 'v1-progressive-build' with progressiveBuild options

The mode integrates with:
- Vercel AI SDK streamText for LLM calls (same as v1-api mode)
- Capability-based tool executor (createCapabilityToolExecutor)
- ReflectionEngine for optional gap analysis
- SSE events via onStreamChunk for frontend progress
- VFS scoping via userId + conversationId
- Fallback: throws on error to trigger unified agent's fallback chain

NOT in auto rotation — must be explicitly requested.

---

IMPLEMENTED: Progressive Build Engine
File: /root/bing/web/lib/chat/progressive-build-engine.ts

Core concept: A multi-iteration, file-aware, self-stopping project build loop.
The LLM is called repeatedly with updated project state until completion.

Key features:
- contextMode integration: uses smart-context.ts modes for context injection
- mem0 integration: loads relevant memories from prior conversations
- Optional reflection: enableReflection runs a separate LLM call for gap analysis
- Completion detection: [BUILD_COMPLETE], [PROJECT_COMPLETE], JSON footer, etc.
- SSE events: progressive_build events for real-time frontend progress
- Abort signal support for user cancellation
- Empty iteration detection: stops after N rounds with no new files
- Time budget enforcement: global timeout
- Modular: caller provides LLM function, optional reflection override

BuildPresets:
- large: diff mode, 20 iterations, reflection enabled
- thorough: read mode, 12 iterations, reflection enabled
- fast: tree mode, 10 iterations, no reflection
- balanced: diff mode, 15 iterations, no reflection

SSE Event Type: progressive_build
Added to: /root/bing/web/lib/streaming/sse-event-schema.ts
Stages: started, iteration_start, iteration_complete, iteration_error, complete, max_iterations_reached





   Core Concept: project-build mode                            
    A toggleable mode (like enhanced/max/super) that runs the       LLM through successive build iterations, each time
    re-prompting it with:

     1. Updated project tree/map (reflecting files                      created/modified in prior rounds)
     2. Recent diffs or file contents (what was actually written        last round)
     3. Original user prompt (as the north-star reference)           4. Instructions to build the next logical piece of the
        project                                                 
    Stop condition: The LLM ends its response with a
    detectable marker, e.g.:

     1 [BUILD_COMPLETE]

    Or a structured footer:

     1 {"build_status": "complete", "reason": "All                     requirements from initial prompt satisfied"}             
    ---

    Mode Config (toggleable)

      1 interface ProgressiveBuildConfig {
      2   enabled: boolean;                                           3   maxIterations: number;        // hard cap (default:
        10-15)                                                        4   timeBudgetMS: number;         // global timeout
        (default: 300,000ms = 5min)                                   5   completionIndicator: string;  // default:
        "[BUILD_COMPLETE]"
      6   contextStrategy: 'diffs' | 'full-files' |
        'tree-only';
      7   maxContextTokens: number;     // prevent context              overflow (default: 8000)
      8   autoReview: boolean;          // after each
        iteration, run a reflection pass
      9   selfCritique: boolean;        // tell LLM to review
        its own work before next round
     10   stopOnEmptyIteration: boolean;// if an iteration
        produces no new files, stop early                            11 }
                                                                    UI toggle: Add project-build as a 5th mode in
    spec-enhancement-mode-context.tsx alongside normal,
    enhanced, max, super.
                                                                    ---                                                                                                                             Architecture Ideas                                          
    1. Progressive Context Injection                            
    Each round, the system prompt grows:
                                                                      1 Round 1: "Build this project: <user_prompt>"
      2          → LLM outputs some files                             3
      4 Round 2: "Continue building this project: <user_prompt
        >
      5                                                               6          Current project tree:
      7          src/
      8            components/
      9              Button.tsx     (created round 1)
     10              Input.tsx      (created round 1)                11            utils/
     12              helpers.ts     (created round 1)                13
     14          Recent changes (last round diffs):
     15          --- src/components/Button.tsx
     16          +++ src/components/Button.tsx                       17          @@ ... @@
     18          +export function Button() { ... }                   19
     20          Build the NEXT logical piece. Do NOT repeat            what already exists.
     21          End with [BUILD_COMPLETE] when the original            prompt is fully implemented."                                                                                               This is significantly different from the existing
    spec-refinement engines because those refine a spec
    document. This one actually writes code and feeds the
    project state back in.
                                                                    2. Completion Indicator Detection
                                                                      1 const BUILD_COMPLETE_PATTERNS = [
      2   /\[BUILD_COMPLETE\]/i,
      3   /\[PROJECT_COMPLETE\]/i,                                    4   /{"build_status"\s*:\s*"complete"/i,
      5   /All requirements satisfied/i,                              6   /Everything has been implemented/i,
      7 ];
      8                                                               9 function detectBuildComplete(response: string):
        boolean {                                                    10   // Check end of response specifically (LLMs tend to           put the marker at the very end)
     11   const last500 = response.slice(-500);                      12   return BUILD_COMPLETE_PATTERNS.some(p => p.test
        (last500));                                                  13 }
                                                                    3. Context Window Management
                                                                    The biggest risk is blowing past token limits. Strategies:

     - Tree-only mode: Just inject the project tree (cheap, ~500        tokens for a medium project)
     - Diff-only mode: Inject the unified diffs from the last
       round (grows with edits, but bounded)                         - Full-files mode: Read the most recent N files (expensive
       but highest quality)
     - Smart trimming: Keep the tree always, but only include          diffs/files from the last 2 rounds (sliding window)      
    4. Self-Review Pass Before Next Round                       
    After the LLM writes files in round N, fire a separate,         cheap LLM call (e.g., gpt-4o-mini) that:

     1. Reads what was written                                       2. Compares against the original prompt
     3. Produces a short "gap analysis" (what's still missing)
     4. This gap analysis becomes part of round N+1's system
        prompt
                                                                     1 ## Gap Analysis (from review of round 2)
     2 ✅ Button component — done                                    3 ✅ Input component — done
     4 ❌ Form validation logic — missing                            5 ❌ API integration layer — missing                            6 ❌ Error handling — not addressed

    This is the "amplification" aspect — the LLM gets explicit
     feedback on what it missed.

    5. Integration with Existing Agent Loop

    Rather than building a new engine from scratch, wire it as
     a layer on top of the existing agentLoop.ts:

      1 ProgressiveBuildLoop
      2   ├── SpecAmplification (round 0): Generate build plan          from user prompt                                              3   ├── For each round:
      4   │   ├── Inject project tree + recent diffs into
        prompt                                                        5   │   ├── Call agentLoop.ts with "build the next
        piece" instruction
      6   │   ├── Apply diffs → VFS
      7   │   ├── Update project tree
      8   │   ├── (Optional) Self-review pass
      9   │   └── Detect [BUILD_COMPLETE] → if found, break          10   └── Return: all files created, final project tree,
        build log                                                                                                                   6. UX: Real-Time Build Progress                                                                                                 New SSE events for the frontend:                                                                                                  1 {
      2   type: 'progressive_build',                                  3   iteration: 3,                                               4   maxIterations: 10,
      5   filesCreatedThisRound: ['src/auth.ts',
        'src/auth.test.ts'],                                          6   projectTree: { ... },
      7   gapsIdentified: ['API layer', 'Error handling'],
      8   selfReview: 'Round 2 covered auth and testing. Next:
        API integration.',
      9   buildComplete: false,
     10   completionReason: null,                                    11 }                                                                                                                           Frontend shows a multi-round progress dashboard:            
      1 ┌─ Progressive Build Mode ──────────────────────────┐
      2 │ Round 3/10  |  2m 14s elapsed                    │
      3 │                                                    │        4 │ ✅ Round 1: Auth components (Button, Input)       │
      5 │ ✅ Round 2: Form validation + tests               │         6 │ 🔄 Round 3: API integration layer...              │         7 │ ⏳ Round 4: (pending)                             │         8 │                                                    │
      9 │ Project: 8 files | 1,240 lines                   │         10 │ Gaps remaining: API layer, Error handling         │
     11 └────────────────────────────────────────────────────┘

    ---
                                                                    Prompt Template (the "secret sauce")
                                                                    The system prompt for each round is the most important
    part:

      1 You are building a software project iteratively.
      2
      3 ## ORIGINAL REQUEST
      4 {userPrompt}
      5                                                               6 ## CURRENT PROJECT TREE                                       7 {projectTree}
      8
      9 ## WHAT WAS WRITTEN LAST ROUND (diffs)
     10 {lastRoundDiffs}                                             11
     12 ## INSTRUCTIONS                                              13 1. Review the current project tree and recent changes
        above.
     14 2. Identify what the user originally asked for that is          NOT YET implemented.                                         15 3. Write ONLY the files/edits needed for the NEXT
        logical piece.                                               16 4. Do NOT repeat or rewrite existing files unless you           are modifying them.
     17 5. Use the write_file, batch_write, and apply_diff
        tools to make changes.
     18                                                              19 ## PROJECT STATUS FROM LAST REVIEW                           20 {gapAnalysis}                                                21                                                              22 ## COMPLETION
     23 When you believe the original request is 100%                   complete, end your response
     24 with exactly: [BUILD_COMPLETE]
     25 Do NOT use this marker until ALL requirements from the          original request are met.                               
    ---                                                                                                                             Edge Cases to Handle

                                                                    ┌─────────────────────┬─────────────────────────────────┐
    │ Case                │ Handling                        │       ├─────────────────────┼─────────────────────────────────┤
    │ LLM never emits ... │ Hard stop at maxIterations o... │       │ LLM rewrites exi... │ Detect in diff application; ... │       │ Context overflow    │ Fall back to tree-only + gap... │
    │ LLM says `[BUILD... │ Self-review pass catches thi... │       │ Infinite loop of... │ After 3 rounds with no new f... │
    │ Token budget exc... │ Truncate oldest diffs, keep ... │       │ User cancels mid... │ Clean abort; keep partial pr... │       └─────────────────────┴─────────────────────────────────┘                                                                   
    ---
                                                                    Synergies with Existing Systems                                                                                                  - Spec Amplification (round 0): Before starting the build
       loop, run a quick spec-amplification pass to turn the
       user's vague prompt into a structured requirements list.        This becomes the "north star" for gap analysis.
     - Reflection Engine: Use the existing reflection-engine.ts        for the self-review pass instead of a separate LLM call.
     - Feedback Loop: The existing feedback-loop.ts could learn        which types of projects need more/fewer rounds and adjust        maxIterations dynamically.                                   - VFS MCP Tools: All file writes go through the existing
       batch_write/write_file tools — the build loop is purely a
        prompting/context orchestration layer, not a filesystem
       layer.                                                        - AgentLoop validation: Each round's diffs pass through
       agentLoop.ts validation (brace matching, conflict               detection) before being committed to VFS.
