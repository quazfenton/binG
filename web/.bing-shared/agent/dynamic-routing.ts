/**
 * Dynamic Routing Instructions
 * 
 * These instructions can be injected into any system prompt to enable
 * self-routing without a separate classification call.
 * 
 * The LLM decides complexity based on:
 * - Task scope (single file vs multi-file)
 * - Code amount (>50 lines = complex)
 * - Tool call requirements
 * - Architecture decisions needed
 */

export const DYNAMIC_ROUTING_INSTRUCTIONS = `
============================================
# DYNAMIC SELF-ROUTING
============================================

Automatically evaluate task complexity and execute appropriately:

## ROUTING LEVELS

### Level 1: DIRECT (simple tasks)
Respond directly without triggering execution mode.

Indicators:
- Single file read/write
- Quick question or explanation  
- Simple bug fix (one location)
- Copy/edit under 20 lines
- No tests needed

Response: Return answer directly.

---

### Level 2: SUGGEST (moderate tasks)
Respond with execution suggestions for follow-up.

Indicators:
- Multi-file changes needed
- Non-trivial logic implementation
- Context understanding required
- Refactoring across 2-3 files
- Test additions

Response format:
[STEP_BREAKDOWN]
1. [First action to take]
2. [Second action]
3. [Verification step]

---

### Level 3: EXECUTE (complex tasks)
Trigger multi-step execution mode.

Indicators:
- Full feature implementation
- Multi-module changes (>3 files)
- New files/folders needed
- Architecture decisions
- Test suite creation
- Configuration changes

Response format:
[EXECUTION_PLAN]
TASK: [Clear objective]
STEPS:
  1. [Step with file paths]
  2. [Step with file paths]
  3. [Verification]
RISKS:
  - [Potential issue and mitigation]
SUCCESS_CRITERIA:
  - [What completion looks like]

---

## DECISION THRESHOLDS

Use these to determine routing level:

| Factor | Simple | Moderate | Complex |
|--------|--------|----------|---------|
| Files | 1 | 2-3 | >3 |
| New code | <20 lines | 20-50 lines | >50 lines |
| Tool calls | 0-1 | 2-4 | >4 |
| Tests | none | partial | full |
| Architecture | none | minor | significant |

## OUTPUT FORMAT

Always structure response as:

1. **IMMEDIATE**: [Direct answer or partial implementation]
2. **NEXT**: [If more needed, what to do]
3. **VERIFY**: [How to confirm success]

This allows immediate return while enabling continuation.
`;

/**
 * Tool Selection Filter Instructions
 * 
 * These instructions prioritize tool selection over explicit mode routing.
 * The LLM should choose tools based on task requirements, not based on
 * a predetermined execution mode.
 */
export const TOOL_SELECTION_FILTER = `
============================================
# TOOL SELECTION PRIORITY
============================================

Let task requirements drive tool selection, not execution mode:

## TOOL SELECTION HIERARCHY

1. **NEED-BASED**: What tools does this task require?
   - File operations? → Use file.read/write/search
   - Code execution? → Use sandbox.execute
   - Research? → Use web.search/browse
   - Don't use tools that aren't needed

2. **SCOPE-BASED**: How many tools are needed?
   - 0-1 tools → Direct response sufficient
   - 2-4 tools → Moderate complexity, suggest breakdown
   - >4 tools → Complex, suggest execution mode

3. **ACCUMULATION**: Track tool calls to self-trigger complexity
   - If you find yourself needing >2 tools, consider breaking down
   - If you need tools across different domains, it's complex

## TOOL FILTERING

Before making a tool call, ask:
- Is this tool necessary for the immediate next step?
- Can I complete this step without a tool call?
- Will this tool call require follow-up calls?

If yes to >2 of these, you're in complex territory.

## EXECUTION MODE TRIGGER

Complex tasks should self-trigger execution mode via:

[REQUIRE_EXECUTION]
MODE: agent-loop
REASON: [Why this needs multi-step execution]
NEXT_TOOL: [What to call next]
`;