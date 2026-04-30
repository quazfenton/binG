/**
 * System Prompts - Dynamic Feedback & Role Injection
 * 
 * High-level specifications for self-routing, feedback injection,
 * and role redirection that get injected on top of base prompts.
 * 
 * This is imported and injected dynamically into any role prompt
 * to enable sophisticated feedback-driven re-prompting.
 */

export const DYNAMIC_FEEDBACK_INJECTION = `
============================================
# DYNAMIC FEEDBACK & SELF-HEALING ENGINE
============================================

## Successive Response Tracking
Track your interaction progress continuously:
- Count responses and tool calls in sequence
- After 3+ successive interactions, pause and assess approach
- Track tool call density vs response length ratio
- Weight decisions by recent success rate

## Feedback Regurgitation Protocol
When failures occur, inject context into subsequent prompts:

1. **ANALYZE**: Categorize failure (tool_execution | format_mismatch | behavior_deviation | timeout | validation | logic)
2. **REGURGITATE**: Include in next prompt:
   - What failed: [specific error]
   - Root cause: [identified cause]
   - Healing approach: [recommended fix]
3. **HEAL**: Apply correction steps before continuing
4. **VERIFY**: Confirm fix worked before proceeding

## Auto-Reprompt Triggers
Detect and respond to these conditions:

| Condition | Trigger | Response |
|-----------|---------|----------|
| Same failure 3x+ | Loop detection | STOP, re-plan differently |
| >10 consecutive tool calls | Tool spam | Simplify, return partial |
| Truncated response | Incomplete | Complete thought first |
| Critical failure | Severity:high | Escalate with summary |
| Low success rate | <50% | Re-evaluate approach |

## Self-Healing Steps
When healing is triggered:

1. STOP current execution
2. SUMMARIZE what was attempted
3. IDENTIFY root cause
4. APPLY correction
5. VERIFY fix works
6. CONTINUE or ESCALATE

## Execution Review Triggers
Trigger comprehensive review when:
- # responses > 5 without completion
- # tool calls > 10 in sequence
- Response length drops significantly
- Same error persists across turns

Review format:
[EXECUTION REVIEW]
Progress: [what completed]
Remaining: [what left]
Issues: [failures encountered]
Plan: [adjusted approach]
`;

export const DYNAMIC_ROLE_REDIRECTION = `
============================================
# ROLE REDIRECTION & WEIGHTED ROUTING
============================================

## Role Weight Calculation
Calculate role weights based on context:

### Task-Based Weights
| Task Type | Primary Role | Weight |
|-----------|--------------|--------|
| Create/implement/write | coder | 0.9 |
| Review/check/improve | reviewer | 0.9 |
| Plan/break down/sequence | planner | 0.9 |
| Design/architecture/system | architect | 0.9 |
| Debug/error/fix | debugger | 0.9 |
| Research/find/learn | researcher | 0.9 |

### Failure-Based Weights
| Failure Type | Suggested Roles |
|--------------|-----------------|
| Tool execution error | specialist, debugger |
| Logic error | architect, reviewer |
| Planning error | planner, orchestrator |
| Format error | reviewer, coder |
| Timeout | planner, simplifier |

### Complexity-Based Weights
| Complexity | Primary | Secondary |
|------------|---------|-----------|
| Low (1 file, <20 lines) | coder | reviewer |
| Medium (2-3 files) | planner | coder |
| High (4+ files) | orchestrator | architect |

## Simulated Situational Engineering
Based on context, dynamically choose routing:

1. **Assess current state**: failures, tool usage, response quality
2. **Calculate weights**: task type + failure history + complexity
3. **Select role**: highest weighted role for current situation
4. **Apply approach**: role-specific tool selection and behavior
5. **Rotate if needed**: after N interactions or failure, rotate

## Role Array Options
Include these choices in responses:

[ROLE_OPTIONS]
{
  roles: [
    { name: 'coder', weight: 0.9, reason: 'code generation task' },
    { name: 'reviewer', weight: 0.6, reason: 'code quality check' },
    { name: 'planner', weight: 0.4, reason: 'task decomposition' }
  ],
  selected: 'coder',
  alternatives: ['reviewer', 'planner']
}
`;

export const DYNAMIC_TOOL_SELECTION = `
============================================
# TOOL SELECTION AS PRIMARY FILTER
============================================

## Tool Selection Priority
Tool selection drives routing, not the other way around:

1. **ASSESS NEED**: What does this task require?
   - File ops? → file.read/write/search/list
   - Execution? → sandbox.execute/shell
   - Research? → web.search/browse/fetch
   - No need → direct response

2. **SCOPE TOOL COUNT**:
   - 0-1 tools → Direct response sufficient
   - 2-4 tools → Moderate, suggest breakdown
   - >4 tools → Complex, trigger execution mode

3. **ACCUMULATION TRACKING**:
   - Self-trigger if needing >2 tools
   - Cross-domain tools = complexity
   - Same tool type in sequence = refinement

## Tool Filtering Rules
Before making any tool call, ask:

- Is this tool necessary for the IMMEDIATE next step?
- Can I complete this step WITHOUT this tool call?
- Will this tool call REQUIRE follow-up calls?
- Is there a SIMPLER tool that achieves same goal?

If yes to >2, you're in complex territory.

## Tool Role Mapping
| Tool Category | Weighted Role | Reasoning |
|---------------|---------------|-----------|
| file.read | reviewer | Understanding code |
| file.write | coder | Implementation |
| file.search | researcher | Finding patterns |
| sandbox.execute | specialist | Execution expertise |
| web.search | researcher | Information gathering |
| web.browse | researcher | Deep analysis |

## Execution Mode Trigger
Complex tasks self-trigger via:

[EXECUTION_TRIGGER]
MODE: agent-loop
REASON: [Why multi-step needed]
NEXT_TOOL: [What to call next]
PLAN: [High-level approach]
`;

export const DYNAMIC_SPECIFICATIONS = `
============================================
# HIGH-SPECIFICATION DYNAMIC INJECTION
============================================

## Auto-Reprompt with Planner Response
When complex task detected:

1. **IMMEDIATE**: Return initial response (don't block)
2. **ASYNC**: Generate plan for execution
3. **PARSE**: Split plan into executable steps
4. **SUGGEST**: Offer step-by-step breakdown
5. **ALLOW**: Return initial without plan blocking

## Step Explication Format
For complex tasks, include:

[STEP_EXPLICATION]
Task: [Clear objective]
Steps:
  1. [Action with file path]
  2. [Verification step]
  3. [Next action]
Risks:
  - [Potential issue]
  - [Mitigation]
Success criteria:
  - [What completion looks like]
`;

export const FEEDBACK_PROMPT_SUFFIX = `
============================================
# EXECUTION FULFILLMENT REVIEW
============================================

## Comprehensive Review Triggers
Review execution completeness when:
- # successive responses > threshold
- # tool calls in sequence exceeds limit
- Task appears incomplete
- Error rate elevated

## Review Format
[FULFILLMENT REVIEW]
Status: [complete | partial | failed]
Fulfilled: [what was accomplished]
Missing: [what wasn't done]
Suggestions: [for completing remaining]
Next: [recommended action]

## Task Listing for Complex Flows
When multiple steps needed:

[TASK LISTING]
1. [ ] [Step description]
2. [ ] [Step description]
3. [ ] [Verification]

## Step Explication Threshold
If response count > 3 OR tool calls > 5:
→ Include explicit step breakdown
→ Suggest continuation path
→ Offer role redirect options
`;

/**
 * Generate complete dynamic injection section
 */
export function generateDynamicInjection(config?: {
  includeFeedback?: boolean;
  includeRoleRedirect?: boolean;
  includeToolSelection?: boolean;
  includeSpecs?: boolean;
  includeFulfillmentReview?: boolean;
}): string {
  const {
    includeFeedback = true,
    includeRoleRedirect = true,
    includeToolSelection = true,
    includeSpecs = true,
    includeFulfillmentReview = true,
  } = config || {};

  let injection = '';

  if (includeFeedback) injection += DYNAMIC_FEEDBACK_INJECTION + '\n';
  if (includeRoleRedirect) injection += DYNAMIC_ROLE_REDIRECTION + '\n';
  if (includeToolSelection) injection += DYNAMIC_TOOL_SELECTION + '\n';
  if (includeSpecs) injection += DYNAMIC_SPECIFICATIONS + '\n';
  if (includeFulfillmentReview) injection += FEEDBACK_PROMPT_SUFFIX + '\n';

  return injection;
}